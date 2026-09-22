import { randomUUID } from 'node:crypto';
import { ProviderAuthError, withMetaApiKey } from '@sparkade/server/providers/base';
import { withProviderRequestPolicy } from '@sparkade/server/providers/request-policy';
import { defaultConfig } from '@sparkade/server/storage/config';
import { metaSpendPolicy, SHARED_META_KEY } from './kiosk-meta-spend';
import type { MetaPricing } from './meta-request-cost';
import type { GenerationPrincipal } from '@sparkade/generation/service-auth';
import { getSql } from './db';
import { normalizeKioskName } from './kiosks';
import { ensureKioskBillingSchema } from './kiosk-billing-store';
export { ensureKioskBillingSchema } from './kiosk-billing-store';
import { scope, type GenerationRow } from './generation/store';
import {
  decryptKioskMetaKey,
  encryptKioskMetaKey,
  KioskBillingError,
  normalizeMetaApiKey,
} from './kiosk-meta-secret';

export interface KioskMetaCredentialSummary {
  id: string;
  label: string;
  suffix: string;
  revoked: boolean;
  assignedKiosks: number;
}

/** Safe projections only: admin rendering never selects ciphertext. */
export async function listKioskMetaCredentials(
  ownerUserId: string,
): Promise<KioskMetaCredentialSummary[]> {
  await ensureKioskBillingSchema();
  const rows = await getSql()`SELECT c.id,c.label,c.key_suffix,c.revoked_at,
    (SELECT count(*) FROM kiosk_meta_assignments a JOIN kiosks k ON k.id=a.kiosk_id
      WHERE a.credential_id=c.id AND a.scope=c.scope AND k.revoked_at IS NULL) AS assigned
    FROM kiosk_meta_credentials c WHERE c.owner_user_id=${ownerUserId} AND c.scope=${scope()}
    ORDER BY c.created_at DESC`;
  return rows.map((r) => ({
    id: String(r.id),
    label: String(r.label),
    suffix: String(r.key_suffix),
    revoked: Boolean(r.revoked_at),
    assignedKiosks: Number(r.assigned),
  }));
}

export async function listKioskMetaAssignments(
  ownerUserId: string,
): Promise<Record<string, string>> {
  await ensureKioskBillingSchema();
  const rows = await getSql()`SELECT a.kiosk_id,a.credential_id FROM kiosk_meta_assignments a
    JOIN kiosks k ON k.id=a.kiosk_id WHERE k.owner_user_id=${ownerUserId} AND a.scope=${scope()}`;
  return Object.fromEntries(rows.map((r) => [String(r.kiosk_id), String(r.credential_id)]));
}

export async function saveKioskMetaCredential(input: {
  actorUserId: string;
  credentialId?: string;
  label: string;
  apiKey: string;
}): Promise<void> {
  const label = normalizeKioskName(input.label);
  if (!label) throw new KioskBillingError('Enter a credential name of up to 80 characters.');
  const key = normalizeMetaApiKey(input.apiKey);
  const id = input.credentialId ?? randomUUID();
  const encrypted = encryptKioskMetaKey(key, scope(), id);
  await ensureKioskBillingSchema();
  const sql = getSql();
  const changed = input.credentialId
    ? await sql`WITH changed AS (
        UPDATE kiosk_meta_credentials SET label=${label},encrypted_key=${encrypted},
          key_suffix=${key.slice(-4)},updated_at=now()
        WHERE id=${id} AND scope=${scope()} AND owner_user_id=${input.actorUserId} AND revoked_at IS NULL RETURNING id
      ) INSERT INTO kiosk_billing_events(id,scope,actor_user_id,action,credential_id)
        SELECT ${randomUUID()},${scope()},${input.actorUserId},'rotate',id FROM changed RETURNING id`
    : await sql`WITH changed AS (
        INSERT INTO kiosk_meta_credentials(id,scope,owner_user_id,label,encrypted_key,key_suffix)
        VALUES(${id},${scope()},${input.actorUserId},${label},${encrypted},${key.slice(-4)}) RETURNING id
      ) INSERT INTO kiosk_billing_events(id,scope,actor_user_id,action,credential_id)
        SELECT ${randomUUID()},${scope()},${input.actorUserId},'create',id FROM changed RETURNING id`;
  if (!changed.length)
    throw new KioskBillingError('That credential is unavailable or you cannot manage it.');
}

export async function disableKioskMetaCredential(
  actorUserId: string,
  credentialId: string,
): Promise<void> {
  await ensureKioskBillingSchema();
  const changed = await getSql()`WITH changed AS (
    UPDATE kiosk_meta_credentials SET revoked_at=now(),updated_at=now(),encrypted_key=''
    WHERE id=${credentialId} AND scope=${scope()} AND owner_user_id=${actorUserId} AND revoked_at IS NULL RETURNING id
  ) INSERT INTO kiosk_billing_events(id,scope,actor_user_id,action,credential_id)
    SELECT ${randomUUID()},${scope()},${actorUserId},'disable',id FROM changed RETURNING id`;
  if (!changed.length)
    throw new KioskBillingError('That credential is unavailable or you cannot manage it.');
}

export async function assignKioskMetaCredential(
  actorUserId: string,
  kioskId: string,
  credentialId: string,
): Promise<void> {
  // The retired standalone generation worker has no credential lookup; do not
  // offer an override that it could silently ignore.
  if (process.env.SPARKADE_GENERATION_BACKEND !== 'vercel') {
    throw new KioskBillingError(
      'Enable the Vercel cloud generation backend before assigning Meta credentials.',
    );
  }
  await ensureKioskBillingSchema();
  const changed = await getSql()`WITH changed AS (
    INSERT INTO kiosk_meta_assignments(kiosk_id,scope,credential_id)
    SELECT k.id,c.scope,c.id FROM kiosks k CROSS JOIN kiosk_meta_credentials c
    WHERE k.id=${kioskId} AND k.owner_user_id=${actorUserId} AND k.revoked_at IS NULL
      AND c.id=${credentialId} AND c.owner_user_id=${actorUserId} AND c.scope=${scope()} AND c.revoked_at IS NULL
    ON CONFLICT(kiosk_id,scope) DO UPDATE SET credential_id=excluded.credential_id,updated_at=now()
    RETURNING kiosk_id,credential_id
  ) INSERT INTO kiosk_billing_events(id,scope,actor_user_id,action,kiosk_id,credential_id)
    SELECT ${randomUUID()},${scope()},${actorUserId},'assign',kiosk_id,credential_id FROM changed RETURNING id`;
  if (!changed.length)
    throw new KioskBillingError('The kiosk or credential is unavailable, or you cannot manage it.');
}

/** Explicit billing action: clearing an override enables shared-key spending for new jobs. */
export async function clearKioskMetaCredential(
  actorUserId: string,
  kioskId: string,
): Promise<void> {
  await ensureKioskBillingSchema();
  const changed = await getSql()`WITH changed AS (
    DELETE FROM kiosk_meta_assignments a USING kiosks k
    WHERE a.kiosk_id=k.id AND k.id=${kioskId} AND k.owner_user_id=${actorUserId}
      AND k.revoked_at IS NULL AND a.scope=${scope()} RETURNING a.kiosk_id,a.credential_id
  ) INSERT INTO kiosk_billing_events(id,scope,actor_user_id,action,kiosk_id,credential_id)
    SELECT ${randomUUID()},${scope()},${actorUserId},'use-shared',kiosk_id,credential_id FROM changed RETURNING id`;
  if (!changed.length)
    throw new KioskBillingError('That kiosk has no override or you cannot manage it.');
}

export async function kioskMetaCredentialId(
  principal: GenerationPrincipal,
): Promise<string | null> {
  if (principal.kioskId === null && !principal.owner.startsWith('kiosk:')) return null;
  if (!principal.kioskId || principal.owner !== `kiosk:${principal.kioskId}`) {
    throw new ProviderAuthError('Kiosk billing identity is invalid.');
  }
  await ensureKioskBillingSchema();
  const rows = await getSql()`SELECT a.credential_id FROM kiosks k
    LEFT JOIN kiosk_meta_assignments a ON a.kiosk_id=k.id AND a.scope=${scope()}
    WHERE k.id=${principal.kioskId} AND k.revoked_at IS NULL`;
  if (!rows.length)
    throw new ProviderAuthError('This kiosk is no longer authorized to generate games.');
  return rows[0]!.credential_id == null ? null : String(rows[0]!.credential_id);
}

async function metaKey(
  principal: GenerationPrincipal,
  credentialId: string | null,
): Promise<string | null> {
  if (credentialId === null) return null;
  if (!principal.kioskId || principal.owner !== `kiosk:${principal.kioskId}`) {
    throw new ProviderAuthError('Kiosk billing identity is invalid.');
  }
  await ensureKioskBillingSchema();
  const rows = await getSql()`SELECT c.encrypted_key FROM kiosk_meta_credentials c JOIN kiosks k
    ON k.owner_user_id=c.owner_user_id WHERE k.id=${principal.kioskId} AND k.revoked_at IS NULL
      AND c.id=${credentialId} AND c.scope=${scope()} AND c.revoked_at IS NULL`;
  if (!rows.length)
    throw new ProviderAuthError(
      'The kiosk Meta credential is disabled or unavailable. Ask an administrator to update it.',
    );
  try {
    return decryptKioskMetaKey(String(rows[0]!.encrypted_key), scope(), credentialId);
  } catch {
    throw new ProviderAuthError(
      'The kiosk Meta credential cannot be opened. Ask an administrator to check credential storage.',
    );
  }
}

export async function withKioskMetaCredential<T>(
  principal: GenerationPrincipal,
  credentialId: string | null,
  work: () => Promise<T>,
  usage?: { pricing: MetaPricing; jobId: string },
): Promise<T> {
  const config = defaultConfig();
  const pricing = usage?.pricing ?? {
    config,
    pricing: config.pricing,
    imagePricing: {
      model: config.imageGeneration.model,
      perImageUsd: config.imageGeneration.pricePerImageUsd,
    },
  };
  return withMetaApiKey(await metaKey(principal, credentialId), () =>
    withProviderRequestPolicy(
      metaSpendPolicy(credentialId ?? SHARED_META_KEY, principal.owner, pricing, usage?.jobId),
      work,
    ),
  );
}

/** Old jobs bind once on first use; new jobs bind at creation. Reassignment cannot
 * make retries fall back to shared billing, and raw secrets never enter job state. */
export async function withJobMetaCredential<T>(
  row: GenerationRow,
  work: () => Promise<T>,
): Promise<T> {
  if (!row.owner.startsWith('kiosk:'))
    return withKioskMetaCredential(row.principal, null, work, {
      pricing: row.state,
      jobId: row.id,
    });
  if (row.principal.owner !== row.owner)
    throw new ProviderAuthError('Kiosk billing identity is invalid.');
  let id = row.meta_credential_id ?? null;
  if (!row.meta_credential_bound) {
    const current = await kioskMetaCredentialId(row.principal);
    const sql = getSql();
    const bound =
      await sql`UPDATE generation_jobs SET meta_credential_id=${current},meta_credential_bound=TRUE
      WHERE id=${row.id} AND scope=${scope()} AND meta_credential_bound=FALSE RETURNING meta_credential_id`;
    const saved = bound.length
      ? bound
      : await sql`SELECT meta_credential_id FROM generation_jobs
      WHERE id=${row.id} AND scope=${scope()} AND meta_credential_bound=TRUE`;
    if (!saved.length) throw new ProviderAuthError('Kiosk billing assignment is unavailable.');
    id = saved[0]!.meta_credential_id == null ? null : String(saved[0]!.meta_credential_id);
  }
  return withKioskMetaCredential(row.principal, id, work, { pricing: row.state, jobId: row.id });
}
