import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bindSignupAttempt, finishSignup, getAccountSignup, limitSignupRequests,
  readSignupAttempt, SignupRateLimitError, startSignupAttempt, type SignupIdentity,
} from '../lib/signup';
import {
  checkCreditConsistency,
  createCreditInvite,
  ensureCreditSchema,
  getCreditBalance,
  getCreditInvite,
  InviteAlreadyClaimedError,
  InviteExpiredError,
  InviteFullError,
  InviteRevokedError,
  lookupInviteOffer,
  redeemInviteCredit,
  revokeCreditInvite,
  updateCreditInvite,
  type InviteReceipt,
  type Sql,
} from '../lib/invites';
import {
  assertSafeSchemaName,
  createLocalPgClient,
  randomTestSchema,
  type PgPoolLike,
} from './pg-sql';

// GENUINE PostgreSQL checks. Enabled ONLY with an explicit loopback scratch
// database URL plus the write opt-in:
//
//   SPARKADE_PGTEST_URL=postgresql://postgres@127.0.0.1:55439/sparkade_invite_test \
//   SPARKADE_PGTEST_ALLOW_WRITE=1 npx vitest run apps/site/test/invites-postgres.test.ts
//
// Each run creates one randomly named schema, confines every pool/client
// connection to it via search_path, and afterwards drops ONLY that schema.
// The app DATABASE_URL is never read or used here. Without the opt-in the
// suite collects and skips cleanly (no database, no extra dependencies).
//
// Mock-only tests live in test/invites.test.ts and prove branch logic, not
// concurrency. The races below run the actual domain through real SQL.

interface PgTestClient {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  connect: () => Promise<void>;
  end: () => Promise<void>;
}

interface PgModuleShape {
  Pool: new (config: Record<string, unknown>) => PgPoolLike;
  Client: new (config: Record<string, unknown>) => PgTestClient;
}

const requireFromRepo = createRequire(import.meta.url);

function loadPg(): PgModuleShape {
  try {
    return requireFromRepo('pg') as PgModuleShape;
  } catch {
    throw new Error(
      'The pg devDependency is not installed; run: npm install -w @sparkade/site --save-dev pg @types/pg',
    );
  }
}

const PGTEST_URL = process.env.SPARKADE_PGTEST_URL ?? '';

function scratchUrlError(): string | null {
  if (!PGTEST_URL) return 'SPARKADE_PGTEST_URL is not set (explicit loopback scratch URL required)';
  if (process.env.SPARKADE_PGTEST_ALLOW_WRITE !== '1') return 'SPARKADE_PGTEST_ALLOW_WRITE!=1';
  let host: string;
  try {
    host = new URL(PGTEST_URL).hostname;
  } catch {
    return 'unparseable test URL';
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) return `non-loopback host ${host}`;
  if (/prod|neon|vercel|amazonaws|cloud|supabase/i.test(PGTEST_URL)) {
    return 'URL looks like shared/cloud infrastructure';
  }
  return null;
}

const skipReason = scratchUrlError();
if (skipReason) console.log(`Postgres invite checks skipped (${skipReason}).`);

const SCHEMA = randomTestSchema();
const CONNECTION_OPTIONS = `-c search_path=${SCHEMA} -c statement_timeout=30s`;

let pool: PgPoolLike | null = null;
let pgLib: PgModuleShape | null = null;
let sql: Sql;

beforeAll(async () => {
  if (skipReason) return;
  if (!process.env.SPARKADE_INVITE_CODE_SECRET) {
    process.env.SPARKADE_INVITE_CODE_SECRET = 'test-harness-only-secret-32-chars-minimum-ok';
  }
  assertSafeSchemaName(SCHEMA);
  pgLib = loadPg();
  pool = new pgLib.Pool({
    connectionString: PGTEST_URL,
    connectionTimeoutMillis: 10_000,
    options: CONNECTION_OPTIONS,
  });
  sql = createLocalPgClient(pool) as unknown as Sql;
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  await ensureCreditSchema(sql);
}, 60_000);

afterAll(async () => {
  if (skipReason || !pool) return;
  try {
    // Cleanup is confined to this run's schema; nothing else is touched.
    assertSafeSchemaName(SCHEMA);
    await pool.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
  } finally {
    await pool.end();
  }
}, 60_000);

function requirePool(): PgPoolLike {
  if (!pool) throw new Error('Postgres pool is not initialized');
  return pool;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!!skipReason)('invite domain against real PostgreSQL', () => {
  it('creates the credit tables through real query execution', async () => {
    const rows = (await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = ${SCHEMA}
        AND table_name IN ('credit_accounts', 'credit_invites', 'credit_ledger', 'invite_redemptions', 'admin_audit_events')
    `) as { table_name: string }[];
    expect(rows.map((row) => row.table_name).sort()).toEqual(
      ['admin_audit_events', 'credit_accounts', 'credit_invites', 'credit_ledger', 'invite_redemptions'].sort(),
    );
  });

  it('caps concurrent claims at the recipient limit with consistent books', async () => {
    const created = await createCreditInvite(
      { label: 'race', creditsPerRecipient: 30, maxRecipients: 5, createdByUserId: 'admin-1', environment: 'pgtest-race' },
      sql,
    );
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        redeemInviteCredit(
          { code: created.code, clerkUserId: `racer-${index}`, emailVerified: true, isNewAccount: true, environment: 'pgtest-race' },
          sql,
        ),
      ),
    );
    const granted = attempts.filter((result) => result.status === 'fulfilled');
    const rejected = attempts.filter((result) => result.status === 'rejected');
    expect(granted).toHaveLength(5);
    expect(rejected).toHaveLength(15);
    for (const result of rejected) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(InviteFullError);
    }
    // Winners are whoever the database admitted — assert on them, not on a guess.
    for (const result of granted) {
      const receipt = (result as PromiseFulfilledResult<{ balanceAfter: number; amountCredits: number }>).value;
      expect(receipt.amountCredits).toBe(30);
      expect(receipt.balanceAfter).toBe(30);
    }
    const detail = await getCreditInvite(created.invite.id, { environment: 'pgtest-race' }, sql);
    expect(detail?.redeemedCount).toBe(5);
    expect(detail?.totalCreditsIssued).toBe(150);
    expect(detail?.status).toBe('exhausted');
    expect(await checkCreditConsistency('pgtest-race', sql)).toEqual([]);
  }, 60_000);

  it('grants concurrent duplicate same-code claims exactly once', async () => {
    const created = await createCreditInvite(
      { label: 'dedupe', creditsPerRecipient: 30, maxRecipients: 5, createdByUserId: 'admin-1', environment: 'pgtest-dedupe' },
      sql,
    );
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        redeemInviteCredit(
          { code: created.code, clerkUserId: 'dedupe-user', emailVerified: true, isNewAccount: true, environment: 'pgtest-dedupe' },
          sql,
        ),
      ),
    );
    expect(attempts.every((result) => result.status === 'fulfilled')).toBe(true);
    const ids = new Set(
      attempts.map((result) => (result as PromiseFulfilledResult<InviteReceipt>).value.redemptionId),
    );
    expect(ids.size).toBe(1);
    const detail = await getCreditInvite(created.invite.id, { environment: 'pgtest-dedupe' }, sql);
    expect(detail?.redeemedCount).toBe(1);
    expect(await getCreditBalance('dedupe-user', 'pgtest-dedupe', sql)).toBe(30);
    expect(await checkCreditConsistency('pgtest-dedupe', sql)).toEqual([]);
  }, 60_000);

  it('allows one bonus per account across codes even when simultaneous', async () => {
    const first = await createCreditInvite(
      { label: 'cross-a', creditsPerRecipient: 30, maxRecipients: 10, createdByUserId: 'admin-1', environment: 'pgtest-cross' },
      sql,
    );
    const second = await createCreditInvite(
      { label: 'cross-b', creditsPerRecipient: 30, maxRecipients: 10, createdByUserId: 'admin-1', environment: 'pgtest-cross' },
      sql,
    );
    const [a, b] = await Promise.allSettled([
      redeemInviteCredit({ code: first.code, clerkUserId: 'cross-user', emailVerified: true, isNewAccount: true, environment: 'pgtest-cross' }, sql),
      redeemInviteCredit({ code: second.code, clerkUserId: 'cross-user', emailVerified: true, isNewAccount: true, environment: 'pgtest-cross' }, sql),
    ]);
    const fulfilled = [a, b].filter((result) => result.status === 'fulfilled');
    const rejected = [a, b].filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InviteAlreadyClaimedError);
    expect(await getCreditBalance('cross-user', 'pgtest-cross', sql)).toBe(30);
    expect(await checkCreditConsistency('pgtest-cross', sql)).toEqual([]);
  }, 60_000);

  it('returns the existing receipt on repeat even after revocation, without new-account eligibility', async () => {
    const created = await createCreditInvite(
      { label: 'repeat', creditsPerRecipient: 30, maxRecipients: 3, createdByUserId: 'admin-1', environment: 'pgtest-repeat' },
      sql,
    );
    const first = await redeemInviteCredit(
      { code: created.code, clerkUserId: 'repeat-user', emailVerified: true, isNewAccount: true, environment: 'pgtest-repeat' },
      sql,
    );
    await revokeCreditInvite({ id: created.invite.id, actorUserId: 'admin-1', reason: 'test cleanup', environment: 'pgtest-repeat' }, sql);
    const retry = await redeemInviteCredit(
      { code: created.code, clerkUserId: 'repeat-user', emailVerified: false, isNewAccount: false, environment: 'pgtest-repeat' },
      sql,
    );
    expect(retry.redemptionId).toBe(first.redemptionId);
    expect(retry.balanceAfter).toBe(30);
    expect(await getCreditBalance('repeat-user', 'pgtest-repeat', sql)).toBe(30);
  }, 60_000);

  it('denies a revoked invite for a brand-new user', async () => {
    const created = await createCreditInvite(
      { label: 'revoked-new', creditsPerRecipient: 30, maxRecipients: 3, createdByUserId: 'admin-1', environment: 'pgtest-revoked' },
      sql,
    );
    await revokeCreditInvite({ id: created.invite.id, actorUserId: 'admin-1', reason: 'test', environment: 'pgtest-revoked' }, sql);
    await expect(
      redeemInviteCredit({ code: created.code, clerkUserId: 'revoked-new-user', emailVerified: true, isNewAccount: true, environment: 'pgtest-revoked' }, sql),
    ).rejects.toThrow(InviteRevokedError);
    expect(await getCreditBalance('revoked-new-user', 'pgtest-revoked', sql)).toBe(0);
    expect(await checkCreditConsistency('pgtest-revoked', sql)).toEqual([]);
  }, 60_000);

  it('denies a claim when the invite expires while the claim waits on the row lock', async () => {
    if (!pgLib) throw new Error('Postgres module is not initialized');
    const created = await createCreditInvite(
      { label: 'expiry-race', creditsPerRecipient: 30, maxRecipients: 3, createdByUserId: 'admin-1', environment: 'pgtest-expiryrace' },
      sql,
    );
    // Near-future expiry is committed BEFORE the holder takes the row lock,
    // so the claim below must observe it after its lock wait.
    await requirePool().query(
      "UPDATE credit_invites SET expires_at = clock_timestamp() + INTERVAL '1.2 seconds' WHERE id = $1",
      [created.invite.id],
    );
    const holder = new pgLib.Client({ connectionString: PGTEST_URL, options: CONNECTION_OPTIONS });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM credit_invites WHERE id = $1 FOR UPDATE', [created.invite.id]);
      // Launch immediately with a rejection handler attached: the claim
      // blocks on the holder's row lock past the 1.2s expiry.
      const settled = redeemInviteCredit(
        { code: created.code, clerkUserId: 'blocked-user', emailVerified: true, isNewAccount: true, environment: 'pgtest-expiryrace' },
        sql,
      ).then(
        (receipt) => ({ granted: true as const, receipt }),
        (error: unknown) => ({ granted: false as const, error }),
      );
      await sleep(2200);
      // Release the pure row lock WITHOUT changing the row.
      await holder.query('COMMIT');
      const outcome = await settled;
      expect(outcome.granted).toBe(false);
      if (!outcome.granted) expect(outcome.error).toBeInstanceOf(InviteExpiredError);
    } finally {
      try {
        await holder.query('ROLLBACK');
      } catch {
        // Already committed on the success path.
      }
      try {
        await holder.end();
      } catch {
        // Already closed; cleanup must not mask the assertion.
      }
    }
    expect(await getCreditBalance('blocked-user', 'pgtest-expiryrace', sql)).toBe(0);
    expect(await checkCreditConsistency('pgtest-expiryrace', sql)).toEqual([]);
  }, 60_000);

  it('enforces the exact expiry boundary with database time', async () => {
    const created = await createCreditInvite(
      { label: 'expiry', creditsPerRecipient: 30, maxRecipients: 3, createdByUserId: 'admin-1', environment: 'pgtest-expiry' },
      sql,
    );
    await requirePool().query(
      "UPDATE credit_invites SET expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id = $1",
      [created.invite.id],
    );
    await expect(
      redeemInviteCredit({ code: created.code, clerkUserId: 'late-user', emailVerified: true, isNewAccount: true, environment: 'pgtest-expiry' }, sql),
    ).rejects.toThrow(InviteExpiredError);
    const offer = await lookupInviteOffer(created.code, 'pgtest-expiry', sql);
    expect(offer.status).toBe('expired');
    expect(offer.valid).toBe(false);
    expect(await getCreditBalance('late-user', 'pgtest-expiry', sql)).toBe(0);
  }, 60_000);

  it('floors capacity at completed redemptions but allows increases and revoke on exhausted invites', async () => {
    const created = await createCreditInvite(
      { label: 'capacity', creditsPerRecipient: 30, maxRecipients: 4, createdByUserId: 'admin-1', environment: 'pgtest-cap' },
      sql,
    );
    await redeemInviteCredit({ code: created.code, clerkUserId: 'cap-1', emailVerified: true, isNewAccount: true, environment: 'pgtest-cap' }, sql);
    await redeemInviteCredit({ code: created.code, clerkUserId: 'cap-2', emailVerified: true, isNewAccount: true, environment: 'pgtest-cap' }, sql);
    await expect(
      updateCreditInvite({ id: created.invite.id, actorUserId: 'admin-1', maxRecipients: 1, environment: 'pgtest-cap' }, sql),
    ).rejects.toThrow(/below 2 completed/);
    const lowered = await updateCreditInvite({ id: created.invite.id, actorUserId: 'admin-1', maxRecipients: 2, environment: 'pgtest-cap' }, sql);
    expect(lowered.status).toBe('exhausted');
    await expect(
      redeemInviteCredit({ code: created.code, clerkUserId: 'cap-3', emailVerified: true, isNewAccount: true, environment: 'pgtest-cap' }, sql),
    ).rejects.toThrow(InviteFullError);
    const raised = await updateCreditInvite({ id: created.invite.id, actorUserId: 'admin-1', maxRecipients: 3, environment: 'pgtest-cap' }, sql);
    expect(raised.status).toBe('active');
    const third = await redeemInviteCredit({ code: created.code, clerkUserId: 'cap-3', emailVerified: true, isNewAccount: true, environment: 'pgtest-cap' }, sql);
    expect(third.amountCredits).toBe(30);
    const revoked = await revokeCreditInvite({ id: created.invite.id, actorUserId: 'admin-1', reason: 'test done', environment: 'pgtest-cap' }, sql);
    expect(revoked.status).toBe('revoked');
    expect(await checkCreditConsistency('pgtest-cap', sql)).toEqual([]);
  }, 60_000);

  it('records success and denial audits with truthful outcomes', async () => {
    const created = await createCreditInvite(
      { label: 'audit', creditsPerRecipient: 30, maxRecipients: 2, createdByUserId: 'admin-1', environment: 'pgtest-audit' },
      sql,
    );
    const rows = (await sql`
      SELECT action, details_json FROM admin_audit_events
      WHERE environment = 'pgtest-audit' AND target_id = ${created.invite.id}
      ORDER BY created_at ASC
    `) as { action: string; details_json: { outcome?: string } | string }[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.action).toBe('invite.create');
    const firstDetails = typeof rows[0]?.details_json === 'string' ? JSON.parse(rows[0].details_json) : rows[0]?.details_json;
    expect(firstDetails.outcome).toBe('success');
    await redeemInviteCredit({ code: created.code, clerkUserId: 'audit-1', emailVerified: true, isNewAccount: true, environment: 'pgtest-audit' }, sql);
    await redeemInviteCredit({ code: created.code, clerkUserId: 'audit-2', emailVerified: true, isNewAccount: true, environment: 'pgtest-audit' }, sql);
    // A successful partial update audits only the supplied field with a
    // top-level success outcome — no stale before snapshot.
    const raised = await updateCreditInvite({ id: created.invite.id, actorUserId: 'admin-1', maxRecipients: 3, environment: 'pgtest-audit' }, sql);
    expect(raised.maxRecipients).toBe(3);
    const successUpdates = (await sql`
      SELECT details_json FROM admin_audit_events
      WHERE environment = 'pgtest-audit' AND target_id = ${created.invite.id}
        AND action = 'invite.update' AND details_json ->> 'outcome' = 'success'
      LIMIT 1
    `) as { details_json: { outcome?: string; changes?: Record<string, unknown>; result?: Record<string, unknown> } | string }[];
    expect(successUpdates.length).toBe(1);
    const payload = typeof successUpdates[0]?.details_json === 'string'
      ? JSON.parse(successUpdates[0].details_json)
      : successUpdates[0]?.details_json;
    expect(payload.outcome).toBe('success');
    expect(payload.changes).toEqual({ maxRecipients: 3 });
    expect(payload).not.toHaveProperty('before');
    expect(payload.result).toMatchObject({ maxRecipients: 3 });
    // A floor violation (below 2 completed redemptions) records a denied audit.
    await expect(
      updateCreditInvite({ id: created.invite.id, actorUserId: 'admin-1', maxRecipients: 1, environment: 'pgtest-audit' }, sql),
    ).rejects.toThrow(/below 2 completed/);
    const denied = (await sql`
      SELECT details_json FROM admin_audit_events
      WHERE environment = 'pgtest-audit' AND target_id = ${created.invite.id}
        AND details_json ->> 'outcome' = 'denied'
      LIMIT 1
    `) as { details_json: unknown }[];
    expect(denied.length).toBe(1);
  }, 60_000);

  it('starts signup balances at zero and isolates environments', async () => {
    expect(await getCreditBalance('nobody', 'pgtest-zero', sql)).toBe(0);
    const created = await createCreditInvite(
      { label: 'iso', creditsPerRecipient: 30, maxRecipients: 2, createdByUserId: 'admin-1', environment: 'pgtest-iso-a' },
      sql,
    );
    await redeemInviteCredit({ code: created.code, clerkUserId: 'iso-user', emailVerified: true, isNewAccount: true, environment: 'pgtest-iso-a' }, sql);
    expect(await getCreditBalance('iso-user', 'pgtest-iso-a', sql)).toBe(30);
    expect(await getCreditBalance('iso-user', 'pgtest-iso-b', sql)).toBe(0);
  }, 60_000);
});

describe.skipIf(!!skipReason)('signup finalization against real PostgreSQL', () => {
  let sequence = 0;
  async function newAccountTimestamp() {
    // Simulate Clerk creating the account AFTER the persisted intent, without
    // assuming the Docker VM and host clocks agree to the millisecond.
    const rows = await sql`SELECT extract(epoch FROM clock_timestamp()) * 1000 AS ms`;
    return Math.ceil(Number(rows[0].ms));
  }
  async function setupSignup() {
    const env = `signup-${++sequence}`;
    const invite = await createCreditInvite({ label: env, createdByUserId: 'admin', environment: env }, sql);
    const token = await startSignupAttempt(invite.code, '/create', env, sql);
    const identity: SignupIdentity = { userId: `user-${sequence}`, createdAt: await newAccountTimestamp(), emailVerified: true };
    return { env, invite, token, identity };
  }

  it('retains encrypted intent without reserving a slot, then grants once across concurrent callbacks', async () => {
    const { env, invite, token, identity } = await setupSignup();
    const attempt = await readSignupAttempt(token, env, sql);
    expect(attempt?.code).toBe(invite.code);
    expect(attempt?.id).not.toBe(token);
    const rows = await sql`SELECT code_cipher FROM credit_signup_attempts WHERE id = ${attempt!.id}`;
    expect(rows[0].code_cipher).not.toContain(invite.code);
    expect((await getCreditInvite(invite.invite.id, { environment: env }, sql))?.redeemedCount).toBe(0);
    const results = await Promise.all(Array.from({ length: 8 }, () => finishSignup(identity, token, { kind: 'redeem' }, env, sql)));
    expect(results.every((result) => result.status === 'credited' && result.balance === 30)).toBe(true);
    expect((await getAccountSignup(identity.userId, env, sql))?.status).toBe('credited');
    expect((await getCreditInvite(invite.invite.id, { environment: env }, sql))?.redeemedCount).toBe(1);
    expect(await checkCreditConsistency(env, sql)).toEqual([]);
  });

  it('rejects existing accounts and attempts belonging to a different account or environment', async () => {
    const { env, token, identity } = await setupSignup();
    expect((await finishSignup({ ...identity, createdAt: Date.now() - 60_000 }, token, { kind: 'redeem' }, env, sql)).status).toBe('ineligible');
    expect(await bindSignupAttempt(identity, token, 'wrong-environment', sql)).toBeNull();
    await bindSignupAttempt(identity, token, env, sql);
    expect(await bindSignupAttempt({ ...identity, userId: 'other-user' }, token, env, sql)).toBeNull();
    expect(await getCreditBalance(identity.userId, env, sql)).toBe(0);
  });

  it('requires verified primary email and recovers a bound pending offer without the cookie', async () => {
    const { env, token, identity } = await setupSignup();
    await expect(finishSignup({ ...identity, emailVerified: false }, token, { kind: 'redeem' }, env, sql)).rejects.toThrow('Verify your primary email');
    expect((await getAccountSignup(identity.userId, env, sql))?.status).toBe('pending');
    expect((await finishSignup(identity, undefined, { kind: 'redeem' }, env, sql)).balance).toBe(30);
  });

  it('does not allow two pending attempts per account or a second bonus', async () => {
    const { env, token, identity } = await setupSignup();
    const second = await createCreditInvite({ label: 'second', createdByUserId: 'admin', environment: env, creditsPerRecipient: 50 }, sql);
    const token2 = await startSignupAttempt(second.code, '/me', env, sql);
    identity.createdAt = await newAccountTimestamp();
    const bindings = await Promise.all([bindSignupAttempt(identity, token, env, sql), bindSignupAttempt(identity, token2, env, sql)]);
    expect(bindings[0]?.id).toBe(bindings[1]?.id);
    const first = await finishSignup(identity, token, { kind: 'redeem' }, env, sql);
    const replay = await finishSignup(identity, token2, { kind: 'replace', code: second.code }, env, sql);
    expect(replay.balance).toBe(first.balance);
    expect(await checkCreditConsistency(env, sql)).toEqual([]);
  });

  it('starts no-invite accounts at zero and permanently declines an invite when explicitly requested', async () => {
    const { env, token, identity } = await setupSignup();
    expect((await finishSignup(identity, token, { kind: 'zero' }, env, sql)).status).toBe('zero');
    expect((await finishSignup(identity, token, { kind: 'redeem' }, env, sql)).balance).toBe(0);
    const zeroToken = await startSignupAttempt('', '/me', env, sql);
    const result = await finishSignup({ ...identity, userId: 'zero-user', createdAt: await newAccountTimestamp() }, zeroToken, { kind: 'redeem' }, env, sql);
    expect(result).toMatchObject({ status: 'zero', balance: 0, creditsAdded: 0 });
  });

  it('allows replacement after an invite expires between signup and verification', async () => {
    const { env, token, identity, invite } = await setupSignup();
    await sql`UPDATE credit_invites SET expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id = ${invite.invite.id}`;
    await expect(finishSignup(identity, token, { kind: 'redeem' }, env, sql)).rejects.toThrow('expired');
    expect((await getAccountSignup(identity.userId, env, sql))?.status).toBe('pending');
    const replacement = await createCreditInvite({ label: 'replacement', createdByUserId: 'admin', environment: env, creditsPerRecipient: 40 }, sql);
    expect((await finishSignup(identity, undefined, { kind: 'replace', code: replacement.code }, env, sql)).balance).toBe(40);
    expect((await getCreditInvite(invite.invite.id, { environment: env }, sql))?.redeemedCount).toBe(0);
  });

  it('expires attempts before binding and prevents a bound expired attempt from granting', async () => {
    const { env, token, identity } = await setupSignup();
    const attempt = await readSignupAttempt(token, env, sql);
    await sql`UPDATE credit_signup_attempts SET expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id = ${attempt!.id}`;
    expect(await bindSignupAttempt(identity, token, env, sql)).toBeNull();
    await sql`UPDATE credit_signup_attempts SET clerk_user_id = ${identity.userId} WHERE id = ${attempt!.id}`;
    await expect(finishSignup(identity, token, { kind: 'redeem' }, env, sql)).rejects.toThrow('expired');
    expect((await finishSignup(identity, token, { kind: 'zero' }, env, sql)).status).toBe('zero');
  });

  it('serializes declining the offer with a concurrent grant', async () => {
    for (let i = 0; i < 4; i++) {
      const { env, token, identity, invite } = await setupSignup();
      await bindSignupAttempt(identity, token, env, sql);
      await Promise.allSettled([
        finishSignup(identity, token, { kind: 'redeem' }, env, sql),
        finishSignup(identity, token, { kind: 'zero' }, env, sql),
      ]);
      const state = await getAccountSignup(identity.userId, env, sql);
      const balance = await getCreditBalance(identity.userId, env, sql);
      expect(['credited', 'zero']).toContain(state?.status);
      expect(balance).toBe(state?.status === 'credited' ? 30 : 0);
      expect((await getCreditInvite(invite.invite.id, { environment: env }, sql))?.redeemedCount).toBe(balance ? 1 : 0);
      expect(await checkCreditConsistency(env, sql)).toEqual([]);
    }
  });

  it('serializes code replacement with an in-flight grant without a second bonus', async () => {
    const { env, token, identity } = await setupSignup();
    const replacement = await createCreditInvite({ label: 'replacement', createdByUserId: 'admin', environment: env, creditsPerRecipient: 40 }, sql);
    await bindSignupAttempt(identity, token, env, sql);
    await Promise.allSettled([
      finishSignup(identity, token, { kind: 'redeem' }, env, sql),
      finishSignup(identity, token, { kind: 'replace', code: replacement.code }, env, sql),
    ]);
    const result = await finishSignup(identity, undefined, { kind: 'redeem' }, env, sql);
    expect([30, 40]).toContain(result.balance);
    const rows = await sql`SELECT count(*) AS count FROM invite_redemptions WHERE environment = ${env}`;
    expect(Number(rows[0].count)).toBe(1);
    expect(await checkCreditConsistency(env, sql)).toEqual([]);
  });

  it('rolls signup status back with the ledger if the wallet cannot be updated', async () => {
    const { env, token, identity, invite } = await setupSignup();
    await bindSignupAttempt(identity, token, env, sql);
    // Force an overflow on credit addition; no schema changes or mocking SQL.
    await sql`INSERT INTO credit_accounts(environment, clerk_user_id, balance) VALUES (${env}, ${identity.userId}, 2147483647)`;
    await expect(finishSignup(identity, token, { kind: 'redeem' }, env, sql)).rejects.toThrow();
    expect((await getAccountSignup(identity.userId, env, sql))?.status).toBe('pending');
    expect((await getCreditInvite(invite.invite.id, { environment: env }, sql))?.redeemedCount).toBe(0);
    expect((await sql`SELECT id FROM credit_ledger WHERE environment = ${env}`).length).toBe(0);
    await sql`UPDATE credit_accounts SET balance = 0 WHERE environment = ${env} AND clerk_user_id = ${identity.userId}`;
    expect((await finishSignup(identity, undefined, { kind: 'redeem' }, env, sql)).balance).toBe(30);
  });

  it('enforces shared limits atomically and opens a new window', async () => {
    const env = `limits-${++sequence}`;
    const results = await Promise.allSettled(Array.from({ length: 25 }, () => limitSignupRequests('same-network', false, env, sql)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(20);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(SignupRateLimitError);
    await sql`UPDATE credit_signup_limits SET window_start = clock_timestamp() - INTERVAL '2 minutes' WHERE environment = ${env}`;
    await expect(limitSignupRequests('same-network', false, env, sql)).resolves.toBeUndefined();
  });
});
