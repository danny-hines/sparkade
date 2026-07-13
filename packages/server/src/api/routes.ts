// HTTP API. Server binds 127.0.0.1 by default; mutating endpoints enforce
// same-origin (a stray LAN page can't drive privileged localhost APIs).
// Photos and audio never appear in logs.
import { existsSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { GENERATION, type JobEvent, type LogicalButton, type SystemInfo } from '@sparkade/shared';
import { costOf, estimateGenerationCost } from '../pipeline/cost';
import { stageProvider } from '../providers/index';
import type { GenerationRunner } from '../pipeline/runner';
import type { SseHub } from '../pipeline/sse';
import type { ConfigStore } from '../storage/config';
import type { Db } from '../storage/db';
import type { GameFiles } from '../storage/files';
import { connectWifi, listNetworks, wifiStatus } from '../system/wifi';
import { piMode, primaryIp } from '../util';
import { registerDevAssetRoutes } from './dev-assets';
import { registerDevLikenessRoutes } from './dev-likeness';

export interface ApiContext {
  db: Db;
  files: GameFiles;
  configStore: ConfigStore;
  runner: GenerationRunner;
  hub: SseHub;
  version: string;
  instanceId: string;
  port: number;
}

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export function registerRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { db, files, configStore, runner, hub } = ctx;

  // Dev-only asset review gallery + likeness lab (never registered in kiosk/production).
  if (process.env.SPARKADE_DEV === '1') {
    registerDevAssetRoutes(app);
    registerDevLikenessRoutes(app, configStore);
  }

  // ---- same-origin gate on mutating requests ------------------------------
  const isDev = process.env.SPARKADE_DEV === '1';
  const allowedOrigins = new Set<string>([
    `http://127.0.0.1:${ctx.port}`,
    `http://localhost:${ctx.port}`,
  ]);
  // In dev, any localhost origin is fine (Vite may land on 5173, 5174, … and the
  // asset gallery / likeness lab are localhost-only tooling). Prod stays strict.
  const devLocalhost = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
  const originAllowed = (origin: string | undefined): boolean =>
    !origin || allowedOrigins.has(origin) || (isDev && devLocalhost.test(origin));
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    if (!originAllowed(req.headers.origin)) {
      await reply.code(403).send({ error: 'cross-origin requests are not allowed' });
    }
  });
  if (isDev) {
    // CORS for the Vite dev origin (any localhost port; prod is same-origin).
    app.addHook('onSend', async (req, reply) => {
      const origin = req.headers.origin;
      if (origin && originAllowed(origin)) {
        reply.header('access-control-allow-origin', origin);
        reply.header('vary', 'origin');
      }
    });
    app.options('/api/*', async (req, reply) => {
      const origin = req.headers.origin;
      if (origin && originAllowed(origin)) {
        reply.header('access-control-allow-origin', origin);
        reply.header('access-control-allow-methods', 'GET,POST,PUT,DELETE');
        reply.header('access-control-allow-headers', 'content-type');
      }
      return reply.code(204).send();
    });
  }

  // ---- transcription (before any job — the review screen confirms it) -----
  app.post('/api/transcribe', async (req, reply) => {
    const file = await (req as FastifyRequest & { file: () => Promise<MultipartFile | undefined> }).file();
    if (!file) return reply.code(400).send({ error: 'no audio uploaded' });
    const audio = await file.toBuffer();
    if (audio.length > MAX_AUDIO_BYTES) return reply.code(413).send({ error: 'audio too large' });
    const config = configStore.get();
    const { provider, providerName, model } = stageProvider(config, 'stt');
    if (!provider.transcribe || !provider.capabilities.audioIn) {
      return reply.code(501).send({
        error: `provider "${providerName}" cannot transcribe audio — point stages.stt at one that can (sparkade config)`,
      });
    }
    try {
      const res = await provider.transcribe(audio, file.mimetype || 'audio/webm', { model });
      db.insertUsage({
        jobId: 'transcribe',
        gameId: '',
        stage: 'stt',
        model,
        provider: providerName,
        inputTokens: res.usage.input,
        outputTokens: res.usage.output,
        cachedTokens: res.usage.cachedInput ?? 0,
        costUsd: costOf(model, res.usage, config.pricing),
        failed: false,
        repair: false,
      });
      if (!res.text) return reply.code(422).send({ error: 'could not hear anything — try again closer to the mic' });
      return { text: res.text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      req.log.warn({ msg: 'transcription failed' });
      return reply.code(502).send({ error: `transcription failed: ${msg.slice(0, 200)}` });
    }
  });

  // ---- games ---------------------------------------------------------------
  app.post('/api/games', async (req, reply) => {
    let promptText = '';
    let idempotencyKey = '';
    let sourceKind: 'voice' | 'preset' | 'surprise' = 'voice';
    let presetId: string | undefined;
    let photo: Buffer | undefined;
    if (req.isMultipart()) {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'photo') {
          photo = await part.toBuffer();
        } else if (part.type === 'field') {
          const v = String(part.value);
          if (part.fieldname === 'promptText') promptText = v;
          else if (part.fieldname === 'idempotencyKey') idempotencyKey = v;
          else if (part.fieldname === 'sourceKind') sourceKind = v as typeof sourceKind;
          else if (part.fieldname === 'presetId') presetId = v;
        }
      }
    } else {
      const body = req.body as Record<string, string> | null;
      promptText = body?.promptText ?? '';
      idempotencyKey = body?.idempotencyKey ?? '';
      sourceKind = (body?.sourceKind as typeof sourceKind) ?? 'voice';
      presetId = body?.presetId;
    }
    if (!promptText.trim()) return reply.code(400).send({ error: 'promptText is required' });
    if (!idempotencyKey) return reply.code(400).send({ error: 'idempotencyKey is required' });
    if (photo && photo.length > MAX_PHOTO_BYTES) return reply.code(413).send({ error: 'photo too large' });
    const res = runner.createJob({
      promptText: promptText.slice(0, 1200),
      sourceKind,
      ...(presetId ? { presetId } : {}),
      ...(photo ? { photo } : {}),
      idempotencyKey,
    });
    return reply.code(202).send(res);
  });

  app.get('/api/games', async () => {
    return db.listGames().map((row) => db.listItem(row));
  });

  app.get('/api/games/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.getGame(id);
    if (!row) return reply.code(404).send({ error: 'unknown game' });
    const spec = files.readSpec(id);
    const meta = files.readMeta(id);
    const job = row.jobId ? db.getJob(row.jobId) : null;
    const assets = {
      head12: existsSync(join(files.gameDir(id), 'assets', 'head12.png')),
      head16: existsSync(join(files.gameDir(id), 'assets', 'head16.png')),
      portrait: existsSync(join(files.gameDir(id), 'assets', 'portrait.png')),
    };
    return {
      item: db.listItem(row),
      spec,
      meta,
      job,
      assets,
      usage: db.usageForGame(id),
    };
  });

  app.get('/api/games/:id/assets/:name', async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    if (!['head12.png', 'head16.png', 'portrait.png'].includes(name)) {
      return reply.code(404).send({ error: 'unknown asset' });
    }
    const path = join(files.gameDir(id), 'assets', name);
    if (!existsSync(path)) return reply.code(404).send({ error: 'asset not found' });
    return reply.type('image/png').send(await import('node:fs').then((fs) => fs.createReadStream(path)));
  });

  app.delete('/api/games/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.getGame(id);
    if (!row) return reply.code(404).send({ error: 'unknown game' });
    runner.cancelForGame(id); // cancels a running job first, discards staging
    files.deleteGame(id);
    db.deleteGame(id);
    return { ok: true };
  });

  app.post('/api/games/:id/retry', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.getGame(id);
    if (!row) return reply.code(404).send({ error: 'unknown game' });
    const res = runner.retryJob(id);
    if (!res) return reply.code(409).send({ error: 'this game has no failed job to retry' });
    return reply.code(202).send(res);
  });

  // ---- job progress (SSE) ---------------------------------------------------
  app.get('/api/jobs/:jobId/events', (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = db.getJob(jobId);
    if (!job) {
      void reply.code(404).send({ error: 'unknown job' });
      return;
    }
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: JobEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    // Synthesize current state so reloads instantly reflect reality.
    if (job.status === 'done') {
      send({ type: 'done', jobId, gameId: job.gameId, elapsedMs: 0, costUsd: db.gameCost(job.gameId) });
    } else if (job.status === 'failed' || job.status === 'canceled') {
      send({
        type: 'failed',
        jobId,
        gameId: job.gameId,
        code: job.error?.code ?? 'failed',
        message: job.error?.message ?? 'Generation failed.',
        stage: job.stage,
        elapsedMs: 0,
        costSoFarUsd: db.gameCost(job.gameId),
      });
    } else {
      send({
        type: 'progress',
        jobId,
        stage: job.stage,
        detail: job.detail,
        elapsedMs: job.startedAt ? Date.now() - Date.parse(job.startedAt) : 0,
        costSoFarUsd: db.gameCost(job.gameId),
      });
    }
    const unsubscribe = hub.subscribe(jobId, send);
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // ---- scores ----------------------------------------------------------------
  app.get('/api/games/:id/scores', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!db.getGame(id)) return reply.code(404).send({ error: 'unknown game' });
    return db.topScores(id);
  });

  app.post('/api/games/:id/scores', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!db.getGame(id)) return reply.code(404).send({ error: 'unknown game' });
    const body = req.body as { initials?: string; score?: number } | null;
    const initials = String(body?.initials ?? '').toUpperCase();
    const score = Number(body?.score);
    if (!/^[A-Z0-9.]{3}$/.test(initials)) return reply.code(400).send({ error: 'initials must be 3 characters' });
    if (!Number.isFinite(score) || score < 0 || score > 99_999_999) {
      return reply.code(400).send({ error: 'invalid score' });
    }
    return db.addScore(id, initials, Math.floor(score));
  });

  // ---- settings ----------------------------------------------------------------
  app.get('/api/settings', async () => {
    const c = configStore.get();
    return {
      audio: c.audio,
      input: c.input,
      likeness: c.likeness,
      devices: c.devices,
      presets: c.presets,
      stages: c.stages, // read-only in the UI; keys never appear here
      pricing: c.pricing,
    };
  });

  app.put('/api/settings', async (req, reply) => {
    const body = req.body as {
      audio?: { musicVol: number; sfxVol: number; uiVol: number };
      input?: { gamepad?: Record<string, LogicalButton>; keyboard?: Record<string, LogicalButton> };
      likeness?: { describeInStory?: boolean; smartFeatures?: boolean; style?: 'photo' | 'avatar'; portraitGen?: { enabled?: boolean } };
      devices?: { cameraId?: string; cameraLabel?: string; micId?: string; micLabel?: string };
    } | null;
    if (!body) return reply.code(400).send({ error: 'empty body' });
    configStore.update((c) => {
      if (body.audio) {
        c.audio = {
          musicVol: clamp01(body.audio.musicVol),
          sfxVol: clamp01(body.audio.sfxVol),
          uiVol: clamp01(body.audio.uiVol),
        };
      }
      if (body.input) {
        if (body.input.gamepad) c.input.gamepad = body.input.gamepad;
        if (body.input.keyboard && Object.keys(body.input.keyboard).length > 0) c.input.keyboard = body.input.keyboard;
      }
      if (body.likeness) {
        c.likeness = {
          ...c.likeness,
          ...(body.likeness.describeInStory !== undefined ? { describeInStory: !!body.likeness.describeInStory } : {}),
          ...(body.likeness.smartFeatures !== undefined ? { smartFeatures: !!body.likeness.smartFeatures } : {}),
          ...(body.likeness.style ? { style: body.likeness.style === 'avatar' ? 'avatar' : 'photo' } : {}),
        };
        if (body.likeness.portraitGen?.enabled !== undefined && c.likeness.portraitGen) {
          c.likeness.portraitGen = { ...c.likeness.portraitGen, enabled: !!body.likeness.portraitGen.enabled };
        }
      }
      if (body.devices) {
        // Store only short strings; empty string clears back to browser default.
        const s = (v: unknown): string | undefined =>
          typeof v === 'string' && v.trim() ? v.slice(0, 200) : undefined;
        c.devices = {
          cameraId: s(body.devices.cameraId),
          cameraLabel: s(body.devices.cameraLabel),
          micId: s(body.devices.micId),
          micLabel: s(body.devices.micLabel),
        };
      }
    });
    return { ok: true };
  });

  // ---- generation cost estimate (review screen) --------------------------------
  app.get('/api/generation/estimate', async () => {
    const c = configStore.get();
    const model = c.stages.design.model;
    const usd = estimateGenerationCost(model, c.pricing);
    return {
      usd,
      label: usd === null ? 'cost unavailable' : `about $${usd.toFixed(2)} (estimate)`,
      model,
      busy: runner.isBusy(),
      maxRecordingSeconds: GENERATION.maxRecordingSeconds,
    };
  });

  // ---- system -------------------------------------------------------------------
  app.get('/api/system/info', async (): Promise<SystemInfo> => {
    let diskFreeBytes = 0;
    let diskTotalBytes = 0;
    try {
      const s = statfsSync(files.dir);
      diskFreeBytes = s.bavail * s.bsize;
      diskTotalBytes = s.blocks * s.bsize;
    } catch {
      /* statfs unsupported (some Windows dirs) — report zeros */
    }
    const c = configStore.get();
    return {
      version: ctx.version,
      instanceId: ctx.instanceId,
      ip: primaryIp(),
      diskFreeBytes,
      diskTotalBytes,
      isPi: piMode(),
      forcedPi: process.env.SPARKADE_FORCE_PI === '1',
      model: process.env.SPARKADE_PROVIDER === 'mock' ? 'mock' : c.stages.design.model,
      provider: process.env.SPARKADE_PROVIDER ?? c.stages.design.provider,
      lifetimeSpendUsd: db.lifetimeSpendUsd(),
      dataDir: files.dir,
      gameCount: db.listGames().length,
    };
  });

  // ---- wifi (Pi only; mock behind SPARKADE_FORCE_PI) ----------------------------
  if (piMode()) {
    app.get('/api/system/wifi/networks', async (_req, reply) => {
      try {
        return await listNetworks();
      } catch (e) {
        return reply.code(502).send({ error: e instanceof Error ? e.message : 'wifi scan failed' });
      }
    });
    app.get('/api/system/wifi/status', async () => wifiStatus());
    app.post('/api/system/wifi/connect', async (req, reply) => {
      const body = req.body as { ssid?: string; psk?: string } | null;
      const ssid = String(body?.ssid ?? '');
      const psk = String(body?.psk ?? '');
      if (!ssid) return reply.code(400).send({ error: 'ssid required' });
      const res = await connectWifi(ssid, psk);
      if (res.ok) return { ok: true, ssid: res.ssid };
      return reply.code(502).send({ ok: false, reason: res.reason, error: res.message });
    });
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number(v) || 0));
}
