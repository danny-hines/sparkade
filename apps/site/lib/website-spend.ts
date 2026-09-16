import { randomUUID } from 'node:crypto';
import type { ProviderRequestPolicy } from '@sparkade/server/providers/request-policy';
import type { PipelineState } from '@sparkade/server/pipeline/job-state';
import type { GenerationRow } from './generation/store';
import { getSql } from './db';
import { env, ArcadeError } from './arcade';

const money = (n: number) => Math.ceil(n * 1_000_000) / 1_000_000;
/** Deliberately conservative: UTF-8 bytes bound text tokens; output includes reasoning.
 * Vision bytes over-reserve rather than guessing provider-specific image tokenization. */
export function requestAllowance(
  url: string,
  body: string | FormData | undefined,
  state: PipelineState,
) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'api.meta.ai')
    throw new ArcadeError('Website generation requires a priced provider endpoint.');
  const request =
    typeof body === 'string'
      ? (JSON.parse(body) as Record<string, unknown>)
      : Object.fromEntries(body?.entries() ?? []);
  const model = String(request.model ?? '');
  if (
    endpoint.pathname.endsWith('/images/generations') ||
    endpoint.pathname.endsWith('/images/edits')
  ) {
    const rate = state.imagePricing?.perImageUsd;
    if (
      model !== state.config?.imageGeneration.model ||
      Number(request.n) !== 1 ||
      rate == null ||
      !Number.isFinite(rate) ||
      rate <= 0
    )
      throw new ArcadeError('Image pricing is unavailable.');
    return { reserved: money(rate), actual: (_response: unknown) => money(rate) };
  }
  if (!endpoint.pathname.endsWith('/chat/completions') || typeof body !== 'string')
    throw new ArcadeError('This provider operation is not enabled for website games.');
  const price = state.pricing[model];
  if (
    !price ||
    typeof price.inputPerM !== 'number' ||
    typeof price.outputPerM !== 'number' ||
    !Number.isFinite(price.inputPerM) ||
    !Number.isFinite(price.outputPerM) ||
    price.inputPerM <= 0 ||
    price.outputPerM <= 0
  )
    throw new ArcadeError('Model pricing is unavailable.');
  const output = Number(request.max_completion_tokens ?? request.max_tokens);
  if (!Number.isInteger(output) || output <= 0)
    throw new ArcadeError('Provider output limit is missing.');
  const reserved = money(
    ((Buffer.byteLength(body, 'utf8') + 4096) * price.inputPerM + output * price.outputPerM) /
      1_000_000,
  );
  return {
    reserved,
    actual: (response: unknown) => {
      const data = response as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const input = data?.usage?.prompt_tokens,
        completion = data?.usage?.completion_tokens;
      if (
        typeof input !== 'number' ||
        typeof completion !== 'number' ||
        !Number.isFinite(input) ||
        !Number.isFinite(completion) ||
        input < 0 ||
        completion < 0
      )
        return null;
      return money((input * price.inputPerM + completion * price.outputPerM) / 1_000_000);
    },
  };
}
export function websiteSpendPolicy(row: GenerationRow): ProviderRequestPolicy {
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
        WHERE g.job_id=${row.id} AND g.environment=${env()} AND g.settlement='held' AND g.input_review='approved'
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
    return async (response) => {
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
    };
  };
}
