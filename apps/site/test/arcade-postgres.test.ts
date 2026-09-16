import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { Pool } from 'pg';
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
}));
import {
  ensureArcadeSchema,
  ensureProfile,
  settings,
  browseGames,
  manageGame,
  setFavorite,
} from '../lib/arcade';
import {
  createWebsiteGame,
  releaseWebsiteCredits,
  reviewWebsiteGame,
  retryWebsiteGame,
  cancelWebsiteGame,
  stageWebsiteResult,
  readWebsiteFinal,
} from '../lib/website-generation';
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
});
async function account(user = 'user-a', balance = 30) {
  await ensureProfile(user);
  await context.sql`INSERT INTO credit_accounts(environment,clerk_user_id,balance) VALUES('arcade-test',${user},${balance}) ON CONFLICT DO NOTHING`;
}
async function create(user = 'user-a', key = randomUUID()) {
  const id = await createWebsiteGame(user, 'A friendly moon race', 'racing', key);
  const [g] = await context.sql`SELECT * FROM arcade_generations WHERE game_id=${id}`;
  return { id, jobId: String(g.job_id) };
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

describe.skipIf(!enabled)('arcade domain against real PostgreSQL', () => {
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
  it('allows only one active game per user and rejects insufficient credits', async () => {
    await account();
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => create()));
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balance()).toBe(20);
    await account('poor', 0);
    await expect(create('poor')).rejects.toThrow('need 10 credits');
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
  it('supports one retry at the original price and refunds its hold separately', async () => {
    await account();
    const { jobId } = await create();
    await reviewWebsiteGame('admin', jobId, 'approve-input', '', 'Fine');
    await context.sql`UPDATE generation_jobs SET status='failed' WHERE id=${jobId}`;
    await releaseWebsiteCredits(jobId);
    expect(await balance()).toBe(30);
    await context.sql`UPDATE arcade_settings SET price=25`;
    const row = await retryWebsiteGame('user-a', jobId);
    expect(row.attempt).toBe(2);
    expect(await balance()).toBe(20);
    await context.sql`UPDATE generation_jobs SET status='failed' WHERE id=${jobId}`;
    await releaseWebsiteCredits(jobId);
    expect(await balance()).toBe(30);
    await expect(retryWebsiteGame('user-a', jobId)).rejects.toThrow('cannot be retried');
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
    const { id, jobId } = await create();
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
        files: { [`games/${row.state.job!.gameId}/assets/key-art.png`]: 'aGVsbG8=' },
      },
      bundle,
    );
    expect((await getJob(jobId))?.status).toBe('review');
    expect(await getPublicGame(id)).toBeNull();
    expect((await readWebsiteFinal(id))?.files['key-art.png']).toBe('aGVsbG8=');
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
  it('counts only qualified plays, deduplicates replay, excludes creators, and gates deleted games', async () => {
    await account();
    const { id, jobId } = await create();
    await ready(id, jobId);
    expect(await startPlay(id, 'user:user-a', 'user-a')).toBeUndefined();
    const ticket = (await startPlay(id, 'guest:viewer', null))!;
    expect(await finishPlay(id, 'guest:viewer', ticket, null)).toBe(false);
    await context.sql`UPDATE arcade_play_tickets SET created_at=now()-interval '11 seconds' WHERE id=${ticket}`;
    const results = await Promise.all(
      Array.from({ length: 6 }, () => finishPlay(id, 'guest:viewer', ticket, null)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const next = (await startPlay(id, 'guest:viewer', null))!;
    await context.sql`UPDATE arcade_play_tickets SET created_at=now()-interval '11 seconds' WHERE id=${next}`;
    expect(await finishPlay(id, 'guest:viewer', next, null)).toBe(false);
    await manageGame('user-a', id, 'delete');
    expect(await startPlay(id, 'guest:other', null)).toBeUndefined();
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
