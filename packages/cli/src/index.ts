// `sparkade` CLI — status, logs, update, restart, config, provider test,
// backup/restore, doctor, remote Chromium debugging, kiosk enable/disable.
// Secrets go to the env file with 0600 perms and are never echoed in full.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const REPO = process.env.SPARKADE_REPO_DIR ?? '/opt/sparkade';
const ENV_FILE = process.platform === 'linux' ? '/etc/sparkade/env' : join(repoDir(), '.env');
const SERVICE = 'sparkade';

function repoDir(): string {
  if (existsSync(join(REPO, 'package.json'))) return REPO;
  // dev fallback: walk up from this script
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'packages'))) return dir;
    dir = resolve(dir, '..');
  }
  return REPO;
}

function dataDir(): string {
  const env = process.env.SPARKADE_DATA;
  if (env) return isAbsolute(env) ? env : resolve(repoDir(), env);
  return join(homedir(), '.sparkade');
}

function sh(cmd: string, args: string[], opts: { quiet?: boolean; check?: boolean; cwd?: string } = {}): string {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    cwd: opts.cwd,
    stdio: opts.quiet ? 'pipe' : ['inherit', 'pipe', 'pipe'],
  });
  if (opts.check !== false && res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${res.stderr ?? ''}`);
  }
  return (res.stdout ?? '').trim();
}

function tryRun(cmd: string, args: string[]): { ok: boolean; out: string } {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  return { ok: res.status === 0, out: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim() };
}

function serverGet<T>(path: string): T | null {
  try {
    const out = execFileSync(
      'curl',
      ['-fsS', '--max-time', '4', `http://127.0.0.1:8080${path}`],
      { encoding: 'utf8' },
    );
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dataDir(), 'config.json'), 'utf8'));
}

function writeConfig(cfg: Record<string, unknown>): void {
  writeFileSync(join(dataDir(), 'config.json'), JSON.stringify(cfg, null, 2));
}

function readEnvVar(name: string): string | undefined {
  if (!existsSync(ENV_FILE)) return undefined;
  const match = new RegExp(`^${name}=(.*)$`, 'm').exec(readFileSync(ENV_FILE, 'utf8'));
  return match?.[1];
}

function writeEnvVar(name: string, value: string): void {
  mkdirSync(resolve(ENV_FILE, '..'), { recursive: true });
  let lines: string[] = [];
  if (existsSync(ENV_FILE)) lines = readFileSync(ENV_FILE, 'utf8').split('\n').filter(Boolean);
  lines = lines.filter((line) => !line.startsWith(`${name}=`));
  lines.push(`${name}=${value}`);
  writeFileSync(ENV_FILE, lines.join('\n') + '\n');
  chmodSync(ENV_FILE, 0o600);
}

function getPath(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function setPath(obj: unknown, path: string, value: unknown): void {
  const segs = path.split('.');
  let cur = obj as Record<string, unknown>;
  for (const seg of segs.slice(0, -1)) {
    if (typeof cur[seg] !== 'object' || cur[seg] === null) cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  let parsed: unknown = value;
  if (typeof value === 'string') {
    if (value === 'true') parsed = true;
    else if (value === 'false') parsed = false;
    else if (/^-?\d+(\.\d+)?$/.test(value)) parsed = Number(value);
  }
  cur[segs[segs.length - 1]!] = parsed;
}

function maskKey(v: string): string {
  return v.length <= 8 ? '••••' : `${v.slice(0, 4)}…${v.slice(-2)} (${v.length} chars)`;
}

// ---------------------------------------------------------------------------

function cmdStatus(): void {
  const info = serverGet<{
    version: string;
    ip: string;
    diskFreeBytes: number;
    gameCount: number;
    lifetimeSpendUsd: number;
    dataDir: string;
    model: string;
    provider: string;
  }>('/api/system/info');
  const svc = tryRun('systemctl', ['is-active', SERVICE]);
  console.log(`service    ${svc.ok ? svc.out : 'not running / not installed'}`);
  if (info) {
    console.log(`version    ${info.version}`);
    console.log(`ip         ${info.ip}`);
    console.log(`data dir   ${info.dataDir}`);
    console.log(`disk free  ${(info.diskFreeBytes / 1e9).toFixed(1)} GB`);
    console.log(`games      ${info.gameCount}`);
    console.log(`model      ${info.provider} · ${info.model}`);
    console.log(`lifetime   $${info.lifetimeSpendUsd.toFixed(3)} API spend`);
  } else {
    console.log('server     not answering on 127.0.0.1:8080');
  }
}

function cmdLogs(follow: boolean): void {
  spawnSync('journalctl', ['-u', SERVICE, ...(follow ? ['-f'] : ['-n', '200']), '--no-pager'], {
    stdio: 'inherit',
  });
}

function cmdUpdate(): void {
  const dir = repoDir();
  // The server needs Node's built-in node:sqlite (Node >= 22.13). `sparkade
  // update` builds + restarts but does NOT manage Node — only the installer
  // does. On an older Node, building + restarting would just crash-loop the
  // service, so refuse up front (leaving the running server intact) and point
  // at the installer, which upgrades Node.
  if (spawnSync('node', ['-e', 'require("node:sqlite")'], { stdio: 'ignore' }).status !== 0) {
    console.error("This version needs Node with built-in node:sqlite (>= 22.13); this box's node is older.");
    console.error('Re-run the installer to upgrade Node (idempotent, keeps your data):');
    console.error('  curl -fsSL "https://raw.githubusercontent.com/danny-hines/sparkade/main/install/install.sh?$(date +%s)" | bash');
    process.exit(1);
  }
  console.log(`updating ${dir} …`);
  // Track the lockfile so we can skip a reinstall when only source changed.
  const lockId = (): string => {
    try {
      return sh('git', ['-C', dir, 'rev-parse', 'HEAD:package-lock.json'], { quiet: true });
    } catch {
      return '';
    }
  };
  const lockBefore = lockId();
  sh('git', ['-C', dir, 'fetch', '--tags', '--force'], {});
  let target = '';
  try {
    target = sh('git', ['-C', dir, 'describe', '--tags', '--abbrev=0', 'origin/main'], { quiet: true });
  } catch {
    /* no tags */
  }
  if (target) {
    console.log(`checking out latest tag ${target}`);
    sh('git', ['-C', dir, 'checkout', target], {});
  } else {
    console.log('no tags found — pulling main');
    sh('git', ['-C', dir, 'checkout', 'main'], {});
    sh('git', ['-C', dir, 'pull', '--ff-only'], {});
  }
  // npm must run IN the repo, not wherever the user typed `sparkade update`
  // (the git steps use -C, but these need cwd or npm would find no lockfile).
  // Skip the Playwright browser download — a dev-only e2e dep the cabinet never
  // runs; downloading it is a big time sink on the Pi's network.
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
  // Incremental install: `npm ci` wipes node_modules and reinstalls everything
  // every run (slow SD-card I/O on a Pi). Only reinstall when the lockfile
  // actually changed; a source-only update then goes straight to the build.
  // (The installer still uses `npm ci` for a clean first install.)
  const depsChanged = lockId() !== lockBefore;
  if (depsChanged || !existsSync(join(dir, 'node_modules'))) {
    console.log('dependencies changed — installing …');
    sh('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir });
    // Keep the working tree clean so the next `git pull --ff-only` never trips.
    tryRun('git', ['-C', dir, 'checkout', '--', 'package-lock.json']);
  } else {
    console.log('dependencies unchanged — skipping install');
  }
  console.log('build …');
  sh('npm', ['run', 'build'], { cwd: dir });
  // The kiosk launcher is installed outside the checkout. Keep it in sync so
  // source updates (including Chromium flags) do not require rerunning the full
  // OS installer. A running startx session still needs one reboot to load a new
  // launcher; `sparkade debug` detects that case and says so.
  if (process.platform === 'linux') {
    const launcherSrc = join(dir, 'install', 'kiosk', 'launch.sh');
    const launcherDst = join(homedir(), '.sparkade-kiosk-launch.sh');
    if (existsSync(launcherSrc) && existsSync(launcherDst)) {
      copyFileSync(launcherSrc, launcherDst);
      chmodSync(launcherDst, 0o755);
      console.log('kiosk launcher updated (reboot once if its Chromium flags changed)');
    }
  }
  console.log('restarting service (the kiosk reloads itself via version poll) …');
  tryRun('sudo', ['-n', 'systemctl', 'restart', SERVICE]);
  console.log('update complete. The data dir was not touched.');
}

function cmdRestart(): void {
  const res = tryRun('sudo', ['-n', 'systemctl', 'restart', SERVICE]);
  console.log(res.ok ? 'restarted' : `failed: ${res.out}`);
}

function cmdConfig(args: string[]): void {
  const [op, path, ...rest] = args;
  if (op === 'get' && path) {
    const v = getPath(readConfig(), path);
    console.log(JSON.stringify(v, null, 2));
  } else if (op === 'set' && path && rest.length) {
    const cfg = readConfig();
    setPath(cfg, path, rest.join(' '));
    writeConfig(cfg);
    console.log(`set ${path}. Restart the service to apply: sparkade restart`);
  } else if (op === 'edit') {
    const editor = process.env.EDITOR ?? 'nano';
    spawnSync(editor, [join(dataDir(), 'config.json')], { stdio: 'inherit' });
  } else if (op === 'set-provider' && path) {
    // sparkade config set-provider <meta|anthropic|compat> [model] [baseUrl]
    // Points the five text-generation stages at the provider. The stt (voice
    // transcription) stage stays on an audio-capable provider — only meta has
    // audioIn — so a non-meta text provider still needs a Meta key for voice.
    const name = path;
    const [modelArg, baseUrlArg] = rest;
    const cfg = readConfig() as {
      providers: Record<string, { kind?: string; baseUrl?: string }>;
      stages: Record<string, { provider: string; model: string }>;
    };
    if (!cfg.providers?.[name]) {
      console.error(`unknown provider "${name}". Known: ${Object.keys(cfg.providers ?? {}).join(', ')}`);
      process.exit(1);
    }
    const DEFAULT_MODELS: Record<string, string> = { meta: 'muse-spark-1.1', anthropic: 'claude-haiku-4-5-20251001' };
    const model = modelArg || DEFAULT_MODELS[name];
    if (!model) {
      console.error(`provider "${name}" needs an explicit model: sparkade config set-provider ${name} <model> [baseUrl]`);
      process.exit(1);
    }
    const TEXT_STAGES = ['design', 'levels', 'entities', 'music', 'repair'];
    for (const s of TEXT_STAGES) cfg.stages[s] = { ...cfg.stages[s], provider: name, model };
    if (name === 'meta') cfg.stages['stt'] = { provider: 'meta', model };
    if (name === 'compat' && baseUrlArg) cfg.providers['compat']!.baseUrl = baseUrlArg;
    writeConfig(cfg);
    console.log(`text stages (design/levels/entities/music/repair) → ${name} · ${model}`);
    const sttProvider = cfg.stages['stt']?.provider ?? 'meta';
    if (name !== 'meta') {
      console.log(`voice transcription (stt) stays on "${sttProvider}" — only Meta can transcribe audio.`);
      console.log(`  → set that provider's key for voice input, or generate from the preset cards.`);
    }
    if (name === 'compat') {
      const url = cfg.providers['compat']?.baseUrl;
      console.log(url ? `compat baseUrl: ${url}` : 'compat baseUrl not set — sparkade config set providers.compat.baseUrl <url>');
    }
    console.log('Restart to apply: sparkade restart');
  } else if (op === 'set-key' && path) {
    // sparkade config set-key META_API_KEY <value> — written to the env file, 0600.
    const value = rest.join(' ');
    if (!value) {
      console.error('usage: sparkade config set-key <ENV_NAME> <value>');
      process.exit(1);
    }
    writeEnvVar(path, value);
    console.log(`${path} saved to ${ENV_FILE} (${maskKey(value)})`);
  } else {
    console.log(
      'usage: sparkade config get <path> | set <path> <value> | set-key <ENV> <value>\n' +
        '       | set-provider <meta|anthropic|compat> [model] [baseUrl] | edit',
    );
  }
}

async function cmdProviderTest(): Promise<void> {
  // Load env file so keys resolve like the service sees them.
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!;
    }
  }
  const cfg = readConfig() as {
    providers: Record<string, { kind: string; baseUrl?: string; apiKeyEnv?: string }>;
    stages: Record<string, { provider: string; model: string }>;
    pricing: Record<string, { inputPerM: number; outputPerM: number }>;
  };
  for (const [name, p] of Object.entries(cfg.providers)) {
    if (p.kind === 'mock') continue;
    if (p.kind === 'openai-compatible' && !p.baseUrl) {
      console.log(`${name.padEnd(10)} skipped (no baseUrl configured)`);
      continue;
    }
    const key = p.apiKeyEnv ? process.env[p.apiKeyEnv] : undefined;
    if (!key) {
      console.log(`${name.padEnd(10)} skipped (no ${p.apiKeyEnv} in ${ENV_FILE})`);
      continue;
    }
    const model =
      Object.values(cfg.stages).find((s) => s.provider === name)?.model ??
      (p.kind === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'muse-spark-1.1');
    const started = Date.now();
    try {
      let url: string;
      let headers: Record<string, string>;
      let body: string;
      if (p.kind === 'anthropic') {
        url = `${p.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`;
        headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
        body = JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: 'Say OK' }] });
      } else {
        url = `${p.baseUrl}/chat/completions`;
        headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
        body = JSON.stringify({
          model,
          max_completion_tokens: 8,
          messages: [{ role: 'user', content: 'Say OK' }],
        });
      }
      const res = await fetch(url, { method: 'POST', headers, body });
      const ms = Date.now() - started;
      if (!res.ok) {
        console.log(`${name.padEnd(10)} HTTP ${res.status} in ${ms}ms`);
        continue;
      }
      const json = (await res.json()) as { usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number } };
      const input = json.usage?.prompt_tokens ?? json.usage?.input_tokens ?? 0;
      const output = json.usage?.completion_tokens ?? json.usage?.output_tokens ?? 0;
      const price = cfg.pricing[model];
      const cost = price ? (input / 1e6) * price.inputPerM + (output / 1e6) * price.outputPerM : null;
      console.log(
        `${name.padEnd(10)} OK ${ms}ms · ${input}+${output} tokens · ${cost === null ? 'cost unavailable' : `$${cost.toFixed(5)}`}`,
      );
    } catch (e) {
      console.log(`${name.padEnd(10)} FAILED: ${(e as Error).message}`);
    }
  }
}

function cmdBackup(args: string[]): void {
  const [sub, file] = args[0] === 'restore' ? ['restore', args[1]] : ['create', args[0]];
  const dir = dataDir();
  if (sub === 'restore') {
    if (!file || !existsSync(file)) {
      console.error('usage: sparkade backup restore <file.tar.gz>');
      process.exit(1);
    }
    console.log(`This will REPLACE the data dir ${dir} with the backup.`);
    process.stdout.write('Type "yes" to continue: ');
    const answer = readFileSync(0, 'utf8').trim().toLowerCase();
    if (answer !== 'yes') {
      console.log('aborted');
      return;
    }
    tryRun('systemctl', ['stop', SERVICE]);
    sh('tar', ['-xzf', resolve(file), '-C', resolve(dir, '..')], {});
    tryRun('systemctl', ['start', SERVICE]);
    console.log('restored');
    return;
  }
  const out = file ?? `sparkade-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;
  const base = dir.split(/[\\/]/).pop()!;
  sh('tar', ['-czf', out, '-C', resolve(dir, '..'), base], {});
  console.log(`backup written to ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
}

function cmdDoctor(): void {
  const checks: [string, () => string][] = [
    [
      'node version',
      () => {
        const v = process.versions.node;
        return Number(v.split('.')[0]) >= 20 ? `OK (${v})` : `TOO OLD (${v}, need >= 20)`;
      },
    ],
    [
      'service',
      () => {
        const r = tryRun('systemctl', ['is-active', SERVICE]);
        return r.ok ? 'OK (active)' : `NOT ACTIVE (${r.out || 'systemd unavailable'})`;
      },
    ],
    [
      'port 8080',
      () => (serverGet('/api/system/info') ? 'OK (answering)' : 'NOT ANSWERING'),
    ],
    [
      'chromium',
      () => {
        for (const bin of ['chromium', 'chromium-browser']) {
          if (tryRun('which', [bin]).ok) return `OK (${bin})`;
        }
        return 'MISSING (apt install chromium)';
      },
    ],
    [
      'gamepad',
      () => {
        // Zero Delay boards typically show as "DragonRise Inc. Generic USB Joystick"
        // (VID 0079). Some clones enumerate as keyboards instead — that's fine,
        // the input layer treats keyboards as first-class.
        try {
          const devices = readFileSync('/proc/bus/input/devices', 'utf8');
          const js = readdirSync('/dev/input').filter((f) => f.startsWith('js'));
          const m = /N: Name="([^"]*)"[\s\S]*?H: Handlers=[^\n]*js\d/.exec(devices);
          if (js.length && m) return `OK (${m[1]} on /dev/input/${js[0]})`;
          if (js.length) return `OK (/dev/input/${js[0]})`;
          if (/dragonrise|0079/i.test(devices)) return 'PRESENT as keyboard-mode clone (works — remap on first boot)';
          return 'NOT FOUND — check the USB encoder (keyboard-mode clones also work)';
        } catch {
          return 'cannot read /proc/bus/input/devices (not Linux?)';
        }
      },
    ],
    [
      'camera',
      () => (existsSync('/dev/video0') ? 'OK (/dev/video0)' : 'NOT FOUND'),
    ],
    [
      'microphone',
      () => {
        const r = tryRun('arecord', ['-l']);
        return r.ok && /card \d/.test(r.out) ? 'OK' : 'NOT FOUND (arecord -l)';
      },
    ],
    [
      'api key',
      () => {
        if (!existsSync(ENV_FILE)) return `MISSING (${ENV_FILE} does not exist)`;
        const env = readFileSync(ENV_FILE, 'utf8');
        const m = /^META_API_KEY=(.+)$/m.exec(env);
        return m ? `OK (${maskKey(m[1]!)})` : 'MISSING (META_API_KEY not set — sparkade config set-key META_API_KEY <key>)';
      },
    ],
  ];
  for (const [name, fn] of checks) {
    let result: string;
    try {
      result = fn();
    } catch (e) {
      result = `ERROR: ${(e as Error).message}`;
    }
    console.log(`${name.padEnd(14)} ${result}`);
  }
  console.log(
    '\nWrong camera/mic used at capture? The kiosk picks a default input — choose the\n' +
      'right USB device in Settings → Camera & Mic (with a live preview + mic meter).',
  );
  console.log('provider ping: run `sparkade provider test` (makes one tiny paid call)');
}

function cmdLan(action: string | undefined): void {
  if (process.platform !== 'linux') {
    console.error('LAN mode is Pi-only. Run `sparkade lan on|off|status` on the cabinet.');
    process.exitCode = 1;
    return;
  }
  if (action && !['on', 'off', 'status'].includes(action)) {
    console.error('usage: sparkade lan on|off|status');
    process.exitCode = 1;
    return;
  }

  const configuredBind = readEnvVar('SPARKADE_BIND') ?? '127.0.0.1';
  const currentlyEnabled = configuredBind !== '127.0.0.1' && configuredBind !== 'localhost';
  const info = serverGet<{ ip: string }>('/api/system/info');
  const hostname = tryRun('hostname', ['-I']);
  const ip =
    (info?.ip && info.ip !== '127.0.0.1' ? info.ip : undefined) ??
    (hostname.ok ? hostname.out.split(/\s+/).find(Boolean) : undefined) ??
    '<pi-ip>';

  if (!action || action === 'status') {
    console.log(`LAN access  ${currentlyEnabled ? 'ON' : 'OFF'} (${configuredBind}:8080)`);
    console.log(currentlyEnabled ? `Kiosk URL  http://${ip}:8080` : 'Kiosk is reachable only from the Pi.');
    return;
  }

  const enabled = action === 'on';
  writeEnvVar('SPARKADE_BIND', enabled ? '0.0.0.0' : '127.0.0.1');
  const restarted = tryRun('sudo', ['-n', 'systemctl', 'restart', SERVICE]);
  if (!restarted.ok) {
    console.error(`Saved the setting, but the service restart failed: ${restarted.out}`);
    console.error('Apply it manually with: sparkade restart');
    process.exitCode = 1;
    return;
  }

  if (enabled) {
    console.log(`LAN access enabled: http://${ip}:8080`);
    console.log('Anyone on this local network can use the full kiosk and API until you run `sparkade lan off`.');
  } else {
    console.log('LAN access disabled. Sparkade is localhost-only again.');
  }
}

function cmdDebug(): void {
  if (process.platform !== 'linux') {
    console.error('Run `sparkade debug` on the Raspberry Pi, then use the printed command on this computer.');
    process.exitCode = 1;
    return;
  }

  const endpoint = tryRun('curl', [
    '-fsS',
    '--max-time',
    '2',
    'http://127.0.0.1:9222/json/version',
  ]);
  const info = serverGet<{ ip: string }>('/api/system/info');
  let ip = info?.ip;
  if (!ip || ip === '127.0.0.1') {
    const hostname = tryRun('hostname', ['-I']);
    ip = hostname.ok ? hostname.out.split(/\s+/).find(Boolean) : undefined;
  }
  const user = process.env.SUDO_USER || userInfo().username;
  const host = ip || '<pi-ip>';

  console.log(`Chromium DevTools  ${endpoint.ok ? 'ready' : 'not active'} (127.0.0.1:9222 only)`);
  if (!endpoint.ok) {
    console.log('The installed kiosk launcher does not appear to be running with debugging enabled.');
    console.log('After updating Sparkade, reboot the Pi once, then run this command again:');
    console.log('  sudo reboot');
    process.exitCode = 1;
    return;
  }

  console.log('\nOn your computer, keep this tunnel running:');
  console.log(`  ssh -N -L 9222:127.0.0.1:9222 ${user}@${host}`);
  console.log('\nThen in Chrome:');
  console.log('  1. Open chrome://inspect/#devices');
  console.log('  2. Configure target discovery: localhost:9222');
  console.log('  3. Click "inspect" under the Sparkade tab');
  console.log('\nCtrl+C closes the tunnel. DevTools is not exposed directly to the network.');
}

function cmdKiosk(enable: boolean): void {
  if (process.platform !== 'linux') {
    console.log('kiosk mode is Pi-only');
    return;
  }
  if (enable) {
    sh('sudo', ['-n', 'raspi-config', 'nonint', 'do_boot_behaviour', 'B2'], { check: false });
    console.log('console autologin enabled; the kiosk starts on next boot (see install/kiosk)');
  } else {
    sh('sudo', ['-n', 'raspi-config', 'nonint', 'do_boot_behaviour', 'B1'], { check: false });
    console.log('kiosk autostart disabled (boot to console login)');
  }
}

// ---------------------------------------------------------------------------

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case 'status':
    cmdStatus();
    break;
  case 'logs':
    cmdLogs(args.includes('-f'));
    break;
  case 'update':
    cmdUpdate();
    break;
  case 'restart':
    cmdRestart();
    break;
  case 'config':
    cmdConfig(args);
    break;
  case 'provider':
    if (args[0] === 'test') await cmdProviderTest();
    else console.log('usage: sparkade provider test');
    break;
  case 'backup':
    cmdBackup(args);
    break;
  case 'doctor':
    cmdDoctor();
    break;
  case 'lan':
    cmdLan(args[0]);
    break;
  case 'debug':
    cmdDebug();
    break;
  case 'kiosk':
    cmdKiosk(args[0] === 'enable');
    break;
  default:
    console.log(`sparkade — self-hosted arcade that generates its own games

usage:
  sparkade status                     service, version, IP, disk, games, lifetime spend
  sparkade logs [-f]                  journalctl passthrough
  sparkade update                     git fetch latest tag (or main) → npm ci → build → restart
  sparkade restart                    restart the service
  sparkade config get <path>          read config.json (dot path)
  sparkade config set <path> <value>  write config.json
  sparkade config set-key <ENV> <v>   store an API key in the env file (0600)
  sparkade config set-provider <name> [model] [baseUrl]
                                      point generation at meta | anthropic | compat
  sparkade config edit                open config.json in $EDITOR
  sparkade provider test              one tiny paid call per configured provider
  sparkade backup [file]              tar.gz the data dir
  sparkade backup restore <file>      restore it (asks for confirmation)
  sparkade doctor                     node/service/port/chromium/gamepad/camera/mic/key checks
  sparkade lan on|off|status          toggle direct access to the web kiosk from the LAN
  sparkade debug                      print a secure SSH tunnel for Chromium DevTools
  sparkade kiosk enable|disable       toggle kiosk autostart`);
}
