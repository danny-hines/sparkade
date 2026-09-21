import { randomUUID } from 'node:crypto';
import {
  combineProviderRequestPolicies,
  type ProviderRequestPolicy,
} from '@sparkade/server/providers/request-policy';
import type { GenerationRow } from './generation/store';
import { getSql } from './db';
import { env, ArcadeError } from './arcade';
import { requestAllowance } from './meta-request-cost';
import { metaSpendPolicy, SHARED_META_KEY } from './kiosk-meta-spend';

export { requestAllowance } from './meta-request-cost';

function websiteOnlySpendPolicy(
  row: GenerationRow,
  purpose: 'generation' | 'input-review' = 'generation',
): ProviderRequestPolicy {
  return async (url, body) => {
    const allowance = requestAllowance(url, body, row.state),
      id = randomUUID(),
      sql = getSql();
    const results = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtext(${`arcade-spend:${env()}`}))`,
      sql`INSERT INTO arcade_spend(id,environment,job_id,reserved)
        SELECT ${id},g.environment,g.job_id,${allowance.reserved}
        FROM arcade_generations g JOIN arcade_settings s ON s.environment=g.environment
        JOIN arcade_profiles p ON p.environment=g.environment AND p.user_id=g.user_id
        JOIN generation_jobs j ON j.id=g.job_id JOIN public_games v ON v.id=g.game_id
        WHERE g.job_id=${row.id} AND g.environment=${env()} AND g.settlement='held' AND (g.input_review='approved' OR (${purpose}='input-review' AND g.input_review='pending' AND g.review_policy='pg13-v1' AND j.status='queued'))
          AND s.enabled AND NOT p.suspended AND v.deleted_at IS NULL AND v.moderation='pending'
          AND j.attempt=${row.attempt} AND j.status IN ('queued','running','waiting-network','publishing')
          AND COALESCE((SELECT sum(COALESCE(charged,reserved)) FROM arcade_spend WHERE job_id=g.job_id),0)+${allowance.reserved}<=LEAST(g.game_cap,s.game_cap)
          AND COALESCE((SELECT sum(COALESCE(charged,reserved)) FROM arcade_spend WHERE environment=g.environment AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)+${allowance.reserved}<=s.daily_cap
          AND COALESCE((SELECT sum(COALESCE(charged,reserved)) FROM arcade_spend WHERE environment=g.environment),0)+${allowance.reserved}<=s.total_cap
        RETURNING id`,
    ]);
    if (!results[1]?.length)
      throw new ArcadeError('Website generation paused or provider-spend limit reached.');
    // No release on a timeout/error: it might have been billed. Every retry gets a fresh reservation.
    return Object.assign(
      async (response: unknown) => {
        const charged = allowance.actual(response);
        if (charged !== null) {
          await sql`UPDATE arcade_spend SET charged=${charged} WHERE id=${id} AND charged IS NULL`;
          if (charged > allowance.reserved) {
            await sql`UPDATE arcade_settings SET enabled=FALSE WHERE environment=${env()}`;
            throw new ArcadeError(
              'Provider usage exceeded its reservation; creation has been paused.',
            );
          }
        }
      },
      {
        cancel: async () => {
          await sql`DELETE FROM arcade_spend WHERE id=${id}`;
        },
      },
    );
  };
}

export function websiteSpendPolicy(
  row: GenerationRow,
  purpose: 'generation' | 'input-review' = 'generation',
): ProviderRequestPolicy {
  return combineProviderRequestPolicies(
    metaSpendPolicy(SHARED_META_KEY, row.owner, row.state, row.id),
    websiteOnlySpendPolicy(row, purpose),
  );
}
