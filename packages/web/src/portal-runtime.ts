/** Standalone Android adapter. Credentials and network authorization stay native;
 * the shared shell keeps the same API contract as the Pi. */
import {
  ENGINE_VERSION,
  SPEC_VERSION,
  GENERATED_GAME_ASSET_FILES,
  type CloudGameBundle,
  type CloudGenerationInput,
  type CloudGenerationSnapshot,
  type GameListItem,
  type JobEvent,
  type KioskRegistrationStatus,
  type ScoreRow,
} from '@sparkade/shared';
import { archetypes } from '@sparkade/archetypes';
import type { GameDetail, SettingsPayload } from './api';

export type NativeCall = <T>(operation: string, args?: Record<string, unknown>) => Promise<T>;
export interface PortalBootstrap {
  version: string;
  buildCommit: string | null;
  settings: SettingsPayload;
  games: GameListItem[];
}
interface StoredGame {
  snapshot: CloudGenerationSnapshot;
  installed?: boolean;
  deleted?: boolean;
  installError?: string;
}
export interface PortalState {
  version: 1;
  settings: SettingsPayload;
  games: Record<string, StoredGame>;
  scores: Record<string, ScoreRow[]>;
  cursor: number;
}
interface NativeBridge {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
}
declare global {
  interface Window {
    SparkadePortalNative?: NativeBridge;
  }
}

function bridgeCall(bridge: NativeBridge): NativeCall {
  const pending = new Map<
    string,
    {
      resolve: (value: never) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  bridge.onmessage = (event) => {
    try {
      const result = JSON.parse(event.data) as { id: string; value: never; error?: string };
      const request = pending.get(result.id);
      if (!request) return;
      pending.delete(result.id);
      clearTimeout(request.timer);
      if (result.error) request.reject(new Error(result.error));
      else request.resolve(result.value);
    } catch {
      /* Ignore malformed native responses. */
    }
  };
  return <T>(operation: string, args: Record<string, unknown> = {}): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      // Asset packs may involve many serial downloads. Each native HTTP operation
      // has its own bounded timeout; a caller timeout doesn't cancel cloud generation.
      const timer = setTimeout(
        () => {
          pending.delete(id);
          reject(new Error('Portal operation timed out. Please retry.'));
        },
        operation === 'game.install' ? 15 * 60_000 : 150_000,
      );
      pending.set(id, { resolve, reject, timer });
      try {
        bridge.postMessage(JSON.stringify({ id, operation, args }));
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
}

export function validatePortalBundle(bundle: CloudGameBundle, gameId: string): void {
  const version = (value: unknown) => (typeof value === 'string' ? value.split('.')[0] : null);
  if (
    !bundle?.meta ||
    !bundle.spec ||
    bundle.meta.id !== gameId ||
    bundle.meta.status !== 'ready' ||
    version(bundle.meta.engineVersion) !== version(ENGINE_VERSION) ||
    bundle.meta.specVersion !== SPEC_VERSION ||
    bundle.spec.specVersion !== SPEC_VERSION ||
    bundle.meta.archetype !== bundle.spec.archetype ||
    !Object.hasOwn(archetypes, bundle.spec.archetype) ||
    version(bundle.meta.archetypeVersion) !== version(archetypes[bundle.spec.archetype].version)
  ) {
    throw new Error('This game requires a Sparkade app update before installation.');
  }
  const assets = bundle.manifest?.assets;
  if (
    bundle.manifest?.version !== 1 ||
    !Array.isArray(assets) ||
    assets.length > Object.keys(GENERATED_GAME_ASSET_FILES).length ||
    new Set(assets.map((a) => a.filename)).size !== assets.length ||
    !assets.every(
      (a) =>
        a &&
        Object.hasOwn(GENERATED_GAME_ASSET_FILES, a.role) &&
        a.filename === GENERATED_GAME_ASSET_FILES[a.role] &&
        a.mimeType === 'image/png' &&
        Number.isSafeInteger(a.width) &&
        a.width > 0 &&
        Number.isSafeInteger(a.height) &&
        a.height > 0 &&
        typeof a.model === 'string' &&
        !!a.model &&
        typeof a.promptVersion === 'string' &&
        !!a.promptVersion &&
        /^[a-f0-9]{64}$/.test(a.sha256) &&
        /^[a-f0-9]{64}$/.test(a.promptSha256),
    )
  ) {
    throw new Error('Invalid game asset manifest');
  }
}

export function bundleAssets(bundle: CloudGameBundle): GameDetail['assets'] {
  const roles = Object.fromEntries(
    Object.keys(GENERATED_GAME_ASSET_FILES).map((role) => [
      role,
      bundle.manifest.assets.some((asset) => asset.role === role),
    ]),
  ) as GameDetail['assets'];
  const arena = bundle.manifest.assets.find((a) => a.role === 'fighterArenaAtlas');
  return {
    ...roles,
    head12: roles.generatedHead12,
    head12Side: roles.generatedHead12Side,
    head12Back: roles.generatedHead12Back,
    head16: roles.generatedHead16,
    head16Side: roles.generatedHead16Side,
    head16Back: roles.generatedHead16Back,
    portrait: roles.generatedPortrait,
    racingArtRequired: bundle.meta.racingArt?.mode === 'generated',
    fighterArenaPresentationBaked: arena?.promptVersion === 'fighter-arena-sheet-v4',
  };
}

export class PortalRuntime {
  private state!: PortalState;
  private saveTail: Promise<void> = Promise.resolve();
  private syncTask: Promise<void> | null = null;
  private installs = new Set<string>();
  private installTail: Promise<void> = Promise.resolve();
  private listeners = new Map<string, Set<(event: JobEvent) => void>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private registration: KioskRegistrationStatus | null = null;
  private readonly instanceId = crypto.randomUUID();

  constructor(
    private readonly native: NativeCall,
    private readonly bootstrap: PortalBootstrap,
    private readonly bundledGame: (id: string) => Promise<GameDetail>,
  ) {}

  async initialize(): Promise<void> {
    const stored = await this.native<PortalState | null>('state.load');
    if (
      stored &&
      (stored.version !== 1 ||
        !stored.settings ||
        !stored.games ||
        !stored.scores ||
        !Number.isSafeInteger(stored.cursor))
    ) {
      throw new Error('Portal storage is incompatible. Update Sparkade without clearing app data.');
    }
    this.state = stored ?? {
      version: 1,
      settings: structuredClone(this.bootstrap.settings),
      games: {},
      scores: {},
      cursor: 0,
    };
    // Merge future read-only defaults while retaining this device's operator settings.
    this.state.settings = {
      ...this.bootstrap.settings,
      ...this.state.settings,
      stages: this.bootstrap.settings.stages,
      pricing: this.bootstrap.settings.pricing,
      imageGeneration: this.bootstrap.settings.imageGeneration,
    };
  }
  start(): void {
    const tick = async () => {
      if (this.stopped) return;
      try {
        this.registration = await this.native<KioskRegistrationStatus>('registration.status');
        if (this.registration.state === 'registered') await this.sync();
      } catch {
        /* Offline play and settings remain available. */
      }
      if (!this.stopped) this.timer = setTimeout(() => void tick(), 5000);
    };
    void tick();
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
  private persist(): Promise<void> {
    const state = structuredClone(this.state);
    const task = this.saveTail
      .catch(() => {})
      .then(() => this.native('state.save', { state }))
      .then(() => {});
    this.saveTail = task;
    return task;
  }
  private async cloud<T>(path: string, method = 'GET', body?: unknown, form?: unknown): Promise<T> {
    const response = await this.native<{ status: number; body: string }>('cloud', {
      path,
      method,
      ...(body !== undefined ? { body } : {}),
      ...(form ? { form } : {}),
    });
    let result: T & { error?: string };
    try {
      result = JSON.parse(response.body) as T & { error?: string };
    } catch {
      throw new Error(`Cloud returned HTTP ${response.status}. Please retry.`);
    }
    if (response.status < 200 || response.status >= 300)
      throw new Error(result.error ?? `Cloud returned HTTP ${response.status}`);
    return result;
  }
  async sync(): Promise<void> {
    if (this.syncTask) return this.syncTask;
    this.syncTask = (async () => {
      const watching = Object.fromEntries(
        Object.entries(this.state.games).flatMap(([jobId, entry]) =>
          !entry.deleted && (!entry.installed || entry.snapshot.publication?.status !== 'published')
            ? [[jobId, Math.max(0, ...entry.snapshot.events.map((e) => e.id))]]
            : [],
        ),
      );
      const result = await this.cloud<{ cursor: number; jobs: CloudGenerationSnapshot[] }>(
        '/v1/sync',
        'POST',
        { cursor: this.state.cursor, watching },
      );
      for (const snapshot of result.jobs) this.accept(snapshot);
      this.state.cursor = result.cursor;
      await this.persist();
    })();
    try {
      await this.syncTask;
    } finally {
      this.syncTask = null;
    }
  }
  private accept(snapshot: CloudGenerationSnapshot): void {
    if (
      !/^j-[A-Za-z0-9_-]+$/.test(snapshot.job.id) ||
      !/^g-[A-Za-z0-9_-]+$/.test(snapshot.game.id) ||
      snapshot.game.id !== snapshot.job.gameId
    )
      throw new Error('Invalid cloud job identity');
    const old = this.state.games[snapshot.job.id];
    if (old?.deleted) return;
    const cursor = Math.max(0, ...(old?.snapshot.events ?? []).map((e) => e.id));
    const added = snapshot.events.filter((e) => e.id > cursor);
    const entry: StoredGame = {
      ...old,
      snapshot: { ...snapshot, events: [...(old?.snapshot.events ?? []), ...added].slice(-1000) },
    };
    this.state.games[snapshot.job.id] = entry;
    for (const event of added)
      this.emit(snapshot.job.id, { type: 'feed', jobId: snapshot.job.id, event });
    this.emitStatus(entry);
    if (
      snapshot.job.status === 'done' &&
      !entry.installed &&
      !entry.installError &&
      !this.installs.has(snapshot.job.id)
    ) {
      this.installs.add(snapshot.job.id);
      this.installTail = this.installTail
        .catch(() => {})
        .then(async () => {
          try {
            if (entry.deleted || this.state.games[snapshot.job.id]?.deleted || this.stopped) return;
            const bundle = await this.cloud<CloudGameBundle>(`/v1/jobs/${snapshot.job.id}/bundle`);
            validatePortalBundle(bundle, snapshot.game.id);
            await this.native('game.install', {
              jobId: snapshot.job.id,
              gameId: snapshot.game.id,
              bundle,
            });
            const current = this.state.games[snapshot.job.id]!;
            if (current.deleted) {
              await this.native('game.remove', { gameId: snapshot.game.id });
              return;
            }
            current.installed = true;
            current.installError = undefined;
            current.snapshot.game = {
              ...current.snapshot.game,
              status: 'ready',
              title: bundle.meta.title,
              tagline: bundle.meta.tagline,
            };
            await this.persist();
            this.emitStatus(current);
          } catch (error) {
            const current = this.state.games[snapshot.job.id];
            if (current && !current.deleted) {
              current.installed = false;
              current.installError = (error as Error).message;
              await this.persist();
              this.emitStatus(current);
            }
          } finally {
            this.installs.delete(snapshot.job.id);
          }
        });
    }
  }
  async settled(): Promise<void> {
    await this.installTail;
    await this.saveTail;
  }
  private emit(jobId: string, event: JobEvent): void {
    this.listeners.get(jobId)?.forEach((fn) => fn(event));
  }
  private emitStatus(entry: StoredGame): void {
    const job = entry.snapshot.job,
      elapsedMs = job.startedAt ? Date.now() - Date.parse(job.startedAt) : 0;
    if (entry.installed)
      this.emit(job.id, {
        type: 'done',
        jobId: job.id,
        gameId: job.gameId,
        elapsedMs,
        costUsd: job.costSoFarUsd,
      });
    else if (entry.installError || job.status === 'failed' || job.status === 'canceled')
      this.emit(job.id, {
        type: 'failed',
        jobId: job.id,
        gameId: job.gameId,
        elapsedMs,
        costSoFarUsd: job.costSoFarUsd,
        code: entry.installError ? 'install-failed' : (job.error?.code ?? job.status),
        message: entry.installError ?? job.error?.message ?? job.detail,
        stage: entry.installError ? 'failed' : job.stage,
      });
    else
      this.emit(job.id, {
        type: 'progress',
        jobId: job.id,
        elapsedMs,
        costSoFarUsd: job.costSoFarUsd,
        stage: job.status === 'done' ? 'building-assets' : job.stage,
        detail: job.status === 'done' ? 'Downloading game to this Portal' : job.detail,
      });
  }
  subscribe(jobId: string, listener: (event: JobEvent) => void): () => void {
    let listeners = this.listeners.get(jobId);
    if (!listeners) this.listeners.set(jobId, (listeners = new Set()));
    listeners.add(listener);
    queueMicrotask(() => {
      const entry = this.state.games[jobId];
      if (entry && listeners.has(listener)) this.emitStatus(entry);
    });
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(jobId);
    };
  }
  private find(gameId: string): StoredGame | undefined {
    return Object.values(this.state.games).find(
      (entry) => entry.snapshot.game.id === gameId && !entry.deleted,
    );
  }
  private item(entry: StoredGame): GameListItem {
    const game = entry.snapshot.game;
    return {
      ...game,
      status: entry.installed
        ? 'ready'
        : entry.installError
          ? 'failed'
          : game.status === 'ready'
            ? 'generating'
            : game.status,
      failure: entry.installError
        ? { code: 'install-failed', message: entry.installError }
        : (game.failure ?? undefined),
      topScore: this.state.scores[game.id]?.[0] ?? null,
      publication: entry.snapshot.publication,
    };
  }
  private async detail(id: string): Promise<GameDetail> {
    if (this.bootstrap.games.some((g) => g.id === id)) {
      const detail = await this.bundledGame(id);
      return { ...detail, item: { ...detail.item, topScore: this.state.scores[id]?.[0] ?? null } };
    }
    const entry = this.find(id);
    if (!entry) throw new Error('Unknown game');
    const bundle = entry.installed
      ? await this.native<CloudGameBundle | null>('game.read', { gameId: id })
      : null;
    if (entry.installed && !bundle) {
      entry.installed = false;
      entry.installError = 'Saved game files are missing. Retry the download.';
      await this.persist();
    }
    if (bundle) validatePortalBundle(bundle, id);
    const job = { ...entry.snapshot.job };
    if (job.status === 'done' && !entry.installed) {
      job.status = entry.installError ? 'failed' : 'running';
      job.stage = entry.installError ? 'failed' : 'building-assets';
      job.detail = entry.installError ?? 'Downloading game to this Portal';
    }
    return {
      item: this.item(entry),
      spec: bundle?.spec ?? null,
      meta: bundle?.meta ?? null,
      job,
      assets: bundle ? bundleAssets(bundle) : ({} as GameDetail['assets']),
      usage: bundle?.meta.costBreakdown ?? [],
      publicGame: entry.snapshot.publicGame,
      publication: entry.snapshot.publication,
    };
  }
  async handle(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return Response.json(
        await this.route(new URL(path, 'https://appassets.androidplatform.net'), init),
      );
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 503 });
    }
  }
  private async route(url: URL, init: RequestInit): Promise<unknown> {
    const path = url.pathname,
      method = init.method ?? 'GET';
    const body = () =>
      typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    if (path === '/api/settings') {
      if (method === 'PUT') {
        const patch = body() as Partial<SettingsPayload>;
        const settings = this.state.settings;
        for (const key of ['audio', 'input', 'likeness', 'devices'] as const) {
          if (patch[key]) Object.assign(settings, { [key]: { ...settings[key], ...patch[key] } });
        }
        await this.persist();
        return { ok: true };
      }
      return this.state.settings;
    }
    if (path === '/api/cloud/registration' || path === '/api/cloud/registration/pair') {
      this.registration = await this.native<KioskRegistrationStatus>(
        path.endsWith('/pair') ? 'registration.pair' : 'registration.status',
        { force: body().force === true },
      );
      return this.registration;
    }
    if (path === '/api/system/info') {
      const info = await this.native<{
        version: string;
        diskFreeBytes: number;
        diskTotalBytes: number;
      }>('device.info');
      return {
        ...info,
        version: this.bootstrap.version,
        buildCommit: this.bootstrap.buildCommit,
        instanceId: this.instanceId,
        ip: 'Wi-Fi · standalone Portal',
        isPi: false,
        forcedPi: false,
        model: 'Cloud configured',
        imageModel: 'Cloud configured',
        provider: 'Sparkade production',
        lifetimeSpendUsd: Object.values(this.state.games).reduce(
          (sum, entry) => sum + (entry.snapshot.job.costSoFarUsd ?? 0),
          0,
        ),
        dataDir: 'On this Portal',
        gameCount:
          this.bootstrap.games.length +
          Object.values(this.state.games).filter((e) => !e.deleted).length,
      };
    }
    if (path === '/api/generation/estimate') return this.cloud(`/v1/estimate${url.search}`);
    if (path === '/api/transcribe' && init.body instanceof FormData) {
      const audio = init.body.get('audio');
      if (!(audio instanceof Blob)) throw new Error('No recording provided');
      return this.cloud('/v1/transcribe', 'POST', undefined, {
        file: await mediaFile('audio', audio),
      });
    }
    if (path === '/api/games' && method === 'POST' && init.body instanceof FormData) {
      const form = init.body;
      const value = (name: string) => String(form.get(name) ?? '').trim();
      const input: CloudGenerationInput = {
        promptText: value('promptText').slice(0, 1200),
        idempotencyKey: value('idempotencyKey'),
        sourceKind: value('sourceKind') as CloudGenerationInput['sourceKind'],
      };
      if (!input.promptText || !input.idempotencyKey) throw new Error('A game idea is required');
      if (value('requestedArchetype'))
        input.requestedArchetype = value(
          'requestedArchetype',
        ) as CloudGenerationInput['requestedArchetype'];
      if (value('presetId')) input.presetId = value('presetId');
      const details = value('details') || (input.sourceKind !== 'voice' ? input.promptText : '');
      if (input.requestedArchetype || value('heroName') || details)
        input.creationBrief = {
          version: 1,
          ...(input.requestedArchetype ? { archetype: input.requestedArchetype } : {}),
          ...(value('heroName') ? { heroName: value('heroName').slice(0, 48) } : {}),
          ...(details ? { details: details.slice(0, 1200) } : {}),
        };
      const photo = form.get('photo');
      const snapshot = await this.cloud<CloudGenerationSnapshot>('/v1/jobs', 'POST', undefined, {
        fields: { input: JSON.stringify(input) },
        ...(photo instanceof Blob ? { file: await mediaFile('photo', photo) } : {}),
      });
      this.accept(snapshot);
      await this.persist();
      return { jobId: snapshot.job.id, gameId: snapshot.game.id, publicGame: snapshot.publicGame };
    }
    if (path === '/api/games')
      return [
        ...this.bootstrap.games.map((g) => ({
          ...g,
          topScore: this.state.scores[g.id]?.[0] ?? null,
        })),
        ...Object.values(this.state.games)
          .filter((e) => !e.deleted)
          .map((e) => this.item(e)),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const game = /^\/api\/games\/([A-Za-z0-9_-]+)(?:\/(scores|retry|publish|partial))?$/.exec(path);
    if (game) {
      const id = game[1]!,
        action = game[2],
        entry = this.find(id);
      if (action === 'scores') {
        if (method === 'POST') {
          const input = body(),
            score = Number(input.score);
          if (!Number.isFinite(score) || score < 0) throw new Error('Invalid score');
          const initials =
            String(input.initials ?? '')
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, '')
              .slice(0, 3) || 'AAA';
          this.state.scores[id] = [
            ...(this.state.scores[id] ?? []),
            { initials, score: Math.floor(score), at: new Date().toISOString() },
          ]
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
          await this.persist();
        }
        return this.state.scores[id] ?? [];
      }
      if (action === 'partial') return { partial: null };
      if (method === 'DELETE') {
        if (!entry) throw new Error('Built-in games cannot be deleted');
        if (!['done', 'failed', 'canceled'].includes(entry.snapshot.job.status))
          await this.cloud(`/v1/jobs/${entry.snapshot.job.id}/cancel`, 'POST');
        this.state.games[entry.snapshot.job.id]!.deleted = true;
        await this.persist();
        if (!this.installs.has(entry.snapshot.job.id))
          await this.native('game.remove', { gameId: id });
        return { ok: true };
      }
      if (action === 'retry' && entry) {
        if (entry.installError) {
          entry.installError = undefined;
          await this.persist();
          this.accept(entry.snapshot);
        } else
          this.accept(
            await this.cloud<CloudGenerationSnapshot>(
              `/v1/jobs/${entry.snapshot.job.id}/retry`,
              'POST',
              { attempt: entry.snapshot.job.attempt },
            ),
          );
        await this.persist();
        return { jobId: entry.snapshot.job.id, publicGame: entry.snapshot.publicGame };
      }
      if (action === 'publish') {
        await this.sync();
        return { publication: this.find(id)?.snapshot.publication };
      }
      return this.detail(id);
    }
    const feed = /^\/api\/jobs\/(j-[A-Za-z0-9_-]+)\/feed$/.exec(path);
    if (feed) return { events: this.state.games[feed[1]!]?.snapshot.events ?? [] };
    throw new Error('This feature is not available on standalone Portal.');
  }
}
async function mediaFile(name: string, blob: Blob) {
  if (blob.size > 12 * 1024 * 1024) throw new Error('Recording or photo is too large');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return {
    name,
    mime: blob.type || (name === 'audio' ? 'audio/webm' : 'image/jpeg'),
    base64: btoa(text),
  };
}
let runtime: PortalRuntime | null = null;
let portalNative: NativeCall | null = null;
export function reportPortalScreen(screen: string): void {
  void portalNative?.('maintenance.state', { screen }).catch(() => {
    /* Older hosts have no updater. */
  });
}
export function isStandalonePortal(): boolean {
  return runtime !== null;
}
export async function initializePortalRuntime(): Promise<void> {
  if (!window.SparkadePortalNative || location.origin !== 'https://appassets.androidplatform.net')
    return;
  const bootstrap = (await fetch('/portal-bootstrap.json').then((r) =>
    r.json(),
  )) as PortalBootstrap;
  portalNative = bridgeCall(window.SparkadePortalNative);
  runtime = new PortalRuntime(
    portalNative,
    bootstrap,
    (id) =>
      fetch(`/portal-games/${encodeURIComponent(id)}.json`).then((r) =>
        r.json(),
      ) as Promise<GameDetail>,
  );
  await runtime.initialize();
  runtime.start();
}
export function platformFetch(path: string, init?: RequestInit): Promise<Response> {
  return runtime ? runtime.handle(path, init) : fetch(path, init);
}
export function portalJobSubscription(
  jobId: string,
  listener: (event: JobEvent) => void,
): (() => void) | null {
  return runtime?.subscribe(jobId, listener) ?? null;
}
