/** Small, untrusted device report. Contains no credentials, account names, or captured media. */
export interface KioskRuntimeReport {
  platform: 'portal';
  version: string;
  versionCode: number;
  model: string;
  channel: 'stable' | 'pilot';
  updateState:
    'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'updated' | 'failed' | 'current';
}
const states = new Set([
  'idle',
  'checking',
  'downloading',
  'ready',
  'installing',
  'updated',
  'failed',
  'current',
]);
export function kioskRuntimeReport(headers: Headers): KioskRuntimeReport | null {
  if (headers.get('x-sparkade-platform') !== 'portal') return null;
  const version = headers.get('x-sparkade-version') ?? '';
  const code = headers.get('x-sparkade-version-code') ?? '';
  const model = headers.get('x-sparkade-model') ?? '';
  const channel = headers.get('x-sparkade-update-channel') ?? '';
  const updateState = headers.get('x-sparkade-update-state') ?? '';
  if (
    !/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(version) ||
    version.length > 40 ||
    !/^\d{1,10}$/.test(code) ||
    Number(code) <= 0 ||
    Number(code) > 2147483647 ||
    !/^[\x20-\x7e]{1,80}$/.test(model) ||
    !['stable', 'pilot'].includes(channel) ||
    !states.has(updateState)
  )
    return null;
  return {
    platform: 'portal',
    version,
    versionCode: Number(code),
    model,
    channel: channel as KioskRuntimeReport['channel'],
    updateState: updateState as KioskRuntimeReport['updateState'],
  };
}
