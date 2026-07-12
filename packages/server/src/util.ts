// Small server utilities: paths, Pi detection, atomic writes.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root: walk up from this module until a package.json with workspaces appears. */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, 'utf8'));
        if (parsed.workspaces) return dir;
      } catch {
        /* keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Data dir: SPARKADE_DATA (relative → repo root) or ~/.sparkade. */
export function dataDir(): string {
  const env = process.env.SPARKADE_DATA;
  if (env && env.length > 0) return isAbsolute(env) ? env : resolve(repoRoot(), env);
  return join(homedir(), '.sparkade');
}

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

/** Crash-safe file write: write a temp sibling, fsync-free rename over the target. */
export function atomicWriteFile(path: string, data: string | Buffer): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data);
  try {
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Real Raspberry Pi detection via device-tree; SPARKADE_FORCE_PI=1 forces mock-Pi mode. */
export function isRealPi(): boolean {
  try {
    const model = readFileSync('/proc/device-tree/model', 'utf8');
    return model.toLowerCase().includes('raspberry pi');
  } catch {
    return false;
  }
}

export function isForcedPi(): boolean {
  return process.env.SPARKADE_FORCE_PI === '1';
}

export function piMode(): boolean {
  return isRealPi() || isForcedPi();
}

/** Best-guess LAN IPv4 for the system info screen. */
export function primaryIp(): string {
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Sleep helper honoring an AbortSignal. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const t = setTimeout(() => resolvePromise(), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    });
  });
}
