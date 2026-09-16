import { createHash, randomBytes } from 'node:crypto';
import { getSql } from './db';
import {
  decryptInviteCode, encryptInviteCode, ensureCreditSchema, getCreditBalance,
  inviteCodeDigest, InviteCodeInvalidError, InviteNotEligibleError, lookupInviteOffer,
  normalizeInviteCode, redeemInviteCredit, resolveCreditEnvironment, SignupChangedError,
  type Sql,
} from './invites';

export const SIGNUP_COOKIE = 'sparkade_signup';
export const SIGNUP_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Only these application destinations may survive authentication. */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500) return '/me';
  if (!/^\/(?:me|create|play|admin|p|u)(?:[/?#]|$)/.test(value)) return '/me';
  if (/[\\\s%]/.test(value) || value.includes('//') || [...value].some((char) => char.charCodeAt(0) < 32)) return '/me';
  const url = new URL(value, 'https://sparkade.invalid');
  // Reject dot-segment normalization, even if it happened to remain same-origin.
  if (url.pathname !== value.split(/[?#]/)[0]) return '/me';
  return value;
}

export interface SignupIdentity {
  userId: string;
  createdAt: number;
  emailVerified: boolean;
}

export interface SignupAttempt {
  id: string;
  status: 'pending' | 'credited' | 'zero';
  returnPath: string;
  code: string | null;
  expiresAt: string;
}

type AttemptRow = {
  id: string; status: SignupAttempt['status']; return_path: string;
  code_cipher: string | null; expires_at: Date | string;
};

function mapAttempt(row: AttemptRow): SignupAttempt {
  return {
    id: row.id, status: row.status, returnPath: safeReturnPath(row.return_path),
    // Completed attempts don't need a working encryption key to show receipts.
    code: row.code_cipher && row.status === 'pending' ? decryptInviteCode(row.code_cipher) : null,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

function tokenId(token: string): string | null {
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? createHash('sha256').update(token).digest('hex') : null;
}

export class SignupRateLimitError extends Error {}

/** Shared fixed windows, with a global cap as well as a hashed network/user key. */
export async function limitSignupRequests(key: string, authenticated: boolean, environment?: string, client?: Sql): Promise<void> {
  await ensureCreditSchema(client);
  const sql = client ?? getSql();
  const env = resolveCreditEnvironment(environment);
  const bucket = createHash('sha256').update(`${authenticated ? 'user' : 'network'}:${key}`).digest('hex');
  // The first statement bounds how many distinct per-client rows can be made.
  for (const [name, limit] of [['global', 200], [bucket, authenticated ? 30 : 20]] as const) {
    const rows = await sql`
      INSERT INTO credit_signup_limits (environment, bucket, window_start, requests)
      VALUES (${env}, ${name}, date_trunc('minute', clock_timestamp()), 1)
      ON CONFLICT (environment, bucket) DO UPDATE
      SET window_start = EXCLUDED.window_start,
          requests = CASE WHEN credit_signup_limits.window_start < EXCLUDED.window_start THEN 1
                          ELSE credit_signup_limits.requests + 1 END
      WHERE credit_signup_limits.window_start < EXCLUDED.window_start OR credit_signup_limits.requests < ${limit}
      RETURNING requests
    `;
    if (!rows.length) throw new SignupRateLimitError('Too many attempts. Please wait a minute and try again.');
  }
  await sql`DELETE FROM credit_signup_limits WHERE environment = ${env} AND window_start < clock_timestamp() - INTERVAL '1 day'`;
  // Unbound attempts are short-lived bearer capabilities; keep bound receipts.
  await sql`DELETE FROM credit_signup_attempts WHERE environment = ${env} AND clerk_user_id IS NULL AND expires_at < clock_timestamp()`;
}

async function validatedCode(rawCode: string, environment: string, client?: Sql): Promise<string | null> {
  if (!rawCode.trim()) return null;
  const code = normalizeInviteCode(rawCode);
  if (!code) throw new InviteCodeInvalidError('That invite code is not valid. Check it and try again.');
  const offer = await lookupInviteOffer(code, environment, client);
  if (!offer.valid) {
    const reason = offer.status === 'invalid' ? 'not valid' : offer.status === 'exhausted' ? 'fully claimed' : offer.status;
    throw new InviteCodeInvalidError(`That invite is ${reason}. Try another code or continue without invite credits.`);
  }
  return code;
}

export async function startSignupAttempt(rawCode: string, returnPath: string, environment?: string, client?: Sql): Promise<string> {
  await ensureCreditSchema(client);
  const sql = client ?? getSql();
  const env = resolveCreditEnvironment(environment);
  const code = await validatedCode(rawCode, env, client);
  const token = randomBytes(32).toString('base64url');
  await sql`
    INSERT INTO credit_signup_attempts (id, environment, code_cipher, code_digest, return_path)
    VALUES (${tokenId(token)}, ${env}, ${code ? encryptInviteCode(code) : null},
      ${code ? inviteCodeDigest(code) : null}, ${safeReturnPath(returnPath)})
  `;
  return token;
}

/** Read-only before registration. A visit never consumes invite capacity. */
export async function readSignupAttempt(token: string | undefined, environment?: string, client?: Sql): Promise<SignupAttempt | null> {
  const id = token ? tokenId(token) : null;
  if (!id) return null;
  await ensureCreditSchema(client);
  const sql = client ?? getSql();
  const rows = await sql`
    SELECT * FROM credit_signup_attempts WHERE id = ${id} AND environment = ${resolveCreditEnvironment(environment)}
      AND clerk_user_id IS NULL AND expires_at > clock_timestamp() LIMIT 1
  `;
  return rows[0] ? mapAttempt(rows[0] as AttemptRow) : null;
}

/** Recovery by authenticated user ID works even when the signup cookie is gone. */
export async function getAccountSignup(userId: string, environment?: string, client?: Sql): Promise<SignupAttempt | null> {
  await ensureCreditSchema(client);
  const sql = client ?? getSql();
  const rows = await sql`
    SELECT * FROM credit_signup_attempts
    WHERE environment = ${resolveCreditEnvironment(environment)} AND clerk_user_id = ${userId} LIMIT 1
  `;
  return rows[0] ? mapAttempt(rows[0] as AttemptRow) : null;
}

export async function bindSignupAttempt(identity: SignupIdentity, token?: string, environment?: string, client?: Sql): Promise<SignupAttempt | null> {
  const prior = await getAccountSignup(identity.userId, environment, client);
  if (prior) return prior;
  const id = token ? tokenId(token) : null;
  if (!id || !identity.userId || !Number.isFinite(identity.createdAt)) return null;
  const sql = client ?? getSql();
  const env = resolveCreditEnvironment(environment);
  try {
    const rows = await sql`
      UPDATE credit_signup_attempts SET clerk_user_id = ${identity.userId}
      WHERE id = ${id} AND environment = ${env} AND clerk_user_id IS NULL
        AND created_at <= ${new Date(identity.createdAt).toISOString()}::timestamptz
        AND expires_at > ${new Date(identity.createdAt).toISOString()}::timestamptz
        AND expires_at > clock_timestamp()
      RETURNING *
    `;
    if (rows[0]) return mapAttempt(rows[0] as AttemptRow);
  } catch (error) {
    // Two callbacks may try to bind different browser attempts to one account.
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== '23505') throw error;
  }
  return getAccountSignup(identity.userId, env, client);
}

export type SignupChoice = { kind: 'redeem' } | { kind: 'replace'; code: string } | { kind: 'zero' };
export interface SignupCompletion {
  status: 'credited' | 'zero' | 'ineligible';
  balance: number;
  creditsAdded: number;
  returnPath: string;
}

export async function finishSignup(
  identity: SignupIdentity, token: string | undefined, choice: SignupChoice,
  environment?: string, client?: Sql,
): Promise<SignupCompletion> {
  const env = resolveCreditEnvironment(environment);
  const sql = client ?? getSql();
  let attempt = await bindSignupAttempt(identity, token, env, client);
  if (!attempt) return { status: 'ineligible', balance: await getCreditBalance(identity.userId, env, client), creditsAdded: 0, returnPath: '/me' };

  if (attempt.status === 'pending') {
    if (choice.kind === 'replace') {
      const code = await validatedCode(choice.code, env, client);
      if (!code) throw new InviteCodeInvalidError('Enter a replacement invite code.');
      await sql`
        UPDATE credit_signup_attempts SET code_cipher = ${encryptInviteCode(code)}, code_digest = ${inviteCodeDigest(code)}
        WHERE id = ${attempt.id} AND environment = ${env} AND clerk_user_id = ${identity.userId}
          AND status = 'pending' AND expires_at > clock_timestamp()
      `;
      attempt = (await getAccountSignup(identity.userId, env, client))!;
    }
    if (attempt.status === 'pending' && (choice.kind === 'zero' || !attempt.code)) {
      await sql`
        UPDATE credit_signup_attempts SET status = 'zero', completed_at = clock_timestamp(), code_cipher = NULL, code_digest = NULL
        WHERE id = ${attempt.id} AND environment = ${env} AND clerk_user_id = ${identity.userId} AND status = 'pending'
      `;
    } else if (attempt.status === 'pending') {
      if (!identity.emailVerified) throw new InviteNotEligibleError('Verify your primary email in account settings, then try again to receive your invite credits.');
      await redeemInviteCredit({
        code: attempt.code!, clerkUserId: identity.userId, emailVerified: identity.emailVerified,
        isNewAccount: true, environment: env, signupAttemptId: attempt.id,
      }, client);
    }
    attempt = (await getAccountSignup(identity.userId, env, client))!;
  }
  if (attempt.status === 'pending') throw new SignupChangedError('Signup changed or expired. Retry, or continue without invite credits.');
  const receipt = await sql`
    SELECT amount FROM invite_redemptions WHERE environment = ${env} AND recipient_user_id = ${identity.userId} LIMIT 1
  `;
  return {
    status: attempt.status, balance: await getCreditBalance(identity.userId, env, client),
    creditsAdded: Number(receipt[0]?.amount ?? 0), returnPath: attempt.returnPath,
  };
}
