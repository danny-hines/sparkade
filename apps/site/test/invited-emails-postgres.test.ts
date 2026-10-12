import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sql } from '../lib/invites';
import { createLocalPgClient, randomTestSchema } from './pg-sql';

const context = vi.hoisted(() => ({ sql: null as unknown as Sql }));
vi.mock('../lib/db', () => ({ getSql: () => context.sql }));
import { ensureArcadeSchema } from '../lib/arcade';
import {
  addInvitedEmails,
  findInvitedEmails,
  listInvitedEmails,
  removeInvitedEmail,
} from '../lib/invited-emails';

const url = process.env.SPARKADE_PGTEST_URL ?? '';
const enabled =
  process.env.SPARKADE_PGTEST_ALLOW_WRITE === '1' &&
  Boolean(url) &&
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
const schema = randomTestSchema('invited_emails_test');
let pool: Pool;
beforeAll(async () => {
  if (!enabled) return;
  vi.stubEnv('SPARKADE_CREDIT_ENV', 'access-test');
  pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public` });
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
  vi.stubEnv('SPARKADE_CREDIT_ENV', 'access-test');
  await pool.query('TRUNCATE site_access_emails,admin_audit_events');
});

describe.skipIf(!enabled)('invite list against PostgreSQL', () => {
  it('adds each address once, audits only new invites, and matches case-insensitively', async () => {
    expect(await addInvitedEmails(['a@example.test', 'b@example.test'], 'admin')).toEqual(
      expect.arrayContaining(['a@example.test', 'b@example.test']),
    );
    expect(await addInvitedEmails(['b@example.test', 'c@example.test'], 'admin')).toEqual([
      'c@example.test',
    ]);
    expect((await listInvitedEmails()).map((entry) => entry.email)).toEqual([
      'a@example.test',
      'b@example.test',
      'c@example.test',
    ]);
    expect(await findInvitedEmails(['B@Example.test', 'z@example.test'])).toEqual([
      'b@example.test',
    ]);
    const { rows } = await pool.query(
      "SELECT target_id FROM admin_audit_events WHERE action='access-invite' ORDER BY target_id",
    );
    expect(rows.map((row) => row.target_id)).toEqual([
      'a@example.test',
      'b@example.test',
      'c@example.test',
    ]);
  });

  it('keeps preview and production invite lists separate', async () => {
    await addInvitedEmails(['a@example.test'], 'admin');
    vi.stubEnv('SPARKADE_CREDIT_ENV', 'other-environment');
    expect(await findInvitedEmails(['a@example.test'])).toEqual([]);
  });

  it('removes an invite with an audit record and reports unknown addresses', async () => {
    await addInvitedEmails(['a@example.test'], 'admin');
    expect(await removeInvitedEmail('a@example.test', 'admin')).toBe(true);
    expect(await removeInvitedEmail('a@example.test', 'admin')).toBe(false);
    expect(await findInvitedEmails(['a@example.test'])).toEqual([]);
    const { rows } = await pool.query(
      "SELECT actor_user_id,target_id FROM admin_audit_events WHERE action='access-remove'",
    );
    expect(rows).toEqual([{ actor_user_id: 'admin', target_id: 'a@example.test' }]);
  });

  it('refuses mixed-case rows at the database layer', async () => {
    await expect(
      pool.query(
        "INSERT INTO site_access_emails(environment,email,invited_by_user_id) VALUES('access-test','A@example.test','admin')",
      ),
    ).rejects.toThrow();
  });
});
