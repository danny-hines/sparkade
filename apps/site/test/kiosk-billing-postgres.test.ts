import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signGenerationToken } from '@sparkade/generation/service-auth';
import { metaApiKeyFor } from '@sparkade/server/providers/base';
import { MetaImageAdapter } from '@sparkade/server/providers/meta-image';
import { MetaProvider } from '@sparkade/server/providers/meta';
import { createLocalPgClient, randomTestSchema } from './pg-sql';
import type { Sql } from '../lib/invites';

const context = vi.hoisted(() => ({
  sql: null as unknown as Sql,
  blobs: new Map<string, unknown>(),
}));
vi.mock('../lib/db', () => ({ getSql: () => context.sql }));
vi.mock('workflow/api', () => ({ start: vi.fn(async () => ({})) }));
vi.mock('@sparkade/server/providers/audio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sparkade/server/providers/audio')>()),
  transcodeToWav: async (audio: Buffer) => audio,
}));
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

import { ensureGenerationSchema, getJob } from '../lib/generation/store';
import { runProviderRequest } from '../lib/generation/steps';
import { POST } from '../app/api/generation/v1/[...path]/route';
import {
  assignKioskMetaCredential,
  clearKioskMetaCredential,
  disableKioskMetaCredential,
  ensureKioskBillingSchema,
  kioskMetaCredentialId,
  listKioskMetaAssignments,
  listKioskMetaCredentials,
  saveKioskMetaCredential,
  withJobMetaCredential,
  withKioskMetaCredential,
} from '../lib/kiosk-meta-credentials';
import {
  assertMetaBudgetAvailable,
  metaSpendSummaries,
  setMetaKeyLimits,
  MetaBudgetError,
  MetaCapacityError,
} from '../lib/kiosk-meta-spend';

const url = process.env.SPARKADE_PGTEST_URL ?? '';
const enabled =
  process.env.SPARKADE_PGTEST_ALLOW_WRITE === '1' &&
  Boolean(url) &&
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
const schema = randomTestSchema('kiosk_billing_test');
const keyA = 'test-only-meta-event-key-aaaa';
const keyB = 'test-only-meta-event-key-bbbb';
const secret = 'test-only-generation-secret-with-32-characters';
const principal = (id = 'kiosk-a') => ({
  owner: `kiosk:${id}`,
  kioskId: id,
  name: 'Test',
  defaultFeedVisibility: 'unlisted' as const,
});
let pool: Pool;
beforeAll(async () => {
  if (!enabled) return;
  pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public` });
  await pool.query(`CREATE SCHEMA ${schema}`);
  context.sql = createLocalPgClient(pool) as Sql;
  await ensureKioskBillingSchema();
  await ensureGenerationSchema();
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
  await pool.query(
    'TRUNCATE kiosks,kiosk_meta_credentials,kiosk_billing_events,kiosk_meta_limits,kiosk_meta_spend,generation_jobs,generation_requests,generation_usage,generation_slots CASCADE',
  );
  await context.sql`INSERT INTO kiosks(id,owner_user_id,name) VALUES
    ('kiosk-a','admin-a','A'),('kiosk-b','admin-b','B'),('kiosk-a2','admin-a','A2')`;
});
afterAll(async () => {
  if (pool) {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function credential(owner = 'admin-a', apiKey = keyA, label = 'Event') {
  await saveKioskMetaCredential({ actorUserId: owner, label, apiKey });
  return (await listKioskMetaCredentials(owner)).find((c) => c.label === label)!.id;
}
async function createJob(idempotencyKey: string) {
  return POST(
    new NextRequest('https://example.test/api/generation/v1/jobs', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${signGenerationToken(principal(), 'generation', secret)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        promptText: 'A moon garden game',
        sourceKind: 'typed',
        requestedArchetype: 'shooter',
        idempotencyKey,
        // Credentials must always come from server assignment, never submitted fields.
        metaCredentialId: 'attacker-supplied',
        apiKey: 'attacker-supplied',
      }),
    }),
    { params: Promise.resolve({ path: ['jobs'] }) },
  );
}
const readKey = () => Promise.resolve(metaApiKeyFor('META_API_KEY', 'meta'));
const wav = () => {
  const bytes = Buffer.alloc(44 + 32000);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(32000, 40);
  return bytes;
};
const imageResponse = () =>
  Response.json({ data: [{ b64_json: Buffer.from('image').toString('base64') }] });
const paidImage = (id: string | null, kiosk = 'kiosk-a') =>
  withKioskMetaCredential(principal(kiosk), id, () =>
    new MetaImageAdapter().generate({ prompt: 'Test' }),
  );

describe.skipIf(!enabled)('kiosk billing with isolated PostgreSQL and mocked providers', () => {
  it('encrypts storage, shares named keys, filters owners, and records non-secret audit events', async () => {
    const id = await credential();
    await assignKioskMetaCredential('admin-a', 'kiosk-a', id);
    await assignKioskMetaCredential('admin-a', 'kiosk-a2', id);
    expect(await listKioskMetaCredentials('admin-a')).toEqual([
      { id, label: 'Event', suffix: 'aaaa', revoked: false, assignedKiosks: 2 },
    ]);
    expect(await listKioskMetaCredentials('admin-b')).toEqual([]);
    expect(await listKioskMetaAssignments('admin-b')).toEqual({});
    const stored = await context.sql`SELECT * FROM kiosk_meta_credentials`;
    expect(JSON.stringify(stored)).not.toContain(keyA);
    const audit = await context.sql`SELECT * FROM kiosk_billing_events ORDER BY created_at`;
    expect(audit.map((r) => r.action)).toEqual(['create', 'assign', 'assign']);
    expect(JSON.stringify(audit)).not.toContain(keyA);
  });

  it('rejects cross-owner mutation, revoked kiosks and mismatched principals', async () => {
    const id = await credential();
    await expect(assignKioskMetaCredential('admin-b', 'kiosk-b', id)).rejects.toThrow(
      'cannot manage',
    );
    await expect(assignKioskMetaCredential('admin-a', 'kiosk-b', id)).rejects.toThrow(
      'cannot manage',
    );
    await expect(
      saveKioskMetaCredential({
        actorUserId: 'admin-b',
        credentialId: id,
        label: 'Hijack',
        apiKey: keyB,
      }),
    ).rejects.toThrow('cannot manage');
    await expect(disableKioskMetaCredential('admin-b', id)).rejects.toThrow('cannot manage');
    await assignKioskMetaCredential('admin-a', 'kiosk-a', id);
    await expect(clearKioskMetaCredential('admin-b', 'kiosk-a')).rejects.toThrow('cannot manage');
    await expect(kioskMetaCredentialId({ ...principal(), owner: 'kiosk:kiosk-b' })).rejects.toThrow(
      'identity',
    );
    await context.sql`UPDATE kiosks SET revoked_at=now() WHERE id='kiosk-a'`;
    await expect(kioskMetaCredentialId(principal())).rejects.toThrow('no longer authorized');
    await expect(assignKioskMetaCredential('admin-a', 'kiosk-a', id)).rejects.toThrow(
      'unavailable',
    );
  });

  it('keeps concurrent jobs on their pinned key through reassignment, rotation, and disable', async () => {
    const id = await credential();
    await assignKioskMetaCredential('admin-a', 'kiosk-a', id);
    const response = await createJob('first');
    expect(response.status).toBe(202);
    const payload = await response.json();
    const row = (await getJob(payload.job.id))!;
    expect(row).toMatchObject({ meta_credential_id: id, meta_credential_bound: true });
    expect(JSON.stringify(row)).not.toContain(keyA);
    expect(JSON.stringify(payload)).not.toContain('meta_credential');
    await clearKioskMetaCredential('admin-a', 'kiosk-a');
    const sharedPayload = await (await createJob('second')).json();
    const shared = (await getJob(sharedPayload.job.id))!;
    expect(
      await Promise.all([
        withJobMetaCredential(row, readKey),
        withJobMetaCredential(shared, readKey),
      ]),
    ).toEqual([keyA, 'shared-test-key']);
    await saveKioskMetaCredential({
      actorUserId: 'admin-a',
      credentialId: id,
      label: 'Rotated event',
      apiKey: keyB,
    });
    expect(await withJobMetaCredential(row, readKey)).toBe(keyB);
    await disableKioskMetaCredential('admin-a', id);
    const provider = vi.fn(readKey);
    await expect(withJobMetaCredential(row, provider)).rejects.toThrow('disabled');
    expect(provider).not.toHaveBeenCalled();
    expect(await withJobMetaCredential(shared, readKey)).toBe('shared-test-key');
  });

  it('binds older jobs once under concurrent steps and fails closed on unreadable/disabled keys', async () => {
    const response = await createJob('old');
    const payload = await response.json();
    await context.sql`UPDATE generation_jobs SET meta_credential_bound=FALSE WHERE id=${payload.job.id}`;
    const row = (await getJob(payload.job.id))!;
    const id = await credential();
    await assignKioskMetaCredential('admin-a', 'kiosk-a', id);
    expect(
      await Promise.all(Array.from({ length: 6 }, () => withJobMetaCredential(row, readKey))),
    ).toEqual(Array(6).fill(keyA));
    await clearKioskMetaCredential('admin-a', 'kiosk-a');
    expect(await withJobMetaCredential(row, readKey)).toBe(keyA);
    vi.stubEnv('SPARKADE_KIOSK_META_SECRET', 'd1'.repeat(32));
    await expect(withJobMetaCredential(row, readKey)).rejects.toThrow('cannot be opened');
    vi.stubEnv('SPARKADE_KIOSK_META_SECRET', 'c1'.repeat(32));
    await assignKioskMetaCredential('admin-a', 'kiosk-a', id);
    await disableKioskMetaCredential('admin-a', id);
    expect((await createJob('blocked')).status).toBe(503);
    expect(await context.sql`SELECT id FROM generation_jobs`).toHaveLength(1);
  });

  it('routes actual durable provider steps and transcription through the assigned credential', async () => {
    const id = await credential();
    await assignKioskMetaCredential('admin-a', 'kiosk-a', id);
    const payload = await (await createJob('steps')).json();
    const jobId = payload.job.id;
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push(new Headers(init.headers).get('authorization')!);
        if (String(url).includes('/transcribe'))
          return Response.json({ transcript: 'A space garden', audioDurationMs: 1000 });
        if (String(url).includes('/images/'))
          return Response.json({ data: [{ b64_json: Buffer.from('image').toString('base64') }] });
        return Response.json({ choices: [{ message: { content: '{}' } }], usage: {} });
      }),
    );
    for (const task of [
      {
        id: 'text',
        kind: 'text',
        stage: 'design',
        model: 'muse-spark-1.2-contributor',
        request: { system: 'Test', user: 'Test', maxTokens: 100 },
      },
      {
        id: 'image',
        kind: 'image',
        request: { prompt: 'Test', role: 'keyArt', size: '1024x1024' },
      },
    ]) {
      context.blobs.set(task.id, task);
      await context.sql`INSERT INTO generation_requests(job_id,request_id,request_url) VALUES(${jobId},${`1:${task.id}`},${task.id})`;
    }
    await Promise.all(['text', 'image'].map((id) => runProviderRequest(jobId, 1, id)));
    const form = new FormData();
    form.set('audio', new File([new Uint8Array(wav())], 'audio.wav', { type: 'audio/wav' }));
    const voice = await POST(
      new NextRequest('https://example.test/api/generation/v1/transcribe', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${signGenerationToken(principal(), 'generation', secret)}`,
        },
        body: form,
      }),
      { params: Promise.resolve({ path: ['transcribe'] }) },
    );
    expect(await voice.json()).toEqual({ text: 'A space garden' });
    expect(requests).toEqual(Array(3).fill(`Bearer ${keyA}`));
    const tracked = (await metaSpendSummaries([id]))[id]!.periods.lifetime;
    expect(tracked.spent).toBe(0.01005); // one image + one second of voice
    expect(tracked.reserved).toBeGreaterThan(0); // missing text usage stays uncertain
    expect(JSON.stringify([...context.blobs.values()])).not.toContain(keyA);
    expect(await context.sql`SELECT * FROM generation_slots`).toEqual([]);
    expect(await context.sql`SELECT * FROM generation_usage`).toHaveLength(2);

    await disableKioskMetaCredential('admin-a', id);
    context.blobs.set('blocked', context.blobs.get('text'));
    await context.sql`INSERT INTO generation_requests(job_id,request_id,request_url)
      VALUES(${jobId},'1:blocked','blocked')`;
    await runProviderRequest(jobId, 1, 'blocked');
    const blocked = await context.sql`SELECT result_url FROM generation_requests
      WHERE job_id=${jobId} AND request_id='1:blocked'`;
    expect(context.blobs.get(String(blocked[0]!.result_url))).toMatchObject({
      kind: 'error',
      status: 401,
      message: expect.stringContaining('disabled'),
    });
    expect(requests).toHaveLength(3);
    expect(await context.sql`SELECT * FROM generation_slots`).toEqual([]);
  });

  it('isolates preview assignments and refuses an unsupported generation backend', async () => {
    const id = await credential();
    await assignKioskMetaCredential('admin-a', 'kiosk-a', id);
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(await listKioskMetaCredentials('admin-a')).toEqual([]);
    expect(await kioskMetaCredentialId(principal())).toBeNull();
    await expect(withKioskMetaCredential(principal(), id, readKey)).rejects.toThrow('unavailable');
    await expect(assignKioskMetaCredential('admin-a', 'kiosk-a', id)).rejects.toThrow(
      'unavailable',
    );
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('SPARKADE_GENERATION_BACKEND', 'legacy');
    await expect(assignKioskMetaCredential('admin-a', 'kiosk-a', id)).rejects.toThrow('Vercel');
  });

  it('atomically shares daily budgets across kiosks and keeps other keys independent', async () => {
    const id = await credential();
    await setMetaKeyLimits('admin-a', id, { dailyUsd: '0.02', weeklyUsd: '1', concurrency: '' });
    const fetch = vi.fn(async () => imageResponse());
    vi.stubGlobal('fetch', fetch);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, (_, n) => paidImage(id, n % 2 ? 'kiosk-a' : 'kiosk-a2')),
    );
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(
      outcomes
        .filter((r) => r.status === 'rejected')
        .every((r) => r.status === 'rejected' && r.reason instanceof MetaBudgetError),
    ).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await metaSpendSummaries([id]))[id]!.periods.daily).toEqual({
      spent: 0.02,
      reserved: 0,
    });
    await paidImage(null);
    expect((await metaSpendSummaries(['shared'])).shared!.periods.daily.spent).toBe(0.01);
    await expect(
      setMetaKeyLimits('admin-b', id, { dailyUsd: '999', weeklyUsd: '', concurrency: '' }),
    ).rejects.toThrow('cannot manage');
  });

  it('queues per-key concurrency without leaking capacity on success or failure', async () => {
    const id = await credential();
    await setMetaKeyLimits('admin-a', id, { dailyUsd: '', weeklyUsd: '', concurrency: '1' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn(async () => {
      await gate;
      return imageResponse();
    });
    vi.stubGlobal('fetch', fetch);
    const first = paidImage(id);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await expect(paidImage(id, 'kiosk-a2')).rejects.toBeInstanceOf(MetaCapacityError);
    release();
    await first;
    expect((await metaSpendSummaries([id]))[id]!.activeRequests).toBe(0);
    fetch.mockImplementationOnce(async () => new Response('temporary failure', { status: 500 }));
    await expect(paidImage(id)).rejects.toThrow('500');
    const afterFailure = (await metaSpendSummaries([id]))[id]!;
    expect(afterFailure.activeRequests).toBe(0);
    expect(afterFailure.periods.daily).toEqual({ spent: 0.01, reserved: 0.01 });
    await paidImage(id);
    expect((await metaSpendSummaries([id]))[id]!.periods.daily).toEqual({
      spent: 0.02,
      reserved: 0.01,
    });
  });

  it('preserves spend and limits when a key is replaced or disabled', async () => {
    const id = await credential();
    await setMetaKeyLimits('admin-a', id, { dailyUsd: '2', weeklyUsd: '5', concurrency: '3' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imageResponse()),
    );
    await paidImage(id);
    await saveKioskMetaCredential({
      actorUserId: 'admin-a',
      credentialId: id,
      label: 'Replacement',
      apiKey: keyB,
    });
    await paidImage(id);
    await disableKioskMetaCredential('admin-a', id);
    const total = (await metaSpendSummaries([id]))[id]!;
    expect(total.limits).toEqual({ dailyUsd: 2, weeklyUsd: 5, concurrency: 3 });
    expect(total.periods.lifetime).toEqual({ spent: 0.02, reserved: 0 });
    expect(total.trackedSince).not.toBeNull();
  });

  it('rejects new jobs at zero budget and resumes waiting provider steps after limits rise', async () => {
    const id = await credential();
    await assignKioskMetaCredential('admin-a', 'kiosk-a', id);
    const payload = await (await createJob('waiting')).json(),
      jobId = payload.job.id;
    context.blobs.set('limited-image', {
      id: 'limited-image',
      kind: 'image',
      request: { prompt: 'Test', role: 'keyArt' },
    });
    await context.sql`INSERT INTO generation_requests(job_id,request_id,request_url) VALUES(${jobId},'1:limited-image','limited-image')`;
    await setMetaKeyLimits('admin-a', id, { dailyUsd: '0', weeklyUsd: '', concurrency: '' });
    const fetch = vi.fn(async () => imageResponse());
    vi.stubGlobal('fetch', fetch);
    expect((await createJob('blocked-budget')).status).toBe(429);
    await expect(runProviderRequest(jobId, 1, 'limited-image')).rejects.toThrow('budget');
    expect((await getJob(jobId))!.status).toBe('waiting-network');
    expect(
      (
        await context.sql`SELECT provider_attempts FROM generation_requests WHERE job_id=${jobId}`
      )[0]!.provider_attempts,
    ).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    await setMetaKeyLimits('admin-a', id, { dailyUsd: '1', weeklyUsd: '', concurrency: '' });
    await runProviderRequest(jobId, 1, 'limited-image');
    expect((await getJob(jobId))!.status).toBe('running');
    expect(fetch).toHaveBeenCalledOnce();
    // A replay with a stored result must not book another API charge.
    await runProviderRequest(jobId, 1, 'limited-image');
    expect((await metaSpendSummaries([id]))[id]!.periods.lifetime.spent).toBe(0.01);
  });

  it('uses Pacific calendar periods, preserves lifetime history, and separates scopes', async () => {
    const id = await credential();
    const [bounds] = await pool
      .query(
        `SELECT
      date_trunc('day',now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles' AS day,
      date_trunc('week',now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles' AS week,
      date_trunc('month',now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles' AS month`,
      )
      .then((r) => r.rows);
    for (const [label, charge, at] of [
      ['today', 1, new Date()],
      ['yesterday', 2, new Date(+bounds.day - 3600000)],
      ['last-week', 4, new Date(+bounds.week - 3600000)],
      ['last-month', 8, new Date(+bounds.month - 3600000)],
    ] as const) {
      await context.sql`INSERT INTO kiosk_meta_spend(id,scope,key_id,owner,model,operation,reserved,charged,created_at)
        VALUES(${label},'preview',${id},'kiosk:kiosk-a','test','text',${charge},${charge},${at.toISOString()})`;
    }
    await context.sql`INSERT INTO kiosk_meta_spend(id,scope,key_id,owner,model,operation,reserved)
      VALUES('pending','preview',${id},'kiosk:kiosk-a','test','text',0.5),
      ('other-environment','production',${id},'kiosk:kiosk-a','test','text',999),
      ('other-key','preview','shared','kiosk:kiosk-a','test','text',999)`;
    const total = (await metaSpendSummaries([id]))[id]!;
    expect(total.periods.daily).toEqual({ spent: 1, reserved: 0.5 });
    expect(total.periods.weekly.spent).toBe(1 + (+bounds.day > +bounds.week ? 2 : 0));
    expect(total.periods.monthly.spent).toBe(
      1 + (+bounds.day > +bounds.month ? 2 : 0) + (+bounds.week > +bounds.month ? 4 : 0),
    );
    expect(total.periods.lifetime).toEqual({ spent: 15, reserved: 0.5 });
    const weekReset = new Date(total.nextWeeklyReset);
    expect(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long' }).format(
        weekReset,
      ),
    ).toBe('Monday');
    expect(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(weekReset),
    ).toBe('00:00');
  });

  it('automatically makes a weekly allowance available after its old charges leave the period', async () => {
    const id = await credential();
    await setMetaKeyLimits('admin-a', id, { dailyUsd: '', weeklyUsd: '0.01', concurrency: '' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imageResponse()),
    );
    await paidImage(id);
    await expect(assertMetaBudgetAvailable(id)).rejects.toThrow('weekly');
    await context.sql`UPDATE kiosk_meta_spend SET created_at=(date_trunc('week',now() AT TIME ZONE 'America/Los_Angeles')-interval '1 second') AT TIME ZONE 'America/Los_Angeles' WHERE key_id=${id}`;
    await assertMetaBudgetAvailable(id);
    await paidImage(id);
    const total = (await metaSpendSummaries([id]))[id]!;
    expect(total.periods.weekly.spent).toBe(0.01);
    expect(total.periods.lifetime.spent).toBe(0.02);
  });
  it('records a failed voice attempt and successful chat fallback against the same key', async () => {
    const id = await credential();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { content: 'A garden' } }],
          usage: { prompt_tokens: 1000, completion_tokens: 100 },
        }),
      );
    vi.stubGlobal('fetch', fetch);
    const result = await withKioskMetaCredential(principal(), id, () =>
      new MetaProvider('meta', { kind: 'meta' }).transcribe(wav(), 'audio/wav', {
        model: 'muse-voice-transcribe-1.0',
      }),
    );
    expect(result.text).toBe('A garden');
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls)
      expect(new Headers(init!.headers).get('authorization')).toBe(`Bearer ${keyA}`);
    const totals = (await metaSpendSummaries([id]))[id]!;
    expect(totals.periods.lifetime.spent).toBeCloseTo(0.00012, 6);
    expect(totals.periods.lifetime.reserved).toBeCloseTo(0.00005, 6);
    expect(totals.activeRequests).toBe(0);
  });
  it('records unexpectedly high charges, pauses the key, and requires an explicit limits save to resume', async () => {
    const id = await credential();
    const data = { b64_json: Buffer.from('image').toString('base64') };
    const fetch = vi.fn(async () => Response.json({ data: [data, data] }));
    vi.stubGlobal('fetch', fetch);
    await expect(paidImage(id)).rejects.toThrow('exceeded');
    const totals = (await metaSpendSummaries([id]))[id]!;
    expect(totals.periods.lifetime.spent).toBe(0.02);
    expect(totals.activeRequests).toBe(0);
    expect(totals.paused).toBe(true);
    await expect(paidImage(id)).rejects.toThrow('paused');
    expect(fetch).toHaveBeenCalledOnce();
    await setMetaKeyLimits('admin-a', id, { dailyUsd: '1', weeklyUsd: '5', concurrency: '' });
    fetch.mockImplementationOnce(async () => imageResponse());
    await paidImage(id);
    expect((await metaSpendSummaries([id]))[id]!.periods.lifetime.spent).toBe(0.03);
  });
});
