import { NextRequest, NextResponse } from 'next/server';
import { start } from 'workflow/api';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyGenerationToken, type GenerationPrincipal } from '@sparkade/generation/service-auth';
import { ARCHETYPE_IDS, type ArchetypeId, type CloudGameBundle } from '@sparkade/shared';
import { GenerationRunner } from '@sparkade/server/pipeline/runner';
import { JobState } from '@sparkade/server/pipeline/job-state';
import { collectFiles, type PassCheckpoint } from '@sparkade/server/pipeline/durable-pass';
import { validateCloudInput } from '@sparkade/server/pipeline/cloud-input';
import { generationEstimate } from '@sparkade/server/pipeline/generation-estimate';
import { GameFiles } from '@sparkade/server/storage/files';
import { defaultConfig } from '@sparkade/server/storage/config';
import { SseHub } from '@sparkade/server/pipeline/sse';
import { stageProvider } from '@sparkade/server/providers/index';
import { transcodeToWav } from '@sparkade/server/providers/audio';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { getSql } from '@/lib/db';
import { readCheckpointFile } from '@/lib/generation/checkpoints';
import { reservePublicGame } from '@/lib/public-games';
import {
  scope,
  prefix,
  ensureGenerationSchema,
  getJob,
  snapshot,
  acquireSlot,
  releaseSlot,
  syncPublicProgress,
  type GenerationRow,
} from '@/lib/generation/store';
import { readPrivate, writePrivate } from '@/lib/generation/storage';
import { generationLimits } from '@/lib/generation/limits';
import { generateGameWorkflow } from '@/workflows/generate-game';

export const runtime = 'nodejs';
export const maxDuration = 300;
const error = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status });
const active = ['queued', 'running', 'waiting-network', 'publishing'];

type Context = { params: Promise<{ path: string[] }> };
export async function POST(request: NextRequest, context: Context) {
  return handle(request, context);
}
export async function GET(request: NextRequest, context: Context) {
  return handle(request, context);
}
async function handle(request: NextRequest, context: Context): Promise<Response> {
  if (process.env.SPARKADE_GENERATION_BACKEND !== 'vercel')
    return error('Cloud generation is not configured', 503);
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const principal = verifyGenerationToken(
    token,
    'generation',
    process.env.SPARKADE_GENERATION_SECRET ?? '',
  );
  if (!principal) return error('Session expired', 401);
  const { path } = await context.params;
  const method = request.method;
  try {
    if (path.join('/') === 'jobs' && method === 'POST') return await createJob(request, principal);
    if (path.join('/') === 'sync' && method === 'POST') {
      const body = await request.json();
      const cursor = body.cursor ?? 0,
        watching = body.watching ?? {};
      if (
        !Number.isSafeInteger(cursor) ||
        cursor < 0 ||
        typeof watching !== 'object' ||
        !watching ||
        Array.isArray(watching) ||
        Object.keys(watching).length > 1000 ||
        Object.values(watching).some((n) => !Number.isSafeInteger(n) || Number(n) < 0)
      )
        return error('Invalid sync cursor', 400);
      await ensureGenerationSchema();
      const sql = getSql();
      const discovered =
        (await sql`SELECT * FROM generation_jobs WHERE scope=${scope()} AND owner=${principal.owner}
        AND seq>${cursor} ORDER BY seq LIMIT 50`) as GenerationRow[];
      const watched = Object.keys(watching).length
        ? ((await sql`SELECT * FROM generation_jobs WHERE scope=${scope()}
        AND owner=${principal.owner} AND id=ANY(${Object.keys(watching)}::text[])`) as GenerationRow[])
        : [];
      const rows = [...new Map([...discovered, ...watched].map((r) => [r.id, r])).values()];
      for (const row of rows) if (row.status === 'queued' && !row.run_id) await dispatch(row);
      return NextResponse.json({
        cursor: Number(discovered.at(-1)?.seq ?? cursor),
        jobs: await Promise.all(rows.map((r) => snapshot(r, Number(watching[r.id]) || 0))),
      });
    }
    if (path[0] === 'estimate' && method === 'GET') {
      const kind = request.nextUrl.searchParams.get('archetype');
      return NextResponse.json(
        generationEstimate(
          defaultConfig(),
          request.nextUrl.searchParams.get('photo') === '1',
          ARCHETYPE_IDS.includes(kind as ArchetypeId) ? (kind as ArchetypeId) : undefined,
          false,
        ),
      );
    }
    if (path[0] === 'transcribe' && method === 'POST') {
      const form = await request.formData(),
        audio = form.get('audio');
      if (!(audio instanceof File) || audio.size > 4 * 1024 * 1024)
        return error('Invalid recording', 400);
      const slot = await acquireSlot(principal.owner);
      if (!slot) return error('Transcription is busy; try again', 429);
      try {
        const { provider, model } = stageProvider(defaultConfig(), 'stt');
        const wav = await transcodeToWav(Buffer.from(await audio.arrayBuffer()), ffmpeg.path);
        const result = await provider.transcribe?.(
          wav,
          'audio/wav',
          { model },
        );
        return result?.text
          ? NextResponse.json({ text: result.text })
          : error('Could not hear anything', 422);
      } finally {
        await releaseSlot(slot);
      }
    }
    if (path[0] !== 'jobs' || !path[1]) return error('Not found', 404);
    const row = await getJob(path[1]);
    if (!row || row.owner !== principal.owner) return error('Not found', 404);
    if (path.length === 2 && method === 'GET') return NextResponse.json(await snapshot(row));
    if (path[2] === 'cancel' && method === 'POST') {
      if (active.includes(row.status)) {
        row.state.job!.status = 'canceled';
        row.state.job!.finishedAt = new Date().toISOString();
        row.state.game!.status = 'failed';
        await getSql()`UPDATE generation_jobs SET status='canceled',state=${JSON.stringify(row.state)}::jsonb,updated_at=now()
          WHERE id=${row.id} AND attempt=${row.attempt} AND status IN ('queued','running','waiting-network','publishing')`;
        await syncPublicProgress(row.id, row.attempt);
      }
      return NextResponse.json({ ok: true });
    }
    if (path[2] === 'retry' && method === 'POST') {
      const body = await request.json();
      if (body.attempt === row.attempt && ['failed', 'canceled'].includes(row.status)) {
        if (!row.checkpoint) return error('The retry window has expired. Create a new game.', 409);
        if (row.attempt >= 10) return error('Retry limit reached', 429);
        row.state.job!.attempt++;
        row.state.job!.status = 'queued';
        row.state.job!.stage = 'queued';
        row.state.job!.error = undefined;
        row.state.job!.finishedAt = undefined;
        row.state.job!.startedAt = undefined;
        row.state.game!.status = 'queued';
        row.state.game!.failure = null;
        const updated =
          await getSql()`UPDATE generation_jobs SET status='queued',attempt=attempt+1,run_id=NULL,
          state=${JSON.stringify(row.state)}::jsonb,updated_at=now() WHERE id=${row.id} AND attempt=${row.attempt}
          AND checkpoint<>'' AND status IN ('failed','canceled') RETURNING *`;
        if (updated[0]) await dispatch(updated[0] as GenerationRow);
      }
      return NextResponse.json(await snapshot((await getJob(row.id))!));
    }
    if (path[2] === 'bundle' && method === 'GET') {
      if (row.status !== 'done' || !row.bundle) return error('Game is not ready', 409);
      return NextResponse.json((await readPrivate<{ bundle: CloudGameBundle }>(row.bundle)).bundle);
    }
    if (path[2] === 'assets' && path[3] && method === 'GET') {
      if (row.status !== 'done' || !row.bundle) return error('Asset not ready', 404);
      const result = await readPrivate<{ bundle: CloudGameBundle; assets: Record<string, string> }>(
        row.bundle,
      );
      const asset = result.bundle.manifest.assets.find((a) => a.filename === path[3]);
      if (!asset || !result.assets[asset.filename]) return error('Unknown asset', 404);
      const response = await fetch(result.assets[asset.filename]);
      return new Response(response.body, {
        status: response.status,
        headers: { 'content-type': asset.mimeType, 'cache-control': 'private, max-age=3600' },
      });
    }
    if (path[2] === 'partial' && method === 'GET') {
      if (row.status === 'done') return NextResponse.json({ partial: null });
      const checkpoint = await readPrivate<PassCheckpoint>(row.checkpoint);
      const raw = await readCheckpointFile(checkpoint, `staging/${row.id}/partial.json`);
      return NextResponse.json({
        partial: raw ? JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) : null,
      });
    }
    return error('Not found', 404);
  } catch (e) {
    console.error('Generation API failed', e instanceof Error ? e.message : 'unknown');
    return error('Cloud generation is temporarily unavailable; try again', 503);
  }
}

async function dispatch(row: GenerationRow) {
  await start(generateGameWorkflow, [row.id, row.attempt]);
}
async function createJob(request: NextRequest, principal: GenerationPrincipal): Promise<Response> {
  let value: unknown, photo: Buffer | undefined;
  if (Number(request.headers.get('content-length')) > 4.25 * 1024 * 1024)
    return error('Photo too large', 413);
  if (request.headers.get('content-type')?.includes('multipart/form-data')) {
    const form = await request.formData();
    try {
      value = JSON.parse(String(form.get('input')));
    } catch {
      return error('Invalid inputs', 400);
    }
    const upload = form.get('photo');
    if (upload instanceof File) {
      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(upload.type) ||
        upload.size > 4 * 1024 * 1024
      )
        return error('Invalid photo', 400);
      photo = Buffer.from(await upload.arrayBuffer());
    }
  } else value = await request.json();
  let input;
  try {
    input = validateCloudInput(value);
  } catch {
    return error('Invalid creation inputs', 400);
  }
  await ensureGenerationSchema();
  const sql = getSql();
  const inputHash = createHash('sha256')
    .update(JSON.stringify(input))
    .update(photo ?? '')
    .digest('hex');
  const existing =
    await sql`SELECT * FROM generation_jobs WHERE scope=${scope()} AND owner=${principal.owner} AND idempotency_key=${input.idempotencyKey}`;
  if (existing[0]) {
    const row = existing[0] as GenerationRow;
    if (row.input_hash !== inputHash)
      return error('Idempotency key already used for different inputs', 409);
    if (row.status === 'queued' && !row.run_id) await dispatch(row);
    return NextResponse.json(await snapshot(row), { status: 202 });
  }
  const dir = mkdtempSync(join(tmpdir(), 'sparkade-new-'));
  const db = new JobState();
  db.state.config = defaultConfig();
  let files: Record<string, string>;
  try {
    const runner = new GenerationRunner(
      db,
      new GameFiles(dir),
      { get: defaultConfig },
      new SseHub(),
    );
    runner.createJob({ ...input, photo }, { defer: true });
    files = collectFiles(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const id = db.state.job!.id;
  const previous = await sql`SELECT state,bundle FROM generation_jobs WHERE scope=${scope()}
    AND owner=${principal.owner} AND status='done' AND bundle IS NOT NULL ORDER BY seq DESC LIMIT 10`;
  const history: NonNullable<PassCheckpoint['history']> = [];
  for (const item of previous) {
    const saved = await readPrivate<{ bundle: CloudGameBundle }>(String(item.bundle));
    history.push({ game: item.state.game, spec: saved.bundle.spec });
  }
  const checkpoint = await writePrivate(`${prefix(id)}checkpoints/initial.json`, {
    state: db.state,
    files,
    history,
  });
  const inserted = await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtext(${`sparkade-admission-${scope()}`}))`,
    sql`INSERT INTO generation_jobs(id,scope,owner,idempotency_key,input_hash,principal,state,checkpoint)
      SELECT ${id},${scope()},${principal.owner},${input.idempotencyKey},${inputHash},${JSON.stringify(principal)}::jsonb,${JSON.stringify(db.state)}::jsonb,${checkpoint}
      WHERE (SELECT count(*) FROM generation_jobs WHERE scope=${scope()} AND status IN ('queued','running','waiting-network','publishing'))<${generationLimits().pendingJobs}
      AND (SELECT count(*) FROM generation_jobs WHERE scope=${scope()} AND owner=${principal.owner} AND status IN ('queued','running','waiting-network','publishing'))<50
      ON CONFLICT DO NOTHING RETURNING *`,
  ]);
  let row = inserted[1]?.[0] as GenerationRow | undefined;
  if (!row) {
    const duplicate =
      await sql`SELECT * FROM generation_jobs WHERE scope=${scope()} AND owner=${principal.owner} AND idempotency_key=${input.idempotencyKey}`;
    row = duplicate[0] as GenerationRow | undefined;
    if (!row) return error('Generation queue is full; try again later', 429);
    if (row.input_hash !== inputHash)
      return error('Idempotency key already used for different inputs', 409);
  }
  const publicGame = await reservePublicGame(`${scope()}:${row.id}`, {
    id: principal.kioskId,
    name: principal.name,
    defaultFeedVisibility: scope() === 'preview' ? 'unlisted' : principal.defaultFeedVisibility,
  });
  await sql`UPDATE generation_jobs SET public_id=${publicGame.id} WHERE id=${row.id}`;
  row.public_id = publicGame.id;
  await dispatch(row);
  return NextResponse.json(await snapshot(row), { status: 202 });
}
