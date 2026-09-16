import { createCipheriv, createDecipheriv, createHash, randomInt } from 'node:crypto';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { getSql } from './db';

// Customer credit invites and signup bonuses.
//
// This module is intentionally separate from the provider-cost usage ledger
// (see lib/generation/*): customer credits are integer grants against a
// product wallet, while provider spend is cost accounting. The two must never
// be conflated, so invite grants live in their own credit_* tables.

export type Sql = NeonQueryFunction<false, false>;

export const DEFAULT_INVITE_CREDITS = 30;
export const DEFAULT_INVITE_MAX_RECIPIENTS = 20;
export const DEFAULT_INVITE_EXPIRY_DAYS = 7;
export const MIN_INVITE_SECRET_LENGTH = 32;

const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 16;
const MAX_LABEL_LENGTH = 80;
const MAX_CREDITS_PER_RECIPIENT = 10_000;
const MAX_RECIPIENT_LIMIT = 100_000;
const MAX_EXPIRY_DAYS_OUT = 366;

export type InviteStatus = 'active' | 'exhausted' | 'expired' | 'revoked';

export interface InviteReceipt {
  redemptionId: string;
  inviteId: string;
  amountCredits: number;
  balanceAfter: number;
  redeemedAt: string;
}

export interface InviteSummary {
  id: string;
  environment: string;
  label: string;
  creditsPerRecipient: number;
  maxRecipients: number;
  redeemedCount: number;
  remainingSlots: number;
  totalCreditsIssued: number;
  status: InviteStatus;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  createdByUserId: string;
}

export interface InviteDetail extends InviteSummary {
  code: string;
  redemptions: InviteRedemption[];
}

export interface InviteRedemption {
  id: string;
  recipientUserId: string;
  amount: number;
  ledgerId: string;
  redeemedAt: string;
}

export interface PublicInviteOffer {
  valid: boolean;
  credits: number | null;
  remainingSlots: number | null;
  expiresAt: string | null;
  status: InviteStatus | 'invalid';
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class InviteSecretMissingError extends Error {
  readonly code = 'invite_secret_missing';
}

export class InviteValidationError extends Error {
  readonly code = 'invite_invalid_input';
}

export class InviteCodeInvalidError extends Error {
  readonly code = 'invite_code_invalid';
}

export class InviteNotEligibleError extends Error {
  readonly code = 'invite_not_eligible';
}

export class InviteExpiredError extends Error {
  readonly code = 'invite_expired';
}

export class InviteRevokedError extends Error {
  readonly code = 'invite_revoked';
}

export class InviteFullError extends Error {
  readonly code = 'invite_full';
}

export class InviteAlreadyClaimedError extends Error {
  readonly code = 'invite_already_claimed';
}

export class SignupChangedError extends Error {
  readonly code = 'signup_changed';
}

export class InviteAdminError extends Error {
  readonly code = 'invite_admin_error';
}

// ---------------------------------------------------------------------------
// Environment scoping
// ---------------------------------------------------------------------------

export function resolveCreditEnvironment(override?: string): string {
  const value = (override ?? process.env.SPARKADE_CREDIT_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development').trim();
  return value || 'development';
}

// ---------------------------------------------------------------------------
// Codes: format, normalization, protected storage
// ---------------------------------------------------------------------------

export function generateInviteCode(): string {
  let raw = '';
  for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
    raw += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
}

export function normalizeInviteCode(value: string): string | null {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized.length !== INVITE_CODE_LENGTH) return null;
  for (const character of normalized) {
    if (!INVITE_CODE_ALPHABET.includes(character)) return null;
  }
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12)}`;
}

export function inviteCodeDigest(normalizedCode: string): string {
  return createHash('sha256').update(normalizedCode).digest('hex');
}

export function inviteCodeSuffix(normalizedCode: string): string {
  return normalizedCode.replace(/-/g, '').slice(-4);
}

/** True when a usable encryption secret is configured. Never reveals the secret. */
export function isInviteSecretConfigured(): boolean {
  return (process.env.SPARKADE_INVITE_CODE_SECRET ?? '').length >= MIN_INVITE_SECRET_LENGTH;
}

function getInviteSecret(): string {
  const secret = process.env.SPARKADE_INVITE_CODE_SECRET ?? '';
  if (!secret) {
    throw new InviteSecretMissingError(
      'SPARKADE_INVITE_CODE_SECRET is not configured. Set it (see apps/site/.env.example) to create or read invite codes.',
    );
  }
  if (secret.length < MIN_INVITE_SECRET_LENGTH) {
    throw new InviteSecretMissingError(
      `SPARKADE_INVITE_CODE_SECRET is too short. Use at least ${MIN_INVITE_SECRET_LENGTH} random characters.`,
    );
  }
  return secret;
}

function inviteCipherKey(): Buffer {
  return createHash('sha256').update(getInviteSecret()).digest();
}

export function encryptInviteCode(normalizedCode: string): string {
  const key = inviteCipherKey();
  const iv = Buffer.alloc(12);
  for (let index = 0; index < iv.length; index += 1) iv[index] = randomInt(256);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(normalizedCode, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptInviteCode(payload: string): string {
  const key = inviteCipherKey();
  const raw = Buffer.from(payload, 'base64');
  if (raw.length < 12 + 16 + 1) throw new InviteSecretMissingError('Stored invite code is unreadable with the current secret.');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new InviteSecretMissingError('Stored invite code cannot be decrypted with SPARKADE_INVITE_CODE_SECRET.');
  }
}

export function inviteSignupPath(normalizedCode: string): string {
  return `/sign-up?invite=${encodeURIComponent(normalizedCode)}`;
}

// ---------------------------------------------------------------------------
// Validation (pure, unit-testable)
// ---------------------------------------------------------------------------

export interface InviteCreateInput {
  label: string;
  creditsPerRecipient?: number;
  maxRecipients?: number;
  expiresAt?: string;
}

export interface ValidatedInviteCreate {
  label: string;
  creditsPerRecipient: number;
  maxRecipients: number;
  expiresAt: string;
}

export function defaultInviteExpiry(): string {
  return new Date(Date.now() + DEFAULT_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function validateInviteCreate(input: InviteCreateInput, now = Date.now()): ValidatedInviteCreate {
  const label = input.label.trim().replace(/\s+/g, ' ');
  if (!label || label.length > MAX_LABEL_LENGTH) {
    throw new InviteValidationError('Give the invite a short internal label (1-80 characters).');
  }
  const credits = input.creditsPerRecipient ?? DEFAULT_INVITE_CREDITS;
  if (!Number.isInteger(credits) || credits < 1 || credits > MAX_CREDITS_PER_RECIPIENT) {
    throw new InviteValidationError('Credits per recipient must be a positive integer.');
  }
  const maxRecipients = input.maxRecipients ?? DEFAULT_INVITE_MAX_RECIPIENTS;
  if (!Number.isInteger(maxRecipients) || maxRecipients < 1 || maxRecipients > MAX_RECIPIENT_LIMIT) {
    throw new InviteValidationError('Recipient limit must be a positive integer.');
  }
  const expiresAt = input.expiresAt ?? defaultInviteExpiry();
  const expiryTime = Date.parse(expiresAt);
  if (!Number.isFinite(expiryTime) || expiryTime <= now) {
    throw new InviteValidationError('Expiry must be a future date and time.');
  }
  if (expiryTime > now + MAX_EXPIRY_DAYS_OUT * 24 * 60 * 60 * 1000) {
    throw new InviteValidationError('Expiry must be within one year of creation.');
  }
  return { label, creditsPerRecipient: credits, maxRecipients, expiresAt: new Date(expiryTime).toISOString() };
}

/**
 * Strictly parse an operator-supplied positive integer. Rejects decimals,
 * trailing junk, and out-of-range values instead of silently coercing them.
 */
export function parsePositiveInt(raw: unknown, name: string, max: number): number {
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) {
    throw new InviteValidationError(`${name} must be a positive whole number.`);
  }
  const value = Number.parseInt(text, 10);
  if (value < 1 || value > max || !Number.isSafeInteger(value)) {
    throw new InviteValidationError(`${name} must be between 1 and ${max}.`);
  }
  return value;
}

export function deriveInviteStatus(
  invite: { revokedAt: string | null; expiresAt: string; redeemedCount: number; maxRecipients: number },
  now = Date.now(),
): InviteStatus {
  if (invite.revokedAt) return 'revoked';
  if (Date.parse(invite.expiresAt) <= now) return 'expired';
  if (invite.redeemedCount >= invite.maxRecipients) return 'exhausted';
  return 'active';
}

// ---------------------------------------------------------------------------
// Schema (additive only; exported as data for the SQL test harness)
// ---------------------------------------------------------------------------

export const CREDIT_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS credit_accounts (
    environment TEXT NOT NULL,
    clerk_user_id TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (environment, clerk_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS credit_invites (
    id TEXT PRIMARY KEY,
    environment TEXT NOT NULL,
    label TEXT NOT NULL,
    code_digest TEXT NOT NULL,
    code_cipher TEXT NOT NULL,
    code_suffix TEXT NOT NULL,
    credits_per_recipient INTEGER NOT NULL CHECK (credits_per_recipient > 0),
    max_recipients INTEGER NOT NULL CHECK (max_recipients > 0),
    redeemed_count INTEGER NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,
    created_by_user_id TEXT NOT NULL,
    UNIQUE (environment, code_digest)
  )`,
  `CREATE TABLE IF NOT EXISTS credit_ledger (
    id TEXT PRIMARY KEY,
    environment TEXT NOT NULL,
    clerk_user_id TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount <> 0),
    kind TEXT NOT NULL,
    reason TEXT NOT NULL,
    actor_user_id TEXT,
    invite_id TEXT,
    operation_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (environment, operation_id)
  )`,
  `CREATE TABLE IF NOT EXISTS invite_redemptions (
    id TEXT PRIMARY KEY,
    environment TEXT NOT NULL,
    invite_id TEXT NOT NULL REFERENCES credit_invites(id),
    recipient_user_id TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    ledger_id TEXT NOT NULL UNIQUE REFERENCES credit_ledger(id),
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (environment, recipient_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS admin_audit_events (
    id TEXT PRIMARY KEY,
    environment TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS invite_redemptions_invite ON invite_redemptions (invite_id)`,
  `CREATE INDEX IF NOT EXISTS credit_ledger_account ON credit_ledger (environment, clerk_user_id)`,
  `CREATE INDEX IF NOT EXISTS admin_audit_target ON admin_audit_events (environment, target_type, target_id)`,
  `CREATE TABLE IF NOT EXISTS credit_signup_attempts (
    id TEXT PRIMARY KEY,
    environment TEXT NOT NULL,
    code_cipher TEXT,
    code_digest TEXT,
    return_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + INTERVAL '7 days',
    clerk_user_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'zero')),
    completed_at TIMESTAMPTZ,
    UNIQUE (environment, clerk_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS credit_signup_limits (
    environment TEXT NOT NULL,
    bucket TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    requests INTEGER NOT NULL,
    PRIMARY KEY (environment, bucket)
  )`,
];

let schemaPromise: Promise<void> | null = null;

async function runSchema(client: Sql): Promise<void> {
  // NOTE: sql.query() executes. sql.unsafe() only builds a raw fragment for
  // interpolation and performs zero transport calls — never use it here.
  for (const statement of CREDIT_SCHEMA_STATEMENTS) {
    await client.query(statement);
  }
}

export async function ensureCreditSchema(client?: Sql): Promise<void> {
  if (client) {
    await runSchema(client);
    return;
  }
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await runSchema(getSql());
    })();
  }
  try {
    await schemaPromise;
  } catch (error) {
    schemaPromise = null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

type InviteRow = {
  id: string;
  environment: string;
  label: string;
  code_cipher: string;
  credits_per_recipient: number | string;
  max_recipients: number | string;
  redeemed_count: number | string;
  created_at: string | Date;
  expires_at: string | Date;
  revoked_at: string | Date | null;
  created_by_user_id: string;
};

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toSummary(row: InviteRow, now = Date.now()): InviteSummary {
  const maxRecipients = Number(row.max_recipients);
  const redeemedCount = Number(row.redeemed_count);
  const credits = Number(row.credits_per_recipient);
  const summary: InviteSummary = {
    id: row.id,
    environment: row.environment,
    label: row.label,
    creditsPerRecipient: credits,
    maxRecipients,
    redeemedCount,
    remainingSlots: Math.max(0, maxRecipients - redeemedCount),
    totalCreditsIssued: redeemedCount * credits,
    status: 'active',
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    revokedAt: row.revoked_at ? iso(row.revoked_at) : null,
    createdByUserId: row.created_by_user_id,
  };
  summary.status = deriveInviteStatus(
    { revokedAt: summary.revokedAt, expiresAt: summary.expiresAt, redeemedCount, maxRecipients },
    now,
  );
  return summary;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.floor(randomInt(1_000_000_000)).toString(36)}-${randomInt(1_000_000).toString(36)}`;
}

// ---------------------------------------------------------------------------
// Admin: create / list / inspect / revoke / update
// ---------------------------------------------------------------------------

export interface CreateInviteResult {
  invite: InviteSummary;
  code: string;
  signupPath: string;
}

export async function createCreditInvite(
  input: InviteCreateInput & { createdByUserId: string; environment?: string },
  client?: Sql,
): Promise<CreateInviteResult> {
  const validated = validateInviteCreate(input);
  if (!input.createdByUserId.trim()) throw new InviteValidationError('A creating operator is required.');
  const sql = client ?? getSql();
  await ensureCreditSchema(client);
  const environment = resolveCreditEnvironment(input.environment);
  const code = generateInviteCode();
  const id = newId();
  // Creation and its audit event commit atomically in one transaction.
  const [inserted] = await sql.transaction([
    sql`
      INSERT INTO credit_invites (
        id, environment, label, code_digest, code_cipher, code_suffix,
        credits_per_recipient, max_recipients, expires_at, created_by_user_id
      )
      VALUES (
        ${id}, ${environment}, ${validated.label}, ${inviteCodeDigest(code)},
        ${encryptInviteCode(code)}, ${inviteCodeSuffix(code)},
        ${validated.creditsPerRecipient}, ${validated.maxRecipients},
        ${validated.expiresAt}, ${input.createdByUserId}
      )
      RETURNING id, environment, label, code_cipher, credits_per_recipient, max_recipients,
                redeemed_count, created_at, expires_at, revoked_at, created_by_user_id
    `,
    sql`
      INSERT INTO admin_audit_events (id, environment, actor_user_id, action, target_type, target_id, details_json)
      VALUES (${newId()}, ${environment}, ${input.createdByUserId}, 'invite.create', 'credit_invite', ${id},
        ${JSON.stringify({ label: validated.label, creditsPerRecipient: validated.creditsPerRecipient, maxRecipients: validated.maxRecipients, expiresAt: validated.expiresAt, outcome: 'success' })})
    `,
  ]);
  const rows = inserted as unknown[];
  if (!rows[0]) throw new InviteAdminError('Invite could not be created.');
  const invite = toSummary(rows[0] as InviteRow);
  return { invite, code, signupPath: inviteSignupPath(code) };
}

export async function listCreditInvites(
  input: { environment?: string; includeCodes?: boolean } = {},
  client?: Sql,
): Promise<InviteDetail[]> {
  const sql = client ?? getSql();
  await ensureCreditSchema(client);
  const environment = resolveCreditEnvironment(input.environment);
  const rows = await sql`
    SELECT id, environment, label, code_cipher, credits_per_recipient, max_recipients,
           redeemed_count, created_at, expires_at, revoked_at, created_by_user_id
    FROM credit_invites
    WHERE environment = ${environment}
    ORDER BY created_at DESC, id DESC
  `;
  const now = Date.now();
  const details: InviteDetail[] = [];
  for (const value of rows) {
    const row = value as InviteRow;
    const summary = toSummary(row, now);
    details.push({
      ...summary,
      code: input.includeCodes ? decryptInviteCode(row.code_cipher) : '',
      redemptions: await listInviteRedemptions(summary.id, environment, sql),
    });
  }
  return details;
}

export async function getCreditInvite(
  id: string,
  input: { environment?: string; includeCode?: boolean } = {},
  client?: Sql,
): Promise<InviteDetail | null> {
  const sql = client ?? getSql();
  await ensureCreditSchema(client);
  const environment = resolveCreditEnvironment(input.environment);
  const rows = await sql`
    SELECT id, environment, label, code_cipher, credits_per_recipient, max_recipients,
           redeemed_count, created_at, expires_at, revoked_at, created_by_user_id
    FROM credit_invites
    WHERE id = ${id} AND environment = ${environment}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  const row = rows[0] as InviteRow;
  const summary = toSummary(row);
  return {
    ...summary,
    code: input.includeCode ? decryptInviteCode(row.code_cipher) : '',
    redemptions: await listInviteRedemptions(summary.id, environment, sql),
  };
}

async function listInviteRedemptions(inviteId: string, environment: string, sql: Sql): Promise<InviteRedemption[]> {
  const rows = await sql`
    SELECT id, recipient_user_id, amount, ledger_id, redeemed_at
    FROM invite_redemptions
    WHERE invite_id = ${inviteId} AND environment = ${environment}
    ORDER BY redeemed_at ASC, id ASC
  `;
  return rows.map((value) => {
    const row = value as { id: string; recipient_user_id: string; amount: number | string; ledger_id: string; redeemed_at: string | Date };
    return {
      id: row.id,
      recipientUserId: row.recipient_user_id,
      amount: Number(row.amount),
      ledgerId: row.ledger_id,
      redeemedAt: iso(row.redeemed_at),
    };
  });
}

async function writeDeniedAudit(
  sql: Sql,
  input: { environment: string; actorUserId: string; action: string; targetId: string; details: Record<string, unknown> },
): Promise<void> {
  await sql`
    INSERT INTO admin_audit_events (id, environment, actor_user_id, action, target_type, target_id, details_json)
    VALUES (${newId()}, ${input.environment}, ${input.actorUserId}, ${input.action}, 'credit_invite', ${input.targetId},
      ${JSON.stringify({ ...input.details, outcome: 'denied' })})
  `;
}

export async function revokeCreditInvite(
  input: { id: string; actorUserId: string; reason: string; environment?: string },
  client?: Sql,
): Promise<InviteSummary> {
  const reason = input.reason.trim();
  if (!reason) throw new InviteAdminError('A revocation reason is required for the audit trail.');
  const sql = client ?? getSql();
  await ensureCreditSchema(client);
  const environment = resolveCreditEnvironment(input.environment);
  const current = await sql`
    SELECT id, environment, label, code_cipher, credits_per_recipient, max_recipients,
           redeemed_count, created_at, expires_at, revoked_at, created_by_user_id
    FROM credit_invites WHERE id = ${input.id} AND environment = ${environment} LIMIT 1
  `;
  if (!current[0]) {
    await writeDeniedAudit(sql, { environment, actorUserId: input.actorUserId, action: 'invite.revoke', targetId: input.id, details: { reason, cause: 'not_found' } });
    throw new InviteAdminError('Invite not found.');
  }
  const before = toSummary(current[0] as InviteRow);
  if (before.revokedAt) {
    await writeDeniedAudit(sql, { environment, actorUserId: input.actorUserId, action: 'invite.revoke', targetId: input.id, details: { reason, cause: 'already_revoked' } });
    throw new InviteAdminError('Invite is already revoked.');
  }
  // Revocation and its success audit commit atomically: the audit row is only
  // inserted when the conditional update actually matched.
  const audited = await sql`
    WITH revoked AS (
      UPDATE credit_invites
      SET revoked_at = clock_timestamp(), revoked_reason = ${reason}, updated_at = clock_timestamp()
      WHERE id = ${input.id} AND environment = ${environment} AND revoked_at IS NULL
      RETURNING id, redeemed_count
    )
    INSERT INTO admin_audit_events (id, environment, actor_user_id, action, target_type, target_id, details_json)
    SELECT ${newId()}, ${environment}, ${input.actorUserId}, 'invite.revoke', 'credit_invite', revoked.id,
      jsonb_build_object(
        'outcome', 'success',
        'reason', ${reason}::text,
        'redeemedCount', revoked.redeemed_count
      )
    FROM revoked
    RETURNING target_id
  `;
  if (!audited[0]) {
    await writeDeniedAudit(sql, { environment, actorUserId: input.actorUserId, action: 'invite.revoke', targetId: input.id, details: { reason, cause: 'revoked_concurrently' } });
    throw new InviteAdminError('Invite could not be revoked; it may have been revoked concurrently.');
  }
  const detail = await getCreditInvite(input.id, { environment }, sql);
  if (!detail) throw new InviteAdminError('Invite not found.');
  return detail;
}

export async function updateCreditInvite(
  input: {
    id: string;
    actorUserId: string;
    maxRecipients?: number;
    expiresAt?: string;
    environment?: string;
  },
  client?: Sql,
): Promise<InviteSummary> {
  const changeLimit = input.maxRecipients !== undefined;
  const changeExpiry = input.expiresAt !== undefined;
  if (!changeLimit && !changeExpiry) {
    throw new InviteAdminError('Nothing to update: provide a recipient limit or expiry.');
  }
  const sql = client ?? getSql();
  await ensureCreditSchema(client);
  const environment = resolveCreditEnvironment(input.environment);
  const current = await sql`
    SELECT id, environment, label, code_cipher, credits_per_recipient, max_recipients,
           redeemed_count, created_at, expires_at, revoked_at, created_by_user_id
    FROM credit_invites WHERE id = ${input.id} AND environment = ${environment} LIMIT 1
  `;
  if (!current[0]) {
    await writeDeniedAudit(sql, { environment, actorUserId: input.actorUserId, action: 'invite.update', targetId: input.id, details: { cause: 'not_found' } });
    throw new InviteAdminError('Invite not found.');
  }
  const before = toSummary(current[0] as InviteRow);
  if (before.revokedAt) {
    await writeDeniedAudit(sql, { environment, actorUserId: input.actorUserId, action: 'invite.update', targetId: input.id, details: { cause: 'revoked' } });
    throw new InviteAdminError('Revoked invites stay revoked and cannot be changed.');
  }
  let nextMax = before.maxRecipients;
  let nextExpiry = before.expiresAt;
  if (changeLimit) {
    if (!Number.isInteger(input.maxRecipients) || (input.maxRecipients as number) < 1 || (input.maxRecipients as number) > MAX_RECIPIENT_LIMIT) {
      throw new InviteAdminError('Recipient limit must be a positive integer.');
    }
    // Capacity can never drop below completed redemptions: slots are never reopened.
    if ((input.maxRecipients as number) < before.redeemedCount) {
      await writeDeniedAudit(sql, { environment, actorUserId: input.actorUserId, action: 'invite.update', targetId: input.id, details: { cause: 'below_redeemed', requested: input.maxRecipients, redeemedCount: before.redeemedCount } });
      throw new InviteAdminError(
        `Limit cannot go below ${before.redeemedCount} completed redemptions.`,
      );
    }
    nextMax = input.maxRecipients as number;
  }
  if (changeExpiry) {
    const expiryTime = Date.parse(input.expiresAt as string);
    if (!Number.isFinite(expiryTime) || expiryTime <= Date.now()) {
      throw new InviteAdminError('New expiry must be a future date and time.');
    }
    nextExpiry = new Date(expiryTime).toISOString();
  }
  // Only the operator-supplied columns are written, so a concurrent admin
  // change to the other column is never clobbered by stale values. The audit
  // row commits in the same statement, only on a successful update, and
  // reports only this request's changes plus the actual resulting values
  // from RETURNING — never a pre-read before/after snapshot that a
  // concurrent change could have made stale.
  const changesJson =
    changeLimit && changeExpiry
      ? JSON.stringify({ maxRecipients: nextMax, expiresAt: nextExpiry })
      : changeLimit
        ? JSON.stringify({ maxRecipients: nextMax })
        : JSON.stringify({ expiresAt: nextExpiry });
  let audited;
  if (changeLimit && changeExpiry) {
    audited = await sql`
      WITH updated AS (
        UPDATE credit_invites
        SET max_recipients = ${nextMax}, expires_at = ${nextExpiry}, updated_at = clock_timestamp()
        WHERE id = ${input.id} AND environment = ${environment}
          AND revoked_at IS NULL AND ${nextMax} >= redeemed_count
        RETURNING id, max_recipients, expires_at
      )
      INSERT INTO admin_audit_events (id, environment, actor_user_id, action, target_type, target_id, details_json)
      SELECT ${newId()}, ${environment}, ${input.actorUserId}, 'invite.update', 'credit_invite', updated.id,
        jsonb_build_object(
          'outcome', 'success',
          'changes', ${changesJson}::jsonb,
          'result', jsonb_build_object('maxRecipients', updated.max_recipients, 'expiresAt', updated.expires_at)
        )
      FROM updated
      RETURNING target_id
    `;
  } else if (changeLimit) {
    audited = await sql`
      WITH updated AS (
        UPDATE credit_invites
        SET max_recipients = ${nextMax}, updated_at = clock_timestamp()
        WHERE id = ${input.id} AND environment = ${environment}
          AND revoked_at IS NULL AND ${nextMax} >= redeemed_count
        RETURNING id, max_recipients, expires_at
      )
      INSERT INTO admin_audit_events (id, environment, actor_user_id, action, target_type, target_id, details_json)
      SELECT ${newId()}, ${environment}, ${input.actorUserId}, 'invite.update', 'credit_invite', updated.id,
        jsonb_build_object(
          'outcome', 'success',
          'changes', ${changesJson}::jsonb,
          'result', jsonb_build_object('maxRecipients', updated.max_recipients, 'expiresAt', updated.expires_at)
        )
      FROM updated
      RETURNING target_id
    `;
  } else {
    audited = await sql`
      WITH updated AS (
        UPDATE credit_invites
        SET expires_at = ${nextExpiry}, updated_at = clock_timestamp()
        WHERE id = ${input.id} AND environment = ${environment}
          AND revoked_at IS NULL AND max_recipients >= redeemed_count
        RETURNING id, max_recipients, expires_at
      )
      INSERT INTO admin_audit_events (id, environment, actor_user_id, action, target_type, target_id, details_json)
      SELECT ${newId()}, ${environment}, ${input.actorUserId}, 'invite.update', 'credit_invite', updated.id,
        jsonb_build_object(
          'outcome', 'success',
          'changes', ${changesJson}::jsonb,
          'result', jsonb_build_object('maxRecipients', updated.max_recipients, 'expiresAt', updated.expires_at)
        )
      FROM updated
      RETURNING target_id
    `;
  }
  if (!audited[0]) {
    // The conditional update matched nothing: re-inspect instead of blaming
    // revocation. A redemption that just landed can make the requested
    // capacity too low, which is a concurrent change, not a revoke.
    const recheck = await sql`
      SELECT revoked_at, redeemed_count, max_recipients
      FROM credit_invites
      WHERE id = ${input.id} AND environment = ${environment}
      LIMIT 1
    `;
    const state = recheck[0] as
      | { revoked_at: string | Date | null; redeemed_count: number | string; max_recipients: number | string }
      | undefined;
    const cause = !state ? 'not_found' : state.revoked_at ? 'revoked' : 'concurrent_change';
    await writeDeniedAudit(sql, { environment, actorUserId: input.actorUserId, action: 'invite.update', targetId: input.id, details: { cause, requested: changesJson } });
    if (cause === 'not_found') throw new InviteAdminError('Invite not found.');
    if (cause === 'revoked') throw new InviteAdminError('Invite was revoked by another operator.');
    throw new InviteAdminError('Invite changed concurrently; review its current values and retry.');
  }
  const detail = await getCreditInvite(input.id, { environment }, sql);
  if (!detail) throw new InviteAdminError('Invite not found.');
  return detail;
}

export async function recordAdminAudit(
  input: {
    environment: string;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    details?: Record<string, unknown>;
  },
  client?: Sql,
): Promise<void> {
  const sql = client ?? getSql();
  await ensureCreditSchema(client);
  await sql`
    INSERT INTO admin_audit_events (id, environment, actor_user_id, action, target_type, target_id, details_json)
    VALUES (${newId()}, ${input.environment}, ${input.actorUserId}, ${input.action},
      ${input.targetType}, ${input.targetId}, ${JSON.stringify(input.details ?? {})})
  `;
}

// ---------------------------------------------------------------------------
// Balances and public offer lookup (read-only; visits consume no slots)
// ---------------------------------------------------------------------------

export async function getCreditBalance(userId: string, environment?: string, client?: Sql): Promise<number> {
  const sql = client ?? getSql();
  await ensureCreditSchema(client);
  const environmentValue = resolveCreditEnvironment(environment);
  const rows = await sql`
    SELECT balance FROM credit_accounts
    WHERE environment = ${environmentValue} AND clerk_user_id = ${userId}
    LIMIT 1
  `;
  if (!rows[0]) return 0;
  return Number((rows[0] as { balance: number | string }).balance);
}

export async function lookupInviteOffer(code: string, environment?: string, client?: Sql): Promise<PublicInviteOffer> {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return { valid: false, credits: null, remainingSlots: null, expiresAt: null, status: 'invalid' };
  const sql = client ?? getSql();
  await ensureCreditSchema(client);
  const environmentValue = resolveCreditEnvironment(environment);
  const rows = await sql`
    SELECT credits_per_recipient, max_recipients, redeemed_count, expires_at, revoked_at
    FROM credit_invites
    WHERE environment = ${environmentValue} AND code_digest = ${inviteCodeDigest(normalized)}
    LIMIT 1
  `;
  if (!rows[0]) return { valid: false, credits: null, remainingSlots: null, expiresAt: null, status: 'invalid' };
  const row = rows[0] as {
    credits_per_recipient: number | string;
    max_recipients: number | string;
    redeemed_count: number | string;
    expires_at: string | Date;
    revoked_at: string | Date | null;
  };
  const summary = {
    revokedAt: row.revoked_at ? iso(row.revoked_at) : null,
    expiresAt: iso(row.expires_at),
    redeemedCount: Number(row.redeemed_count),
    maxRecipients: Number(row.max_recipients),
  };
  const status = deriveInviteStatus(summary);
  const remaining = Math.max(0, summary.maxRecipients - summary.redeemedCount);
  return {
    valid: status === 'active',
    credits: Number(row.credits_per_recipient),
    remainingSlots: remaining,
    expiresAt: summary.expiresAt,
    status,
  };
}

// ---------------------------------------------------------------------------
// Redemption: atomic single-statement grant
// ---------------------------------------------------------------------------

export interface RedeemInput {
  /** Raw code as typed or linked; normalized server-side. */
  code: string;
  /**
   * Server-verified stable user ID (e.g. Clerk ID from auth, never a form
   * field). The signup milestone supplies this after authentication and a
   * verified email.
   */
  clerkUserId: string;
  /** Trusted eligibility: the caller must have verified the email/identity. */
  emailVerified: boolean;
  /** Trusted eligibility: only a brand-new account may claim a signup bonus. */
  isNewAccount: boolean;
  environment?: string;
  /** Server-owned signup attempt, bound to this user before redemption. */
  signupAttemptId?: string;
}

/**
 * Redeem an invite code for a signup bonus.
 *
 * A completed redemption is resolved first and returned as-is, so retries and
 * late auth callbacks recover the receipt without re-checking new-account
 * eligibility. Only a genuinely new claim runs the eligibility gates.
 *
 * The grant runs as a lock statement plus the grant statement in ONE
 * transaction: SELECT ... FOR UPDATE on the invite row first, then the
 * atomic grant (capacity claim + redemption record + ledger append +
 * balance update). Concurrent claims for the last slot therefore serialize
 * on the invite row and capacity cannot be exceeded. Every grant predicate
 * — especially the expiry comparison against clock_timestamp() — is
 * evaluated after the serialization lock is held, so a code expiring while
 * a claim waits on a pure row lock grants nothing (a lone UPDATE ... WHERE
 * could evaluate its volatile timestamp before the wait with no
 * re-evaluation on release).
 * The per-account single-bonus rule is enforced by a UNIQUE constraint, so a
 * simultaneous cross-code double claim rolls back the loser, which is then
 * reported as already-claimed (never as the other invite's receipt).
 * Public signup additionally locks and consumes its server-owned attempt in
 * this transaction. Changing the selected code or declining the offer cannot
 * race a grant. The HTTP boundary derives eligibility from Clerk, not forms.
 */
export async function redeemInviteCredit(input: RedeemInput, client?: Sql): Promise<InviteReceipt> {
  const userId = input.clerkUserId.trim();
  const normalized = normalizeInviteCode(input.code);
  if (!normalized) throw new InviteCodeInvalidError('That invite code is not valid.');
  const sql = client ?? getSql();
  await ensureCreditSchema(client);
  const environment = resolveCreditEnvironment(input.environment);
  const digest = inviteCodeDigest(normalized);

  const prior = await readExistingReceipt(sql, environment, userId);
  const inviteRows = await sql`
    SELECT id FROM credit_invites
    WHERE environment = ${environment} AND code_digest = ${digest}
    LIMIT 1
  `;
  const inviteId = (inviteRows[0] as { id: string } | undefined)?.id;
  if (!inviteId) throw new InviteCodeInvalidError('That invite code is not valid.');
  if (prior) {
    if (prior.inviteId === inviteId) return prior;
    throw new InviteAlreadyClaimedError('This account has already claimed an invite bonus.');
  }

  if (!userId) throw new InviteNotEligibleError('A verified account is required.');
  if (!input.emailVerified) {
    throw new InviteNotEligibleError('Verify your email before claiming invite credits.');
  }
  if (!input.isNewAccount) {
    throw new InviteNotEligibleError('Invite bonuses are for new accounts only.');
  }

  const operationId = `invite-bonus:${userId}`;
  let receiptRows;
  try {
    // Acquire the invite row lock FIRST, in the same transaction as the
    // grant: every check in the grant statement — especially the expiry
    // comparison — is then evaluated after the lock is held. A volatile
    // timestamp inside a lone UPDATE ... WHERE may be evaluated before a
    // lock wait and is NOT re-checked when the blocker releases a pure
    // SELECT FOR UPDATE lock without modifying the row, which would admit
    // an already-expired code.
    const lockInvite = sql`
      SELECT id
      FROM credit_invites
      WHERE environment = ${environment} AND code_digest = ${digest}
      LIMIT 1
      FOR UPDATE
    `;
    const runGrant = sql`
      WITH target AS (
        SELECT id
        FROM credit_invites
        WHERE environment = ${environment} AND code_digest = ${digest}
        LIMIT 1
      ), already AS (
        SELECT id
        FROM invite_redemptions
        WHERE environment = ${environment} AND recipient_user_id = ${userId}
        LIMIT 1
      ), claimed AS (
        UPDATE credit_invites AS inv
        SET redeemed_count = inv.redeemed_count + 1, updated_at = clock_timestamp()
        FROM target
        WHERE inv.id = target.id
          AND NOT EXISTS (SELECT 1 FROM already)
          AND inv.revoked_at IS NULL
          AND inv.expires_at > clock_timestamp()
          AND inv.redeemed_count < inv.max_recipients
          AND (${input.signupAttemptId ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM credit_signup_attempts s
            WHERE s.id = ${input.signupAttemptId ?? null} AND s.environment = ${environment}
              AND s.clerk_user_id = ${userId} AND s.status = 'pending'
              AND s.code_digest = ${digest} AND s.expires_at > clock_timestamp()
          ))
        RETURNING inv.id AS invite_id, inv.credits_per_recipient AS amount
      ), ledger_grant AS (
        INSERT INTO credit_ledger (id, environment, clerk_user_id, amount, kind, reason, invite_id, operation_id)
        SELECT ${newId()}, ${environment}, ${userId}, claimed.amount, 'invite_grant',
               'Invite signup bonus', claimed.invite_id, ${operationId}
        FROM claimed
        RETURNING id AS ledger_id, invite_id, amount
      ), redemption AS (
        INSERT INTO invite_redemptions (id, environment, invite_id, recipient_user_id, amount, ledger_id)
        SELECT ${newId()}, ${environment}, ledger_grant.invite_id, ${userId}, ledger_grant.amount, ledger_grant.ledger_id
        FROM ledger_grant
        RETURNING id AS redemption_id, invite_id, amount, redeemed_at
      ), wallet AS (
        INSERT INTO credit_accounts (environment, clerk_user_id, balance)
        SELECT ${environment}, ${userId}, redemption.amount FROM redemption
        ON CONFLICT (environment, clerk_user_id)
        DO UPDATE SET balance = credit_accounts.balance + EXCLUDED.balance, updated_at = clock_timestamp()
        RETURNING balance
      ), completed_signup AS (
        UPDATE credit_signup_attempts
        SET status = 'credited', completed_at = clock_timestamp()
        WHERE id = ${input.signupAttemptId ?? null} AND environment = ${environment}
          AND clerk_user_id = ${userId} AND EXISTS (SELECT 1 FROM wallet)
        RETURNING id
      )
      SELECT redemption.redemption_id, redemption.invite_id, redemption.amount,
             redemption.redeemed_at, wallet.balance
      FROM redemption CROSS JOIN wallet
    `;
    const lockSignup = input.signupAttemptId ? [sql`
      SELECT id FROM credit_signup_attempts
      WHERE id = ${input.signupAttemptId} AND environment = ${environment}
        AND clerk_user_id = ${userId}
      FOR UPDATE
    `] : [];
    const txResults = await sql.transaction([...lockSignup, lockInvite, runGrant]);
    const offset = lockSignup.length;
    if (!txResults[offset] || txResults[offset].length === 0) {
      throw new InviteCodeInvalidError('That invite code is not valid.');
    }
    receiptRows = txResults[offset + 1];
  } catch (error) {
    // A unique violation means this request lost a simultaneous race for the
    // same account: re-read the winner. A same-code repeat returns the
    // receipt; a different invite is rejected as already-claimed.
    if (isUniqueViolation(error)) {
      const winner = await readExistingReceipt(sql, environment, userId);
      if (winner) {
        if (winner.inviteId === inviteId) return winner;
        throw new InviteAlreadyClaimedError('This account has already claimed an invite bonus.');
      }
    }
    throw error;
  }

  if (receiptRows[0]) {
    const row = receiptRows[0] as {
      redemption_id: string;
      invite_id: string;
      amount: number | string;
      redeemed_at: string | Date;
      balance: number | string;
    };
    return {
      redemptionId: row.redemption_id,
      inviteId: row.invite_id,
      amountCredits: Number(row.amount),
      balanceAfter: Number(row.balance),
      redeemedAt: iso(row.redeemed_at),
    };
  }

  // No grant: diagnose with database state (a concurrent claim may have won).
  const existing = await readExistingReceipt(sql, environment, userId);
  if (existing) {
    if (existing.inviteId === inviteId) return existing;
    throw new InviteAlreadyClaimedError('This account has already claimed an invite bonus.');
  }
  if (input.signupAttemptId) {
    const eligible = await sql`
      SELECT id FROM credit_signup_attempts
      WHERE id = ${input.signupAttemptId} AND environment = ${environment}
        AND clerk_user_id = ${userId} AND status = 'pending'
        AND code_digest = ${digest} AND expires_at > clock_timestamp()
    `;
    if (!eligible.length) throw new SignupChangedError('Signup changed or expired. Refresh to see its current status.');
  }
  const inviteState = await sql`
    SELECT revoked_at, expires_at, redeemed_count, max_recipients
    FROM credit_invites
    WHERE environment = ${environment} AND code_digest = ${digest}
    LIMIT 1
  `;
  if (!inviteState[0]) throw new InviteCodeInvalidError('That invite code is not valid.');
  const state = inviteState[0] as {
    revoked_at: string | Date | null;
    expires_at: string | Date;
    redeemed_count: number | string;
    max_recipients: number | string;
  };
  if (state.revoked_at) throw new InviteRevokedError('This invite has been revoked.');
  const expired = await sql`SELECT clock_timestamp() >= ${iso(state.expires_at)}::timestamptz AS expired`;
  if ((expired[0] as { expired: boolean }).expired) {
    throw new InviteExpiredError('This invite has expired.');
  }
  if (Number(state.redeemed_count) >= Number(state.max_recipients)) {
    throw new InviteFullError('This invite has reached its recipient limit.');
  }
  throw new InviteFullError('This invite is no longer available.');
}

async function readExistingReceipt(sql: Sql, environment: string, userId: string): Promise<InviteReceipt | null> {
  const rows = await sql`
    SELECT r.id, r.invite_id, r.amount, r.redeemed_at, a.balance
    FROM invite_redemptions r
    LEFT JOIN credit_accounts a
      ON a.environment = r.environment AND a.clerk_user_id = r.recipient_user_id
    WHERE r.environment = ${environment} AND r.recipient_user_id = ${userId}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  const row = rows[0] as { id: string; invite_id: string; amount: number | string; redeemed_at: string | Date; balance: number | string | null };
  return {
    redemptionId: row.id,
    inviteId: row.invite_id,
    amountCredits: Number(row.amount),
    balanceAfter: Number(row.balance ?? row.amount),
    redeemedAt: iso(row.redeemed_at),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === '23505'
  );
}

// ---------------------------------------------------------------------------
// Consistency: invite counters vs redemptions vs ledger vs balances
// ---------------------------------------------------------------------------

export interface CreditConsistencyIssue {
  check: string;
  detail: string;
}

/**
 * Cross-check derived counters against source rows. Returns every mismatch;
 * empty means consistent. Intended for tests and admin diagnostics — every
 * check reads committed state, so run it when no grant is in flight.
 */
export async function checkCreditConsistency(environment?: string, client?: Sql): Promise<CreditConsistencyIssue[]> {
  const sql = client ?? getSql();
  await ensureCreditSchema(client);
  const env = resolveCreditEnvironment(environment);
  const issues: CreditConsistencyIssue[] = [];
  const counterRows = await sql`
    SELECT i.id, i.redeemed_count, COUNT(r.id)::int AS actual
    FROM credit_invites i
    LEFT JOIN invite_redemptions r ON r.invite_id = i.id AND r.environment = i.environment
    WHERE i.environment = ${env}
    GROUP BY i.id, i.redeemed_count
  `;
  for (const value of counterRows) {
    const row = value as { id: string; redeemed_count: number | string; actual: number | string };
    if (Number(row.redeemed_count) !== Number(row.actual)) {
      issues.push({ check: 'invite_counter', detail: `invite ${row.id}: redeemed_count=${row.redeemed_count} but ${row.actual} redemptions` });
    }
  }
  const balanceRows = await sql`
    SELECT a.clerk_user_id, a.balance, COALESCE(SUM(l.amount), 0)::int AS ledger_total
    FROM credit_accounts a
    LEFT JOIN credit_ledger l ON l.environment = a.environment AND l.clerk_user_id = a.clerk_user_id
    WHERE a.environment = ${env}
    GROUP BY a.clerk_user_id, a.balance
  `;
  for (const value of balanceRows) {
    const row = value as { clerk_user_id: string; balance: number | string; ledger_total: number | string };
    if (Number(row.balance) !== Number(row.ledger_total)) {
      issues.push({ check: 'account_balance', detail: `account ${row.clerk_user_id}: balance=${row.balance} but ledger sums to ${row.ledger_total}` });
    }
  }
  const orphanRows = await sql`
    SELECT r.id
    FROM invite_redemptions r
    LEFT JOIN credit_ledger l ON l.id = r.ledger_id
    WHERE r.environment = ${env} AND l.id IS NULL
    LIMIT 5
  `;
  for (const value of orphanRows) {
    issues.push({ check: 'redemption_ledger_link', detail: `redemption ${(value as { id: string }).id} has no ledger entry` });
  }
  return issues;
}
