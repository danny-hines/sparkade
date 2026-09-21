import type { KioskRuntimeReport } from './kiosk-runtime';
import {
  parseKioskDisplayCopy,
  resolveKioskDisplayCopy,
  type KioskDisplayCopy,
} from '@sparkade/shared';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { getSql } from './db';

const PAIRING_ALPHABET = '23456789BCDFGHJKMNPQRSTVWXYZ';
const PAIRING_CODE_LENGTH = 8;
const KIOSK_NAME_MAX_LENGTH = 80;

export const KIOSK_CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;
export const KIOSK_CREDENTIAL_HASH_PATTERN = /^[a-f0-9]{64}$/;
export const KIOSK_TOKEN_PATTERN = /^spk_kiosk_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/;

export type FeedVisibility = 'listed' | 'unlisted';

export interface KioskPrincipal {
  kind: 'registered';
  kioskId: string;
  credentialId: string;
  name: string;
  defaultFeedVisibility: FeedVisibility;
  displayCopy: KioskDisplayCopy;
}

export interface ManagedKiosk {
  id: string;
  name: string;
  ownerUserId: string;
  defaultFeedVisibility: FeedVisibility;
  displayCopy: KioskDisplayCopy;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  gameCount: number;
  runtime: KioskRuntimeReport | null;
  runtimeReportedAt: string | null;
}

export type KioskCredentialStatus =
  | {
      state: 'registered';
      kioskId: string;
      name: string;
      defaultFeedVisibility: FeedVisibility;
      displayCopy: KioskDisplayCopy;
    }
  | { state: 'pending'; code: string; expiresAt: string }
  | { state: 'expired' | 'revoked' | 'unregistered' };

type KioskRow = {
  id: string;
  name: string;
  owner_user_id: string;
  default_feed_visibility: FeedVisibility;
  display_copy?: unknown;
  created_at: string | Date;
  updated_at: string | Date;
  last_seen_at: string | Date | null;
  revoked_at: string | Date | null;
  game_count: number | string;
  runtime_report?: KioskRuntimeReport | null;
  runtime_reported_at?: string | Date | null;
};

type CredentialRow = {
  credential_id: string;
  kiosk_id: string;
  name: string;
  default_feed_visibility: FeedVisibility;
  display_copy?: unknown;
  kiosk_revoked_at: string | Date | null;
  credential_revoked_at: string | Date | null;
};

type PairingRow = {
  code: string;
  expires_at: string | Date;
  claimed_at: string | Date | null;
};

let schemaPromise: Promise<void> | null = null;

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalIso(value: string | Date | null): string | null {
  return value ? iso(value) : null;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function pairingCode(): string {
  let code = '';
  for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
    code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normalizePairingCode(value: string): string | null {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized.length !== PAIRING_CODE_LENGTH) return null;
  for (const character of normalized) {
    if (!PAIRING_ALPHABET.includes(character)) return null;
  }
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export function normalizeKioskName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > KIOSK_NAME_MAX_LENGTH) return null;
  for (const character of name) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return null;
  }
  return name;
}

export function isFeedVisibility(value: unknown): value is FeedVisibility {
  return value === 'listed' || value === 'unlisted';
}

export function hashKioskCredential(token: string): string {
  return digest(token);
}

async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kiosks (
          id TEXT PRIMARY KEY,
          owner_user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          default_feed_visibility TEXT NOT NULL DEFAULT 'unlisted'
            CHECK (default_feed_visibility IN ('listed', 'unlisted')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ
        )
      `;
      await sql`ALTER TABLE kiosks ADD COLUMN IF NOT EXISTS runtime_report JSONB`;
      await sql`ALTER TABLE kiosks ADD COLUMN IF NOT EXISTS runtime_reported_at TIMESTAMPTZ`;
      await sql`ALTER TABLE kiosks ADD COLUMN IF NOT EXISTS display_copy JSONB NOT NULL DEFAULT '{}'::jsonb`;
      await sql`
        CREATE TABLE IF NOT EXISTS kiosk_credentials (
          id TEXT PRIMARY KEY,
          kiosk_id TEXT NOT NULL REFERENCES kiosks(id) ON DELETE CASCADE,
          secret_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_used_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS kiosk_pairings (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          credential_id TEXT NOT NULL UNIQUE,
          secret_hash TEXT NOT NULL,
          request_fingerprint TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          claimed_at TIMESTAMPTZ,
          kiosk_id TEXT
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kiosk_pairings_expiry
        ON kiosk_pairings (expires_at)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kiosk_credentials_kiosk
        ON kiosk_credentials (kiosk_id)
      `;
    })();
  }

  try {
    await schemaPromise;
  } catch (error) {
    schemaPromise = null;
    throw error;
  }
}

export class PairingRateLimitError extends Error {}
export class PairingCodeError extends Error {}

export async function createKioskPairing(input: {
  credentialId: string;
  secretHash: string;
  requestFingerprint: string;
}): Promise<{ code: string; expiresAt: string }> {
  if (!KIOSK_CREDENTIAL_ID_PATTERN.test(input.credentialId)) {
    throw new PairingCodeError('credential ID is invalid');
  }
  if (!KIOSK_CREDENTIAL_HASH_PATTERN.test(input.secretHash)) {
    throw new PairingCodeError('credential hash is invalid');
  }
  await ensureSchema();
  const sql = getSql();
  const existing = await sql`
    SELECT code, expires_at, claimed_at
    FROM kiosk_pairings
    WHERE credential_id = ${input.credentialId}
      AND secret_hash = ${input.secretHash}
      AND claimed_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
  `;
  if (existing[0]) {
    const row = existing[0] as PairingRow;
    return { code: row.code, expiresAt: iso(row.expires_at) };
  }

  await sql`
    DELETE FROM kiosk_pairings
    WHERE credential_id = ${input.credentialId}
      AND claimed_at IS NULL
  `;
  const recent = await sql`
    SELECT COUNT(*)::int AS count
    FROM kiosk_pairings
    WHERE request_fingerprint = ${input.requestFingerprint}
      AND created_at > NOW() - INTERVAL '10 minutes'
  `;
  if (Number((recent[0] as { count?: number | string } | undefined)?.count ?? 0) >= 8) {
    throw new PairingRateLimitError('too many pairing requests');
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = pairingCode();
    const inserted = await sql`
      INSERT INTO kiosk_pairings (
        id, code, credential_id, secret_hash, request_fingerprint, expires_at
      )
      SELECT
        ${randomUUID()},
        ${code},
        ${input.credentialId},
        ${input.secretHash},
        ${input.requestFingerprint},
        NOW() + INTERVAL '10 minutes'
      WHERE NOT EXISTS (
        SELECT 1 FROM kiosk_credentials WHERE id = ${input.credentialId}
      )
      ON CONFLICT DO NOTHING
      RETURNING code, expires_at, claimed_at
    `;
    if (inserted[0]) {
      const row = inserted[0] as PairingRow;
      return { code: row.code, expiresAt: iso(row.expires_at) };
    }
  }
  throw new PairingCodeError('could not create a pairing code');
}

async function credentialRowForToken(token: string): Promise<CredentialRow | null> {
  const match = KIOSK_TOKEN_PATTERN.exec(token);
  if (!match) return null;
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT c.id AS credential_id,
           k.id AS kiosk_id,
           k.name,
           k.default_feed_visibility,
           k.display_copy,
           k.revoked_at AS kiosk_revoked_at,
           c.revoked_at AS credential_revoked_at
    FROM kiosk_credentials c
    JOIN kiosks k ON k.id = c.kiosk_id
    WHERE c.id = ${match[1]}
      AND c.secret_hash = ${digest(token)}
    LIMIT 1
  `;
  return rows[0] ? (rows[0] as CredentialRow) : null;
}

export async function authenticateKioskToken(token: string): Promise<KioskPrincipal | null> {
  const row = await credentialRowForToken(token);
  if (!row || row.kiosk_revoked_at || row.credential_revoked_at) return null;
  const sql = getSql();
  await Promise.all([
    sql`
      UPDATE kiosk_credentials
      SET last_used_at = NOW()
      WHERE id = ${row.credential_id}
        AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '1 minute')
    `,
    sql`
      UPDATE kiosks
      SET last_seen_at = NOW()
      WHERE id = ${row.kiosk_id}
        AND (last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL '1 minute')
    `,
  ]);
  return {
    kind: 'registered',
    kioskId: row.kiosk_id,
    credentialId: row.credential_id,
    name: row.name,
    defaultFeedVisibility: row.default_feed_visibility,
    displayCopy: resolveKioskDisplayCopy(row.display_copy),
  };
}

export async function getKioskCredentialStatus(token: string): Promise<KioskCredentialStatus> {
  const match = KIOSK_TOKEN_PATTERN.exec(token);
  if (!match) return { state: 'unregistered' };
  const credential = await credentialRowForToken(token);
  if (credential) {
    if (credential.kiosk_revoked_at || credential.credential_revoked_at) {
      return { state: 'revoked' };
    }
    await authenticateKioskToken(token);
    return {
      state: 'registered',
      kioskId: credential.kiosk_id,
      name: credential.name,
      defaultFeedVisibility: credential.default_feed_visibility,
      displayCopy: resolveKioskDisplayCopy(credential.display_copy),
    };
  }

  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT code, expires_at, claimed_at
    FROM kiosk_pairings
    WHERE credential_id = ${match[1]}
      AND secret_hash = ${digest(token)}
    LIMIT 1
  `;
  if (!rows[0]) return { state: 'unregistered' };
  const pairing = rows[0] as PairingRow;
  if (new Date(pairing.expires_at).getTime() <= Date.now()) return { state: 'expired' };
  return { state: 'pending', code: pairing.code, expiresAt: iso(pairing.expires_at) };
}

export async function claimKioskPairing(input: {
  code: string;
  name: string;
  ownerUserId: string;
  defaultFeedVisibility: FeedVisibility;
}): Promise<ManagedKiosk> {
  const code = normalizePairingCode(input.code);
  const name = normalizeKioskName(input.name);
  if (!code || !name || !isFeedVisibility(input.defaultFeedVisibility)) {
    throw new PairingCodeError('Enter a valid pairing code and kiosk name.');
  }
  await ensureSchema();
  const sql = getSql();
  const kioskId = randomUUID();
  const rows = await sql`
    WITH claimed AS (
      UPDATE kiosk_pairings
      SET claimed_at = NOW(), kiosk_id = ${kioskId}
      WHERE code = ${code}
        AND claimed_at IS NULL
        AND expires_at > NOW()
        AND NOT EXISTS (
          SELECT 1 FROM kiosk_credentials
          WHERE id = kiosk_pairings.credential_id
        )
      RETURNING credential_id, secret_hash
    ), created AS (
      INSERT INTO kiosks (id, owner_user_id, name, default_feed_visibility)
      SELECT ${kioskId}, ${input.ownerUserId}, ${name}, ${input.defaultFeedVisibility}
      FROM claimed
      RETURNING id, owner_user_id, name, default_feed_visibility,
                created_at, updated_at, last_seen_at, revoked_at
    ), credential AS (
      INSERT INTO kiosk_credentials (id, kiosk_id, secret_hash)
      SELECT claimed.credential_id, created.id, claimed.secret_hash
      FROM claimed CROSS JOIN created
      RETURNING id
    )
    SELECT created.id,
           created.owner_user_id,
           created.name,
           created.default_feed_visibility,
           created.created_at,
           created.updated_at,
           created.last_seen_at,
           created.revoked_at,
           0::int AS game_count
    FROM created CROSS JOIN credential
  `;
  if (!rows[0]) throw new PairingCodeError('That pairing code is invalid or has expired.');
  return mapKioskRow(rows[0] as KioskRow);
}

function mapKioskRow(row: KioskRow): ManagedKiosk {
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    defaultFeedVisibility: row.default_feed_visibility,
    displayCopy: resolveKioskDisplayCopy(row.display_copy),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    lastSeenAt: optionalIso(row.last_seen_at),
    revokedAt: optionalIso(row.revoked_at),
    gameCount: Number(row.game_count),
    runtime: row.runtime_report ?? null,
    runtimeReportedAt: optionalIso(row.runtime_reported_at ?? null),
  };
}

export async function listManagedKiosks(ownerUserId: string): Promise<ManagedKiosk[]> {
  await ensureSchema();
  await import('./public-games').then((module) => module.ensurePublicGamesSchema());
  const sql = getSql();
  const rows = await sql`
    SELECT k.id,
           k.owner_user_id,
           k.name,
           k.default_feed_visibility,
           k.display_copy,
           k.created_at,
           k.updated_at,
           k.last_seen_at,
           k.revoked_at,
           k.runtime_report,
           k.runtime_reported_at,
           COUNT(g.id)::int AS game_count
    FROM kiosks k
    LEFT JOIN public_games g ON g.kiosk_id = k.id
    WHERE k.owner_user_id = ${ownerUserId}
    GROUP BY k.id
    ORDER BY k.created_at DESC
  `;
  return rows.map((row) => mapKioskRow(row as KioskRow));
}

export async function updateManagedKiosk(input: {
  kioskId: string;
  ownerUserId: string;
  name?: string;
  defaultFeedVisibility?: FeedVisibility;
  displayCopy?: KioskDisplayCopy;
}): Promise<boolean> {
  const name = input.name === undefined ? undefined : normalizeKioskName(input.name);
  if (input.name !== undefined && !name) return false;
  if (input.defaultFeedVisibility !== undefined && !isFeedVisibility(input.defaultFeedVisibility)) {
    return false;
  }
  const displayCopy =
    input.displayCopy === undefined ? undefined : parseKioskDisplayCopy(input.displayCopy);
  if (displayCopy === null) return false;
  if (name === undefined && input.defaultFeedVisibility === undefined && displayCopy === undefined)
    return false;
  await ensureSchema();
  if (name) {
    await import('./public-games').then((module) => module.ensurePublicGamesSchema());
  }
  const sql = getSql();
  const rows = await sql`
    UPDATE kiosks
    SET name = COALESCE(${name ?? null}, name),
        default_feed_visibility = COALESCE(
          ${input.defaultFeedVisibility ?? null},
          default_feed_visibility
        ),
        display_copy = COALESCE(${displayCopy ? JSON.stringify(displayCopy) : null}::jsonb, display_copy),
        updated_at = NOW()
    WHERE id = ${input.kioskId}
      AND owner_user_id = ${input.ownerUserId}
      AND revoked_at IS NULL
    RETURNING id
  `;
  if (rows[0] && name) {
    await sql`
      UPDATE public_games
      SET kiosk_name = ${name}, updated_at = NOW()
      WHERE kiosk_id = ${input.kioskId}
    `;
  }
  return rows.length > 0;
}

export async function revokeManagedKiosk(kioskId: string, ownerUserId: string): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE kiosks
    SET revoked_at = NOW(), updated_at = NOW()
    WHERE id = ${kioskId}
      AND owner_user_id = ${ownerUserId}
      AND revoked_at IS NULL
    RETURNING id
  `;
  if (!rows[0]) return false;
  await sql`
    UPDATE kiosk_credentials
    SET revoked_at = NOW()
    WHERE kiosk_id = ${kioskId}
      AND revoked_at IS NULL
  `;
  return true;
}

/** The authenticated principal supplies kioskId; a device cannot report for another kiosk. */
export async function recordKioskRuntime(
  kioskId: string,
  report: KioskRuntimeReport,
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const json = JSON.stringify(report);
  await sql`
    UPDATE kiosks SET runtime_report = ${json}::jsonb, runtime_reported_at = NOW()
    WHERE id = ${kioskId} AND revoked_at IS NULL
      AND (runtime_reported_at IS NULL OR runtime_reported_at < NOW() - INTERVAL '1 minute'
           OR runtime_report IS DISTINCT FROM ${json}::jsonb)
  `;
}
