// `sparkade` CLI — status, logs, update, restart, config, provider test,
// backup/restore, doctor, kiosk enable/disable.
// Secrets go to the env file with 0600 perms and are never echoed in full.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
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

function sh(cmd: string, args: string[], opts: { quiet?: boolean; check?: boolean } = {}): string {
  const res = spawnSync(cmd, args, { encoding: 'utf8', stdio: opts.quiet ? 'pipe' : ['inherit', 'pipe', 'pipe'] });
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
  console.log(`updating ${dir} …`);
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
  console.log('npm ci …');
  sh('npm', ['ci', '--no-audit', '--no-fund'], {});
  console.log('build …');
  sh('npm', ['run', 'build'], {});
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
  } else if (op === 'set-key' && path) {
    // sparkade config set-key META_API_KEY <value> — written to the env file, 0600.
    const value = rest.join(' ');
    if (!value) {
      console.error('usage: sparkade config set-key <ENV_NAME> <value>');
      process.exit(1);
    }
    mkdirSync(resolve(ENV_FILE, '..'), { recursive: true });
    let lines: string[] = [];
    if (existsSync(ENV_FILE)) lines = readFileSync(ENV_FILE, 'utf8').split('\n').filter(Boolean);
    lines = lines.filter((l) => !l.startsWith(`${path}=`));
    lines.push(`${path}=${value}`);
    writeFileSync(ENV_FILE, lines.join('\n') + '\n');
    chmodSync(ENV_FILE, 0o600);
    console.log(`${path} saved to ${ENV_FILE} (${maskKey(value)})`);
  } else {
    console.log('usage: sparkade config get <path> | set <path> <value> | set-key <ENV> <value> | edit');
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
  console.log('\nprovider ping: run `sparkade provider test` (makes one tiny paid call)');
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
  sparkade config edit                open config.json in $EDITOR
  sparkade provider test              one tiny paid call per configured provider
  sparkade backup [file]              tar.gz the data dir
  sparkade backup restore <file>      restore it (asks for confirmation)
  sparkade doctor                     node/service/port/chromium/gamepad/camera/mic/key checks
  sparkade kiosk enable|disable       toggle kiosk autostart`);
}
