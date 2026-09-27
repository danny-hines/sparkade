import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { RetryableError } from 'workflow';
import { signGenerationToken } from '@sparkade/generation/service-auth';
import type { PassCheckpoint } from '@sparkade/server/pipeline/durable-pass';
import { createLocalPgClient, randomTestSchema } from './pg-sql';
import type { Sql } from '../lib/invites';

// Event kiosks: an attendee starts a game and walks away, so a failed first
// attempt must retry by itself, and provider hiccups must back off instead of
// spending every paid attempt at once.
const context = vi.hoisted(() => ({
  sql: null as unknown as Sql,
  blobs: new Map<string, unknown>(),
  failPass: null as null | { code: string; message: string },
}));
const workflowApi = vi.hoisted(() => ({ start: vi.fn(async () => ({})) }));
vi.mock('../lib/db', () => ({ getSql: () => context.sql }));
vi.mock('workflow/api', () => workflowApi);
vi.mock('../lib/public-games', () => ({
  reservePublicGame: async () => ({ id: 'public-game', url: 'https://example.test/p/public-game' }),
}));
vi.mock('../lib/generation/storage', () => ({
  writePrivate: async (path: string, value: unknown) => {
    context.blobs.set(path, structuredClone(value));
    return path;
  },
  readPrivate: async (path: string) => {
    if (!context.blobs.has(path)) throw new Error('Missing test blob');
    return structuredClone(context.blobs.get(path));
  },
  readOptionalPrivate: async (path: string) => structuredClone(context.blobs.get(path) ?? null),
  cleanPrivate: async () => {},
}));
vi.mock('@sparkade/server/pipeline/durable-pass', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sparkade/server/pipeline/durable-pass')>();
  return {
    ...actual,
    // A pass that ends the job the way the runner does on a gate failure.
    advancePipeline: vi.fn(async (checkpoint: PassCheckpoint) => {
      const failure = context.failPass;
      if (!failure) throw new Error('No scripted pass');
      const state = structuredClone(checkpoint.state);
      state.job!.status = 'failed';
      state.job!.stage = 'failed';
      state.job!.error = { ...failure, stage: 'building-assets' };
      state.game!.status = 'failed';
      state.game!.failure = failure;
      state.events.push({
        id: state.events.length + 1,
        jobId: state.job!.id,
        gameId: state.job!.gameId,
        attempt: state.job!.attempt,
        kind: 'failure',
        stage: 'building-assets',
        message: failure.message,
        at: new Date().toISOString(),
      });
      return { state, files: checkpoint.files, history: checkpoint.history, pending: [], timings: {} };
    }),
  };
});

import { ensureGenerationSchema, getJob } from '../lib/generation/store';
import { advanceGeneration, failGeneration, runProviderRequest } from '../lib/generation/steps';
import { POST } from '../app/api/generation/v1/[...path]/route';
import {
  assignKioskMetaCredential,
  ensureKioskBillingSchema,
  listKioskMetaCredentials,
  saveKioskMetaCredential,
} from '../lib/kiosk-meta-credentials';

const url = process.env.SPARKADE_PGTEST_URL ?? '';
const enabled =
  process.env.SPARKADE_PGTEST_ALLOW_WRITE === '1' &&
  Boolean(url) &&
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
const schema = randomTestSchema('generation_retry_test');
const secret = 'test-only-generation-secret-with-32-characters';
const principal = {
  owner: 'kiosk:kiosk-a',
  kioskId: 'kiosk-a',
  name: 'Test',
  defaultFeedVisibility: 'unlisted' as const,
};
const token = () => `Bearer ${signGenerationToken(principal, 'generation', secret)}`;
let pool: Pool;
beforeAll(async () => {
  if (!enabled) return;
  pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public` });
  await pool.query(`CREATE SCHEMA ${schema}`);
  context.sql = createLocalPgClient(pool) as Sql;
  await ensureKioskBillingSchema();
  await ensureGenerationSchema();
  const publicGames = await vi.importActual<typeof import('../lib/public-games')>('../lib/public-games');
  await publicGames.ensurePublicGamesSchema();
});
beforeEach(async () => {
  if (!enabled) return;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('SPARKADE_GENERATION_BACKEND', 'vercel');
  vi.stubEnv('SPARKADE_KIOSK_META_SECRET', 'c1'.repeat(32));
  vi.stubEnv('SPARKADE_GENERATION_SECRET', secret);
  vi.stubEnv('META_API_KEY', 'shared-test-key');
  vi.stubEnv('SPARKADE_PROVIDER', undefined);
  context.blobs.clear();
  context.failPass = null;
  workflowApi.start.mockClear();
  await pool.query(
    'TRUNCATE kiosks,kiosk_meta_credentials,kiosk_billing_events,kiosk_meta_limits,kiosk_meta_spend,generation_jobs,generation_requests,generation_usage,generation_slots,generation_passes,public_games CASCADE',
  );
  await context.sql`INSERT INTO kiosks(id,owner_user_id,name) VALUES ('kiosk-a','admin-a','A')`;
  await saveKioskMetaCredential({
    actorUserId: 'admin-a',
    label: 'Event',
    apiKey: 'test-only-meta-event-key-aaaa',
  });
  const [credential] = await listKioskMetaCredentials('admin-a');
  await assignKioskMetaCredential('admin-a', 'kiosk-a', credential!.id);
});
afterAll(async () => {
  if (pool) {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const route = (path: string[], body: unknown) =>
  POST(
    new NextRequest(`https://example.test/api/generation/v1/${path.join('/')}`, {
      method: 'POST',
      headers: { authorization: token(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ path }) },
  );
async function createJob(idempotencyKey: string): Promise<string> {
  const response = await route(['jobs'], {
    promptText: 'A moon garden game',
    sourceKind: 'typed',
    requestedArchetype: 'racing',
    idempotencyKey,
  });
  expect(response.status).toBe(202);
  return ((await response.json()) as { job: { id: string } }).job.id;
}

describe.skipIf(!enabled)('kiosk generation retries with isolated PostgreSQL', () => {
  it('turns a failed first attempt into a queued retry that the kiosk sync dispatches', async () => {
    const jobId = await createJob('auto-retry');
    await context.sql`INSERT INTO public_games(id,source_id,status,stage,message)
      VALUES('public-game',${`preview:${jobId}`},'generating','building-assets','Painting the game art…')`;
    const phone = async () =>
      (await context.sql`SELECT status, message FROM public_games WHERE id='public-game'`)[0];
    context.failPass = { code: 'image-invalid', message: 'Player vehicle review rejected the strip' };
    expect(await advanceGeneration(jobId, 1, 0)).toMatchObject({ stopped: true, done: false });
    const retried = (await getJob(jobId))!;
    // The failure is never committed, so kiosks and phones never see it.
    expect(retried).toMatchObject({ status: 'queued', attempt: 2, run_id: null });
    expect(retried.state.job).toMatchObject({
      attempt: 2,
      status: 'queued',
      stage: 'queued',
      detail: 'Muse is taking another pass…',
    });
    expect(retried.state.job!.error).toBeUndefined();
    expect(retried.state.game!.failure).toBeNull();
    expect(retried.state.events.slice(-2)).toMatchObject([
      { kind: 'failure', attempt: 1 },
      {
        id: retried.state.events.length,
        kind: 'progress',
        attempt: 2,
        payload: { autoRetry: true, code: 'image-invalid' },
      },
    ]);
    // The phone page keeps showing progress through the automatic pass.
    expect(await phone()).toMatchObject({ status: 'generating', message: 'Painting the game art…' });
    workflowApi.start.mockClear();
    const sync = await route(['sync'], { cursor: 0, watching: { [jobId]: 0 } });
    expect(sync.status).toBe(200);
    expect(workflowApi.start).toHaveBeenCalledOnce();
    expect((workflowApi.start.mock.calls[0] as unknown[])[1]).toEqual([jobId, 2]);

    // The automatic pass is used once; a second failure waits for manual Retry.
    expect(await advanceGeneration(jobId, 2, 0)).toMatchObject({ stopped: true });
    expect(await getJob(jobId)).toMatchObject({ status: 'failed', attempt: 2 });
    // The phone never shows the provider's raw rejection text.
    expect(await phone()).toMatchObject({
      status: 'failed',
      message: 'Some generated artwork didn’t pass the checks needed to work in the game.',
    });
  });

  it('never retries failures a repeat attempt cannot fix', async () => {
    const jobId = await createJob('auth-failure');
    context.failPass = { code: 'auth', message: 'provider rejected the API key' };
    await advanceGeneration(jobId, 1, 0);
    expect(await getJob(jobId)).toMatchObject({ status: 'failed', attempt: 1 });
  });

  it('retries a workflow step failure once, then fails', async () => {
    const jobId = await createJob('step-failure');
    await failGeneration(jobId, 1, 'Generation made no progress');
    const retried = (await getJob(jobId))!;
    expect(retried).toMatchObject({ status: 'queued', attempt: 2, run_id: null });
    expect(retried.state.events.at(-1)).toMatchObject({
      payload: { autoRetry: true, code: 'cloud-step', message: 'Generation made no progress' },
    });
    await failGeneration(jobId, 2, 'Generation made no progress');
    expect(await getJob(jobId)).toMatchObject({
      status: 'failed',
      attempt: 2,
      state: { job: { error: { code: 'cloud-step' } } },
    });
  });

  it('backs off transient provider errors, honoring Retry-After, within four paid attempts', async () => {
    const jobId = await createJob('transient');
    context.blobs.set('busy-image', {
      id: 'busy-image',
      kind: 'image',
      request: { prompt: 'Test', role: 'keyArt' },
    });
    await context.sql`INSERT INTO generation_requests(job_id,request_id,request_url) VALUES(${jobId},'1:busy-image','busy-image')`;
    const responses = [
      new Response('busy', { status: 503 }),
      new Response('busy', { status: 503 }),
      new Response('slow down', { status: 429, headers: { 'retry-after': '120' } }),
      new Response('busy', { status: 503 }),
    ];
    const fetch = vi.fn(async () => responses.shift()!);
    vi.stubGlobal('fetch', fetch);
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      const error = await runProviderRequest(jobId, 1, 'busy-image').then(
        () => null,
        (e: unknown) => e,
      );
      expect(RetryableError.is(error)).toBe(true);
      delays.push(Math.round(((error as RetryableError).retryAfter.getTime() - Date.now()) / 1000));
    }
    expect(delays.map((d) => Math.round(d / 5) * 5)).toEqual([5, 20, 120, 60]);
    // The fifth attempt stops calling the provider and records the failure.
    await runProviderRequest(jobId, 1, 'busy-image');
    expect(fetch).toHaveBeenCalledTimes(4);
    const [saved] =
      await context.sql`SELECT provider_attempts, result_url FROM generation_requests WHERE job_id=${jobId}`;
    expect(saved).toMatchObject({ provider_attempts: 5 });
    expect(context.blobs.get(String(saved!.result_url))).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('four attempts'),
    });
  });
});
