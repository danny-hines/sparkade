// In-app self-update (cabinet only): the settings screen can pull + build + restart
// without SSH. We reuse the `sparkade update` CLI (git fetch latest tag → npm
// install if deps changed → build → `sudo systemctl restart sparkade`) — no new
// privileges beyond the systemctl-restart the sudoers already allows.
//
// Restart survival: `systemctl restart sparkade` kills this service's whole
// process group, so the updater is spawned DETACHED and only issues the restart
// as its final step (after the build), by which point systemd has the restart
// job queued independently. The kiosk then hard-reloads via its instanceId poll.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { join } from 'node:path';
import type { SoftwareUpdateStatus } from '@sparkade/shared';
import { repoRoot } from '../util';

let updating = false;
let lastUpdateStatus: SoftwareUpdateStatus = { state: 'idle' };

export interface UpdateCheck {
  current: string;
  /** Latest available version/tag, or the current version when up to date. */
  latest: string | null;
  available: boolean;
  /** Set when the check couldn't complete (offline, not a git checkout, …). */
  error?: string;
}

/** Compare the local checkout against the latest remote tag (or origin/main).
 *  Read-only: `git fetch` updates remote refs but never touches the work tree. */
export function checkForUpdate(current: string): UpdateCheck {
  const dir = repoRoot();
  const git = (args: string[]) =>
    spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 30_000 });
  const revision = (ref: string): string => {
    const result = git(['rev-parse', '--verify', `${ref}^{commit}`]);
    const value = result.stdout?.trim();
    if (result.status !== 0 || !value || !/^[a-f0-9]{40,64}$/i.test(value)) {
      throw new Error(
        (result.stderr || result.error?.message || `Could not read Git revision ${ref}`)
          .trim()
          .slice(0, 200),
      );
    }
    return value;
  };
  try {
    const fetched = git(['fetch', '--tags', '--force', '--quiet']);
    if (fetched.status !== 0) {
      return {
        current,
        latest: null,
        available: false,
        error: (fetched.stderr || fetched.error?.message || 'could not reach the update server')
          .trim()
          .slice(0, 200),
      };
    }
    const localHead = revision('HEAD');
    const mainHead = revision('origin/main');
    // Android APK/channel tags must never pin the Pi to a Portal release commit.
    const tagResult = git([
      'describe',
      '--tags',
      '--abbrev=0',
      '--exclude=portal-*',
      'origin/main',
    ]);
    const latestTag = tagResult.status === 0 ? tagResult.stdout.trim() : '';
    let remoteHead: string;
    let label: string;
    if (latestTag) {
      remoteHead = revision(latestTag);
      label = latestTag;
    } else {
      remoteHead = mainHead;
      label = 'main';
    }
    const available = remoteHead !== localHead;
    return { current, latest: available ? label : current, available };
  } catch (e) {
    return {
      current,
      latest: null,
      available: false,
      error: e instanceof Error ? e.message : 'check failed',
    };
  }
}

export function updateInProgress(): boolean {
  return updating;
}

export function getUpdateStatus(): SoftwareUpdateStatus {
  return lastUpdateStatus;
}

/** Launch `sparkade update` detached. Returns immediately; the process outlives
 *  this server and restarts the service when done (or exits cleanly on failure,
 *  leaving the running version untouched). */
export function startUpdate(logPath: string): { started: boolean; reason?: string } {
  if (updating) return { started: false, reason: 'An update is already running.' };
  const cli = join(repoRoot(), 'packages', 'cli', 'dist', 'index.js');
  if (!existsSync(cli)) return { started: false, reason: 'updater not installed on this machine' };
  try {
    // Capture output so a failed run is inspectable at <dataDir>/update.log.
    let out: 'ignore' | number = 'ignore';
    try {
      out = openSync(logPath, 'a');
    } catch {
      /* unwritable data dir — fall back to discarding output */
    }
    const child = spawn(process.execPath, [cli, 'update'], {
      cwd: repoRoot(),
      detached: true,
      stdio: ['ignore', out, out],
      env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
    });
    updating = true;
    lastUpdateStatus = { state: 'running' };
    // On a successful update the service restarts and kills us first; if it fails
    // before that (offline, bad build), the child exits and we clear the flag so
    // the button isn't wedged. A stale in-memory flag also resets on restart.
    child.on('exit', (code, signal) => {
      updating = false;
      lastUpdateStatus =
        code === 0
          ? { state: 'succeeded' }
          : {
              state: 'failed',
              message: `Update failed${code !== null ? ` with exit code ${code}` : signal ? ` after signal ${signal}` : ''}. Details are in ${logPath}.`,
            };
    });
    child.on('error', (error) => {
      updating = false;
      lastUpdateStatus = { state: 'failed', message: `Update could not start: ${error.message}` };
    });
    child.unref();
    return { started: true };
  } catch (e) {
    return {
      started: false,
      reason: e instanceof Error ? e.message : 'could not start the updater',
    };
  }
}
