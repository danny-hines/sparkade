import { getRun } from 'workflow/api';
import { getSql } from './db';
import { ensureArcadeSchema, env } from './arcade';
import { releaseWebsiteCredits } from './website-generation';

/** Runtime-level failures (such as replay divergence) bypass the workflow's catch block. */
export async function reconcileWebsiteJob(id: string): Promise<boolean> {
  await ensureArcadeSchema();
  const sql = getSql();
  const [row] =
    await sql`UPDATE arcade_generations g SET runtime_checked_at=now() FROM generation_jobs j
    WHERE j.id=${id} AND g.job_id=j.id AND g.environment=${env()} AND g.settlement='held'
    AND j.status IN ('queued','running','waiting-network','publishing') AND j.run_id IS NOT NULL
    AND j.updated_at<now()-interval '1 minute'
    AND (g.runtime_checked_at IS NULL OR g.runtime_checked_at<now()-interval '1 minute') RETURNING j.run_id`;
  if (!row) return false;
  let status: string;
  try {
    status = await getRun(String(row.run_id)).status;
  } catch {
    return false;
  }
  if (!['failed', 'cancelled'].includes(status)) return false;
  const changed = await sql`UPDATE generation_jobs SET status='failed',updated_at=now()
    WHERE id=${id} AND run_id=${row.run_id} AND status IN ('queued','running','waiting-network','publishing') RETURNING id`;
  if (!changed.length) return false;
  await sql`UPDATE public_games p SET status='failed',stage='failed',message='Generation stopped. Your credits have been returned.',updated_at=now()
    FROM arcade_generations g WHERE g.job_id=${id} AND g.environment=${env()} AND g.game_id=p.id AND p.deleted_at IS NULL`;
  await releaseWebsiteCredits(id);
  return true;
}

/** Account-scoped polling can recover a crashed workflow even if its progress page is closed. */
export async function reconcileWebsiteOwner(userId: string) {
  await ensureArcadeSchema();
  const rows =
    await getSql()`SELECT g.job_id FROM arcade_generations g JOIN generation_jobs j ON j.id=g.job_id
    WHERE g.environment=${env()} AND g.user_id=${userId} AND g.settlement='held'
    AND j.status IN ('queued','running','waiting-network','publishing') AND j.run_id IS NOT NULL
    AND j.updated_at<now()-interval '1 minute'
    AND (g.runtime_checked_at IS NULL OR g.runtime_checked_at<now()-interval '1 minute') LIMIT 3`;
  await Promise.all(rows.map((row) => reconcileWebsiteJob(String(row.job_id))));
}
