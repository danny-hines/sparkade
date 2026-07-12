// Typed API client. The browser never sees an API key; everything talks to the
// local server (Vite proxies /api in dev).
import type {
  CostEstimate,
  GameListItem,
  GameMetaFile,
  GameSpec,
  JobEvent,
  JobRecord,
  LogicalButton,
  ScoreRow,
  SystemInfo,
  WifiNetwork,
  WifiStatus,
} from '@sparkade/shared';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-json error */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export interface GameDetail {
  item: GameListItem;
  spec: GameSpec | null;
  meta: GameMetaFile | null;
  job: JobRecord | null;
  assets: { head12: boolean; head16: boolean; portrait: boolean };
  usage: {
    stage: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    failed: boolean;
    repair: boolean;
    at: string;
  }[];
}

export interface SettingsPayload {
  audio: { musicVol: number; sfxVol: number; uiVol: number };
  input: { gamepad: Record<string, LogicalButton>; keyboard: Record<string, LogicalButton> };
  likeness: { describeInStory: boolean; smartFeatures?: boolean };
  devices: { cameraId?: string; cameraLabel?: string; micId?: string; micLabel?: string };
  presets: { id: string; title: string; archetype: string; premise: string; tone: string }[];
  stages: Record<string, { provider: string; model: string }>;
  pricing: Record<string, { inputPerM: number; outputPerM: number }>;
}

export const api = {
  listGames: () => fetch('/api/games').then((r) => json<GameListItem[]>(r)),
  getGame: (id: string) => fetch(`/api/games/${id}`).then((r) => json<GameDetail>(r)),
  deleteGame: (id: string) =>
    fetch(`/api/games/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),
  retryGame: (id: string) =>
    fetch(`/api/games/${id}/retry`, { method: 'POST' }).then((r) => json<{ jobId: string }>(r)),
  getScores: (id: string) => fetch(`/api/games/${id}/scores`).then((r) => json<ScoreRow[]>(r)),
  submitScore: (id: string, initials: string, score: number) =>
    fetch(`/api/games/${id}/scores`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initials, score }),
    }).then((r) => json<ScoreRow[]>(r)),
  transcribe: async (audio: Blob): Promise<string> => {
    const form = new FormData();
    form.append('audio', audio, 'recording.webm');
    const res = await fetch('/api/transcribe', { method: 'POST', body: form });
    return (await json<{ text: string }>(res)).text;
  },
  createGame: async (opts: {
    promptText: string;
    sourceKind: 'voice' | 'preset' | 'surprise';
    presetId?: string;
    photo?: Blob;
    idempotencyKey: string;
  }): Promise<{ jobId: string; gameId: string }> => {
    const form = new FormData();
    form.append('promptText', opts.promptText);
    form.append('sourceKind', opts.sourceKind);
    form.append('idempotencyKey', opts.idempotencyKey);
    if (opts.presetId) form.append('presetId', opts.presetId);
    if (opts.photo) form.append('photo', opts.photo, 'photo.jpg');
    const res = await fetch('/api/games', { method: 'POST', body: form });
    return json(res);
  },
  estimate: () =>
    fetch('/api/generation/estimate').then((r) =>
      json<CostEstimate & { model: string; busy: boolean; maxRecordingSeconds: number }>(r),
    ),
  settings: () => fetch('/api/settings').then((r) => json<SettingsPayload>(r)),
  saveSettings: (patch: {
    audio?: { musicVol: number; sfxVol: number; uiVol: number };
    input?: { gamepad?: Record<string, LogicalButton>; keyboard?: Record<string, LogicalButton> };
    likeness?: { describeInStory?: boolean; smartFeatures?: boolean };
    devices?: { cameraId?: string; cameraLabel?: string; micId?: string; micLabel?: string };
  }) =>
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<{ ok: boolean }>(r)),
  systemInfo: () => fetch('/api/system/info').then((r) => json<SystemInfo>(r)),
  wifiNetworks: () => fetch('/api/system/wifi/networks').then((r) => json<WifiNetwork[]>(r)),
  wifiStatus: () => fetch('/api/system/wifi/status').then((r) => json<WifiStatus>(r)),
  wifiConnect: async (
    ssid: string,
    psk: string,
  ): Promise<{ ok: boolean; reason?: string; error?: string }> => {
    const res = await fetch('/api/system/wifi/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ssid, psk }),
    });
    if (res.ok) return { ok: true };
    try {
      return (await res.json()) as { ok: false; reason: string; error: string };
    } catch {
      return { ok: false, reason: 'error', error: `HTTP ${res.status}` };
    }
  },
  assetUrl: (gameId: string, name: 'head12.png' | 'head16.png' | 'portrait.png') =>
    `/api/games/${gameId}/assets/${name}`,
};

/** Subscribe to a job's SSE stream. Returns an unsubscribe function. */
export function subscribeJob(jobId: string, onEvent: (e: JobEvent) => void): () => void {
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as JobEvent);
    } catch {
      /* malformed frame — ignore */
    }
  };
  return () => source.close();
}
