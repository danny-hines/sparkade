import { Readable } from 'node:stream';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ENGINE_VERSION,
  SPEC_VERSION,
  GENERATED_GAME_ASSET_FILES,
  type CloudGameBundle,
  type CloudGenerationSession,
  type CloudGenerationSnapshot,
  type GameAssetManifest,
  type JobEvent,
  type JobRecord,
} from '@sparkade/shared';
import type { NewJobInputs } from '../pipeline/runner';
import type { Db } from '../storage/db';
import type { GameFiles } from '../storage/files';
import type { SseHub } from '../pipeline/sse';
import { isGeneratedGameAsset } from '../assets/manifest';
import { archetypes } from '@sparkade/archetypes';

export interface CloudMirrorState {
  costUsd: number | null;
  eventCursor: number;
  installed?: boolean;
  deleted?: boolean;
  installError?: string;
  publicGame?: CloudGenerationSnapshot['publicGame'];
  publication?: CloudGenerationSnapshot['publication'];
}
export const mirrorKey = (jobId: string) => `cloud-mirror:${jobId}`;

export class CloudGenerationError extends Error {
  constructor(
    message: string,
    readonly status = 503,
  ) {
    super(message);
  }
}

export class CloudGenerationClient {
  private session: CloudGenerationSession | null = null;
  private sessionTask: Promise<CloudGenerationSession> | null = null;
  private syncing: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private installTail: Promise<void> = Promise.resolve();
  private installing = new Set<string>();
  private lastStatus = new Map<string, string>();

  constructor(
    private readonly portalOrigin: string,
    private readonly token: () => string | null,
    private readonly db: Db,
    private readonly files: GameFiles,
    private readonly hub: SseHub,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    // Recover an installation whose atomic rename completed before its final
    // local DB transaction. Cloud jobs never need local generation recovery.
    for (const job of db.listJobs()) {
      const state = this.state(job.id);
      if (
        state &&
        !state.deleted &&
        files.readMeta(job.gameId)?.status === 'ready' &&
        files.readSpec(job.gameId)
      ) {
        this.save(job.id, { ...state, installed: true, installError: undefined });
        db.updateJob(job.id, {
          status: 'done',
          stage: 'done',
          error: null,
          detail: 'Ready to play',
        });
      }
    }
  }

  owns(jobId: string): boolean {
    return this.db.getSetting(mirrorKey(jobId)) !== null;
  }
  state(jobId: string): CloudMirrorState | null {
    return this.db.getSetting(mirrorKey(jobId));
  }
  private save(jobId: string, state: CloudMirrorState): void {
    this.db.setSetting(mirrorKey(jobId), state);
  }

  start(): void {
    const tick = async () => {
      if (this.stopped) return;
      try {
        if (this.token()) await this.sync();
      } catch {
        /* Connectivity never stops playback. */
      }
      if (!this.stopped) {
        this.timer = setTimeout(() => void tick(), 5000);
        this.timer.unref();
      }
    };
    void tick();
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async getSession(): Promise<CloudGenerationSession> {
    if (this.session && this.session.expiresAt > Date.now() + 30_000) return this.session;
    if (this.sessionTask) return this.sessionTask;
    this.sessionTask = (async () => {
      const token = this.token();
      if (!token)
        throw new CloudGenerationError('Register this cabinet in Settings before generating.', 401);
      const response = await this.fetchImpl(new URL('/api/generation/session', this.portalOrigin), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
      if (!response.ok)
        throw new CloudGenerationError(
          response.status === 401
            ? 'Cabinet registration is no longer valid.'
            : 'Cloud generation is unavailable. Please try again.',
          response.status,
        );
      const session = (await response.json()) as CloudGenerationSession;
      const url = new URL(session.origin);
      if (
        (url.protocol !== 'https:' &&
          !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) ||
        !session.token ||
        !Number.isFinite(session.expiresAt)
      )
        throw new CloudGenerationError('Invalid cloud generation session');
      this.session = session;
      return session;
    })();
    try {
      return await this.sessionTask;
    } finally {
      this.sessionTask = null;
    }
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await this.getSession();
      let response: Response;
      try {
        response = await this.fetchImpl(new URL(path, session.origin), {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init.headers)),
            authorization: `Bearer ${session.token}`,
          },
          signal: AbortSignal.timeout(120_000),
          redirect: 'error',
        });
      } catch {
        throw new CloudGenerationError(
          'Cloud connection interrupted. Your submitted games continue generating.',
        );
      }
      if (response.status === 401 && attempt === 0) {
        this.session = null;
        await response.body?.cancel();
        continue;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new CloudGenerationError(
          body.error ?? 'Cloud generation is temporarily unavailable.',
          response.status,
        );
      }
      return response;
    }
    throw new CloudGenerationError('Could not connect to cloud generation');
  }

  async createJob(inputs: NewJobInputs) {
    const { photo, ...input } = inputs;
    const form = new FormData();
    form.set('input', JSON.stringify(input));
    if (photo)
      form.set('photo', new Blob([Uint8Array.from(photo)], { type: 'image/jpeg' }), 'photo.jpg');
    const response = await this.request('/v1/jobs', { method: 'POST', body: form });
    const snapshot = (await response.json()) as CloudGenerationSnapshot;
    this.accept(snapshot);
    return {
      jobId: snapshot.job.id,
      gameId: snapshot.game.id,
      ...(snapshot.publicGame ? { publicGame: snapshot.publicGame } : {}),
    };
  }
  async transcribe(audio: Buffer, mime: string) {
    const form = new FormData();
    form.set('audio', new Blob([Uint8Array.from(audio)], { type: mime }), 'recording');
    return (await this.request('/v1/transcribe', { method: 'POST', body: form })).json();
  }
  async retryJob(gameId: string) {
    const job = this.db.getJobForGame(gameId);
    if (!job || !this.owns(job.id)) return null;
    const state = this.state(job.id)!;
    if (state.installError) {
      this.save(job.id, { ...state, installError: undefined });
      await this.sync();
      return { jobId: job.id };
    }
    const response = await this.request(`/v1/jobs/${encodeURIComponent(job.id)}/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attempt: job.attempt }),
    });
    this.accept((await response.json()) as CloudGenerationSnapshot);
    return { jobId: job.id };
  }
  async cancelForGame(gameId: string): Promise<void> {
    const job = this.db.getJobForGame(gameId);
    if (!job || !this.owns(job.id)) return;
    await this.request(`/v1/jobs/${encodeURIComponent(job.id)}/cancel`, { method: 'POST' });
    this.save(job.id, { ...this.state(job.id)!, deleted: true });
    this.db.updateJob(job.id, { status: 'canceled' });
  }

  async sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      const watching = Object.fromEntries(
        this.db.listJobs().flatMap((job) => {
          const state = this.state(job.id);
          return state &&
            !state.deleted &&
            (!state.installed || state.publication?.status !== 'published')
            ? [[job.id, state.eventCursor]]
            : [];
        }),
      );
      const response = await this.request('/v1/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cursor: this.db.getSetting<number>('cloud-discovery-cursor') ?? 0,
          watching,
        }),
      });
      const result = (await response.json()) as { cursor: number; jobs: CloudGenerationSnapshot[] };
      for (const snapshot of result.jobs) this.accept(snapshot);
      this.db.setSetting('cloud-discovery-cursor', result.cursor);
    })();
    try {
      await this.syncing;
    } finally {
      this.syncing = null;
    }
  }

  private accept(snapshot: CloudGenerationSnapshot): void {
    const { job, game, events } = snapshot;
    if (
      !/^j-[a-zA-Z0-9_-]+$/.test(job.id) ||
      !/^g-[a-zA-Z0-9_-]+$/.test(game.id) ||
      game.id !== job.gameId
    )
      throw new CloudGenerationError('Invalid cloud job');
    const existing = this.state(job.id);
    if (existing?.deleted) return;
    const installed = !!existing?.installed && existsSync(this.files.gameDir(game.id));
    const state: CloudMirrorState = {
      ...existing,
      installed,
      costUsd: job.costSoFarUsd,
      eventCursor: existing?.eventCursor ?? 0,
      publicGame: snapshot.publicGame ?? existing?.publicGame,
      publication: snapshot.publication ?? existing?.publication,
    };
    const waitingInstall = job.status === 'done' && !installed;
    const status = waitingInstall ? (state.installError ? 'failed' : 'running') : job.status;
    const stage = waitingInstall ? (state.installError ? 'failed' : 'building-assets') : job.stage;
    const detail = waitingInstall
      ? (state.installError ?? 'Generated in the cloud — downloading to this cabinet')
      : job.detail;
    const feed: JobEvent[] = [];
    this.db.db.transaction(() => {
      this.save(job.id, state);
      if (!this.db.getJob(job.id)) this.db.insertJob({ ...job, status, stage, detail }, {});
      else
        this.db.updateJob(job.id, {
          ...job,
          status,
          stage,
          detail,
          error: state.installError
            ? { code: 'install-failed', message: state.installError, stage: 'failed' }
            : (job.error ?? null),
        });
      if (!installed)
        this.db.upsertGame({
          ...game,
          status: waitingInstall ? (state.installError ? 'failed' : 'generating') : game.status,
        });
      for (const event of events) {
        if (event.id <= state.eventCursor) continue;
        const local = this.db.appendGenerationEvent({
          ...event,
          message:
            event.kind === 'complete'
              ? 'Cloud generation complete — preparing the cabinet download'
              : event.message,
        });
        feed.push({ type: 'feed', jobId: job.id, event: local });
        state.eventCursor = event.id;
      }
      this.save(job.id, state);
    })();
    for (const event of feed) this.hub.emit(event);
    this.emit(this.db.getJob(job.id)!);
    if (waitingInstall && !state.installError && !this.installing.has(job.id)) {
      this.installing.add(job.id);
      this.installTail = this.installTail.then(async () => {
        if (this.stopped || this.state(job.id)?.deleted) return;
        try {
          await this.install(job.id, game.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Download interrupted';
          const next = this.state(job.id);
          if (next && !next.deleted) {
            this.save(job.id, { ...next, installError: message });
            this.db.updateJob(job.id, {
              status: 'failed',
              stage: 'failed',
              detail: message,
              error: { code: 'install-failed', message, stage: 'failed' },
            });
            this.db.setGameStatus(game.id, 'failed', { code: 'install-failed', message });
            this.emit(this.db.getJob(job.id)!);
          }
        } finally {
          this.installing.delete(job.id);
        }
      });
    }
  }

  private emit(job: JobRecord): void {
    const statusKey =
      job.status === 'done'
        ? JSON.stringify(['done', job.attempt])
        : JSON.stringify([job.status, job.stage, job.detail, job.costSoFarUsd, job.attempt]);
    if (this.lastStatus.get(job.id) === statusKey) return;
    this.lastStatus.set(job.id, statusKey);
    const elapsedMs = job.startedAt ? Date.now() - Date.parse(job.startedAt) : 0;
    if (job.status === 'done')
      this.hub.emit({
        type: 'done',
        jobId: job.id,
        gameId: job.gameId,
        elapsedMs,
        costUsd: job.costSoFarUsd,
      });
    else if (job.status === 'failed' || job.status === 'canceled')
      this.hub.emit({
        type: 'failed',
        jobId: job.id,
        gameId: job.gameId,
        elapsedMs,
        costSoFarUsd: job.costSoFarUsd,
        code: job.error?.code ?? job.status,
        message: job.error?.message ?? job.detail,
        stage: job.stage,
      });
    else
      this.hub.emit({
        type: 'progress',
        jobId: job.id,
        stage: job.stage,
        detail: job.detail,
        elapsedMs,
        costSoFarUsd: job.costSoFarUsd,
      });
  }

  /** Serial downloads; stream each file to disk with a size cap and checksum.
   * No PNG decode, recompression, or atlas assembly happens on the cabinet. */
  private async install(jobId: string, gameId: string): Promise<void> {
    const bundle = (await (
      await this.request(`/v1/jobs/${jobId}/bundle`)
    ).json()) as CloudGameBundle;
    validateBundle(bundle, gameId);
    const staging = join(this.files.stagingDir, jobId);
    const assetsDir = join(staging, 'assets');
    await mkdir(assetsDir, { recursive: true });
    for (const asset of bundle.manifest.assets) {
      if (this.stopped || this.state(jobId)?.deleted) return;
      const path = join(assetsDir, asset.filename);
      // Completed files survive disconnects/reboots; only missing ones download.
      try {
        if (
          createHash('sha256')
            .update(await readFile(path))
            .digest('hex') === asset.sha256
        )
          continue;
      } catch {}
      const response = await this.request(
        `/v1/jobs/${jobId}/assets/${encodeURIComponent(asset.filename)}`,
      );
      if (!response.body) throw new Error('Empty asset download');
      const { open } = await import('node:fs/promises');
      const file = await open(`${path}.part`, 'w');
      const hash = createHash('sha256');
      let size = 0;
      try {
        for await (const chunk of Readable.fromWeb(
          response.body as import('node:stream/web').ReadableStream,
        )) {
          size += chunk.length;
          if (size > 16 * 1024 * 1024) throw new Error('Generated asset exceeds download limit');
          hash.update(chunk);
          await file.writeFile(chunk);
        }
      } finally {
        await file.close();
      }
      if (hash.digest('hex') !== asset.sha256) {
        await rm(`${path}.part`, { force: true });
        throw new Error('Asset checksum mismatch; retry download');
      }
      await rename(`${path}.part`, path);
    }
    if (this.stopped || this.state(jobId)?.deleted) return;
    await writeFile(join(assetsDir, 'manifest.json'), JSON.stringify(bundle.manifest));
    await writeFile(join(staging, 'game.json'), JSON.stringify(bundle.spec));
    await writeFile(join(staging, 'meta.json'), JSON.stringify(bundle.meta));
    // A delete can arrive while the final files are being written. The check,
    // rename and DB commit below are synchronous so it cannot resurrect a game.
    if (this.stopped || this.state(jobId)?.deleted) return;
    this.files.publish(jobId, gameId);
    this.db.db.transaction(() => {
      const row = this.db.getGame(gameId)!;
      this.db.upsertGame({
        ...row,
        status: 'ready',
        failure: null,
        title: bundle.meta.title,
        tagline: bundle.meta.tagline,
        cover: this.files.coverFor(bundle.spec, gameId),
        engineVersion: bundle.meta.engineVersion,
        archetypeVersion: bundle.meta.archetypeVersion,
      });
      this.db.updateJob(jobId, {
        status: 'done',
        stage: 'done',
        detail: 'Ready to play',
        error: null,
      });
      this.save(jobId, { ...this.state(jobId)!, installed: true, installError: undefined });
    })();
    this.emit(this.db.getJob(jobId)!);
  }

  async settled(): Promise<void> {
    await this.installTail;
  }
}

export function validateBundle(bundle: CloudGameBundle, gameId: string): void {
  if (
    !bundle?.meta ||
    !bundle.spec ||
    bundle.meta.id !== gameId ||
    bundle.meta.status !== 'ready' ||
    bundle.meta.engineVersion.split('.')[0] !== ENGINE_VERSION.split('.')[0] ||
    bundle.meta.specVersion !== SPEC_VERSION ||
    bundle.spec.specVersion !== SPEC_VERSION ||
    bundle.meta.archetype !== bundle.spec.archetype ||
    !Object.hasOwn(archetypes, bundle.spec.archetype) ||
    bundle.meta.archetypeVersion?.split('.')[0] !==
      archetypes[bundle.spec.archetype].version.split('.')[0]
  )
    throw new Error('This game requires a cabinet update before installation.');
  const manifest: GameAssetManifest = bundle.manifest;
  if (
    manifest?.version !== 1 ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length > Object.keys(GENERATED_GAME_ASSET_FILES).length ||
    new Set(manifest.assets.map((a) => a.filename)).size !== manifest.assets.length ||
    !manifest.assets.every(isGeneratedGameAsset)
  )
    throw new Error('Invalid generated asset manifest');
}
