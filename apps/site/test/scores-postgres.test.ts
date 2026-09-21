import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import type { Sql } from '../lib/invites';
import { createLocalPgClient, randomTestSchema } from './pg-sql';

const context = vi.hoisted(() => ({ sql: null as unknown as Sql }));
vi.mock('../lib/db', () => ({ getSql: () => context.sql }));
import { ensureArcadeSchema } from '../lib/arcade-schema';
import { addScore, topScores } from '../lib/scores';

const url = process.env.SPARKADE_PGTEST_URL ?? '';
const enabled =
  process.env.SPARKADE_PGTEST_ALLOW_WRITE === '1' &&
  Boolean(url) &&
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
const schema = randomTestSchema('scores_test');
let pool: Pool;

beforeAll(async () => {
  if (!enabled) return;
  vi.stubEnv('SPARKADE_CREDIT_ENV', 'scores-test');
  pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public` });
  await pool.query(`CREATE SCHEMA ${schema}`);
  context.sql = createLocalPgClient(pool) as Sql;
  await ensureArcadeSchema();
  await pool.query(`INSERT INTO public_games(id,source_id,status) VALUES
    ('7kmp2qx','scores-test-a','ready'),('dp7js5d','scores-test-b','ready')`);
});
beforeEach(async () => {
  if (!enabled) return;
  vi.stubEnv('SPARKADE_CREDIT_ENV', 'scores-test');
  await pool.query('TRUNCATE arcade_scores');
});
afterAll(async () => {
  if (pool) {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  }
  vi.unstubAllEnvs();
});

describe.skipIf(!enabled)('persisted high scores against PostgreSQL', () => {
  it('stores scores and reads only the highest 10, with stable ties', async () => {
    expect(await topScores('7kmp2qx')).toEqual([]);
    for (let score = 100; score <= 1200; score += 100) await addScore('7kmp2qx', 'ABC', score);
    const board = await addScore('7kmp2qx', 'DEF', 1200);
    expect(board).toHaveLength(10);
    expect(board.slice(0, 2).map((row) => row.initials)).toEqual(['ABC', 'DEF']);
    expect(board.map((row) => row.score)).toEqual([
      1200, 1200, 1100, 1000, 900, 800, 700, 600, 500, 400,
    ]);
    expect(board[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await topScores('7kmp2qx')).toEqual(board);
    expect(
      (await pool.query('SELECT count(*)::int AS count FROM arcade_scores')).rows[0].count,
    ).toBe(13);
  });

  it('isolates games and environments', async () => {
    await addScore('7kmp2qx', 'ONE', 100);
    await addScore('dp7js5d', 'TWO', 200);
    vi.stubEnv('SPARKADE_CREDIT_ENV', 'other-test');
    expect(await topScores('7kmp2qx')).toEqual([]);
    await addScore('7kmp2qx', 'ALT', 9999);
    vi.stubEnv('SPARKADE_CREDIT_ENV', 'scores-test');
    expect((await topScores('7kmp2qx')).map((row) => row.initials)).toEqual(['ONE']);
    expect((await topScores('dp7js5d')).map((row) => row.initials)).toEqual(['TWO']);
  });

  it('rejects invalid scores at the database boundary', async () => {
    await expect(addScore('7kmp2qx', 'ABC', -1)).rejects.toThrow();
    await expect(addScore('7kmp2qx', 'ABC', 100_000_000)).rejects.toThrow();
    await expect(addScore('7kmp2qx', 'TOO LONG', 10)).rejects.toThrow();
    expect(await topScores('7kmp2qx')).toEqual([]);
  });
});
