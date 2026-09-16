import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sql } from '../lib/invites';
import { createLocalPgClient, randomTestSchema } from './pg-sql';

interface DirectoryUser {
  id: string;
  primaryEmailAddressId: string;
  emailAddresses: { id: string; emailAddress: string }[];
}
const context = vi.hoisted(() => ({
  sql: null as unknown as Sql,
  users: [] as DirectoryUser[],
  list: vi.fn(),
}));
vi.mock('../lib/db', () => ({ getSql: () => context.sql }));
vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({ users: { getUserList: context.list } }),
}));
vi.mock('../lib/admin-auth', () => ({ requireAdminIdentity: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import { requireAdminIdentity } from '../lib/admin-auth';
import { ensureArcadeSchema } from '../lib/arcade';
import { searchAdminAccounts } from '../lib/admin-account-search';
import { accountAdminAction } from '../app/admin/accounts/actions';

const url = process.env.SPARKADE_PGTEST_URL ?? '';
const enabled =
  process.env.SPARKADE_PGTEST_ALLOW_WRITE === '1' &&
  Boolean(url) &&
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
const schema = randomTestSchema('admin_accounts_test');
let pool: Pool;
beforeAll(async () => {
  if (!enabled) return;
  vi.stubEnv('SPARKADE_CREDIT_ENV', 'accounts-test');
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
  await pool.query(
    'TRUNCATE arcade_profiles,credit_accounts,credit_ledger,admin_audit_events CASCADE',
  );
  context.users = [];
  context.list
    .mockReset()
    .mockImplementation(
      async ({ query, userId, limit }: { query?: string; userId?: string[]; limit: number }) => {
        const users = context.users.filter((user) =>
          userId
            ? userId.includes(user.id)
            : user.emailAddresses.some((email) =>
                email.emailAddress.toLowerCase().includes(query ?? ''),
              ),
        );
        return { data: users.slice(0, limit), totalCount: users.length };
      },
    );
  vi.mocked(requireAdminIdentity).mockReset().mockResolvedValue({
    userId: 'admin',
    email: 'admin@example.com',
    displayName: 'Admin',
    authorized: true,
  });
});
async function account(id: string, handle: string, email: string, environment = 'accounts-test') {
  await pool.query('INSERT INTO arcade_profiles(environment,user_id,handle) VALUES($1,$2,$3)', [
    environment,
    id,
    handle,
  ]);
  context.users.push({
    id,
    primaryEmailAddressId: 'primary',
    emailAddresses: [{ id: 'primary', emailAddress: email }],
  });
}
function form(userId: string) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    userId,
    action: 'grant',
    credits: '7',
    reason: 'Testing account selection',
    key: randomUUID(),
  }))
    form.set(key, value);
  return form;
}

describe.skipIf(!enabled)('account lookup and mutations against PostgreSQL', () => {
  it('finds the current username case-insensitively, including profiles older than the latest 100', async () => {
    await account('old', 'moon_pilot', 'old@example.com');
    await pool.query("UPDATE arcade_profiles SET created_at=now()-interval '1 year'");
    await pool.query(
      "INSERT INTO arcade_profiles(environment,user_id,handle) SELECT 'accounts-test','recent-'||n,'recent-'||n FROM generate_series(1,110) n",
    );
    await pool.query(
      "INSERT INTO credit_accounts(environment,clerk_user_id,balance) VALUES('accounts-test','old',23)",
    );
    await pool.query("UPDATE arcade_profiles SET suspended=true WHERE user_id='old'");
    expect(await searchAdminAccounts(' @MOON_ ')).toEqual({
      accounts: [
        {
          userId: 'old',
          handle: 'moon_pilot',
          email: 'old@example.com',
          balance: 23,
          suspended: true,
        },
      ],
      more: false,
    });
  });
  it('finds primary and secondary email addresses while excluding other environments and non-profile users', async () => {
    await account('one', 'pilot', 'first@example.com');
    context.users[0].emailAddresses.push({ id: 'secondary', emailAddress: 'Matching@Example.com' });
    await account('other', 'other-env', 'matching-other@example.com', 'elsewhere');
    context.users.push({
      id: 'no-profile',
      primaryEmailAddressId: 'primary',
      emailAddresses: [{ id: 'primary', emailAddress: 'matching-new@example.com' }],
    });
    expect((await searchAdminAccounts('MATCHING')).accounts).toEqual([
      {
        userId: 'one',
        handle: 'pilot',
        email: 'Matching@Example.com',
        balance: 0,
        suspended: false,
      },
    ]);
    expect((await searchAdminAccounts('first@example.com')).accounts[0].userId).toBe('one');
  });
  it('deduplicates username/email matches, ranks exact matches first, and treats wildcard characters literally', async () => {
    await account('substring', 'x-pilot', 'x@example.com');
    await account('exact', 'pilot', 'pilot@example.com');
    await account('prefix', 'pilot-two', 'two@example.com');
    expect((await searchAdminAccounts('pilot')).accounts.map((account) => account.userId)).toEqual([
      'exact',
      'prefix',
      'substring',
    ]);
    expect((await searchAdminAccounts('%_')).accounts).toEqual([]);
  });
  it('excludes stale Clerk profiles and unrelated directory name matches', async () => {
    await account('deleted', 'pilot', 'deleted@example.com');
    context.users = [];
    expect((await searchAdminAccounts('pilot')).accounts).toEqual([]);
    await account('name-only', 'racer', 'racer@example.com');
    context.list.mockResolvedValue({ data: context.users, totalCount: 1 });
    expect((await searchAdminAccounts('pilot')).accounts).toEqual([]);
  });
  it('limits broad results and asks the admin to refine them', async () => {
    for (let i = 0; i < 12; i++)
      await account(`user-${i}`, `pilot-${i}`, `person-${i}@example.com`);
    const result = await searchAdminAccounts('pilot');
    expect(result.accounts).toHaveLength(10);
    expect(result.more).toBe(true);
    expect(context.list).toHaveBeenCalledTimes(2); // One search plus one batched email hydration.
  });
  it('never reads the directory for a short query', async () => {
    expect(await searchAdminAccounts('@a')).toEqual({ accounts: [], more: false });
    expect(context.list).not.toHaveBeenCalled();
  });
  it('requires authorization on account updates', async () => {
    vi.mocked(requireAdminIdentity).mockRejectedValue(new Error('Access denied'));
    await expect(accountAdminAction(form('arbitrary'))).rejects.toThrow('Access denied');
    expect((await pool.query('SELECT * FROM credit_ledger')).rows).toEqual([]);
  });
  it('rejects absent, fabricated, and other-environment IDs without creating profiles or credits', async () => {
    await account('other', 'other-user', 'other@example.com', 'elsewhere');
    for (const userId of ['', 'fabricated', 'other']) {
      await expect(accountAdminAction(form(userId))).rejects.toThrow(
        'REDIRECT:/admin/accounts?tone=error',
      );
    }
    expect((await pool.query('SELECT * FROM credit_ledger')).rows).toEqual([]);
    expect(
      (await pool.query("SELECT * FROM arcade_profiles WHERE environment='accounts-test'")).rows,
    ).toEqual([]);
    expect((await pool.query('SELECT * FROM admin_audit_events')).rows).toEqual([]);
  });
  it('grants only the selected account once, and preserves the audit reason', async () => {
    await account('chosen', 'chosen-user', 'chosen@example.com');
    await account('other', 'other-user', 'other@example.com');
    const data = form('chosen');
    for (let i = 0; i < 2; i++)
      await expect(accountAdminAction(data)).rejects.toThrow(
        'REDIRECT:/admin/accounts?notice=Account+updated',
      );
    expect((await pool.query('SELECT clerk_user_id,balance FROM credit_accounts')).rows).toEqual([
      { clerk_user_id: 'chosen', balance: 7 },
    ]);
    expect(
      (await pool.query('SELECT target_id,details_json FROM admin_audit_events')).rows,
    ).toEqual([
      { target_id: 'chosen', details_json: { amount: 7, reason: 'Testing account selection' } },
    ]);
  });
});
