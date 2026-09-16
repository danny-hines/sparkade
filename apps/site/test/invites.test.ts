import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neon, neonConfig } from '@neondatabase/serverless';
import {
  CREDIT_SCHEMA_STATEMENTS,
  decryptInviteCode,
  defaultInviteExpiry,
  deriveInviteStatus,
  encryptInviteCode,
  ensureCreditSchema,
  generateInviteCode,
  inviteCodeDigest,
  inviteSignupPath,
  InviteAlreadyClaimedError,
  InviteCodeInvalidError,
  InviteExpiredError,
  InviteFullError,
  InviteNotEligibleError,
  InviteRevokedError,
  InviteSecretMissingError,
  InviteValidationError,
  isInviteSecretConfigured,
  lookupInviteOffer,
  normalizeInviteCode,
  parsePositiveInt,
  redeemInviteCredit,
  resolveCreditEnvironment,
  revokeCreditInvite,
  updateCreditInvite,
  validateInviteCreate,
  type Sql,
} from '../lib/invites';

beforeEach(() => {
  process.env.SPARKADE_INVITE_CODE_SECRET = 'test-only-secret-not-a-real-credential';
  delete process.env.SPARKADE_CREDIT_ENV;
  delete process.env.VERCEL_ENV;
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// A scripted mock for the neon tagged-template client. Each expected query in
// sequence is matched by a substring of its SQL text and answered with rows
// (or a thrown error). This verifies branch logic ONLY — it proves nothing
// about real PostgreSQL concurrency; see test/invites-postgres.test.ts, which
// runs the actual domain against a scratch database.
function nextStep(
  steps: Array<{ match: string; rows?: unknown[]; error?: unknown }>,
  text: string,
): unknown[] {
  const step = steps.shift();
  if (!step) throw new Error(`unexpected query: ${text.slice(0, 120)}`);
  if (!text.includes(step.match)) {
    throw new Error(`expected query containing "${step.match}", got: ${text.slice(0, 160)}`);
  }
  if (step.error) throw step.error;
  return step.rows ?? [];
}

function mockSql(
  steps: Array<{ match: string; rows?: unknown[]; error?: unknown }>,
  onQuery?: (text: string, values: unknown[]) => void,
): Sql {
  const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    onQuery?.(text, values);
    return nextStep(steps, text) as never;
  }) as unknown as Record<string, unknown>;
  tag.query = async (text: string) => {
    onQuery?.(String(text), []);
    return nextStep(steps, String(text)) as never;
  };
  // Execute queued queries sequentially and return per-query row arrays,
  // mirroring sql.transaction([...]) batch semantics.
  tag.transaction = async (queries: unknown[]) => {
    const list = (
      typeof queries === 'function' ? (queries as (tag: unknown) => unknown[])(tag) : queries
    ) as Promise<unknown[]>[];
    const out: unknown[][] = [];
    for (const query of list) out.push((await query) as unknown[]);
    return out as never;
  };
  return tag as unknown as Sql;
}

const SCHEMA_STEPS = () => [
  { match: 'CREATE TABLE' },
  { match: 'CREATE TABLE' },
  { match: 'CREATE TABLE' },
  { match: 'CREATE TABLE' },
  { match: 'CREATE TABLE' },
  { match: 'CREATE INDEX' },
  { match: 'CREATE INDEX' },
  { match: 'CREATE INDEX' },
  { match: 'CREATE TABLE' },
  { match: 'CREATE TABLE' },
];

describe('schema setup uses the real query transport', () => {
  it('executes every statement through the actual Neon client (unsafe() would send zero)', async () => {
    let calls = 0;
    const bodies: string[] = [];
    const previous = neonConfig.fetchFunction;
    neonConfig.fetchFunction = (async (_url: unknown, init?: { body?: unknown }) => {
      calls += 1;
      bodies.push(String(init?.body ?? ''));
      return new Response(JSON.stringify({ fields: [], rows: [] }), { status: 200 });
    }) as typeof fetch;
    try {
      const client = neon('postgresql://tester:tester@localhost:5432/sparkade_test', {
        disableWarningInBrowsers: true,
      });
      await ensureCreditSchema(client);
    } finally {
      neonConfig.fetchFunction = previous;
    }
    expect(calls).toBe(CREDIT_SCHEMA_STATEMENTS.length);
    expect(calls).toBeGreaterThan(0);
    expect(bodies.every((body) => body.includes('CREATE'))).toBe(true);
  });
});

describe('invite codes', () => {
  it('generates high-entropy human-enterable codes', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      const code = generateInviteCode();
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(code).not.toMatch(/[01ILO]/);
      seen.add(code);
    }
    expect(seen.size).toBe(50);
  });

  it('normalizes separators and case, rejecting ambiguous characters', () => {
    expect(normalizeInviteCode('abcd efgh-jkmn pqrs')).toBe('ABCD-EFGH-JKMN-PQRS');
    expect(normalizeInviteCode('abcd-efgh-ijkl-mnpq')).toBeNull();
    expect(normalizeInviteCode('short')).toBeNull();
    expect(normalizeInviteCode('ABCD-EFGH-JKLM-NPQ0')).toBeNull();
  });

  it('digests codes without revealing them and round-trips server-side encryption', () => {
    const code = 'ABCD-EFGH-JKMN-PQRS';
    const digest = inviteCodeDigest(code);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain('ABCD');
    const cipher = encryptInviteCode(code);
    expect(cipher).not.toContain('ABCD');
    expect(decryptInviteCode(cipher)).toBe(code);
  });

  it('fails cleanly when the invite secret is missing or too weak', () => {
    delete process.env.SPARKADE_INVITE_CODE_SECRET;
    expect(isInviteSecretConfigured()).toBe(false);
    expect(() => encryptInviteCode('ABCD-EFGH-JKMN-PQRS')).toThrow(InviteSecretMissingError);
    process.env.SPARKADE_INVITE_CODE_SECRET = 'short';
    expect(isInviteSecretConfigured()).toBe(false);
    expect(() => encryptInviteCode('ABCD-EFGH-JKMN-PQRS')).toThrow(/at least 32/);
  });

  it('builds a signup path containing the code by design', () => {
    expect(inviteSignupPath('ABCD-EFGH-JKMN-PQRS')).toBe('/sign-up?invite=ABCD-EFGH-JKMN-PQRS');
  });
});

describe('invite validation', () => {
  it('applies product defaults (30 credits, 20 recipients, seven days)', () => {
    const now = Date.now();
    const validated = validateInviteCreate({ label: '  Friends  beta ' }, now);
    expect(validated.label).toBe('Friends beta');
    expect(validated.creditsPerRecipient).toBe(30);
    expect(validated.maxRecipients).toBe(20);
    expect(Date.parse(validated.expiresAt) - now).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    expect(defaultInviteExpiry()).toBeTruthy();
  });

  it('rejects non-positive credits, limits, bad labels, and past expiry', () => {
    expect(() => validateInviteCreate({ label: '', creditsPerRecipient: 30 })).toThrow(InviteValidationError);
    expect(() => validateInviteCreate({ label: 'x', creditsPerRecipient: 0 })).toThrow(InviteValidationError);
    expect(() => validateInviteCreate({ label: 'x', creditsPerRecipient: 2.5 })).toThrow(InviteValidationError);
    expect(() => validateInviteCreate({ label: 'x', maxRecipients: 0 })).toThrow(InviteValidationError);
    expect(() => validateInviteCreate({ label: 'x', expiresAt: new Date(Date.now() - 1000).toISOString() })).toThrow(
      InviteValidationError,
    );
  });

  it('strictly parses operator integers instead of silently coercing them', () => {
    expect(parsePositiveInt('20', 'Limit', 100)).toBe(20);
    expect(() => parsePositiveInt('1.5', 'Limit', 100)).toThrow(InviteValidationError);
    expect(() => parsePositiveInt('20junk', 'Limit', 100)).toThrow(InviteValidationError);
    expect(() => parsePositiveInt('0', 'Limit', 100)).toThrow(InviteValidationError);
    expect(() => parsePositiveInt('-3', 'Limit', 100)).toThrow(InviteValidationError);
    expect(() => parsePositiveInt('', 'Limit', 100)).toThrow(InviteValidationError);
    expect(() => parsePositiveInt('101', 'Limit', 100)).toThrow(InviteValidationError);
  });

  it('derives active/exhausted/expired/revoked state with expiry winning ties', () => {
    const base = { revokedAt: null, expiresAt: new Date(Date.now() + 3600_000).toISOString(), redeemedCount: 0, maxRecipients: 2 };
    expect(deriveInviteStatus(base)).toBe('active');
    expect(deriveInviteStatus({ ...base, redeemedCount: 2 })).toBe('exhausted');
    expect(deriveInviteStatus({ ...base, expiresAt: new Date(Date.now() - 1000).toISOString() })).toBe('expired');
    expect(deriveInviteStatus({ ...base, revokedAt: new Date().toISOString() })).toBe('revoked');
  });

  it('scopes records by environment with preview/production isolation', () => {
    expect(resolveCreditEnvironment()).toBe('test');
    expect(resolveCreditEnvironment('production')).toBe('production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(resolveCreditEnvironment()).toBe('preview');
  });
});

describe('redemption eligibility (only for genuinely new claims)', () => {
  const base = {
    code: 'ABCD-EFGH-JKMN-PQRS',
    clerkUserId: 'user_1',
    emailVerified: true,
    isNewAccount: true,
  };

  it('requires verified email and a new account before granting', async () => {
    for (const input of [
      { ...base, emailVerified: false },
      { ...base, isNewAccount: false },
    ]) {
      const sql = mockSql([
        ...SCHEMA_STEPS(),
        { match: 'FROM invite_redemptions', rows: [] },
        { match: 'FROM credit_invites', rows: [{ id: 'inv-1' }] },
      ]);
      await expect(redeemInviteCredit(input, sql)).rejects.toThrow(InviteNotEligibleError);
    }
  });

  it('rejects malformed codes without querying', async () => {
    const sql = mockSql([]);
    await expect(
      redeemInviteCredit({ ...base, code: 'not-a-code' }, sql),
    ).rejects.toThrow(InviteCodeInvalidError);
  });

  it('recovers a prior receipt even when the account is no longer new', async () => {
    const sql = mockSql([
      ...SCHEMA_STEPS(),
      {
        match: 'FROM invite_redemptions',
        rows: [
          { id: 'red-1', invite_id: 'inv-1', amount: 30, redeemed_at: '2026-09-15T00:00:00.000Z', balance: 30 },
        ],
      },
      { match: 'FROM credit_invites', rows: [{ id: 'inv-1' }] },
    ]);
    const receipt = await redeemInviteCredit({ ...base, isNewAccount: false, emailVerified: false }, sql);
    expect(receipt.redemptionId).toBe('red-1');
    expect(receipt.balanceAfter).toBe(30);
  });
});

describe('redemption branches (mock SQL: logic only, not concurrency proof)', () => {
  const input = {
    code: 'ABCD-EFGH-JKMN-PQRS',
    clerkUserId: 'user_1',
    emailVerified: true,
    isNewAccount: true,
  };

  it('grants once and returns the receipt with the balance', async () => {
    const sql = mockSql([
      ...SCHEMA_STEPS(),
      { match: 'FROM invite_redemptions', rows: [] },
      { match: 'FROM credit_invites', rows: [{ id: 'inv-1' }] },
      { match: 'FOR UPDATE', rows: [{ id: 'inv-1' }] },
      {
        match: 'redemption CROSS JOIN wallet',
        rows: [
          { redemption_id: 'red-1', invite_id: 'inv-1', amount: 30, redeemed_at: '2026-09-15T00:00:00.000Z', balance: 30 },
        ],
      },
    ]);
    const receipt = await redeemInviteCredit(input, sql);
    expect(receipt).toEqual({
      redemptionId: 'red-1',
      inviteId: 'inv-1',
      amountCredits: 30,
      balanceAfter: 30,
      redeemedAt: '2026-09-15T00:00:00.000Z',
    });
  });

  it('repeats a successful redemption idempotently without granting again', async () => {
    const sql = mockSql([
      ...SCHEMA_STEPS(),
      {
        match: 'FROM invite_redemptions',
        rows: [
          { id: 'red-1', invite_id: 'inv-1', amount: 30, redeemed_at: '2026-09-15T00:00:00.000Z', balance: 30 },
        ],
      },
      { match: 'FROM credit_invites', rows: [{ id: 'inv-1' }] },
    ]);
    const receipt = await redeemInviteCredit(input, sql);
    expect(receipt.redemptionId).toBe('red-1');
    expect(receipt.balanceAfter).toBe(30);
  });

  it('blocks a second code for an account that already claimed (cross-code double claim)', async () => {
    const sql = mockSql([
      ...SCHEMA_STEPS(),
      {
        match: 'FROM invite_redemptions',
        rows: [{ id: 'red-1', invite_id: 'inv-other', amount: 30, redeemed_at: '2026-09-15T00:00:00.000Z', balance: 30 }],
      },
      { match: 'FROM credit_invites', rows: [{ id: 'inv-1' }] },
    ]);
    await expect(redeemInviteCredit(input, sql)).rejects.toThrow(InviteAlreadyClaimedError);
  });

  it('recovers a lost same-code race by returning the winners receipt', async () => {
    const raceError = Object.assign(new Error('duplicate key'), { code: '23505' });
    const sql = mockSql([
      ...SCHEMA_STEPS(),
      { match: 'FROM invite_redemptions', rows: [] },
      { match: 'FROM credit_invites', rows: [{ id: 'inv-1' }] },
      { match: 'FOR UPDATE', rows: [{ id: 'inv-1' }] },
      { match: 'redemption CROSS JOIN wallet', error: raceError },
      {
        match: 'FROM invite_redemptions',
        rows: [{ id: 'red-winner', invite_id: 'inv-1', amount: 30, redeemed_at: '2026-09-15T00:00:00.000Z', balance: 30 }],
      },
    ]);
    const receipt = await redeemInviteCredit(input, sql);
    expect(receipt.redemptionId).toBe('red-winner');
  });

  it('rejects a lost cross-code race as already-claimed, not as the other receipt', async () => {
    const raceError = Object.assign(new Error('duplicate key'), { code: '23505' });
    const sql = mockSql([
      ...SCHEMA_STEPS(),
      { match: 'FROM invite_redemptions', rows: [] },
      { match: 'FROM credit_invites', rows: [{ id: 'inv-1' }] },
      { match: 'FOR UPDATE', rows: [{ id: 'inv-1' }] },
      { match: 'redemption CROSS JOIN wallet', error: raceError },
      {
        match: 'FROM invite_redemptions',
        rows: [{ id: 'red-other', invite_id: 'inv-other', amount: 30, redeemed_at: '2026-09-15T00:00:00.000Z', balance: 30 }],
      },
    ]);
    await expect(redeemInviteCredit(input, sql)).rejects.toThrow(InviteAlreadyClaimedError);
  });

  it.each([
    { name: 'expired', state: { revoked_at: null, expires_at: '2020-01-01T00:00:00.000Z', redeemed_count: 1, max_recipients: 5 }, expired: true, error: InviteExpiredError },
    { name: 'revoked', state: { revoked_at: '2026-09-14T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z', redeemed_count: 1, max_recipients: 5 }, expired: false, error: InviteRevokedError },
    { name: 'full', state: { revoked_at: null, expires_at: '2027-01-01T00:00:00.000Z', redeemed_count: 5, max_recipients: 5 }, expired: false, error: InviteFullError },
  ])('fails a new claim for a $name code using database state', async ({ state, expired, error }) => {
    const sql = mockSql([
      ...SCHEMA_STEPS(),
      { match: 'FROM invite_redemptions', rows: [] },
      { match: 'FROM credit_invites', rows: [{ id: 'inv-1' }] },
      { match: 'FOR UPDATE', rows: [{ id: 'inv-1' }] },
      { match: 'redemption CROSS JOIN wallet', rows: [] },
      { match: 'FROM invite_redemptions', rows: [] },
      { match: 'FROM credit_invites', rows: [state] },
      ...(state.revoked_at ? [] : [{ match: 'clock_timestamp()', rows: [{ expired }] }]),
    ]);
    await expect(redeemInviteCredit(input, sql)).rejects.toThrow(error);
  });

  it('rejects unknown codes without granting', async () => {
    const sql = mockSql([
      ...SCHEMA_STEPS(),
      { match: 'FROM invite_redemptions', rows: [] },
      { match: 'FROM credit_invites', rows: [] },
    ]);
    await expect(redeemInviteCredit(input, sql)).rejects.toThrow(InviteCodeInvalidError);
  });
});

describe('admin capacity updates never clobber the other column', () => {
  const inviteRow = {
    id: 'inv-1',
    environment: 'test',
    label: 'Test',
    code_cipher: 'x',
    credits_per_recipient: 30,
    max_recipients: 20,
    redeemed_count: 2,
    created_at: '2026-09-15T00:00:00.000Z',
    expires_at: '2027-01-01T00:00:00.000Z',
    revoked_at: null,
    created_by_user_id: 'admin-1',
  };

  it('writes only the limit column when only the limit changes', async () => {
    const seen: Array<{ text: string; values: unknown[] }> = [];
    const sql = mockSql(
      [
        ...SCHEMA_STEPS(),
        { match: 'FROM credit_invites', rows: [inviteRow] },
        { match: 'WITH updated', rows: [{ target_id: 'inv-1' }] },
        ...SCHEMA_STEPS(),
        { match: 'FROM credit_invites', rows: [inviteRow] },
        { match: 'FROM invite_redemptions', rows: [] },
      ],
      (text, values) => seen.push({ text, values }),
    );
    await updateCreditInvite({ id: 'inv-1', actorUserId: 'admin-1', maxRecipients: 25 }, sql);
    const update = seen.find((entry) => entry.text.includes('WITH updated'));
    expect(update?.text).toContain('SET max_recipients');
    expect(update?.text).not.toContain('SET expires_at');
    expect(update?.text).not.toContain('SET max_recipients = ?, expires_at');
  });

  it('audits only the operator-supplied fields with a top-level success outcome', async () => {
    const seen: Array<{ text: string; values: unknown[] }> = [];
    const sql = mockSql(
      [
        ...SCHEMA_STEPS(),
        { match: 'FROM credit_invites', rows: [inviteRow] },
        { match: 'WITH updated', rows: [{ target_id: 'inv-1' }] },
        ...SCHEMA_STEPS(),
        { match: 'FROM credit_invites', rows: [inviteRow] },
        { match: 'FROM invite_redemptions', rows: [] },
      ],
      (text, values) => seen.push({ text, values }),
    );
    await updateCreditInvite({ id: 'inv-1', actorUserId: 'admin-1', maxRecipients: 25 }, sql);
    const update = seen.find((entry) => entry.text.includes('WITH updated'));
    expect(update?.text).toContain("'outcome', 'success'");
    expect(update?.text).toContain("'changes'");
    expect(update?.text).not.toContain('before');
    // The changes payload reports exactly the supplied field — no snapshot
    // of the untouched expiry column.
    expect(update?.values).toContain(JSON.stringify({ maxRecipients: 25 }));
    expect(
      update?.values.some((value) => typeof value === 'string' && value.includes('expiresAt')),
    ).toBe(false);
  });

  it('reports a concurrent change truthfully when a redemption lands mid-update', async () => {
    const seen: string[] = [];
    const sql = mockSql(
      [
        ...SCHEMA_STEPS(),
        { match: 'FROM credit_invites', rows: [inviteRow] },
        { match: 'WITH updated', rows: [] },
        {
          match: 'revoked_at, redeemed_count',
          rows: [{ revoked_at: null, redeemed_count: 3, max_recipients: 20 }],
        },
        { match: 'admin_audit_events', rows: [] },
      ],
      (text) => seen.push(text),
    );
    // Requested max (2) cleared the pre-read floor (redeemed 2) but a
    // concurrent grant raised redemptions to 3 before the UPDATE ran.
    await expect(
      updateCreditInvite({ id: 'inv-1', actorUserId: 'admin-1', maxRecipients: 2 }, sql),
    ).rejects.toThrow(/concurrently/);
    expect(seen.some((text) => text.includes('WITH updated'))).toBe(true);
  });

  it('records the database-returned redemption count on revoke', async () => {
    const seen: Array<{ text: string; values: unknown[] }> = [];
    const sql = mockSql(
      [
        ...SCHEMA_STEPS(),
        { match: 'FROM credit_invites', rows: [inviteRow] },
        { match: 'WITH revoked', rows: [{ target_id: 'inv-1' }] },
        ...SCHEMA_STEPS(),
        {
          match: 'FROM credit_invites',
          rows: [{ ...inviteRow, revoked_at: '2026-09-16T00:00:00.000Z' }],
        },
        { match: 'FROM invite_redemptions', rows: [] },
      ],
      (text, values) => seen.push({ text, values }),
    );
    const summary = await revokeCreditInvite({ id: 'inv-1', actorUserId: 'admin-1', reason: 'leak' }, sql);
    expect(summary.status).toBe('revoked');
    const revoke = seen.find((entry) => entry.text.includes('WITH revoked'));
    expect(revoke?.text).toContain("'redeemedCount', revoked.redeemed_count");
    expect(revoke?.values).toContain('leak');
  });
});

describe('public offer lookup (visits consume no slots)', () => {
  it('returns signup-facing info only, never recipient history', async () => {
    const sql = mockSql([
      ...SCHEMA_STEPS(),
      {
        match: 'FROM credit_invites',
        rows: [
          {
            credits_per_recipient: 30,
            max_recipients: 20,
            redeemed_count: 19,
            expires_at: '2027-01-01T00:00:00.000Z',
            revoked_at: null,
          },
        ],
      },
    ]);
    const offer = await lookupInviteOffer('ABCD-EFGH-JKMN-PQRS', 'test', sql);
    expect(offer).toMatchObject({ valid: true, credits: 30, remainingSlots: 1, status: 'active' });
    expect(offer).not.toHaveProperty('redemptions');
  });

  it('marks malformed codes invalid without querying', async () => {
    const sql = mockSql([]);
    expect(await lookupInviteOffer('nope', 'test', sql)).toMatchObject({ valid: false, status: 'invalid' });
  });
});
