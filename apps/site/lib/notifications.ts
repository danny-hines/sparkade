import { reconcileWebsiteOwner } from './website-recovery';
import { getSql } from './db';
import { ensureArcadeSchema, env } from './arcade';
import type { NotificationSnapshot } from './notification-types';

/** Idempotent catch-up also covers runtime failures and old jobs whose workflow never called a finalizer. */
export async function gameNotifications(userId: string): Promise<NotificationSnapshot> {
  await ensureArcadeSchema();
  await reconcileWebsiteOwner(userId);
  const sql = getSql();
  await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtext(${`arcade-notifications:${env()}:${userId}`}))`,
    sql`INSERT INTO arcade_notifications(environment,user_id,game_id,job_id,attempt,kind,title)
    SELECT g.environment,g.user_id,g.game_id,g.job_id,j.attempt,
      CASE WHEN j.status='done' AND p.moderation='approved' THEN 'ready'
        WHEN j.status='done' AND p.moderation='rejected' THEN 'removed'
        WHEN g.input_review='rejected' OR p.moderation='rejected' THEN 'rejected' ELSE 'failed' END,
      COALESCE(NULLIF(p.title,''),'Your new game')
    FROM arcade_generations g JOIN generation_jobs j ON j.id=g.job_id JOIN public_games p ON p.id=g.game_id
    WHERE g.environment=${env()} AND g.user_id=${userId} AND p.environment=g.environment AND p.owner_id=g.user_id
      AND p.deleted_at IS NULL AND ((j.status='done' AND g.settlement='captured') OR (j.status='failed' AND g.settlement='released'))
    ON CONFLICT DO NOTHING`,
  ]);
  const [items, counts] = await Promise.all([
    sql`SELECT id::text,game_id,title,kind,created_at,read_at FROM arcade_notifications n
      WHERE environment=${env()} AND user_id=${userId} ORDER BY n.id DESC LIMIT 50`,
    sql`SELECT count(*) FILTER(WHERE read_at IS NULL)::int AS unread,COALESCE(max(id),0)::text AS cursor
      FROM arcade_notifications WHERE environment=${env()} AND user_id=${userId}`,
  ]);
  return {
    userKey: `${env()}:${userId}`,
    cursor: counts[0]!.cursor,
    unread: counts[0]!.unread,
    items: items.map((n) => ({
      id: n.id,
      gameId: n.game_id,
      title: String(n.title).slice(0, 180),
      kind: n.kind,
      createdAt: new Date(n.created_at).toISOString(),
      read: Boolean(n.read_at),
    })),
  };
}
export async function updateGameNotifications(
  userId: string,
  action: string,
  ids: string[],
  through = '0',
) {
  await ensureArcadeSchema();
  if (
    !['read', 'read-all', 'claim-toasts'].includes(action) ||
    ids.length > 50 ||
    !ids.every((id) => /^\d{1,18}$/.test(id)) ||
    !/^\d{1,18}$/.test(through)
  )
    throw new Error('Invalid notification request');
  const sql = getSql();
  if (action === 'claim-toasts') {
    const rows =
      await sql`UPDATE arcade_notifications SET toast_at=now() WHERE environment=${env()} AND user_id=${userId}
      AND id=ANY(${ids}::bigint[]) AND toast_at IS NULL AND read_at IS NULL RETURNING id::text`;
    return rows.map((r) => String(r.id));
  }
  await sql`UPDATE arcade_notifications SET read_at=COALESCE(read_at,now()) WHERE environment=${env()} AND user_id=${userId}
    AND ((${action}='read' AND id=ANY(${ids}::bigint[])) OR (${action}='read-all' AND id<=${through}::bigint))`;
  return [];
}
