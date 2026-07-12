// WiFi management via nmcli (Bookworm default). Pi-only; on non-Pi these are
// never routed (404) unless SPARKADE_FORCE_PI=1 serves the labeled mock.
// SECURITY: the PSK is fed on stdin (`nmcli --ask`), never in argv or logs.
import { spawn } from 'node:child_process';
import type { WifiNetwork, WifiStatus } from '@sparkade/shared';
import { isForcedPi } from '../util';

function runNmcli(args: string[], stdin?: string, timeoutMs = 45_000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', 'nmcli', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
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
    if (stdin !== undefined) child.stdin.write(stdin + '\n');
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Mock (SPARKADE_FORCE_PI=1 off-Pi): clearly labeled, stateful, no system calls.
// ---------------------------------------------------------------------------

const mockState = { connected: true, ssid: 'MOCK-HomeNet' };

const MOCK_NETWORKS: WifiNetwork[] = [
  { ssid: 'MOCK-HomeNet', signal: 86, secured: true, current: true },
  { ssid: 'MOCK-Workshop', signal: 64, secured: true, current: false },
  { ssid: 'MOCK-CoffeeShop', signal: 42, secured: false, current: false },
  { ssid: 'MOCK-Neighbor 5G', signal: 23, secured: true, current: false },
];

export async function listNetworks(): Promise<WifiNetwork[]> {
  if (isForcedPi()) {
    return MOCK_NETWORKS.map((n) => ({ ...n, current: mockState.connected && n.ssid === mockState.ssid }));
  }
  const res = await runNmcli(['-t', '-f', 'SSID,SIGNAL,SECURITY,IN-USE', 'dev', 'wifi', 'list', '--rescan', 'yes']);
  if (res.code !== 0) throw new Error(`wifi scan failed: ${res.err.trim() || res.code}`);
  const seen = new Map<string, WifiNetwork>();
  for (const line of res.out.split('\n')) {
    if (!line.trim()) continue;
    // nmcli -t escapes ':' in fields as '\:'
    const parts = line.split(/(?<!\\):/).map((p) => p.replace(/\\:/g, ':'));
    const [ssid, signal, security, inUse] = parts;
    if (!ssid) continue;
    const net: WifiNetwork = {
      ssid,
      signal: Number(signal) || 0,
      secured: !!security && security !== '--',
      current: inUse === '*',
    };
    const prev = seen.get(ssid);
    if (!prev || net.signal > prev.signal || net.current) seen.set(ssid, { ...net, current: net.current || prev?.current || false });
  }
  return [...seen.values()].sort((a, b) => Number(b.current) - Number(a.current) || b.signal - a.signal);
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
  let ssid: string | null = null;
  for (const line of res.out.split('\n')) {
    const [active, name] = line.split(/(?<!\\):/);
    if (active === 'yes' && name) {
      ssid = name.replace(/\\:/g, ':');
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
  if (!/^[\x20-\x7E]{1,32}$/.test(ssid)) return { ok: false, reason: 'error', message: 'invalid SSID' };
  if (isForcedPi()) {
    if (psk === 'wrong') return { ok: false, reason: 'bad-password', message: '(mock) wrong password' };
    mockState.connected = true;
    mockState.ssid = ssid;
    return { ok: true, ssid };
  }
  try {
    // PSK travels on stdin via --ask; never in argv (visible in ps) or logs.
    const res = await runNmcli(['--ask', 'dev', 'wifi', 'connect', ssid], psk, 60_000);
    if (res.code === 0) return { ok: true, ssid };
    const text = (res.err + res.out).toLowerCase();
    if (/(secrets were required|invalid.*(password|key)|802-11-wireless-security)/.test(text)) {
      return { ok: false, reason: 'bad-password', message: 'The password was not accepted.' };
    }
    if (/timeout|timed out/.test(text)) {
      return { ok: false, reason: 'timeout', message: 'The network did not respond in time.' };
    }
    return { ok: false, reason: 'error', message: res.err.trim().slice(0, 200) || 'connection failed' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timed out/.test(msg)) return { ok: false, reason: 'timeout', message: 'The network did not respond in time.' };
    return { ok: false, reason: 'error', message: msg.slice(0, 200) };
  }
}
