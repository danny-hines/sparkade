import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { createLocalPgClient, randomTestSchema } from './pg-sql';
import type { Sql } from '../lib/invites';

const context = vi.hoisted(() => ({ sql: null as unknown as Sql }));
vi.mock('../lib/db', () => ({ getSql: () => context.sql }));
import { acquireSlot, ensureGenerationSchema, releaseSlot } from '../lib/generation/store';

const url = process.env.SPARKADE_PGTEST_URL ?? '';
const enabled =
  process.env.SPARKADE_PGTEST_ALLOW_WRITE === '1' &&
  Boolean(url) &&
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
const schema = randomTestSchema('generation_capacity_test');
let pool: Pool;

beforeAll(async () => {
  if (!enabled) return;
  pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 20 });
  await pool.query(`CREATE SCHEMA ${schema}`);
  context.sql = createLocalPgClient(pool) as Sql;
  await ensureGenerationSchema();
});
beforeEach(async () => {
  if (!enabled) return;
  vi.unstubAllEnvs();
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('SPARKADE_CLOUD_CONCURRENCY', undefined);
  vi.stubEnv('SPARKADE_CLOUD_OWNER_CONCURRENCY', undefined);
  await pool.query('TRUNCATE generation_slots');
});
afterAll(async () => {
  if (pool) {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  }
  vi.unstubAllEnvs();
});

describe.skipIf(!enabled)('cloud capacity against real PostgreSQL', () => {
  it('admits a full image burst and enforces the 128-request owner cap', async () => {
    const groups = await Promise.all(
      ['a', 'b'].map((owner) => Promise.all(Array.from({ length: 132 }, () => acquireSlot(owner)))),
    );
    expect(groups.map((tokens) => tokens.filter(Boolean).length)).toEqual([128, 128]);
    expect(await context.sql`SELECT token FROM generation_slots`).toHaveLength(256);
  });

  it('enforces a configured global cap under contention and reuses released capacity', async () => {
    vi.stubEnv('SPARKADE_CLOUD_CONCURRENCY', '40');
    const tokens = await Promise.all(
      Array.from({ length: 80 }, (_, i) => acquireSlot(`owner-${i % 8}`)),
    );
    expect(tokens.filter(Boolean)).toHaveLength(40);
    expect(await acquireSlot('new-owner')).toBeNull();
    await releaseSlot(tokens.find((token) => token !== null)!);
    expect(await acquireSlot('new-owner')).toEqual(expect.any(String));
    expect(await context.sql`SELECT token FROM generation_slots`).toHaveLength(40);
  });

  it('allows increasing capacity beyond the default without a code ceiling', async () => {
    await pool.query(`INSERT INTO generation_slots(scope,slot,owner,token,expires_at)
      SELECT 'production',n,'existing-owner','token-'||n,now()+interval '5 minutes'
      FROM generate_series(1,1024) n`);
    expect(await acquireSlot('new-owner')).toBeNull();
    vi.stubEnv('SPARKADE_CLOUD_CONCURRENCY', '2048');
    const token = await acquireSlot('new-owner');
    expect(token).toEqual(expect.any(String));
    const rows = await context.sql`SELECT slot FROM generation_slots WHERE token=${token}`;
    expect(rows[0]?.slot).toBe(1025);
  });
});
