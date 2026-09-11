import { randomUUID } from 'node:crypto';
import type { GenerationPrincipal } from '@sparkade/generation/service-auth';
import type { CloudGenerationSnapshot } from '@sparkade/shared';
import type { PipelineState } from '@sparkade/server/pipeline/job-state';
import { getSql } from '../db';

export const scope = () => (process.env.VERCEL_ENV === 'production' ? 'production' : 'preview');
export const prefix = (id: string) => `generation/${scope()}/${id}/`;
export interface GenerationRow {
  id: string;
  seq: number;
  owner: string;
  principal: GenerationPrincipal;
  input_hash: string;
  state: PipelineState;
  checkpoint: string;
  status: string;
  attempt: number;
  run_id: string | null;
  public_id: string | null;
  bundle: string | null;
  created_at: string;
  updated_at: string;
}
let schema: Promise<void> | undefined;
export function ensureGenerationSchema() {
  return (schema ??= (async () => {
    const sql = getSql();
    await sql`CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY, seq BIGSERIAL UNIQUE, scope TEXT NOT NULL, owner TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, input_hash TEXT NOT NULL, principal JSONB NOT NULL,
      state JSONB NOT NULL, checkpoint TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
      attempt INTEGER NOT NULL DEFAULT 1, run_id TEXT, public_id TEXT, bundle TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(scope, owner, idempotency_key))`;
    await sql`ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS cleanup_pending BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`CREATE INDEX IF NOT EXISTS generation_jobs_owner_seq ON generation_jobs(scope, owner, seq)`;
    await sql`CREATE TABLE IF NOT EXISTS generation_passes (
      job_id TEXT NOT NULL, attempt INTEGER NOT NULL, pass INTEGER NOT NULL, result JSONB NOT NULL,
      PRIMARY KEY(job_id, attempt, pass))`;
    await sql`CREATE TABLE IF NOT EXISTS generation_requests (
      job_id TEXT NOT NULL, request_id TEXT NOT NULL, request_url TEXT NOT NULL,
      result_url TEXT, provider_attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(job_id, request_id))`;
    await sql`ALTER TABLE generation_requests ADD COLUMN IF NOT EXISTS provider_attempts INTEGER NOT NULL DEFAULT 0`;
    await sql`CREATE TABLE IF NOT EXISTS generation_usage (
      job_id TEXT NOT NULL, request_id TEXT NOT NULL, event JSONB NOT NULL,
      PRIMARY KEY(job_id,request_id))`;
    await sql`CREATE TABLE IF NOT EXISTS generation_slots (
      scope TEXT NOT NULL, slot INTEGER NOT NULL, owner TEXT NOT NULL, token TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(scope, slot))`;
  })().catch((error) => {
    schema = undefined;
    throw error;
  }));
}
export async function getJob(id: string): Promise<GenerationRow | null> {
  await ensureGenerationSchema();
  const rows = await getSql()`SELECT * FROM generation_jobs WHERE id=${id} AND scope=${scope()}`;
  return (rows[0] as GenerationRow | undefined) ?? null;
}
export async function snapshot(row: GenerationRow, cursor = 0): Promise<CloudGenerationSnapshot> {
  const paid = await getSql()`SELECT event FROM generation_usage WHERE job_id=${row.id}`;
  const usage = new Map(row.state.usage.map((u, i) => [u.requestId ?? `local:${i}`, u]));
  for (const item of paid) usage.set(item.event.requestId, item.event);
  const job = structuredClone(row.state.job!);
  const game = structuredClone(row.state.game!);
  job.costSoFarUsd = [...usage.values()].some((u) => u.costUsd === null)
    ? null
    : [...usage.values()].reduce((n, u) => n + (u.costUsd ?? 0), 0);
  game.costUsd = job.costSoFarUsd;
  const link = row.public_id
    ? {
        id: row.public_id,
        url: `${process.env.SPARKADE_PUBLIC_ORIGIN ?? 'https://sparkade.dev'}/p/${row.public_id}`,
      }
    : null;
  if (row.status === 'publishing') {
    job.status = 'running';
    job.stage = 'building-assets';
    job.detail = 'Saving your finished game…';
    game.status = 'generating';
  }
  return {
    job,
    game,
    events: row.state.events
      .filter((e) => e.id > cursor && (row.status === 'done' || e.kind !== 'complete'))
      .slice(0, 500),
    ...(link
      ? {
          publicGame: link,
          publication: {
            link,
            status:
              row.status === 'done'
                ? ('published' as const)
                : ['failed', 'canceled'].includes(row.status)
                  ? ('failed' as const)
                  : ('publishing' as const),
          },
        }
      : {}),
  };
}
export async function acquireSlot(owner: string): Promise<string | null> {
  await ensureGenerationSchema();
  const sql = getSql();
  const token = randomUUID();
  const max = Math.max(1, Math.min(32, Number(process.env.SPARKADE_CLOUD_CONCURRENCY) || 16));
  const perOwner = Math.max(
    1,
    Math.min(max, Number(process.env.SPARKADE_CLOUD_OWNER_CONCURRENCY) || 8),
  );
  const results = await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtext(${`sparkade-slots-${scope()}`}))`,
    sql`INSERT INTO generation_slots(scope,slot,owner,token,expires_at)
      SELECT ${scope()}, candidate, ${owner}, ${token}, now()+interval '5 minutes'
      FROM generate_series(1,${max}) candidate
      WHERE NOT EXISTS (SELECT 1 FROM generation_slots s WHERE s.scope=${scope()}
        AND s.slot=candidate AND s.expires_at>now())
      AND (SELECT count(*) FROM generation_slots WHERE scope=${scope()} AND owner=${owner}
        AND expires_at>now()) < ${perOwner}
      ORDER BY candidate LIMIT 1
      ON CONFLICT(scope,slot) DO UPDATE SET owner=excluded.owner, token=excluded.token,
        expires_at=excluded.expires_at WHERE generation_slots.expires_at<=now()
      RETURNING token`,
  ]);
  return results[1]?.length ? token : null;
}
export async function releaseSlot(token: string) {
  await getSql()`DELETE FROM generation_slots WHERE token=${token} AND scope=${scope()}`;
}

/** Update the public progress page only from the current canonical job row. */
export async function syncPublicProgress(id: string, attempt: number) {
  await getSql()`UPDATE public_games p SET
    status=CASE WHEN g.status IN ('failed','canceled') THEN 'failed' ELSE 'generating' END,
    stage=CASE WHEN g.status='publishing' THEN 'building-assets' ELSE g.state->'job'->>'stage' END,
    message=CASE WHEN g.status='canceled' THEN 'Generation canceled'
      WHEN g.status='failed' THEN COALESCE(g.state->'job'->'error'->>'message','Generation failed')
      ELSE g.state->'job'->>'detail' END,
    title=COALESCE(g.state->'game'->>'title',p.title),updated_at=now(),
    failed_at=CASE WHEN g.status IN ('failed','canceled') THEN now() ELSE NULL END
    FROM generation_jobs g WHERE g.id=${id} AND g.attempt=${attempt}
      AND p.source_id=g.scope||':'||g.id AND g.status NOT IN ('done','queued')`;
}
