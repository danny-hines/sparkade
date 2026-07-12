// Camera/mic helpers. On the Pi, Chromium runs with --use-fake-ui-for-media-stream
// so getUserMedia is auto-granted against the REAL devices — but it picks a
// default input, which may not be the USB webcam/mic. These let the user pin a
// specific device (see Settings → Camera & Mic).

export interface DeviceInfo {
  id: string;
  label: string;
}

/**
 * List camera + mic inputs. Device labels are hidden until media permission has
 * been granted, so if they're blank we open a throwaway stream to unlock them,
 * then re-enumerate. Falls back to generic names if a device still has no label.
 */
export async function enumerateInputs(): Promise<{ cameras: DeviceInfo[]; mics: DeviceInfo[] }> {
  const md = navigator.mediaDevices;
  if (!md?.enumerateDevices) return { cameras: [], mics: [] };
  let devices = await md.enumerateDevices();
  const needsLabels = devices.some(
    (d) => (d.kind === 'videoinput' || d.kind === 'audioinput') && !d.label,
  );
  if (needsLabels) {
    // Try both, then each alone — a box may have only one of the two.
    for (const c of [{ video: true, audio: true }, { audio: true }, { video: true }] as const) {
      try {
        const s = await md.getUserMedia(c);
        s.getTracks().forEach((t) => t.stop());
        break;
      } catch {
        /* try the next combo */
      }
    }
    devices = await md.enumerateDevices();
  }
  const pick = (kind: MediaDeviceKind, fallback: string): DeviceInfo[] =>
    devices
      .filter((d) => d.kind === kind && d.deviceId)
      .map((d, i) => ({ id: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
  return { cameras: pick('videoinput', 'Camera'), mics: pick('audioinput', 'Microphone') };
}

/**
 * getUserMedia pinned to a chosen device. Uses `exact` so the selection is
 * honored over Chromium's default, and falls back to the default device if the
 * chosen one is gone (unplugged / changed id) rather than hard-failing.
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
      return await md.getUserMedia(build(deviceId));
    } catch (e) {
      const name = (e as Error).name;
      if (name !== 'OverconstrainedError' && name !== 'NotFoundError' && name !== 'NotReadableError') throw e;
      // chosen device unavailable → fall through to the default below
    }
  }
  return md.getUserMedia(build(undefined));
}
