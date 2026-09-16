import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { Pool } from 'pg';
import sharp from 'sharp';
import type { Sql } from '../lib/invites';
import { createLocalPgClient, randomTestSchema } from './pg-sql';
const context = vi.hoisted(() => ({
  sql: null as unknown as Sql,
  blobs: new Map<string, unknown>(),
}));
vi.mock('../lib/db', () => ({ getSql: () => context.sql }));
vi.mock('../lib/generation/storage', () => ({
  writePrivate: async (path: string, value: unknown) => {
    context.blobs.set(path, structuredClone(value));
    return path;
  },
  readPrivate: async (path: string) => structuredClone(context.blobs.get(path)),
  readOptionalPrivate: async (path: string) => structuredClone(context.blobs.get(path) ?? null),
}));
import {
  ensureArcadeSchema,
  ActiveGameError,
  getActiveWebsiteGames,
  ensureProfile,
  settings,
  browseGames,
  manageGame,
  setFavorite,
} from '../lib/arcade';
import {
  createWebsiteGame,
  resumeAdminWebsiteGame,
  assertWebsiteRunnable,
  releaseWebsiteCredits,
  reviewWebsiteGame,
  retryWebsiteGame,
  cancelWebsiteGame,
  stageWebsiteResult,
  readWebsiteFinal,
} from '../lib/website-generation';
import { reviewWebsiteInput, reviewContent } from '../lib/website-content-review';
import { stageProvider } from '@sparkade/server/providers/index';
import { defaultConfig } from '@sparkade/server/storage/config';
import { CONTENT_POLICY } from '../lib/content-policy';
import { websiteProgress, websiteAssetPreview } from '../lib/website-progress';
import { gameNotifications, updateGameNotifications } from '../lib/notifications';
import { getJob } from '../lib/generation/store';
import { websiteSpendPolicy } from '../lib/website-spend';
import {
  getPublicGame,
  updatePublicGame,
  reservePublicGame,
  listManagedPublicGames,
} from '../lib/public-games';
vi.mock('workflow/api', () => ({ getRun: () => ({ status: Promise.resolve('failed') }) }));
import { reconcileWebsiteJob } from '../lib/website-recovery';
import { startPlay, finishPlay } from '../lib/plays';
import type { CloudGameBundle } from '@sparkade/shared';
import { changeUsername, findPublicProfile } from '../lib/profiles';
import { buildDesignPrompt } from '@sparkade/server/pipeline/prompts';
import { readWebsitePhoto } from '../lib/website-photo';
import type { AdminIdentity } from '../lib/admin-auth';
import type { PassCheckpoint } from '@sparkade/server/pipeline/durable-pass';

const url = process.env.SPARKADE_PGTEST_URL ?? '';
const enabled =
  process.env.SPARKADE_PGTEST_ALLOW_WRITE === '1' &&
  Boolean(url) &&
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
const schema = randomTestSchema('arcade_test');
let pool: Pool;
beforeAll(async () => {
  if (!enabled) return;
  vi.stubEnv('SPARKADE_CREDIT_ENV', 'arcade-test');
  vi.stubEnv('SPARKADE_PROVIDER', 'mock');
  vi.stubEnv('SPARKADE_MOCK_FAST', '1');
  pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 20 });
  await pool.query(`CREATE SCHEMA ${schema}`);
  context.sql = createLocalPgClient(pool) as Sql;
  await ensureArcadeSchema();
}, 60000);
afterAll(async () => {
  if (pool) {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  }
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  if (!enabled) return;
  await pool.query(
    'TRUNCATE arcade_generations,arcade_profiles,arcade_settings,arcade_spend,arcade_favorites,arcade_plays,arcade_play_tickets,public_games,generation_jobs,credit_accounts,credit_ledger,admin_audit_events CASCADE',
  );
  await settings();
  await context.sql`UPDATE arcade_settings SET enabled=TRUE,game_cap=5,daily_cap=10,total_cap=50 WHERE environment='arcade-test'`;
  context.blobs.clear();
  vi.restoreAllMocks();
});
async function account(user = 'user-a', balance = 30) {
  await ensureProfile(user);
  await context.sql`INSERT INTO credit_accounts(environment,clerk_user_id,balance) VALUES('arcade-test',${user},${balance}) ON CONFLICT DO NOTHING`;
}
async function create(user = 'user-a', key = randomUUID(), heroName = '', photo?: File) {
  const id = await createWebsiteGame(user, 'A friendly moon race', 'racing', key, heroName, photo);
  // Historical manual-review fixtures exercise backwards compatibility. New-policy cases below use createWebsiteGame directly.
  await context.sql`UPDATE arcade_generations SET review_policy='legacy' WHERE game_id=${id}`;
  const [g] = await context.sql`SELECT * FROM arcade_generations WHERE game_id=${id}`;
  return { id, jobId: String(g.job_id) };
}
async function photoFile(background = '#38e5ff') {
  const bytes = await sharp({ create: { width: 48, height: 48, channels: 3, background } })
    .png()
    .toBuffer();
  return new File([new Uint8Array(bytes)], 'hero.png', { type: 'image/png' });
}
async function balance(user = 'user-a') {
  const [a] =
    await context.sql`SELECT balance FROM credit_accounts WHERE environment='arcade-test' AND clerk_user_id=${user}`;
  return Number(a.balance);
}
async function ready(id: string, jobId: string) {
  await reviewWebsiteGame('admin', jobId, 'approve-input', '', 'Friendly idea');
  await context.sql`UPDATE generation_jobs SET status='review' WHERE id=${jobId}`;
  await context.sql`UPDATE public_games SET version_hash='version-one',title='Moon Race',spec_json='{"archetype":"racing","meta":{"title":"Moon Race","tagline":"Race among stars"}}'::jsonb WHERE id=${id}`;
  await reviewWebsiteGame('admin', jobId, 'approve-output', 'version-one', 'Reviewed all content');
}

const admin: AdminIdentity = {
  userId: 'user-a',
  email: 'admin@example.test',
  displayName: 'Admin',
  authorized: true,
};
async function createAdminGame(key = randomUUID()) {
  const id = await createWebsiteGame(
    admin.userId,
    'A friendly moon race',
    'racing',
    key,
    'Hero',
    await photoFile(),
    admin,
  );
  const [g] = await context.sql`SELECT * FROM arcade_generations WHERE game_id=${id}`;
  return { id, jobId: String(g.job_id) };
}
async function stageFinishedGame(jobId: string) {
  const row = (await getJob(jobId))!;
  const bundle = {
    spec: { archetype: 'racing', meta: { title: 'Admin Moon Race' } },
    meta: {},
    manifest: { assets: [{ filename: 'key-art.png', mimeType: 'image/png' }] },
  } as unknown as CloudGameBundle;
  return stageWebsiteResult(
    row,
    {
      state: row.state,
      files: {
        [`games/${row.state.job!.gameId}/assets/key-art.png`]: Buffer.from(
          await (await photoFile()).arrayBuffer(),
        ).toString('base64'),
        [`staging/${jobId}/photo.jpg`]: 'cHJpdmF0ZQ==',
      },
    },
    bundle,
  );
}

describe.skipIf(!enabled)('arcade domain against real PostgreSQL', () => {
  it('checks admin input and output automatically, captures once, keeps unlisted and supports takedown', async () => {
    await account();
    const key = randomUUID();
    const { id, jobId } = await createAdminGame(key);
    expect(await createAdminGame(key)).toEqual({ id, jobId });
    const [g] = await context.sql`SELECT * FROM arcade_generations WHERE game_id=${id}`;
    expect(g).toMatchObject({
      admin_bypass: false,
      input_review: 'pending',
      settlement: 'held',
      review_policy: CONTENT_POLICY,
    });
    await expect(assertWebsiteRunnable((await getJob(jobId))!)).rejects.toThrow();
    expect(await reviewWebsiteInput((await getJob(jobId))!)).toBe(true);
    expect(await balance()).toBe(20);
    await assertWebsiteRunnable((await getJob(jobId))!);
    expect(await getPublicGame(id)).toBeNull();
    await context.sql`UPDATE generation_jobs SET status='publishing' WHERE id=${jobId}`;
    const finished = await Promise.allSettled([stageFinishedGame(jobId), stageFinishedGame(jobId)]);
    expect(finished.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await getJob(jobId))?.status).toBe('done');
    expect((await getPublicGame(id))?.status).toBe('ready');
    expect((await browseGames()).games).toHaveLength(0);
    expect(
      (await context.sql`SELECT settlement FROM arcade_generations WHERE game_id=${id}`)[0]
        .settlement,
    ).toBe('captured');
    expect(await readWebsitePhoto(id, 'user-a')).toBeNull();
    expect(Object.keys((await readWebsiteFinal(id))!.files)).toEqual(['key-art.png']);
    const audits =
      await context.sql`SELECT action,actor_user_id,details_json FROM admin_audit_events WHERE target_id=${id} ORDER BY action`;
    expect(audits).toEqual([]);
    const reviews =
      await context.sql`SELECT phase,decision,version_hash FROM arcade_content_reviews WHERE job_id=${jobId} ORDER BY phase`;
    expect(reviews.map((r) => [r.phase, r.decision])).toEqual([
      ['input', 'allow'],
      ['output', 'allow'],
    ]);
    expect(reviews[1].version_hash).toBe(
      (await context.sql`SELECT version_hash FROM public_games WHERE id=${id}`)[0].version_hash,
    );
    await releaseWebsiteCredits(jobId);
    expect(await balance()).toBe(20);
    await manageGame('user-a', id, 'publish');
    expect((await browseGames()).games).toHaveLength(1);
    await reviewWebsiteGame('admin', jobId, 'takedown', '', 'Reported content');
    expect(await getPublicGame(id)).toBeNull();
    expect((await browseGames()).games).toHaveLength(0);
    await expect(manageGame('user-a', id, 'publish')).rejects.toThrow();
    await expect(stageFinishedGame(jobId)).rejects.toThrow();
    expect(await getPublicGame(id)).toBeNull();
  });
  it('dispatch recovery checks owner and environment, and input rejection refunds exactly once before generation', async () => {
    await account();
    const id = await createWebsiteGame(
      'user-a',
      'A disallowed test fixture',
      'fighter',
      randomUUID(),
    );
    const [{ job_id }] =
      await context.sql`SELECT job_id FROM arcade_generations WHERE game_id=${id}`;
    const row = (await getJob(job_id))!;
    const provider = stageProvider(defaultConfig(), 'design').provider;
    const complete = vi.spyOn(provider, 'complete').mockResolvedValue({
      text: '{"decision":"reject","category":"hate"}',
      usage: { input: 12, output: 8 },
    });
    expect(await reviewWebsiteInput(row)).toBe(false);
    await releaseWebsiteCredits(job_id);
    expect(await balance()).toBe(30);
    expect((await getJob(job_id))!.status).toBe('failed');
    expect(
      (
        await context.sql`SELECT input_review,settlement FROM arcade_generations WHERE job_id=${job_id}`
      )[0],
    ).toMatchObject({ input_review: 'rejected', settlement: 'released' });
    expect(await getPublicGame(id)).toBeNull();
    await expect(retryWebsiteGame('user-a', job_id)).rejects.toThrow();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await context.sql`SELECT * FROM generation_requests WHERE job_id=${job_id}`).toEqual([]);
  });
  it('fails closed on invalid model output with bounded attempts, then permits one refunded service retry', async () => {
    await account();
    const { jobId } = await createAdminGame();
    const row = (await getJob(jobId))!;
    const complete = vi
      .spyOn(stageProvider(defaultConfig(), 'design').provider, 'complete')
      .mockResolvedValue({
        text: '{"decision":"allow","category":"hate"}',
        usage: { input: 1, output: 1 },
      });
    for (let i = 0; i < 3; i++) await expect(reviewWebsiteInput(row)).rejects.toThrow();
    expect(complete).toHaveBeenCalledTimes(2);
    await expect(assertWebsiteRunnable(row)).rejects.toThrow();
    await context.sql`UPDATE generation_jobs SET status='failed' WHERE id=${jobId}`;
    await releaseWebsiteCredits(jobId);
    expect(await balance()).toBe(30);
    const retried = await retryWebsiteGame('user-a', jobId);
    expect(retried.attempt).toBe(2);
    expect(await balance()).toBe(20);
    complete.mockResolvedValue({
      text: '{"decision":"allow","category":"none"}',
      usage: { input: 1, output: 1 },
    });
    expect(await reviewWebsiteInput(retried)).toBe(true);
  });
  it('reuses a persisted exact-version decision and never trusts a different version', async () => {
    await account();
    const { jobId } = await createAdminGame();
    const row = (await getJob(jobId))!;
    const complete = vi.spyOn(stageProvider(defaultConfig(), 'design').provider, 'complete');
    await reviewContent(row, 'input', 'version-a', { text: 'hello' });
    await reviewContent(row, 'input', 'version-a', { text: 'hello' });
    expect(complete).toHaveBeenCalledTimes(1);
    await reviewContent(row, 'input', 'version-b', { text: 'different' });
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it('refunds rejected finished output without exposing any game or source asset', async () => {
    await account();
    const { id, jobId } = await createAdminGame();
    await reviewWebsiteInput((await getJob(jobId))!);
    await context.sql`UPDATE generation_jobs SET status='publishing' WHERE id=${jobId}`;
    vi.spyOn(stageProvider(defaultConfig(), 'design').provider, 'complete').mockResolvedValue({
      text: '{"decision":"reject","category":"sexual"}',
      usage: { input: 10, output: 8 },
    });
    await stageFinishedGame(jobId);
    expect((await getJob(jobId))!.status).toBe('failed');
    expect(await balance()).toBe(30);
    expect(await getPublicGame(id)).toBeNull();
    expect(await readWebsiteFinal(id)).toBeNull();
    await expect(manageGame('user-a', id, 'publish')).rejects.toThrow();
  });
  it('allows review spending before approval but still blocks generator requests, stopped accounts and other environments', async () => {
    await account();
    const { jobId } = await createAdminGame();
    const row = (await getJob(jobId))!;
    const body = JSON.stringify({
      model: row.state.config!.stages.design.model,
      max_completion_tokens: 1660,
      messages: [],
    });
    const url = 'https://api.meta.ai/v1/chat/completions';
    await expect(websiteSpendPolicy(row)(url, body)).rejects.toThrow();
    const settle = await websiteSpendPolicy(row, 'input-review')(url, body);
    await settle?.({ usage: { prompt_tokens: 20, completion_tokens: 10 } });
    await context.sql`UPDATE arcade_profiles SET suspended=TRUE`;
    await expect(websiteSpendPolicy(row, 'input-review')(url, body)).rejects.toThrow();
    await context.sql`UPDATE arcade_profiles SET suspended=FALSE`;
    vi.stubEnv('SPARKADE_CREDIT_ENV', 'elsewhere');
    await expect(websiteSpendPolicy(row, 'input-review')(url, body)).rejects.toThrow();
    vi.stubEnv('SPARKADE_CREDIT_ENV', 'arcade-test');
    await context.sql`UPDATE arcade_settings SET total_cap=0.000001`;
    await expect(websiteSpendPolicy(row, 'input-review')(url, body)).rejects.toThrow();
  });
  it('serves only owner-announced art, excludes source photos and isolates deleted, rejected and other-environment games', async () => {
    await account();
    const { id, jobId } = await createAdminGame();
    await reviewWebsiteInput((await getJob(jobId))!);
    const row = (await getJob(jobId))!;
    row.state.events.push({
      id: 100,
      jobId,
      gameId: row.state.job!.gameId,
      attempt: 1,
      kind: 'asset',
      message: 'art',
      at: new Date().toISOString(),
      payload: { filename: 'hero.png', role: 'hero' },
    });
    const checkpoint = context.blobs.get(row.checkpoint) as PassCheckpoint;
    checkpoint.files[`staging/${jobId}/assets/hero.png`] = 'aGVsbG8=';
    await context.sql`UPDATE generation_jobs SET state=${JSON.stringify(row.state)}::jsonb WHERE id=${jobId}`;
    expect(
      (await websiteProgress('user-a', id))?.items.some((i) => i.image?.endsWith('/hero.png')),
    ).toBe(true);
    expect((await websiteAssetPreview('user-a', id, 'hero.png'))?.toString()).toBe('hello');
    expect(await websiteProgress('other', id)).toBeNull();
    expect(await websiteAssetPreview('other', id, 'hero.png')).toBeNull();
    expect(await websiteAssetPreview('user-a', id, 'photo.jpg')).toBeNull();
    expect(await websiteAssetPreview('user-a', id, '../photo.jpg')).toBeNull();
    expect(await websiteAssetPreview('user-a', id, 'not-announced.png')).toBeNull();
    vi.stubEnv('SPARKADE_CREDIT_ENV', 'other');
    expect(await websiteProgress('user-a', id)).toBeNull();
    vi.stubEnv('SPARKADE_CREDIT_ENV', 'arcade-test');
    await context.sql`UPDATE public_games SET moderation='rejected' WHERE id=${id}`;
    expect(await websiteAssetPreview('user-a', id, 'hero.png')).toBeNull();
    expect((await websiteProgress('user-a', id))?.items.every((i) => !i.image)).toBe(true);
    await context.sql`UPDATE public_games SET deleted_at=now() WHERE id=${id}`;
    expect(await websiteProgress('user-a', id)).toBeNull();
  });
  it('persists terminal notifications once, isolates owners, and claims toasts atomically across tabs', async () => {
    await account();
    const { id, jobId } = await create();
    expect((await gameNotifications('user-a')).items).toEqual([]);
    await ready(id, jobId);
    const results = await Promise.all([gameNotifications('user-a'), gameNotifications('user-a')]);
    const notificationId = results[0].items[0]!.id;
    expect(results.every((r) => r.unread === 1 && r.items.length === 1)).toBe(true);
    expect((await gameNotifications('other')).items).toEqual([]);
    expect(await updateGameNotifications('other', 'claim-toasts', [notificationId])).toEqual([]);
    const claims = await Promise.all([
      updateGameNotifications('user-a', 'claim-toasts', [notificationId]),
      updateGameNotifications('user-a', 'claim-toasts', [notificationId]),
    ]);
    expect(claims.flat()).toEqual([notificationId]);
    await updateGameNotifications('other', 'read-all', [], notificationId);
    expect((await gameNotifications('user-a')).unread).toBe(1);
    await updateGameNotifications('user-a', 'read', [notificationId]);
    expect((await gameNotifications('user-a')).unread).toBe(0);
    await reviewWebsiteGame('admin', jobId, 'takedown', '', 'Policy issue');
    expect((await gameNotifications('user-a')).items[0].kind).toBe('removed');
    await updateGameNotifications('user-a', 'read-all', [], notificationId);
    expect((await gameNotifications('user-a')).unread).toBe(1); // A new outcome is above the captured boundary.
    vi.stubEnv('SPARKADE_CREDIT_ENV', 'other');
    expect((await gameNotifications('user-a')).items).toEqual([]);
    vi.stubEnv('SPARKADE_CREDIT_ENV', 'arcade-test');
  });
  it('recovers a crashed workflow through owner notifications while other accounts cannot trigger it', async () => {
    await account();
    const { jobId } = await createAdminGame();
    await context.sql`UPDATE generation_jobs SET status='running',run_id='failed-runtime',updated_at=now()-interval '2 minutes' WHERE id=${jobId}`;
    expect((await gameNotifications('other')).items).toHaveLength(0);
    expect((await getJob(jobId))?.status).toBe('running');
    expect((await gameNotifications('user-a')).items[0].kind).toBe('failed');
    expect((await getJob(jobId))?.status).toBe('failed');
    expect(await balance()).toBe(30);
    expect((await gameNotifications('user-a')).items).toHaveLength(1);
    expect(await balance()).toBe(30);
  });
  it('reports failed and rejected attempts only once credits are returned, newest first across ID digit boundaries', async () => {
    await context.sql`SELECT setval(pg_get_serial_sequence('arcade_notifications','id'),98,true)`;
    await account();
    const { jobId } = await createAdminGame();
    await context.sql`UPDATE generation_jobs SET status='failed' WHERE id=${jobId}`;
    expect((await gameNotifications('user-a')).items).toHaveLength(0);
    await releaseWebsiteCredits(jobId);
    expect((await gameNotifications('user-a')).items[0].kind).toBe('failed');
    const row = await retryWebsiteGame('user-a', jobId);
    vi.spyOn(stageProvider(defaultConfig(), 'design').provider, 'complete').mockResolvedValue({
      text: '{"decision":"reject","category":"hate"}',
      usage: { input: 2, output: 2 },
    });
    await reviewWebsiteInput(row);
    expect((await gameNotifications('user-a')).items.map((n) => n.kind)).toEqual([
      'rejected',
      'failed',
    ]);
  });
  it('does not exempt an unauthorized identity or another admin’s user ID', async () => {
    await account();
    for (const identity of [
      { ...admin, authorized: false },
      { ...admin, userId: 'someone-else' },
    ]) {
      const id = await createWebsiteGame('user-a', '', 'racing', randomUUID(), '', null, identity);
      const [g] = await context.sql`SELECT * FROM arcade_generations WHERE game_id=${id}`;
      expect(g).toMatchObject({ admin_bypass: false, input_review: 'pending' });
      await expect(assertWebsiteRunnable((await getJob(g.job_id))!)).rejects.toThrow();
      await cancelWebsiteGame('user-a', g.job_id);
    }
  });
  it('resumes only the authenticated admin’s own eligible legacy job, without another hold or duplicate audit', async () => {
    await account();
    const { id, jobId } = await create();
    await expect(resumeAdminWebsiteGame({ ...admin, authorized: false }, id)).rejects.toThrow(
      'Admin access',
    );
    expect(await resumeAdminWebsiteGame({ ...admin, userId: 'other' }, id)).toBeNull();
    vi.stubEnv('SPARKADE_CREDIT_ENV', 'other-environment');
    expect(await resumeAdminWebsiteGame(admin, id)).toBeNull();
    vi.stubEnv('SPARKADE_CREDIT_ENV', 'arcade-test');
    const rows = await Promise.all([
      resumeAdminWebsiteGame(admin, id),
      resumeAdminWebsiteGame(admin, id),
    ]);
    expect(rows.every((r) => r?.id === jobId)).toBe(true);
    expect(await balance()).toBe(20);
    expect(await context.sql`SELECT id FROM admin_audit_events WHERE target_id=${id}`).toHaveLength(
      1,
    );
    await context.sql`UPDATE generation_jobs SET status='running',run_id='claimed' WHERE id=${jobId}`;
    expect(await resumeAdminWebsiteGame(admin, id)).toBeNull();
  });
  it('keeps admin failures refundable and retries under the same price, budget and bypass policy', async () => {
    await account();
    const { id, jobId } = await createAdminGame();
    await context.sql`UPDATE generation_jobs SET status='failed' WHERE id=${jobId}`;
    await releaseWebsiteCredits(jobId);
    await releaseWebsiteCredits(jobId);
    expect(await balance()).toBe(30);
    await context.sql`UPDATE arcade_settings SET price=25`;
    const row = await retryWebsiteGame('user-a', jobId);
    expect(row.attempt).toBe(2);
    expect(await balance()).toBe(20);
    expect(
      (await context.sql`SELECT admin_bypass FROM arcade_generations WHERE game_id=${id}`)[0]
        .admin_bypass,
    ).toBe(false);
    await reviewWebsiteInput(row);
    await context.sql`UPDATE arcade_settings SET total_cap=0.001`;
    await expect(
      websiteSpendPolicy(row)(
        'https://api.meta.ai/v1/images/generations',
        JSON.stringify({ model: row.state.config!.imageGeneration.model, n: 1 }),
      ),
    ).rejects.toThrow();
    await context.sql`UPDATE arcade_settings SET total_cap=50`;
    await context.sql`UPDATE generation_jobs SET status='publishing' WHERE id=${jobId}`;
    await stageFinishedGame(jobId);
    expect((await getPublicGame(id))?.status).toBe('ready');
    expect(await balance()).toBe(20);
  });
  it('still stops admin creation and completion for paused, suspended, deleted or stale jobs', async () => {
    await account();
    await context.sql`UPDATE arcade_settings SET enabled=FALSE`;
    await expect(createAdminGame()).rejects.toThrow('paused');
    await context.sql`UPDATE arcade_settings SET enabled=TRUE`;
    const { id, jobId } = await createAdminGame();
    await context.sql`UPDATE generation_jobs SET status='publishing' WHERE id=${jobId}`;
    await context.sql`UPDATE arcade_settings SET enabled=FALSE`;
    await expect(stageFinishedGame(jobId)).rejects.toThrow();
    await context.sql`UPDATE arcade_settings SET enabled=TRUE`;
    await context.sql`UPDATE arcade_profiles SET suspended=TRUE`;
    await expect(stageFinishedGame(jobId)).rejects.toThrow();
    await context.sql`UPDATE arcade_profiles SET suspended=FALSE`;
    await context.sql`UPDATE public_games SET deleted_at=now() WHERE id=${id}`;
    await expect(stageFinishedGame(jobId)).rejects.toThrow();
    await context.sql`UPDATE public_games SET deleted_at=NULL WHERE id=${id}`;
    const stale = (await getJob(jobId))!;
    stale.attempt += 1;
    await expect(
      stageWebsiteResult(stale, { state: stale.state, files: {} }, {} as CloudGameBundle),
    ).rejects.toThrow();
    expect(
      (await context.sql`SELECT settlement FROM arcade_generations WHERE game_id=${id}`)[0]
        .settlement,
    ).toBe('held');
    expect(await getPublicGame(id)).toBeNull();
  });
  it('admin library separates online ownership and excludes deleted or other-environment games', async () => {
    await account();
    const { id, jobId } = await create();
    await ready(id, jobId);
    let game = (await listManagedPublicGames()).find((game) => game.id === id);
    expect(game).toMatchObject({
      ownerId: 'user-a',
      moderation: 'approved',
      keyArtUrl: `/api/games/${id}/assets/key-art.png`,
    });
    await context.sql`UPDATE public_games SET environment='other-env' WHERE id=${id}`;
    expect(await listManagedPublicGames()).toEqual([]);
    await context.sql`UPDATE public_games SET environment='arcade-test',deleted_at=now() WHERE id=${id}`;
    expect(await listManagedPublicGames()).toEqual([]);
    await context.sql`UPDATE public_games SET deleted_at=NULL,owner_id=NULL,environment=NULL WHERE id=${id}`;
    game = (await listManagedPublicGames())[0];
    expect(game.ownerId).toBeNull();
  });
  it('renames creator identity without changing games, credits, or saved games', async () => {
    await account();
    const initial = await ensureProfile('user-a');
    const { id, jobId } = await create();
    await ready(id, jobId);
    await manageGame('user-a', id, 'publish');
    await setFavorite('user-a', id, true);
    expect(await changeUsername('user-a', ' Moon_Racer ')).toBe('moon_racer');
    expect(await ensureProfile('user-a')).toMatchObject({ handle: 'moon_racer', credits: 20 });
    expect(await findPublicProfile(initial.handle)).toEqual({
      userId: 'user-a',
      handle: 'moon_racer',
    });
    expect(await findPublicProfile('MOON_RACER')).toEqual({
      userId: 'user-a',
      handle: 'moon_racer',
    });
    const result = await browseGames({ viewer: 'user-a', favorites: true });
    expect(result.games[0]).toMatchObject({ id, creatorHandle: 'moon_racer', favorite: true });
    expect((await browseGames({ q: 'moon_racer' })).games).toHaveLength(1);
  });
  it('allows exactly one winner when users concurrently claim the same case-insensitive name', async () => {
    const users = ['one', 'two', 'three', 'four'];
    await Promise.all(users.map((user) => account(user)));
    const attempts = await Promise.allSettled(
      users.map((user, index) => changeUsername(user, index % 2 ? 'Moon-Racer' : 'moon-racer')),
    );
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(3);
    const [{ count }] =
      await context.sql`SELECT count(*) FROM arcade_profiles WHERE handle='moon-racer'`;
    expect(Number(count)).toBe(1);
  });
  it('keeps every alias with its owner across concurrent renames and reverting to a previous name', async () => {
    await account();
    const initial = (await ensureProfile('user-a')).handle;
    await Promise.all(
      ['moon-racer', 'star-pilot', 'space-ace'].map((name) => changeUsername('user-a', name)),
    );
    const current = (await ensureProfile('user-a')).handle;
    for (const name of [initial, 'moon-racer', 'star-pilot', 'space-ace']) {
      expect(await findPublicProfile(name)).toEqual({ userId: 'user-a', handle: current });
    }
    await expect(changeUsername('another', 'MOON-RACER')).rejects.toThrow('taken');
    await changeUsername('user-a', 'moon-racer');
    expect(await findPublicProfile('star-pilot')).toEqual({
      userId: 'user-a',
      handle: 'moon-racer',
    });
    expect(await balance()).toBe(30);
  });
  it('rejects invalid and suspended edits without changing identity, and hides suspended aliases', async () => {
    await account();
    const initial = (await ensureProfile('user-a')).handle;
    expect(await changeUsername('user-a', initial)).toBe(initial);
    await expect(changeUsername('user-a', 'admin')).rejects.toThrow('reserved');
    await expect(changeUsername('user-a', 'f_u_c_k')).rejects.toThrow('offensive');
    expect((await ensureProfile('user-a')).handle).toBe(initial);
    await changeUsername('user-a', 'moon-racer');
    await context.sql`UPDATE arcade_profiles SET suspended=TRUE WHERE user_id='user-a'`;
    await expect(changeUsername('user-a', 'star-pilot')).rejects.toThrow('paused');
    expect(await findPublicProfile(initial)).toBeNull();
    expect(await findPublicProfile('moon-racer')).toBeNull();
    expect(await findPublicProfile('../private')).toBeNull();
  });
  it('scopes username claims and historical aliases to the credit environment', async () => {
    await account();
    await changeUsername('user-a', 'moon-racer');
    vi.stubEnv('SPARKADE_CREDIT_ENV', 'arcade-test-other');
    try {
      expect(await findPublicProfile('moon-racer')).toBeNull();
      await changeUsername('user-b', 'moon-racer');
      expect(await findPublicProfile('moon-racer')).toEqual({
        userId: 'user-b',
        handle: 'moon-racer',
      });
    } finally {
      vi.stubEnv('SPARKADE_CREDIT_ENV', 'arcade-test');
    }
    expect(await findPublicProfile('moon-racer')).toEqual({
      userId: 'user-a',
      handle: 'moon-racer',
    });
  });
  it('serializes simultaneous submissions and reserves credits only once', async () => {
    await account();
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, () => create('user-a', key)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await balance()).toBe(20);
    const [{ count }] =
      await context.sql`SELECT count(*) FROM credit_ledger WHERE kind='generation_hold'`;
    expect(Number(count)).toBe(1);
    await expect(createWebsiteGame('user-a', 'Changed idea', 'racing', key)).rejects.toThrow(
      'different game',
    );
  });
  it('saves the exact hero name in the checkpoint and generation prompt, and deduplicates the full brief', async () => {
    await account();
    const key = randomUUID();
    const { id, jobId } = await create('user-a', key, '  Dr. Lúna  ');
    const row = (await getJob(jobId))!;
    const brief = {
      version: 1,
      heroName: 'Dr. Lúna',
      archetype: 'racing',
      details: 'A friendly moon race',
    };
    expect(row.state.job!.creationBrief).toEqual(brief);
    expect(context.blobs.get(row.checkpoint)).toMatchObject({
      state: { job: { creationBrief: brief } },
    });
    const prompt = buildDesignPrompt({
      promptText: row.state.job!.promptText,
      hasPhoto: false,
      describeInStory: false,
      antiCollision: [],
      creationBrief: row.state.job!.creationBrief,
    });
    expect(prompt.user).toContain('HERO NAME: Dr. Lúna');
    expect(prompt.user).toContain('Preserve the supplied hero name exactly in story text.');
    expect((await create('user-a', key, 'Dr. Lúna')).id).toBe(id);
    await expect(create('user-a', key, 'Captain Pip')).rejects.toThrow('different game');
    await expect(create('user-a', key)).rejects.toThrow('different game');
    expect(await balance()).toBe(20);
  });
  it('lets Spark choose when the name is blank and preserves legacy unnamed submission fingerprints', async () => {
    await account();
    const key = randomUUID();
    const { id, jobId } = await create('user-a', key, '   ');
    const row = (await getJob(jobId))!;
    expect(row.state.job!.creationBrief!.heroName).toBeUndefined();
    const legacyHash = createHash('sha256')
      .update(JSON.stringify(['A friendly moon race', 'racing']))
      .digest('hex');
    expect(row.input_hash).toBe(legacyHash);
    await context.sql`UPDATE generation_jobs SET state=state #- '{job,creationBrief}' WHERE id=${jobId}`;
    expect((await create('user-a', key)).id).toBe(id);
    expect(await balance()).toBe(20);
  });
  it('rejects an oversized hero name before holding any credits', async () => {
    await account();
    await expect(create('user-a', randomUUID(), 'a'.repeat(49))).rejects.toThrow('48 characters');
    expect(await balance()).toBe(30);
    expect(await context.sql`SELECT job_id FROM arcade_generations`).toEqual([]);
    expect(await context.sql`SELECT id FROM credit_ledger`).toEqual([]);
  });
  it.each([false, true])(
    'lets Spark invent a blank idea, with personalization: %s',
    async (personalized) => {
      await account();
      const key = randomUUID();
      const name = personalized ? 'Captain Luna' : '';
      const photo = personalized ? await photoFile() : undefined;
      const id = await createWebsiteGame('user-a', ' \n ', 'racing', key, name, photo);
      const [submission] = await context.sql`SELECT * FROM arcade_generations WHERE game_id=${id}`;
      const row = (await getJob(submission.job_id))!;
      const job = row.state.job!;
      expect(job.creationBrief).toEqual({
        version: 1,
        archetype: 'racing',
        ...(name ? { heroName: name } : {}),
      });
      expect(job.hasPhoto).toBe(personalized);
      expect(job.promptText).toContain('Make it a racing game.');
      expect(job.promptText).toContain(
        'Spark decides the story, enemies, setting, and visual style.',
      );
      expect(submission.prompt).toBe(job.promptText);
      expect(context.blobs.get(row.checkpoint)).toMatchObject({
        state: { job: { creationBrief: job.creationBrief } },
      });
      const prompt = buildDesignPrompt({
        promptText: job.promptText,
        hasPhoto: job.hasPhoto,
        describeInStory: false,
        antiCollision: [],
        creationBrief: job.creationBrief,
      });
      expect(prompt.user).toContain('ADDITIONAL DETAILS: (Spark decides)');
      expect(prompt.user).toContain('Invent an original story, enemies, setting, and aesthetic.');
      expect(await createWebsiteGame('user-a', '', 'racing', key, name, photo)).toBe(id);
      await expect(
        createWebsiteGame('user-a', 'A new plot', 'racing', key, name, photo),
      ).rejects.toThrow('different game');
      expect(await balance()).toBe(20);
    },
  );
  it('still rejects overlong ideas before holding credits', async () => {
    await account();
    await expect(
      createWebsiteGame('user-a', 'a'.repeat(1201), 'racing', randomUUID()),
    ).rejects.toThrow('1,200 characters');
    expect(await balance()).toBe(30);
    expect(await context.sql`SELECT job_id FROM arcade_generations`).toEqual([]);
  });
  it('persists a normalized private photo, deduplicates it, and rejects changed or removed photos', async () => {
    await account();
    const key = randomUUID(),
      photo = await photoFile();
    const { id, jobId } = await create('user-a', key, 'Luna', photo);
    const row = (await getJob(jobId))!;
    expect(row.state.job!.hasPhoto).toBe(true);
    const initial = context.blobs.get(row.checkpoint) as PassCheckpoint;
    const saved = Buffer.from(initial.files[`staging/${jobId}/photo.jpg`], 'base64');
    expect(await sharp(saved).metadata()).toMatchObject({ format: 'jpeg', width: 48, height: 48 });
    expect(await readWebsitePhoto(id, 'user-a')).toEqual(saved);
    expect(await readWebsitePhoto(id, 'other-user')).toBeNull();
    expect(await readWebsitePhoto(id, 'admin', true)).toEqual(saved);
    expect((await create('user-a', key, 'Luna', photo)).id).toBe(id);
    await expect(create('user-a', key, 'Luna', await photoFile('#ff8844'))).rejects.toThrow(
      'different game',
    );
    await expect(create('user-a', key, 'Luna')).rejects.toThrow('different game');
    expect(await balance()).toBe(20);
    vi.stubEnv('SPARKADE_CREDIT_ENV', 'other-environment');
    try {
      expect(await readWebsitePhoto(id, 'admin', true)).toBeNull();
    } finally {
      vi.stubEnv('SPARKADE_CREDIT_ENV', 'arcade-test');
    }
    await context.sql`UPDATE public_games SET deleted_at=now() WHERE id=${id}`;
    expect(await readWebsitePhoto(id, 'admin', true)).toBeNull();
    await context.sql`UPDATE public_games SET deleted_at=NULL WHERE id=${id}`;
    await cancelWebsiteGame('user-a', jobId);
    expect(await readWebsitePhoto(id, 'user-a')).toBeNull();
  });
  it('rejects malformed photo input before creating a job or holding credits', async () => {
    await account();
    await expect(
      create(
        'user-a',
        randomUUID(),
        '',
        new File(['not a photo'], 'hero.jpg', { type: 'image/jpeg' }),
      ),
    ).rejects.toThrow('Could not read');
    expect(await balance()).toBe(30);
    expect(await context.sql`SELECT job_id FROM arcade_generations`).toEqual([]);
    expect(context.blobs.size).toBe(0);
  });
  it.each([false, true])(
    'allows three active games under concurrent submissions (admin: %s)',
    async (isAdmin) => {
      await account('user-a', 100);
      const attempts = await Promise.allSettled(
        Array.from({ length: 8 }, () => (isAdmin ? createAdminGame() : create())),
      );
      const accepted = attempts.filter((r) => r.status === 'fulfilled');
      expect(accepted).toHaveLength(3);
      expect(
        attempts
          .filter((r) => r.status === 'rejected')
          .every((r) => r.reason instanceof ActiveGameError),
      ).toBe(true);
      expect(await balance()).toBe(70);
      expect(
        await context.sql`SELECT id FROM credit_ledger WHERE kind='generation_hold'`,
      ).toHaveLength(3);
      expect(await getActiveWebsiteGames('user-a')).toHaveLength(3);
      expect(await getActiveWebsiteGames('other')).toEqual([]);
      vi.stubEnv('SPARKADE_CREDIT_ENV', 'other-environment');
      expect(await getActiveWebsiteGames('user-a')).toEqual([]);
      vi.stubEnv('SPARKADE_CREDIT_ENV', 'arcade-test');
      expect(
        await context.sql`SELECT indexname FROM pg_indexes WHERE schemaname=${schema} AND indexname='arcade_one_active_per_user'`,
      ).toEqual([]);
      // A settled game frees a slot without changing the other active games.
      const first = accepted[0].value;
      await context.sql`UPDATE generation_jobs SET status='failed' WHERE id=${first.jobId}`;
      await releaseWebsiteCredits(first.jobId);
      expect(await getActiveWebsiteGames('user-a')).toHaveLength(2);
      await (isAdmin ? createAdminGame() : create());
      expect(await getActiveWebsiteGames('user-a')).toHaveLength(3);
      expect(await balance()).toBe(70);
    },
  );
  it('deduplicates simultaneous requests for the last slot even once the queue becomes full', async () => {
    await account('user-a', 100);
    await Promise.all([create(), create()]);
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, () => create('user-a', key)));
    expect(new Set(results.map((g) => g.id)).size).toBe(1);
    expect(await create('user-a', key)).toEqual(results[0]);
    expect(await getActiveWebsiteGames('user-a')).toHaveLength(3);
    expect(await balance()).toBe(70);
  });
  it('limits concurrent credit holds to the available balance even with free game slots', async () => {
    await account('user-a', 10);
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => create()));
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balance()).toBe(0);
    expect(await getActiveWebsiteGames('user-a')).toHaveLength(1);
    expect(
      await context.sql`SELECT id FROM credit_ledger WHERE kind='generation_hold'`,
    ).toHaveLength(1);
    await account('poor', 0);
    await expect(create('poor')).rejects.toThrow('need 10 credits');
  });
  it('reports a full personal queue before uploading another private checkpoint', async () => {
    await account('user-a', 100);
    const games = await Promise.all([create(), create(), create()]);
    const blobs = context.blobs.size;
    await expect(create()).rejects.toMatchObject({
      games: expect.arrayContaining(
        games.map((g) => ({ id: g.id, title: 'Your game in progress' })),
      ),
      message: expect.stringContaining('3 games in progress'),
    });
    expect(context.blobs.size).toBe(blobs);
    expect(await balance()).toBe(70);
  });
  it('serializes retries with new submissions competing for the third game slot', async () => {
    await account('user-a', 100);
    const retry = await create();
    await reviewWebsiteGame('admin', retry.jobId, 'approve-input', '', 'Fine');
    await context.sql`UPDATE generation_jobs SET status='failed' WHERE id=${retry.jobId}`;
    await releaseWebsiteCredits(retry.jobId);
    await Promise.all([create(), create()]);
    const attempts = await Promise.allSettled([retryWebsiteGame('user-a', retry.jobId), create()]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await getActiveWebsiteGames('user-a')).toHaveLength(3);
    expect(await balance()).toBe(70);
    expect((await getJob(retry.jobId))?.attempt).toBe(attempts[0].status === 'fulfilled' ? 2 : 1);
  });
  it('does not charge a retry when three other games are active', async () => {
    await account('user-a', 100);
    const retry = await create();
    await reviewWebsiteGame('admin', retry.jobId, 'approve-input', '', 'Fine');
    await context.sql`UPDATE generation_jobs SET status='failed' WHERE id=${retry.jobId}`;
    await releaseWebsiteCredits(retry.jobId);
    await Promise.all([create(), create(), create()]);
    await expect(retryWebsiteGame('user-a', retry.jobId)).rejects.toThrow('3 games in progress');
    expect(await balance()).toBe(70);
    expect((await getJob(retry.jobId))?.attempt).toBe(1);
  });
  it('cancels only the owner’s unreviewed queue entry and refunds once under replay', async () => {
    await account();
    const { id, jobId } = await create();
    await cancelWebsiteGame('other', jobId);
    expect(await balance()).toBe(20);
    await Promise.all(Array.from({ length: 6 }, () => cancelWebsiteGame('user-a', jobId)));
    expect(await balance()).toBe(30);
    expect(await getPublicGame(id)).toBeNull();
  });
  it('requires exact output version, keeps approved games unlisted, and honors owner publish/delete/restore', async () => {
    await account();
    const { id, jobId } = await create();
    expect(await getPublicGame(id)).toBeNull();
    await reviewWebsiteGame('admin', jobId, 'approve-input', '', 'Fine');
    await context.sql`UPDATE generation_jobs SET status='review' WHERE id=${jobId}`;
    await context.sql`UPDATE public_games SET version_hash='v1',spec_json='{"archetype":"racing","meta":{"title":"Moon Race"}}'::jsonb,title='Moon Race' WHERE id=${id}`;
    await expect(
      reviewWebsiteGame('admin', jobId, 'approve-output', 'wrong', 'Fine'),
    ).rejects.toThrow('changed');
    expect(await getPublicGame(id)).toBeNull();
    await reviewWebsiteGame('admin', jobId, 'approve-output', 'v1', 'Reviewed');
    expect((await getPublicGame(id))?.status).toBe('ready');
    expect((await browseGames()).games).toHaveLength(0);
    await expect(manageGame('other', id, 'publish')).rejects.toThrow();
    await manageGame('user-a', id, 'publish');
    expect((await browseGames({ q: 'moon', type: 'racing' })).games).toHaveLength(1);
    await manageGame('user-a', id, 'unpublish');
    expect((await browseGames()).games).toHaveLength(0);
    expect(await getPublicGame(id)).not.toBeNull();
    await manageGame('user-a', id, 'delete');
    expect(await getPublicGame(id)).toBeNull();
    await manageGame('user-a', id, 'restore');
    expect(await getPublicGame(id)).not.toBeNull();
    expect((await browseGames()).games).toHaveLength(0);
    expect(await balance()).toBe(20);
    await releaseWebsiteCredits(jobId);
    expect(await balance()).toBe(20);
  });
  it('rejects output once, returns credits, and never lists rejected content', async () => {
    await account();
    const { id, jobId } = await create();
    await reviewWebsiteGame('admin', jobId, 'reject', '', 'Not appropriate');
    await Promise.all([releaseWebsiteCredits(jobId), releaseWebsiteCredits(jobId)]);
    expect(await balance()).toBe(30);
    expect(await getPublicGame(id)).toBeNull();
    await expect(manageGame('user-a', id, 'publish')).rejects.toThrow();
  });
  it('explains failures in owner progress and library cards without exposing raw errors', async () => {
    await account();
    const { id, jobId } = await create();
    await reviewWebsiteGame('admin', jobId, 'approve-input', '', 'Fine');
    const row = (await getJob(jobId))!;
    row.state.job!.error = {
      code: 'image-content-policy',
      stage: 'building-assets',
      message: 'Provider secret-token https://private.example/photo.jpg cost $5',
    };
    await context.sql`UPDATE generation_jobs SET status='failed',state=${JSON.stringify(row.state)}::jsonb WHERE id=${jobId}`;
    const pending = (await websiteProgress('user-a', id))!;
    expect(pending.summary).toContain('Your credits are being returned.');
    await releaseWebsiteCredits(jobId);
    const progress = (await websiteProgress('user-a', id))!;
    const card = (await browseGames({ viewer: 'user-a', mine: true })).games[0];
    expect(progress.failure).toBe(
      'The image service blocked a requested image during its safety check.',
    );
    expect(card.failure).toBe(progress.failure);
    expect(progress.summary).toContain('Your credits have been returned.');
    expect(progress.summary).not.toContain('being returned');
    expect(progress.items.at(-1)?.message).toBe(progress.summary);
    expect(JSON.stringify({ card, progress })).not.toMatch(/secret-token|private\.example|\$5/);
    expect(await websiteProgress('other', id)).toBeNull();
    expect((await browseGames({ viewer: 'other', mine: true })).games).toHaveLength(0);
    expect((await browseGames()).games).toHaveLength(0);

    // Some older records only saved the game's failure, with a JSON null job error.
    await context.sql`UPDATE generation_jobs SET state=jsonb_set(jsonb_set(state,'{game,failure}',state->'job'->'error'),'{job,error}','null'::jsonb) WHERE id=${jobId}`;
    expect((await websiteProgress('user-a', id))?.failure).toBe(progress.failure);
    expect((await browseGames({ viewer: 'user-a', mine: true })).games[0].failure).toBe(
      progress.failure,
    );

    await retryWebsiteGame('user-a', jobId);
    expect((await websiteProgress('user-a', id))?.failure).toBeNull();
    expect((await browseGames({ viewer: 'user-a', mine: true })).games[0].failure).toBeNull();
  });
  it('supports one retry at the original price and refunds its hold separately', async () => {
    await account();
    const { id, jobId } = await create('user-a', randomUUID(), 'Dr. Lúna', await photoFile());
    const photo = await readWebsitePhoto(id, 'user-a');
    await reviewWebsiteGame('admin', jobId, 'approve-input', '', 'Fine');
    await context.sql`UPDATE generation_jobs SET status='failed' WHERE id=${jobId}`;
    await releaseWebsiteCredits(jobId);
    expect(await balance()).toBe(30);
    expect((await browseGames({ viewer: 'user-a', mine: true })).games[0].retry).toEqual({
      available: true,
      jobId,
      price: 10,
    });
    expect((await browseGames({ viewer: 'other', mine: true })).games).toHaveLength(0);
    await context.sql`UPDATE arcade_settings SET price=25`;
    const row = await retryWebsiteGame('user-a', jobId);
    expect((await browseGames({ viewer: 'user-a', mine: true })).games[0].retry).toBeNull();
    expect(row.attempt).toBe(2);
    expect(row.state.job!.creationBrief?.heroName).toBe('Dr. Lúna');
    expect(row.state.job!.hasPhoto).toBe(true);
    expect(await readWebsitePhoto(id, 'user-a')).toEqual(photo);
    const checkpoint = context.blobs.get(row.checkpoint) as PassCheckpoint;
    expect(checkpoint.files[`staging/${jobId}/photo.jpg`]).toBe(photo!.toString('base64'));
    expect(await balance()).toBe(20);
    await context.sql`UPDATE generation_jobs SET status='failed' WHERE id=${jobId}`;
    await releaseWebsiteCredits(jobId);
    expect(await balance()).toBe(30);
    expect((await browseGames({ viewer: 'user-a', mine: true })).games[0].retry).toMatchObject({
      available: false,
      message: expect.stringContaining('one retry'),
    });
    await expect(retryWebsiteGame('user-a', jobId)).rejects.toThrow('cannot be retried');
  });
  it('does not offer or charge a retry when its saved checkpoint is being removed', async () => {
    await account();
    const { jobId } = await create();
    await reviewWebsiteGame('admin', jobId, 'approve-input', '', 'Fine');
    await context.sql`UPDATE generation_jobs SET status='failed',cleanup_pending=TRUE WHERE id=${jobId}`;
    await releaseWebsiteCredits(jobId);
    expect((await browseGames({ viewer: 'user-a', mine: true })).games[0].retry).toMatchObject({
      available: false,
      message: expect.stringContaining('no longer available'),
    });
    await expect(retryWebsiteGame('user-a', jobId)).rejects.toThrow('cannot be retried');
    expect(await balance()).toBe(30);
    expect((await getJob(jobId))?.attempt).toBe(1);
  });
  it('accepts concurrent retry clicks once and holds the original credit price once', async () => {
    await account();
    const { jobId } = await create();
    await reviewWebsiteGame('admin', jobId, 'approve-input', '', 'Fine');
    await context.sql`UPDATE generation_jobs SET status='failed' WHERE id=${jobId}`;
    await releaseWebsiteCredits(jobId);
    const results = await Promise.allSettled([
      retryWebsiteGame('user-a', jobId),
      retryWebsiteGame('user-a', jobId),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await balance()).toBe(20);
    expect((await getJob(jobId))?.attempt).toBe(2);
    expect(
      await context.sql`SELECT id FROM credit_ledger WHERE operation_id=${`retry-hold:${jobId}`}`,
    ).toHaveLength(1);
  });
  it('reserves spend atomically across requests, retains unknown charges and obeys the kill switch', async () => {
    await account();
    const { jobId } = await create();
    await reviewWebsiteGame('admin', jobId, 'approve-input', '', 'Fine');
    await context.sql`UPDATE arcade_settings SET game_cap=.025,daily_cap=.025,total_cap=.025`;
    const row = (await getJob(jobId))!;
    row.state.imagePricing = { ...row.state.imagePricing!, perImageUsd: 0.01 };
    const policy = websiteSpendPolicy(row),
      body = JSON.stringify({ model: row.state.config!.imageGeneration.model, n: 1 });
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => policy('https://api.meta.ai/v1/images/generations', body)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    const [{ sum }] = await context.sql`SELECT sum(COALESCE(charged,reserved)) FROM arcade_spend`;
    expect(Number(sum)).toBe(0.02);
    await context.sql`UPDATE arcade_settings SET enabled=FALSE`;
    await expect(policy('https://api.meta.ai/v1/images/generations', body)).rejects.toThrow(
      'paused',
    );
  });
  it('stores an immutable private version before approval and detects tampering', async () => {
    await account();
    const { id, jobId } = await create('user-a', randomUUID(), '', await photoFile());
    await reviewWebsiteGame('admin', jobId, 'approve-input', '', 'Fine');
    await context.sql`UPDATE generation_jobs SET status='publishing' WHERE id=${jobId}`;
    const row = (await getJob(jobId))!,
      bundle = {
        spec: { archetype: 'racing', meta: { title: 'Moon Race' } },
        meta: {},
        manifest: { assets: [{ filename: 'key-art.png', mimeType: 'image/png' }] },
      } as unknown as CloudGameBundle;
    await stageWebsiteResult(
      row,
      {
        state: row.state,
        files: {
          [`games/${row.state.job!.gameId}/assets/key-art.png`]: Buffer.from(
            await (await photoFile()).arrayBuffer(),
          ).toString('base64'),
          [`staging/${jobId}/photo.jpg`]: 'cHJpdmF0ZSBwaG90bw==',
        },
      },
      bundle,
    );
    expect((await getJob(jobId))?.status).toBe('review');
    expect(await getPublicGame(id)).toBeNull();
    expect((await readWebsiteFinal(id))?.files['key-art.png']).toMatch(/^iVBOR/);
    expect(Object.keys((await readWebsiteFinal(id))!.files)).toEqual(['key-art.png']);
    await reviewWebsiteGame(
      'admin',
      jobId,
      'approve-output',
      (await context.sql`SELECT version_hash FROM public_games WHERE id=${id}`)[0].version_hash,
      'Reviewed',
    );
    expect(await readWebsitePhoto(id, 'admin', true)).toBeNull();
    const [game] = await context.sql`SELECT private_bundle FROM public_games WHERE id=${id}`;
    context.blobs.set(game.private_bundle, { bundle, files: { 'key-art.png': 'tampered' } });
    await expect(readWebsiteFinal(id)).rejects.toThrow('integrity');
  });
  it('makes favorites idempotent and private, and removes inaccessible content from saved lists', async () => {
    await account();
    await account('fan');
    const { id, jobId } = await create();
    await ready(id, jobId);
    await Promise.all(Array.from({ length: 6 }, () => setFavorite('fan', id, true)));
    expect((await browseGames({ viewer: 'fan', favorites: true })).games[0].likes).toBe(1);
    expect((await browseGames()).games).toHaveLength(0);
    await manageGame('user-a', id, 'publish');
    expect((await browseGames({ sort: 'likes' })).games[0].likes).toBe(1);
    await reviewWebsiteGame('admin', jobId, 'takedown', '', 'Reported content');
    expect((await browseGames({ viewer: 'fan', favorites: true })).games).toHaveLength(0);
    expect(await getPublicGame(id)).toBeNull();
  });
  it.each(['guest:viewer', 'user:user-a'])(
    'counts qualified plays and deduplicates replay for %s, including the creator',
    async (viewer) => {
      await account();
      const { id, jobId } = await create();
      await ready(id, jobId);
      const ticket = (await startPlay(id, viewer))!;
      expect(ticket).toBeTruthy();
      expect(await finishPlay(id, viewer, ticket)).toBe(false);
      await context.sql`UPDATE arcade_play_tickets SET created_at=now()-interval '11 seconds' WHERE id=${ticket}`;
      expect(await finishPlay(id, 'guest:someone-else', ticket)).toBe(false);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => finishPlay(id, viewer, ticket)),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await browseGames({ viewer: 'user-a', mine: true })).games[0].plays).toBe(1);
      const next = (await startPlay(id, viewer))!;
      await context.sql`UPDATE arcade_play_tickets SET created_at=now()-interval '11 seconds' WHERE id=${next}`;
      expect(await finishPlay(id, viewer, next)).toBe(false);
      const beforeDelete = (await startPlay(id, viewer))!;
      await context.sql`UPDATE arcade_play_tickets SET created_at=now()-interval '11 seconds' WHERE id=${beforeDelete}`;
      await manageGame('user-a', id, 'delete');
      expect(await startPlay(id, viewer)).toBeUndefined();
      expect(await finishPlay(id, viewer, beforeDelete)).toBe(false);
    },
  );
  it('counts the same creator playing three different games within 30 minutes', async () => {
    await account();
    for (let i = 0; i < 3; i++) {
      const { id, jobId } = await create();
      await ready(id, jobId);
      const ticket = (await startPlay(id, 'user:user-a'))!;
      await context.sql`UPDATE arcade_play_tickets SET created_at=now()-interval '11 seconds' WHERE id=${ticket}`;
      expect(await finishPlay(id, 'user:user-a', ticket)).toBe(true);
    }
    const { games } = await browseGames({ viewer: 'user-a', mine: true });
    expect(games).toHaveLength(3);
    expect(games.map((game) => game.plays)).toEqual([1, 1, 1]);
  });
  it('denies kiosk overwrite of website-owned games and isolates environments', async () => {
    await account();
    const { id, jobId } = await create();
    await ready(id, jobId);
    expect(
      await updatePublicGame({
        id,
        sourceId: `preview:${jobId}`,
        status: 'ready',
        stage: 'done',
        message: 'overwrite',
      }),
    ).toBeNull();
    await expect(
      reservePublicGame(`preview:${jobId}`, {
        id: null,
        name: 'Legacy',
        defaultFeedVisibility: 'listed',
      }),
    ).rejects.toThrow();
    vi.stubEnv('SPARKADE_CREDIT_ENV', 'other-environment');
    expect(await getPublicGame(id)).toBeNull();
    expect((await browseGames()).games).toHaveLength(0);
    vi.stubEnv('SPARKADE_CREDIT_ENV', 'arcade-test');
  });
  it('recovers a terminal runtime failure that bypassed the workflow catch block', async () => {
    await account();
    const { jobId } = await create();
    await reviewWebsiteGame('admin', jobId, 'approve-input', '', 'Fine');
    await context.sql`UPDATE generation_jobs SET status='running',run_id='test-failed-run',updated_at=now()-interval '2 minutes' WHERE id=${jobId}`;
    expect(await reconcileWebsiteJob(jobId)).toBe(true);
    expect(await balance()).toBe(30);
    expect(await reconcileWebsiteJob(jobId)).toBe(false);
    expect((await getJob(jobId))?.status).toBe('failed');
  });
});
