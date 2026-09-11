import { createHash } from 'node:crypto';
import { createReadStream, existsSync, rmSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import {
  ARCHETYPE_IDS,
  type CloudGenerationInput,
  type CloudGenerationSnapshot,
  type JobRecord,
} from '@sparkade/shared';
import {
  signGenerationToken,
  verifyGenerationToken,
  type GenerationPrincipal,
} from '@sparkade/generation/service-auth';
import { GenerationRunner, type NewJobInputs } from '../pipeline/runner';
import { SseHub } from '../pipeline/sse';
import { Db } from '../storage/db';
import { GameFiles, reconcileGames } from '../storage/files';
import { ConfigStore } from '../storage/config';
import { generatedAssetForFilename, readGameAssetManifest } from '../assets/manifest';
import { PublicGamePublisher } from '../cloud/public-games';
import { stageProvider } from '../providers';
import { costOf } from '../pipeline/cost';
import { generationEstimate } from '../pipeline/generation-estimate';

const SCHEMA = `CREATE TABLE IF NOT EXISTS cloud_jobs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL, principal_json TEXT NOT NULL, input_hash TEXT NOT NULL
); CREATE INDEX IF NOT EXISTS cloud_jobs_owner ON cloud_jobs(owner, seq);`;
const ACTIVE = new Set(['queued', 'running', 'waiting-network']);

/** Private titles, premises and mechanics must not enter another owner's
 * model context through the runner's anti-repetition history. */
export function cloudGenerationHistory(db: Db, jobId: string) {
  const rows = db.db
    .prepare(
      `SELECT candidate.job_id FROM cloud_jobs candidate
    JOIN cloud_jobs current ON current.owner=candidate.owner WHERE current.job_id=?`,
    )
    .all(jobId) as { job_id: string }[];
  const allowed = new Set(rows.map((row) => row.job_id));
  return db
    .listGames()
    .filter((game) => game.golden || (game.jobId !== null && allowed.has(game.jobId)));
}

export interface ServiceOptions {
  dir: string;
  secret: string;
  portalOrigin: string;
  fetchImpl?: typeof fetch;
  runnerFactory?: (db: Db, files: GameFiles, config: ConfigStore, hub: SseHub) => GenerationRunner;
  publish?: boolean;
}

export { validateCloudInput } from '../pipeline/cloud-input';
import { validateCloudInput } from '../pipeline/cloud-input';

export async function createGenerationService(options: ServiceOptions) {
  if (options.secret.length < 32)
    throw new Error('SPARKADE_GENERATION_SECRET must have at least 32 characters');
  const db = new Db(options.dir);
  db.db.pragma('synchronous = FULL');
  db.db.exec(SCHEMA);
  const files = new GameFiles(options.dir);
  const config = new ConfigStore(options.dir);
  const hub = new SseHub();
  const runner =
    options.runnerFactory?.(db, files, config, hub) ??
    new GenerationRunner(db, files, config, hub, (id) => cloudGenerationHistory(db, id));
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, fieldSize: 16_384 },
  });
  const principals = new WeakMap<object, GenerationPrincipal>();
  const publishers = new Map<string, PublicGamePublisher>();
  const principalFor = (jobId: string): GenerationPrincipal | null => {
    const row = db.db.prepare('SELECT principal_json FROM cloud_jobs WHERE job_id=?').get(jobId) as
      { principal_json: string } | undefined;
    return row ? JSON.parse(row.principal_json) : null;
  };
  const publisherFor = (principal: GenerationPrincipal, jobId: string) => {
    let publisher = publishers.get(jobId);
    if (!publisher) {
      publisher = new PublicGamePublisher(
        options.portalOrigin,
        () => signGenerationToken(principal, 'publication', options.secret),
        principal.name,
        {
          getGame: (id) => db.getGame(id),
          getSetting: <T>(key: string) => db.getSetting<T>(`publisher:${jobId}:${key}`),
          setSetting: (key, value) => db.setSetting(`publisher:${jobId}:${key}`, value),
        },
        hub,
        options.fetchImpl ?? fetch,
        (id) => files.readSpec(id),
        (id) => files.readPublicAssets(id),
      );
      publishers.set(jobId, publisher);
    }
    return publisher;
  };
  const snapshot = (job: JobRecord, after = 0): CloudGenerationSnapshot => {
    const principal = principalFor(job.id)!;
    const publication =
      options.publish === false
        ? null
        : publisherFor(principal, job.id).publicationForGame(job.gameId);
    return {
      job,
      game: db.getGame(job.gameId)!,
      events: db
        .generationEventsForJob(job.id)
        .filter((e) => e.id > after)
        .slice(0, 200),
      ...(publication ? { publication, publicGame: publication.link } : {}),
    };
  };

  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin) {
      if (origin !== new URL(options.portalOrigin).origin)
        return reply.code(403).send({ error: 'Origin denied' });
      reply.header('access-control-allow-origin', origin).header('vary', 'origin');
      reply.header('access-control-allow-methods', 'GET,POST,OPTIONS');
      reply.header('access-control-allow-headers', 'authorization,content-type');
    }
    if (req.method === 'OPTIONS') return reply.code(204).send();
    if (req.url === '/health') return;
    const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const principal = verifyGenerationToken(token, 'generation', options.secret);
    if (!principal)
      return reply.code(401).send({ error: 'Generation session expired; reconnect to continue' });
    principals.set(req, principal);
    const jobId = (req.params as { jobId?: string }).jobId;
    if (jobId && principalFor(jobId)?.owner !== principal.owner)
      return reply.code(404).send({ error: 'Unknown job' });
  });
  app.get('/health', async () => ({ ok: true }));
  app.options('/*', async () => ({}));

  app.post('/v1/jobs', async (req, reply) => {
    let input: CloudGenerationInput;
    let photo: Buffer | undefined;
    let value: unknown = req.body;
    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (
            part.fieldname !== 'photo' ||
            !['image/jpeg', 'image/png', 'image/webp'].includes(part.mimetype)
          )
            return reply.code(400).send({ error: 'Invalid photo' });
          photo = await part.toBuffer();
          if (photo.length > 4 * 1024 * 1024)
            return reply.code(413).send({ error: 'Photo too large' });
        } else if (part.fieldname === 'input') {
          try {
            value = JSON.parse(String(part.value));
          } catch {
            return reply.code(400).send({ error: 'Invalid input JSON' });
          }
        }
      }
    }
    try {
      input = validateCloudInput(value);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    const principal = principals.get(req)!;
    const scopedKey = createHash('sha256')
      .update(`${principal.owner}\0${input.idempotencyKey}`)
      .digest('hex');
    const hash = createHash('sha256')
      .update(JSON.stringify(input))
      .update(photo ?? '')
      .digest('hex');
    const existing = db.getJobByIdempotencyKey(scopedKey);
    if (existing) {
      const stored = db.db
        .prepare('SELECT input_hash FROM cloud_jobs WHERE job_id=?')
        .get(existing.id) as { input_hash: string } | undefined;
      if (stored?.input_hash !== hash)
        return reply.code(409).send({ error: 'Idempotency key already used for different inputs' });
      return reply.code(202).send(snapshot(existing));
    }
    const all = db.listJobs();
    const owned = all.filter((job) => principalFor(job.id)?.owner === principal.owner);
    if (
      all.filter((j) => ACTIVE.has(j.status)).length >= 200 ||
      owned.filter((j) => ACTIVE.has(j.status)).length >= 50 ||
      owned.filter((j) => Date.parse(j.createdAt) > Date.now() - 86_400_000).length >= 100
    ) {
      return reply
        .code(429)
        .header('retry-after', '60')
        .send({ error: 'Generation queue limit reached; try again later' });
    }
    const disk = statfsSync(options.dir);
    if (disk.bavail * disk.bsize < 1024 ** 3)
      return reply.code(503).send({ error: 'Generation storage is full; try again later' });
    let result!: { jobId: string; gameId: string };
    db.db.transaction(() => {
      result = runner.createJob({ ...input, idempotencyKey: scopedKey, photo } as NewJobInputs, {
        defer: true,
      });
      db.db
        .prepare(
          'INSERT INTO cloud_jobs(job_id, owner, principal_json, input_hash) VALUES(?,?,?,?)',
        )
        .run(result.jobId, principal.owner, JSON.stringify(principal), hash);
    })();
    runner.startJob(result.jobId);
    if (options.publish !== false)
      await publisherFor(principal, result.jobId).reserveAndTrack(result.jobId, result.gameId);
    return reply.code(202).send(snapshot(db.getJob(result.jobId)!));
  });

  // One batched, cursor-based poll per cabinet. Discovery survives a lost POST
  // response; feed cursors make reconnect catch-up bounded and repeatable.
  app.post('/v1/sync', async (req, reply) => {
    const body = req.body as { cursor?: unknown; watching?: unknown } | null;
    const cursor = body?.cursor ?? 0;
    const watching = body?.watching ?? {};
    if (
      !Number.isSafeInteger(cursor) ||
      Number(cursor) < 0 ||
      !watching ||
      typeof watching !== 'object' ||
      Array.isArray(watching) ||
      Object.keys(watching).length > 1000 ||
      Object.values(watching).some((v) => !Number.isSafeInteger(v) || Number(v) < 0)
    )
      return reply.code(400).send({ error: 'Invalid sync cursor' });
    const owner = principals.get(req)!.owner;
    const discovered = db.db
      .prepare('SELECT seq, job_id FROM cloud_jobs WHERE owner=? AND seq>? ORDER BY seq LIMIT 50')
      .all(owner, cursor) as { seq: number; job_id: string }[];
    const ids = new Set([...discovered.map((r) => r.job_id), ...Object.keys(watching)]);
    const jobs = [...ids]
      .filter((id) => principalFor(id)?.owner === owner)
      .map((id) => db.getJob(id))
      .filter((j): j is JobRecord => !!j && !!db.getGame(j.gameId));
    return {
      cursor: discovered.at(-1)?.seq ?? cursor,
      jobs: jobs.map((job) =>
        snapshot(job, Number((watching as Record<string, number>)[job.id]) || 0),
      ),
    };
  });
  app.get('/v1/jobs/:jobId', async (req) =>
    snapshot(db.getJob((req.params as { jobId: string }).jobId)!),
  );
  app.post('/v1/jobs/:jobId/retry', async (req, reply) => {
    const job = db.getJob((req.params as { jobId: string }).jobId)!;
    // Expected attempt makes retries safe after a timeout or double-click.
    if ((req.body as { attempt?: unknown })?.attempt !== job.attempt) return snapshot(job);
    if (!['failed', 'canceled'].includes(job.status)) return snapshot(job);
    if (job.attempt >= 10) return reply.code(429).send({ error: 'Retry limit reached' });
    if (job.hasPhoto && !existsSync(join(files.stagingDir, job.id, 'photo.jpg'))) {
      return reply
        .code(409)
        .send({ error: 'The reference photo has expired. Create a new game with your photo.' });
    }
    runner.retryJob(job.gameId);
    return snapshot(db.getJob(job.id)!);
  });
  app.post('/v1/jobs/:jobId/cancel', async (req) => {
    const job = db.getJob((req.params as { jobId: string }).jobId)!;
    if (ACTIVE.has(job.status)) runner.cancelForGame(job.gameId);
    return { ok: true };
  });
  app.get('/v1/jobs/:jobId/partial', async (req) => ({
    partial: files.readPartial((req.params as { jobId: string }).jobId),
  }));
  app.get('/v1/jobs/:jobId/bundle', async (req, reply) => {
    const job = db.getJob((req.params as { jobId: string }).jobId)!;
    if (job.status !== 'done') return reply.code(409).send({ error: 'Game is not ready' });
    return {
      spec: files.readSpec(job.gameId),
      meta: files.readMeta(job.gameId),
      manifest: readGameAssetManifest(join(files.gameDir(job.gameId), 'assets')),
    };
  });
  app.get('/v1/jobs/:jobId/assets/:name', async (req, reply) => {
    const { jobId, name } = req.params as { jobId: string; name: string };
    const job = db.getJob(jobId)!;
    const dir = join(
      job.status === 'done' ? files.gameDir(job.gameId) : join(files.stagingDir, jobId),
      'assets',
    );
    const asset = generatedAssetForFilename(dir, name);
    if (!asset) return reply.code(404).send({ error: 'Unknown asset' });
    return reply.type(asset.mimeType).send(createReadStream(join(dir, name)));
  });
  let transcribing = 0;
  app.post('/v1/transcribe', async (req, reply) => {
    if (transcribing >= 4)
      return reply.code(429).send({ error: 'Transcription is busy; try again' });
    transcribing++;
    try {
      const file = await req.file();
      if (
        !file ||
        !['audio/webm', 'audio/wav', 'audio/mp4', 'audio/ogg', 'video/webm'].includes(file.mimetype)
      )
        return reply.code(400).send({ error: 'Invalid audio' });
      const audio = await file.toBuffer();
      const c = config.get();
      const { provider, model, providerName } = stageProvider(c, 'stt');
      if (!provider.transcribe) return reply.code(503).send({ error: 'Transcription unavailable' });
      const result = await provider.transcribe(audio, file.mimetype, { model });
      db.insertUsage({
        jobId: `transcribe:${principals.get(req)!.owner}`,
        gameId: '',
        stage: 'stt',
        model: result.model ?? model,
        provider: providerName,
        inputTokens: result.usage.input,
        outputTokens: result.usage.output,
        cachedTokens: result.usage.cachedInput ?? 0,
        audioSeconds: result.usage.audioSeconds,
        costUsd: costOf(result.model ?? model, result.usage, c.pricing),
        failed: false,
        repair: false,
      });
      if (!result.text)
        return reply.code(422).send({ error: 'Could not hear anything; try again' });
      return { text: result.text };
    } catch {
      return reply.code(503).send({ error: 'Transcription temporarily unavailable; try again' });
    } finally {
      transcribing--;
    }
  });
  app.get('/v1/estimate', async (req) => {
    const c = config.get();
    const query = req.query as { photo?: string; archetype?: string };
    const archetype = (ARCHETYPE_IDS as readonly string[]).includes(query.archetype ?? '')
      ? (query.archetype as CloudGenerationInput['requestedArchetype'])
      : undefined;
    return generationEstimate(c, query.photo === '1', archetype, runner.isBusy());
  });

  let publishing = false;
  const maintain = async () => {
    if (publishing) return;
    publishing = true;
    try {
      for (const job of db.listJobs()) {
        // Failed/canceled source photos expire after seven days. Successful
        // publication already removes source media atomically.
        if (
          !ACTIVE.has(job.status) &&
          Date.parse(job.finishedAt ?? job.createdAt) < Date.now() - 7 * 86_400_000
        ) {
          rmSync(join(files.stagingDir, job.id, 'photo.jpg'), { force: true });
        }
        const principal = principalFor(job.id);
        if (!principal || options.publish === false) continue;
        const publisher = publisherFor(principal, job.id);
        if (job.status === 'done') {
          if (publisher.publicationForGame(job.gameId)?.status !== 'published')
            await publisher.publishExisting(job.gameId);
        } else {
          await publisher.reserveAndTrack(job.id, job.gameId);
          // Restore publication status even when the worker restarted after
          // the original terminal event (the in-memory hub has no history).
          if (job.status === 'failed' || job.status === 'canceled') {
            hub.emit({
              type: 'failed',
              jobId: job.id,
              gameId: job.gameId,
              stage: job.stage,
              code: job.error?.code ?? job.status,
              message: job.error?.message ?? 'Generation canceled',
              elapsedMs: 0,
              costSoFarUsd: job.costSoFarUsd,
            });
          } else {
            hub.emit({
              type: 'progress',
              jobId: job.id,
              stage: job.stage,
              detail: job.detail,
              elapsedMs: job.startedAt ? Date.now() - Date.parse(job.startedAt) : 0,
              costSoFarUsd: job.costSoFarUsd,
            });
          }
        }
      }
    } catch (error) {
      console.warn(
        'Cloud publication will retry:',
        error instanceof Error ? error.message : 'unavailable',
      );
    } finally {
      publishing = false;
    }
  };
  reconcileGames(files, db);
  // A completed atomic rename can precede the final job-row write at shutdown.
  for (const job of db.listJobs())
    if (files.readMeta(job.gameId)?.status === 'ready' && files.readSpec(job.gameId))
      db.updateJob(job.id, { status: 'done', stage: 'done' });
  runner.recoverCloudJobs();
  const timer = setInterval(() => void maintain(), 15_000);
  timer.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
    db.close();
  });
  return { app, db, files, runner, hub, maintain };
}
