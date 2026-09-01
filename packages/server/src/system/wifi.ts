// WiFi management via nmcli (Bookworm default). Pi-only; on non-Pi these are
// never routed (404) unless SPARKADE_FORCE_PI=1 serves the labeled mock.
// SECURITY: the PSK is fed on stdin (`nmcli --ask`), never in argv or logs.
import { spawn } from 'node:child_process';
import type { WifiNetwork, WifiStatus } from '@sparkade/shared';
import { isForcedPi } from '../util';

interface NmcliResult {
  code: number;
  out: string;
  err: string;
}

function runNmcli(args: string[], stdin?: string, timeoutMs = 45_000): Promise<NmcliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', 'nmcli', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Error classification below relies on stable English output. sudo
      // normally preserves locale variables, so set both common entry points.
      env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('nmcli timed out'));
    }, timeoutMs);
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out, err });
    });
    // sudo can reject an invocation before stdin is written (for example, an
    // out-of-date sudoers rule). Do not let the resulting EPIPE crash Node.
    child.stdin.on('error', () => {});
    if (stdin !== undefined) child.stdin.write(stdin + '\n');
    child.stdin.end();
  });
}

/** Parse one nmcli terse row, where both `:` and `\\` are backslash-escaped. */
export function parseNmcliTerseRow(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '\\' && i + 1 < line.length) {
      field += line[++i]!;
    } else if (ch === ':') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

export function wifiSecurityDetails(
  raw: string | undefined,
): Pick<WifiNetwork, 'security' | 'secured' | 'requiresPassword' | 'supported'> {
  const security = raw?.trim() && raw.trim() !== '--' ? raw.trim() : null;
  if (!security) {
    return { security: null, secured: false, requiresPassword: false, supported: true };
  }
  const enterprise = /(?:802[.-]1x|\beap\b)/i.test(security);
  const enhancedOpen = /\bowe\b/i.test(security);
  return {
    security,
    secured: true,
    requiresPassword: !enterprise && !enhancedOpen,
    supported: !enterprise,
  };
}

export function parseWifiNetworks(output: string): WifiNetwork[] {
  const seen = new Map<string, WifiNetwork>();
  for (const line of output.split('\n')) {
    if (!line) continue;
    const [ssid, signal, security, inUse] = parseNmcliTerseRow(line);
    if (!ssid) continue;
    const net: WifiNetwork = {
      ssid,
      signal: Number(signal) || 0,
      ...wifiSecurityDetails(security),
      current: inUse === '*',
    };
    const prev = seen.get(ssid);
    if (!prev || net.signal > prev.signal || net.current) {
      seen.set(ssid, { ...net, current: net.current || prev?.current || false });
    }
  }
  return [...seen.values()].sort(
    (a, b) => Number(b.current) - Number(a.current) || b.signal - a.signal,
  );
}

export function validateSsid(ssid: string): string | null {
  const bytes = Buffer.byteLength(ssid, 'utf8');
  if (bytes < 1 || bytes > 32) return 'SSID must be between 1 and 32 bytes';
  for (let i = 0; i < ssid.length; i++) {
    const code = ssid.charCodeAt(i);
    if (code < 32 || code === 127) return 'SSID contains unsupported control characters';
  }
  return null;
}

function validatePsk(psk: string): string | null {
  if (Buffer.byteLength(psk, 'utf8') > 256) return 'WiFi password is too long';
  if (psk.includes('\0') || psk.includes('\r') || psk.includes('\n')) {
    return 'WiFi password contains unsupported characters';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mock (SPARKADE_FORCE_PI=1 off-Pi): clearly labeled, stateful, no system calls.
// ---------------------------------------------------------------------------

const mockState = { connected: true, ssid: 'MOCK-HomeNet' };

const MOCK_NETWORKS: WifiNetwork[] = [
  {
    ssid: 'MOCK-HomeNet',
    signal: 86,
    ...wifiSecurityDetails('WPA2'),
    current: true,
  },
  {
    ssid: 'MOCK-Workshop',
    signal: 64,
    ...wifiSecurityDetails('WPA2'),
    current: false,
  },
  {
    ssid: 'MOCK-CoffeeShop',
    signal: 42,
    ...wifiSecurityDetails('--'),
    current: false,
  },
  {
    ssid: 'MOCK-Corporate',
    signal: 31,
    ...wifiSecurityDetails('WPA2 802.1X'),
    current: false,
  },
  {
    ssid: 'MOCK-Neighbor 5G',
    signal: 23,
    ...wifiSecurityDetails('WPA3'),
    current: false,
  },
];

export async function listNetworks(): Promise<WifiNetwork[]> {
  if (isForcedPi()) {
    return MOCK_NETWORKS.map((n) => ({
      ...n,
      current: mockState.connected && n.ssid === mockState.ssid,
    }));
  }
  const res = await runNmcli([
    '-t',
    '-f',
    'SSID,SIGNAL,SECURITY,IN-USE',
    'dev',
    'wifi',
    'list',
    '--rescan',
    'yes',
  ]);
  if (res.code !== 0) throw new Error(`wifi scan failed: ${res.err.trim() || res.code}`);
  return parseWifiNetworks(res.out);
}

export async function wifiStatus(): Promise<WifiStatus> {
  if (isForcedPi()) {
    return {
      connected: mockState.connected,
      ssid: mockState.connected ? mockState.ssid : null,
      ip: mockState.connected ? '192.168.1.42' : null,
      mock: true,
    };
  }
  const res = await runNmcli(['-t', '-f', 'ACTIVE,SSID', 'dev', 'wifi']);
  if (res.code !== 0) throw new Error(`wifi status failed: ${res.err.trim() || res.code}`);
  let ssid: string | null = null;
  for (const line of res.out.split('\n')) {
    const [active, name] = parseNmcliTerseRow(line);
    if (active === 'yes' && name) {
      ssid = name;
      break;
    }
  }
  let ip: string | null = null;
  if (ssid) {
    const ipRes = await runNmcli(['-t', '-f', 'IP4.ADDRESS', 'dev', 'show']);
    const m = /IP4\.ADDRESS\[\d+\]:([\d.]+)\//.exec(ipRes.out);
    ip = m?.[1] ?? null;
  }
  return { connected: !!ssid, ssid, ip, mock: false };
}

export type WifiConnectResult =
  | { ok: true; ssid: string }
  | { ok: false; reason: 'bad-password' | 'timeout' | 'error'; message: string };

/**
 * Connect. NetworkManager keeps the current connection until the new one is
 * negotiated where it can; a wrong PSK surfaces as a distinct error.
 */
export async function connectWifi(ssid: string, psk: string): Promise<WifiConnectResult> {
  const ssidError = validateSsid(ssid);
  if (ssidError) return { ok: false, reason: 'error', message: ssidError };
  const pskError = validatePsk(psk);
  if (pskError) return { ok: false, reason: 'error', message: pskError };
  if (isForcedPi()) {
    if (psk === 'wrong')
      return { ok: false, reason: 'bad-password', message: '(mock) wrong password' };
    mockState.connected = true;
    mockState.ssid = ssid;
    return { ok: true, ssid };
  }
  try {
    // PSK travels on stdin via --ask; never in argv (visible in ps) or logs.
    const res = await runNmcli(['--ask', 'dev', 'wifi', 'connect', ssid], psk, 50_000);
    if (res.code === 0) return { ok: true, ssid };
    const text = (res.err + res.out).toLowerCase();
    if (/(secrets were required|invalid.*(password|key)|802-11-wireless-security)/.test(text)) {
      return { ok: false, reason: 'bad-password', message: 'The password was not accepted.' };
    }
    if (res.code === 3 || /timeout|timed out/.test(text)) {
      return { ok: false, reason: 'timeout', message: 'The network did not respond in time.' };
    }
    return {
      ok: false,
      reason: 'error',
      message: res.err.trim().slice(0, 200) || 'connection failed',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timed out/.test(msg))
      return { ok: false, reason: 'timeout', message: 'The network did not respond in time.' };
    return { ok: false, reason: 'error', message: msg.slice(0, 200) };
  }
}
