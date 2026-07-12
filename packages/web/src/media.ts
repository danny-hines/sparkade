// Camera/mic helpers. On the Pi, Chromium runs with --use-fake-ui-for-media-stream
// so getUserMedia is auto-granted against the REAL devices — but it picks a
// default input, which may not be the USB webcam/mic. These let the user pin a
// specific device (see Settings → Camera & Mic).
//
// Everything here is TIMEOUT-BOUNDED: a stuck permission prompt or a wedged
// device driver must never hang the UI forever (which it did — the device
// picker spun on "Finding cameras & mics…" indefinitely).

export interface DeviceInfo {
  id: string;
  label: string;
}

/**
 * getUserMedia that rejects after `ms` if the device never opens. A late stream
 * (arriving after the timeout) is stopped so it can't leak.
 */
function gumWithTimeout(
  md: MediaDevices,
  constraints: MediaStreamConstraints,
  ms: number,
): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        reject(new Error('getUserMedia timed out'));
      }
    }, ms);
    md.getUserMedia(constraints).then(
      (stream) => {
        if (done) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        done = true;
        clearTimeout(timer);
        resolve(stream);
      },
      (err: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Resolve `p`, or `fallback` after `ms` — so even a hung enumerateDevices()
 *  (a wedged Chromium media backend can do this) can't block the picker. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.then((v) => v).catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * List camera + mic inputs. Device labels are hidden until media permission has
 * been granted, so if they're blank we open a short-lived stream to unlock
 * them, then re-enumerate. EVERY async step is time-boxed: a stuck permission,
 * a wedged device, or a hung enumerateDevices() must never leave the picker
 * spinning — it resolves with whatever it has (even an empty list) within ~13s.
 */
export async function enumerateInputs(): Promise<{ cameras: DeviceInfo[]; mics: DeviceInfo[] }> {
  const md = navigator.mediaDevices;
  if (!md?.enumerateDevices) return { cameras: [], mics: [] };
  const empty: MediaDeviceInfo[] = [];
  let devices = await withTimeout(md.enumerateDevices(), 4000, empty);
  const needsLabels = devices.some(
    (d) => (d.kind === 'videoinput' || d.kind === 'audioinput') && !d.label,
  );
  if (needsLabels) {
    // Any single successful getUserMedia unlocks labels for ALL devices. Try
    // both, then camera-only (works even if the mic is what's wedged), then
    // mic-only — each capped so a stuck device can't block the picker.
    for (const c of [{ video: true, audio: true }, { video: true }, { audio: true }] as const) {
      try {
        const s = await gumWithTimeout(md, c, 2500);
        s.getTracks().forEach((t) => t.stop());
        break;
      } catch {
        /* timed out or that device kind is absent — try a narrower request */
      }
    }
    devices = await withTimeout(md.enumerateDevices(), 4000, devices);
  }
  const pick = (kind: MediaDeviceKind, fallback: string): DeviceInfo[] =>
    devices
      .filter((d) => d.kind === kind && d.deviceId)
      .map((d, i) => ({ id: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
  return { cameras: pick('videoinput', 'Camera'), mics: pick('audioinput', 'Microphone') };
}

/**
 * getUserMedia pinned to a chosen device. Uses `exact` so the selection is
 * honored over Chromium's default, falls back to the default device if the
 * chosen one is gone, and is time-boxed so a wedged device rejects (letting the
 * caller show an error) rather than hanging.
 */
export async function getUserMediaForDevice(
  kind: 'video' | 'audio',
  deviceId: string | undefined,
  extra: MediaTrackConstraints = {},
): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  const build = (id?: string): MediaStreamConstraints => {
    const track: MediaTrackConstraints = { ...extra, ...(id ? { deviceId: { exact: id } } : {}) };
    return kind === 'video' ? { video: track } : { audio: Object.keys(track).length ? track : true };
  };
  if (deviceId) {
    try {
      return await gumWithTimeout(md, build(deviceId), 8000);
    } catch (e) {
      const name = (e as Error).name;
      const timedOut = (e as Error).message === 'getUserMedia timed out';
      // chosen device unavailable/slow → fall through to the default below
      if (!timedOut && name !== 'OverconstrainedError' && name !== 'NotFoundError' && name !== 'NotReadableError') throw e;
    }
  }
  return gumWithTimeout(md, build(undefined), 8000);
}

/** What Chromium actually sees, for on-device diagnosis when the picker comes
 *  up empty. The getUserMedia error NAME is the key signal:
 *    NotFoundError    → Chromium enumerates no such device (session can't see it)
 *    NotReadableError → device found but can't be opened (busy / driver / format)
 *    NotAllowedError  → permission denied (auto-grant flag not working)
 *    OverconstrainedError → device exists but not at requested constraints */
export interface MediaProbe {
  secureContext: boolean;
  hasMediaDevices: boolean;
  deviceCount: number;
  devices: string[];
  videoResult: string;
  audioResult: string;
}

async function probeGum(md: MediaDevices, c: MediaStreamConstraints): Promise<string> {
  try {
    const s = await gumWithTimeout(md, c, 6000);
    const n = s.getTracks().length;
    s.getTracks().forEach((t) => t.stop());
    return `ok — ${n} track${n === 1 ? '' : 's'}`;
  } catch (e) {
    const err = e as Error;
    return `${err.name || 'Error'}: ${err.message || '(no message)'}`;
  }
}

export async function probeMedia(): Promise<MediaProbe> {
  const md = navigator.mediaDevices;
  const secureContext = typeof window !== 'undefined' && window.isSecureContext;
  if (!md?.enumerateDevices) {
    return { secureContext, hasMediaDevices: false, deviceCount: 0, devices: [], videoResult: 'n/a', audioResult: 'n/a' };
  }
  const raw = await withTimeout(md.enumerateDevices(), 4000, [] as MediaDeviceInfo[]);
  const devices = raw.map(
    (d) => `${d.kind} · id=${d.deviceId ? d.deviceId.slice(0, 8) + '…' : '(blank)'} · label=${d.label || '(blank)'}`,
  );
  const videoResult = await probeGum(md, { video: true });
  const audioResult = await probeGum(md, { audio: true });
  return { secureContext, hasMediaDevices: true, deviceCount: raw.length, devices, videoResult, audioResult };
}
