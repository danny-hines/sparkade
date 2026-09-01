// Typed API client. The browser never sees an API key; everything talks to the
// local server (Vite proxies /api in dev).
import {
  GENERATED_GAME_ASSET_FILES,
  type ArchetypeId,
  type CostEstimate,
  type GameListItem,
  type GameMetaFile,
  type GameSpec,
  type GeneratedGameAssetRole,
  type GenerationFeedEvent,
  type JobEvent,
  type JobRecord,
  type LogicalButton,
  type PartialSpec,
  type ScoreRow,
  type SystemInfo,
  type WifiNetwork,
  type WifiStatus,
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

export type GameAssetAvailability = {
  head12: boolean;
  head12Side: boolean;
  head12Back: boolean;
  head16: boolean;
  head16Side: boolean;
  head16Back: boolean;
  portrait: boolean;
  /** Server-normalized v4+ Fighter arenas already contain their color treatment. */
  fighterArenaPresentationBaked?: boolean;
} & Record<GeneratedGameAssetRole, boolean>;

export interface GameDetail {
  item: GameListItem;
  spec: GameSpec | null;
  meta: GameMetaFile | null;
  job: JobRecord | null;
  assets: GameAssetAvailability;
  usage: {
    stage: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    costUsd: number | null;
    failed: boolean;
    repair: boolean;
    at: string;
  }[];
}

export interface SettingsPayload {
  audio: { musicVol: number; sfxVol: number; uiVol: number };
  input: { gamepad: Record<string, LogicalButton>; keyboard: Record<string, LogicalButton> };
  likeness: {
    describeInStory: boolean;
  };
  devices: { cameraId?: string; cameraLabel?: string; micId?: string; micLabel?: string };
  presets: { id: string; title: string; archetype: string; premise: string; tone: string }[];
  stages: Record<string, { provider: string; model: string }>;
  pricing: Record<string, { inputPerM: number; outputPerM: number }>;
  imageGeneration: { model: string; baseUrl: string; pricePerImageUsd: number };
}

export type PlatformerPoseLabStage =
  'source' | 'idle' | 'idle-judge' | 'side-anchor' | 'candidates' | 'judge' | 'complete';

export interface PlatformerPoseLabEvent {
  seq: number;
  runId: string;
  at: string;
  type:
    | 'stage'
    | 'asset'
    | 'idle-judge-response'
    | 'idle-selection'
    | 'judge-response'
    | 'selection'
    | 'human-verdict'
    | 'done'
    | 'failed';
  stage: PlatformerPoseLabStage;
  status: 'started' | 'complete' | 'rejected' | 'failed';
  message: string;
  elapsedMs?: number;
  data?: Record<string, unknown>;
}

export interface PlatformerPoseScore {
  identity: number;
  costume: number;
  pose: number;
  technical: number;
}

export type PlatformerEyewearState = 'present' | 'absent' | 'uncertain';

export interface PlatformerIdleCandidateReview {
  id: string;
  eyewear: PlatformerEyewearState;
  eyewearMatch: boolean;
  scores: {
    identity: number;
    faceAndHair: number;
    accessories: number;
    costume: number;
    proportions: number;
    pose: number;
    technical: number;
  };
  fatalIssues: string[];
  summary: string;
}

export interface PlatformerIdleJudgeDecision {
  sourceReview: {
    eyewear: PlatformerEyewearState;
    summary: string;
  };
  candidateReviews: PlatformerIdleCandidateReview[];
  selection: {
    accepted: boolean;
    candidateId: string;
    confidence: number;
    rationale: string;
    retryGuidance: string;
  };
}

export interface PlatformerPoseCandidateReview {
  id: string;
  kind: 'phase-a' | 'phase-b';
  scores: PlatformerPoseScore;
  fatalIssues: string[];
  summary: string;
}

export interface PlatformerPosePairReview {
  phaseAId: string;
  phaseBId: string;
  legAlternation: number;
  armAlternation: number;
  pairConsistency: number;
  fatalIssues: string[];
  summary: string;
}

export interface PlatformerPoseHumanVerdict {
  accepted: boolean;
  phaseAId: string;
  phaseBId: string;
  notes: string;
  at: string;
}

export interface PlatformerPoseJudgeDecision {
  anchorReview: {
    identity: number;
    sideView: number;
    costume: number;
    fatalIssues: string[];
    summary: string;
  };
  candidateReviews: PlatformerPoseCandidateReview[];
  pairReviews: PlatformerPosePairReview[];
  selection: {
    accepted: boolean;
    phaseAId: string;
    phaseBId: string;
    legAlternation: number;
    armAlternation: number;
    pairConsistency: number;
    confidence: number;
    rationale: string;
    retryGuidance: string;
  };
}

export interface PlatformerPoseLabStatus {
  runId: string;
  status: 'running' | 'done' | 'failed';
  events: PlatformerPoseLabEvent[];
  imageCalls: number;
  imageCostUsd: number;
  judgeCostUsd: number | null;
  idleDecision?: PlatformerIdleJudgeDecision;
  decision?: PlatformerPoseJudgeDecision;
  humanVerdict?: PlatformerPoseHumanVerdict;
  error?: string;
}

export type FighterPoseName =
  | 'idle'
  | 'walk'
  | 'crouch'
  | 'jump'
  | 'punchHigh'
  | 'punchLow'
  | 'kickHigh'
  | 'kickLow'
  | 'airPunch'
  | 'airKick'
  | 'block'
  | 'hit'
  | 'ko';

export type FighterPoseLabStage =
  | 'source'
  | 'foundations'
  | 'identity-judge'
  | 'poses'
  | 'pose-judge'
  | 'retry'
  | 'atlas'
  | 'complete';

export interface FighterPoseLabEvent {
  seq: number;
  runId: string;
  at: string;
  type: 'stage' | 'asset' | 'judge-response' | 'selection' | 'human-verdict' | 'done' | 'failed';
  stage: FighterPoseLabStage;
  status: 'started' | 'complete' | 'rejected' | 'failed';
  message: string;
  elapsedMs?: number;
  data?: Record<string, unknown>;
}

export interface FighterIdentityJudgeDecision {
  candidateReviews: Array<{
    id: string;
    slot: string;
    scores: {
      identity: number;
      concept: number;
      costume: number;
      silhouette: number;
      technical: number;
    };
    fatalIssues: string[];
    summary: string;
  }>;
  selections: Array<{
    slot: string;
    accepted: boolean;
    candidateId: string;
    confidence: number;
    rationale: string;
    retryGuidance: string;
  }>;
  castReview: {
    distinctiveness: number;
    styleConsistency: number;
    fatalIssues: string[];
    summary: string;
  };
}

export interface FighterPoseJudgeDecision {
  candidateReviews: Array<{
    id: string;
    pose: FighterPoseName;
    scores: { identity: number; costume: number; pose: number; technical: number };
    fatalIssues: string[];
    summary: string;
  }>;
  selections: Array<{ pose: FighterPoseName; candidateId: string; rationale: string }>;
  setReview: {
    accepted: boolean;
    identityConsistency: number;
    costumeConsistency: number;
    scaleConsistency: number;
    poseReadability: number;
    fatalIssues: string[];
    summary: string;
  };
  retryPoses: Array<{ pose: FighterPoseName; guidance: string }>;
}

export interface FighterPoseLabStatus {
  runId: string;
  status: 'running' | 'done' | 'failed';
  generationMode: 'sheets' | 'individual';
  events: FighterPoseLabEvent[];
  imageCalls: number;
  imageCostUsd: number;
  judgeCalls: number;
  judgeCostUsd: number | null;
  identityDecision?: FighterIdentityJudgeDecision;
  poseDecision?: FighterPoseJudgeDecision;
  humanVerdict?: { accepted: boolean; notes: string; at: string };
  error?: string;
}

export type PlatformerLevelLabStage = 'layouts' | 'parse' | 'repair' | 'selection' | 'hydrate';

export interface PlatformerLevelLabEvent {
  seq: number;
  runId: string;
  at: string;
  type:
    | 'stage'
    | 'candidate'
    | 'selection'
    | 'hydration'
    | 'hydration-candidate'
    | 'hydration-judge-response'
    | 'hydration-selection'
    | 'mask'
    | 'ready'
    | 'failed';
  stage: PlatformerLevelLabStage;
  status: 'started' | 'complete' | 'rejected' | 'failed';
  message: string;
  elapsedMs?: number;
  data?: Record<string, unknown>;
}

export interface PlatformerLevelLabMetrics {
  registration: 'frame' | 'content';
  crop: { left: number; top: number; width: number; height: number };
  confidentCellRatio: number;
  meanWinnerShare: number;
  meanColorDistance: number;
  changedCells: number;
  repairs: string[];
  issuesBefore: string[];
  issuesAfter: string[];
  reachableStandingCells: number;
  markerCounts: Record<'spawn' | 'exit' | 'checkpoint', number>;
  tileCounts: Record<string, number>;
  score: number;
}

export interface PlatformerLevelLabStatus {
  runId: string;
  status: 'running' | 'ready' | 'hydrating' | 'failed';
  concept: string;
  events: PlatformerLevelLabEvent[];
  recommendedId?: string;
  hydratedId?: string;
  hydrationWinnerId?: string;
  hydrationMetrics?: Record<string, unknown>;
  imageCalls: number;
  imageCostUsd: number;
  judgeCalls: number;
  judgeCostUsd: number | null;
  error?: string;
}

export const api = {
  listGames: () => fetch('/api/games').then((r) => json<GameListItem[]>(r)),
  getGame: (id: string) => fetch(`/api/games/${id}`).then((r) => json<GameDetail>(r)),
  getPartial: (id: string) =>
    fetch(`/api/games/${id}/partial`).then((r) => json<{ partial: PartialSpec | null }>(r)),
  getGenerationFeed: (jobId: string) =>
    fetch(`/api/jobs/${encodeURIComponent(jobId)}/feed`).then((response) =>
      json<{ events: GenerationFeedEvent[] }>(response),
    ),
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
    requestedArchetype?: ArchetypeId;
    heroName?: string;
    details?: string;
    presetId?: string;
    photo?: Blob;
    idempotencyKey: string;
  }): Promise<{ jobId: string; gameId: string }> => {
    const form = new FormData();
    form.append('promptText', opts.promptText);
    form.append('sourceKind', opts.sourceKind);
    form.append('idempotencyKey', opts.idempotencyKey);
    if (opts.requestedArchetype) form.append('requestedArchetype', opts.requestedArchetype);
    if (opts.heroName?.trim()) form.append('heroName', opts.heroName.trim());
    if (opts.details?.trim()) form.append('details', opts.details.trim());
    if (opts.presetId) form.append('presetId', opts.presetId);
    if (opts.photo) form.append('photo', opts.photo, 'photo.jpg');
    const res = await fetch('/api/games', { method: 'POST', body: form });
    return json(res);
  },
  startPlatformerPoseLab: async (opts: {
    photo: Blob;
    heroConcept?: string;
    colors?: string;
  }): Promise<{ runId: string }> => {
    const form = new FormData();
    form.append('photo', opts.photo, 'player-reference.png');
    if (opts.heroConcept) form.append('heroConcept', opts.heroConcept);
    if (opts.colors) form.append('colors', opts.colors);
    const response = await fetch('/api/dev/platformer-poses/runs', {
      method: 'POST',
      body: form,
    });
    return json(response);
  },
  startFighterPoseLab: async (opts: {
    photo: Blob;
    name: string;
    visualConcept: string;
    build: string;
    outfit: string;
    colors: string;
    generationMode: 'sheets' | 'individual';
  }): Promise<{ runId: string }> => {
    const form = new FormData();
    form.append('photo', opts.photo, 'fighter-reference.png');
    form.append('name', opts.name);
    form.append('visualConcept', opts.visualConcept);
    form.append('build', opts.build);
    form.append('outfit', opts.outfit);
    form.append('colors', opts.colors);
    form.append('generationMode', opts.generationMode);
    const response = await fetch('/api/dev/fighter-poses/runs', { method: 'POST', body: form });
    return json(response);
  },
  fighterPoseLabStatus: (runId: string) =>
    fetch(`/api/dev/fighter-poses/runs/${encodeURIComponent(runId)}`).then((response) =>
      json<FighterPoseLabStatus>(response),
    ),
  saveFighterPoseHumanVerdict: (runId: string, input: { accepted: boolean; notes?: string }) =>
    fetch(`/api/dev/fighter-poses/runs/${encodeURIComponent(runId)}/human-verdict`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }).then((response) =>
      json<{ humanVerdict: { accepted: boolean; notes: string; at: string } }>(response),
    ),
  platformerPoseLabStatus: (runId: string) =>
    fetch(`/api/dev/platformer-poses/runs/${encodeURIComponent(runId)}`).then((response) =>
      json<PlatformerPoseLabStatus>(response),
    ),
  savePlatformerPoseHumanVerdict: (
    runId: string,
    input: { accepted: boolean; phaseAId?: string; phaseBId?: string; notes?: string },
  ) =>
    fetch(`/api/dev/platformer-poses/runs/${encodeURIComponent(runId)}/human-verdict`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }).then((response) =>
      json<{ humanVerdict: PlatformerPoseHumanVerdict; event: PlatformerPoseLabEvent }>(response),
    ),
  startPlatformerLevelLab: (concept: string) =>
    fetch('/api/dev/platformer-levels/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ concept }),
    }).then((response) => json<{ runId: string }>(response)),
  platformerLevelLabStatus: (runId: string) =>
    fetch(`/api/dev/platformer-levels/runs/${encodeURIComponent(runId)}`).then((response) =>
      json<PlatformerLevelLabStatus>(response),
    ),
  hydratePlatformerLevelLab: (runId: string, candidateId: string) =>
    fetch(`/api/dev/platformer-levels/runs/${encodeURIComponent(runId)}/hydrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidateId }),
    }).then((response) => json<{ runId: string; candidateId: string }>(response)),
  reprocessPlatformerLevelLab: (
    runId: string,
    candidateId: string,
    fringe: { topPx: number; sidePx: number; bottomPx: number },
  ) =>
    fetch(`/api/dev/platformer-levels/runs/${encodeURIComponent(runId)}/reprocess`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidateId, fringe }),
    }).then((response) => json<{ runId: string; candidateId: string }>(response)),
  estimate: (opts: { photo?: boolean; archetype?: ArchetypeId } = {}) => {
    const query = new URLSearchParams();
    if (opts.photo) query.set('photo', '1');
    if (opts.archetype) query.set('archetype', opts.archetype);
    const suffix = query.size ? `?${query.toString()}` : '';
    return fetch(`/api/generation/estimate${suffix}`).then((r) =>
      json<
        CostEstimate & {
          model: string;
          imageModel: string;
          busy: boolean;
          maxRecordingSeconds: number;
        }
      >(r),
    );
  },
  settings: () => fetch('/api/settings').then((r) => json<SettingsPayload>(r)),
  saveSettings: (patch: {
    audio?: { musicVol: number; sfxVol: number; uiVol: number };
    input?: { gamepad?: Record<string, LogicalButton>; keyboard?: Record<string, LogicalButton> };
    likeness?: {
      describeInStory?: boolean;
    };
    devices?: { cameraId?: string; cameraLabel?: string; micId?: string; micLabel?: string };
  }) =>
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => json<{ ok: boolean }>(r)),
  systemInfo: () => fetch('/api/system/info').then((r) => json<SystemInfo>(r)),
  updateCheck: () =>
    fetch('/api/system/update/check').then((r) =>
      json<{ current: string; latest: string | null; available: boolean; error?: string }>(r),
    ),
  updateInstall: () =>
    fetch('/api/system/update', { method: 'POST' }).then((r) => json<{ started: boolean }>(r)),
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
  assetUrl: (
    gameId: string,
    name:
      | 'head12.png'
      | 'head12-side.png'
      | 'head12-back.png'
      | 'head16.png'
      | 'head16-side.png'
      | 'head16-back.png'
      | 'portrait.png'
      | (typeof GENERATED_GAME_ASSET_FILES)[GeneratedGameAssetRole],
  ) => `/api/games/${gameId}/assets/${name}`,
  jobAssetUrl: (jobId: string, filename: string) =>
    `/api/jobs/${encodeURIComponent(jobId)}/assets/${encodeURIComponent(filename)}`,
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

/** Subscribe to a dev pose-lab run. The server replays every prior event, so
 * opening after the multipart upload still shows the complete pipeline. */
export function subscribePlatformerPoseLab(
  runId: string,
  onEvent: (event: PlatformerPoseLabEvent) => void,
  onDisconnect?: () => void,
): () => void {
  const source = new EventSource(
    `/api/dev/platformer-poses/runs/${encodeURIComponent(runId)}/events`,
  );
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as PlatformerPoseLabEvent);
    } catch {
      /* malformed dev frame — ignore */
    }
  };
  source.onerror = () => onDisconnect?.();
  return () => source.close();
}

/** Subscribe to the isolated Fighter avatar generation experiment. */
export function subscribeFighterPoseLab(
  runId: string,
  onEvent: (event: FighterPoseLabEvent) => void,
  onDisconnect?: () => void,
): () => void {
  const source = new EventSource(`/api/dev/fighter-poses/runs/${encodeURIComponent(runId)}/events`);
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as FighterPoseLabEvent);
    } catch {
      /* malformed dev frame — ignore */
    }
  };
  source.onerror = () => onDisconnect?.();
  return () => source.close();
}

/** Subscribe to the level-design lab. The connection intentionally stays open
 * while a candidate batch is ready so a later user-triggered hydration streams
 * into the same page. */
export function subscribePlatformerLevelLab(
  runId: string,
  onEvent: (event: PlatformerLevelLabEvent) => void,
  onDisconnect?: () => void,
): () => void {
  const source = new EventSource(
    `/api/dev/platformer-levels/runs/${encodeURIComponent(runId)}/events`,
  );
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as PlatformerLevelLabEvent);
    } catch {
      /* malformed dev frame — ignore */
    }
  };
  source.onerror = () => onDisconnect?.();
  return () => source.close();
}
