import { randomUUID } from 'node:crypto';
import { ProviderAuthError } from '@sparkade/server/providers/base';
import type { ProviderRequestPolicy } from '@sparkade/server/providers/request-policy';
import { getSql } from './db';
import { scope } from './generation/store';
import { ensureKioskBillingSchema } from './kiosk-billing-store';
import { KioskBillingError } from './kiosk-meta-secret';
import { metaRequestAllowance, type MetaPricing } from './meta-request-cost';

export const META_BILLING_TIME_ZONE = 'America/Los_Angeles';
export const SHARED_META_KEY = 'shared';
export class MetaBudgetError extends Error {}
export class MetaCapacityError extends Error {}
export interface MetaKeyLimits {
  dailyUsd: number | null;
  weeklyUsd: number | null;
  concurrency: number | null;
}
export interface MetaSpendSummary {
  keyId: string;
  limits: MetaKeyLimits;
  paused: boolean;
  activeRequests: number;
  periods: Record<'daily' | 'weekly' | 'monthly' | 'lifetime', { spent: number; reserved: number }>;
  nextDailyReset: string;
  nextWeeklyReset: string;
  trackedSince: string | null;
}

/** Server-provided IDs only: callers enforce admin visibility before requesting totals. */
export async function metaSpendSummaries(
  keyIds: string[],
): Promise<Record<string, MetaSpendSummary>> {
  await ensureKioskBillingSchema();
  if (!keyIds.length) return {};
  const rows = await getSql()`WITH clock AS (SELECT
      date_trunc('day', now() AT TIME ZONE ${META_BILLING_TIME_ZONE}) AT TIME ZONE ${META_BILLING_TIME_ZONE} AS day,
      date_trunc('week', now() AT TIME ZONE ${META_BILLING_TIME_ZONE}) AT TIME ZONE ${META_BILLING_TIME_ZONE} AS week,
      date_trunc('month', now() AT TIME ZONE ${META_BILLING_TIME_ZONE}) AT TIME ZONE ${META_BILLING_TIME_ZONE} AS month,
      (date_trunc('day', now() AT TIME ZONE ${META_BILLING_TIME_ZONE})+interval '1 day') AT TIME ZONE ${META_BILLING_TIME_ZONE} AS next_day,
      (date_trunc('week', now() AT TIME ZONE ${META_BILLING_TIME_ZONE})+interval '1 week') AT TIME ZONE ${META_BILLING_TIME_ZONE} AS next_week)
    SELECT k.key_id,l.daily_usd,l.weekly_usd,l.concurrency,l.paused,c.next_day,c.next_week,s.*
    FROM unnest(${keyIds}::text[]) AS k(key_id) CROSS JOIN clock c
    LEFT JOIN kiosk_meta_limits l ON l.key_id=k.key_id AND l.scope=${scope()}
    LEFT JOIN LATERAL (SELECT min(created_at) AS first_at,
      count(*) FILTER (WHERE active_until>now()) AS active,
      COALESCE(sum(charged) FILTER (WHERE created_at>=c.day),0) AS daily_spent,
      COALESCE(sum(reserved) FILTER (WHERE charged IS NULL AND created_at>=c.day),0) AS daily_reserved,
      COALESCE(sum(charged) FILTER (WHERE created_at>=c.week),0) AS weekly_spent,
      COALESCE(sum(reserved) FILTER (WHERE charged IS NULL AND created_at>=c.week),0) AS weekly_reserved,
      COALESCE(sum(charged) FILTER (WHERE created_at>=c.month),0) AS monthly_spent,
      COALESCE(sum(reserved) FILTER (WHERE charged IS NULL AND created_at>=c.month),0) AS monthly_reserved,
      COALESCE(sum(charged),0) AS lifetime_spent,
      COALESCE(sum(reserved) FILTER (WHERE charged IS NULL),0) AS lifetime_reserved
      FROM kiosk_meta_spend WHERE key_id=k.key_id AND scope=${scope()}) s ON TRUE`;
  return Object.fromEntries(
    rows.map((row) => [
      String(row.key_id),
      {
        keyId: String(row.key_id),
        limits: {
          dailyUsd: nullableNumber(row.daily_usd),
          weeklyUsd: nullableNumber(row.weekly_usd),
          concurrency: nullableNumber(row.concurrency),
        },
        paused: Boolean(row.paused),
        activeRequests: Number(row.active),
        periods: Object.fromEntries(
          ['daily', 'weekly', 'monthly', 'lifetime'].map((period) => [
            period,
            {
              spent: Number(row[`${period}_spent`]),
              reserved: Number(row[`${period}_reserved`]),
            },
          ]),
        ) as MetaSpendSummary['periods'],
        nextDailyReset: new Date(row.next_day).toISOString(),
        nextWeeklyReset: new Date(row.next_week).toISOString(),
        trackedSince: row.first_at ? new Date(row.first_at).toISOString() : null,
      },
    ]),
  );
}
const nullableNumber = (value: unknown) => (value == null ? null : Number(value));

export function parseMetaKeyLimits(fields: {
  dailyUsd: string;
  weeklyUsd: string;
  concurrency: string;
}): MetaKeyLimits {
  const budget = (value: string): number | null => {
    if (!value.trim()) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(value.trim()) || Number(value) > 1_000_000_000)
      throw new KioskBillingError(
        'Budgets must be nonnegative USD amounts with at most two decimal places. Leave blank for no cap.',
      );
    return Number(value);
  };
  const concurrency = fields.concurrency.trim();
  if (
    concurrency &&
    (!/^\d+$/.test(concurrency) || Number(concurrency) < 1 || Number(concurrency) > 10_000)
  )
    throw new KioskBillingError(
      'Concurrent requests must be between 1 and 10,000, or blank for the system limit.',
    );
  return {
    dailyUsd: budget(fields.dailyUsd),
    weeklyUsd: budget(fields.weeklyUsd),
    concurrency: concurrency ? Number(concurrency) : null,
  };
}

/** The server action supplies a billing-authorized actor. Shared billing is global. */
export async function setMetaKeyLimits(
  actorUserId: string,
  keyId: string,
  fields: { dailyUsd: string; weeklyUsd: string; concurrency: string },
): Promise<void> {
  const limits = parseMetaKeyLimits(fields);
  await ensureKioskBillingSchema();
  const sql = getSql();
  const result = await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtext(${`meta-billing:${scope()}:${keyId}`}))`,
    sql`WITH changed AS (
      INSERT INTO kiosk_meta_limits(scope,key_id,daily_usd,weekly_usd,concurrency)
      SELECT ${scope()},${keyId},${limits.dailyUsd},${limits.weeklyUsd},${limits.concurrency}
      WHERE ${keyId}= 'shared' OR EXISTS (SELECT 1 FROM kiosk_meta_credentials
        WHERE id=${keyId} AND scope=${scope()} AND owner_user_id=${actorUserId} AND revoked_at IS NULL)
      ON CONFLICT(scope,key_id) DO UPDATE SET daily_usd=excluded.daily_usd,weekly_usd=excluded.weekly_usd,
        concurrency=excluded.concurrency,paused=FALSE,updated_at=now() RETURNING key_id
    ) INSERT INTO kiosk_billing_events(id,scope,actor_user_id,action,credential_id)
      SELECT ${randomUUID()},${scope()},${actorUserId},'limits',key_id FROM changed RETURNING id`,
  ]);
  if (!result[1]?.length)
    throw new KioskBillingError('That credential is unavailable or you cannot manage it.');
}

export async function assertMetaBudgetAvailable(keyId: string): Promise<void> {
  const summary = (await metaSpendSummaries([keyId]))[keyId]!;
  if (summary.paused)
    throw new MetaBudgetError(
      'Meta billing is paused after unexpected provider usage. Ask an administrator to review the key limits.',
    );
  for (const period of ['daily', 'weekly'] as const) {
    const cap = period === 'daily' ? summary.limits.dailyUsd : summary.limits.weeklyUsd;
    if (cap !== null && summary.periods[period].spent + summary.periods[period].reserved >= cap)
      throw new MetaBudgetError(
        `The Meta key's ${period} budget has been reached. Requests resume after reset or an administrator raises the limit.`,
      );
  }
}

/** Reserve before every HTTP attempt. Returned usage is a cost estimate, not a provider invoice. */
export function metaSpendPolicy(
  keyId: string,
  owner: string,
  state: MetaPricing,
  jobId: string | null = null,
): ProviderRequestPolicy {
  return async (url, body, options) => {
    // Other providers have independent accounts. Only Meta traffic belongs here.
    if (new URL(url).hostname !== 'api.meta.ai') return async () => {};
    let allowance;
    try {
      allowance = await metaRequestAllowance(url, body, state);
    } catch {
      throw new MetaBudgetError(
        'Meta request pricing is unavailable. Ask an administrator to check provider pricing before continuing.',
      );
    }
    await ensureKioskBillingSchema();
    const sql = getSql(),
      id = randomUUID();
    const leaseMs = Math.max(1, options?.timeoutMs ?? 180_000) + 60_000;
    const admitted = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext(${`meta-billing:${scope()}:${keyId}`}))`,
      sql`INSERT INTO kiosk_meta_limits(scope,key_id) VALUES(${scope()},${keyId}) ON CONFLICT DO NOTHING`,
      sql`WITH limits AS (
        SELECT l.*,
          (${keyId}<>'shared' AND NOT EXISTS(SELECT 1 FROM kiosk_meta_credentials WHERE id=${keyId} AND scope=l.scope AND revoked_at IS NULL)) AS unavailable,
          (l.concurrency IS NOT NULL AND (SELECT count(*) FROM kiosk_meta_spend WHERE scope=l.scope AND key_id=l.key_id AND active_until>now())>=l.concurrency) AS busy,
          (l.daily_usd IS NOT NULL AND COALESCE((SELECT sum(COALESCE(charged,reserved)) FROM kiosk_meta_spend
            WHERE scope=l.scope AND key_id=l.key_id AND created_at>=date_trunc('day',now() AT TIME ZONE ${META_BILLING_TIME_ZONE}) AT TIME ZONE ${META_BILLING_TIME_ZONE}),0)+${allowance.reserved}>l.daily_usd) AS daily_exhausted,
          (l.weekly_usd IS NOT NULL AND COALESCE((SELECT sum(COALESCE(charged,reserved)) FROM kiosk_meta_spend
            WHERE scope=l.scope AND key_id=l.key_id AND created_at>=date_trunc('week',now() AT TIME ZONE ${META_BILLING_TIME_ZONE}) AT TIME ZONE ${META_BILLING_TIME_ZONE}),0)+${allowance.reserved}>l.weekly_usd) AS weekly_exhausted
        FROM kiosk_meta_limits l WHERE l.scope=${scope()} AND l.key_id=${keyId}
      ), admitted AS (
        INSERT INTO kiosk_meta_spend(id,scope,key_id,owner,job_id,model,operation,reserved,active_until)
        SELECT ${id},scope,key_id,${owner},${jobId},${allowance.model},${allowance.operation},${allowance.reserved},now()+${leaseMs}*interval '1 millisecond'
        FROM limits WHERE NOT paused AND NOT unavailable AND NOT busy AND NOT daily_exhausted AND NOT weekly_exhausted
        RETURNING id
      ) SELECT unavailable,busy,paused,daily_exhausted,weekly_exhausted,EXISTS(SELECT 1 FROM admitted) AS admitted FROM limits`,
    ]);
    const decision = admitted[2]?.[0];
    if (!decision?.admitted) {
      // Return the reason from the admission snapshot; another request may have
      // finished by the time this transaction returns.
      if (decision?.unavailable)
        throw new ProviderAuthError('The kiosk Meta credential is disabled or unavailable.');
      if (decision?.paused)
        throw new MetaBudgetError(
          'Meta billing is paused after unexpected provider usage. Ask an administrator to review the key limits.',
        );
      if (decision?.daily_exhausted || decision?.weekly_exhausted) {
        const period = decision.daily_exhausted ? 'daily' : 'weekly';
        throw new MetaBudgetError(
          `This Meta request exceeds the remaining ${period} budget. Requests resume after reset or an administrator raises the limit.`,
        );
      }
      if (decision?.busy)
        throw new MetaCapacityError('Waiting for this Meta key’s request capacity.');
      throw new MetaBudgetError('Meta billing limits are unavailable. Try again.');
    }
    return Object.assign(
      async (response: unknown) => {
        const charged = allowance.actual(response);
        if (charged !== null) {
          await sql`UPDATE kiosk_meta_spend SET charged=${charged} WHERE id=${id} AND charged IS NULL`;
          if (charged > allowance.reserved) {
            await sql`UPDATE kiosk_meta_limits SET paused=TRUE,updated_at=now() WHERE scope=${scope()} AND key_id=${keyId}`;
            throw new MetaBudgetError(
              'Provider usage exceeded its reservation. Meta billing is paused until an administrator reviews the key limits.',
            );
          }
        }
      },
      {
        cancel: async () => {
          await sql`DELETE FROM kiosk_meta_spend WHERE id=${id}`;
        },
        finish: async () => {
          await sql`UPDATE kiosk_meta_spend SET active_until=NULL WHERE id=${id}`;
        },
      },
    );
  };
}
