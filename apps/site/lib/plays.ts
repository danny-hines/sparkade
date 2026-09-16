import { randomUUID } from 'node:crypto';
import { getSql } from './db';
import { ensureArcadeSchema, env } from './arcade';
export async function startPlay(gameId: string, viewer: string) {
  await ensureArcadeSchema();
  const sql = getSql(),
    id = randomUUID();
  const result = await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtext(${`play:${env()}:${viewer}`}))`,
    sql`INSERT INTO arcade_play_tickets(id,environment,game_id,viewer)
      SELECT ${id},${env()},p.id,${viewer} FROM public_games p WHERE p.id=${gameId}
        AND p.status='ready' AND p.moderation='approved' AND p.deleted_at IS NULL
        AND (p.owner_id IS NULL OR p.environment=${env()})
        AND (SELECT count(*) FROM arcade_play_tickets WHERE environment=${env()} AND viewer=${viewer} AND created_at>now()-interval '1 hour')<20 RETURNING id`,
    sql`DELETE FROM arcade_play_tickets WHERE environment=${env()} AND created_at<now()-interval '1 day'`,
  ]);
  return result[1]?.[0]?.id as string | undefined;
}
export async function finishPlay(gameId: string, viewer: string, ticket: string) {
  await ensureArcadeSchema();
  const sql = getSql();
  const result = await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtext(${`play:${env()}:${viewer}`}))`,
    sql`WITH valid AS (UPDATE arcade_play_tickets SET consumed=TRUE
      WHERE id=${ticket} AND environment=${env()} AND game_id=${gameId} AND viewer=${viewer} AND NOT consumed
      AND created_at<=now()-interval '10 seconds' AND created_at>now()-interval '1 hour' RETURNING *)
      INSERT INTO arcade_plays(environment,game_id,viewer,bucket)
      SELECT t.environment,t.game_id,t.viewer,floor(extract(epoch FROM now())/1800)::bigint FROM valid t JOIN public_games p ON p.id=t.game_id
      WHERE p.status='ready' AND p.moderation='approved' AND p.deleted_at IS NULL
      AND (p.owner_id IS NULL OR p.environment=${env()})
      AND NOT EXISTS(SELECT 1 FROM arcade_plays v WHERE v.environment=t.environment AND v.game_id=t.game_id AND v.viewer=t.viewer AND v.created_at>now()-interval '30 minutes')
      ON CONFLICT DO NOTHING RETURNING game_id`,
  ]);
  return result[1]?.length > 0;
}
