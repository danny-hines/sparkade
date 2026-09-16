import { getRun } from 'workflow/api';
import { getSql } from './db';
import { ensureArcadeSchema, env } from './arcade';
import { releaseWebsiteCredits } from './website-generation';

/** Runtime-level failures (such as replay divergence) bypass the workflow's catch block. */
export async function reconcileWebsiteJob(id: string): Promise<boolean> {
  await ensureArcadeSchema();
  const sql = getSql();
  const [row] =
    await sql`SELECT j.run_id FROM generation_jobs j JOIN arcade_generations g ON g.job_id=j.id
    WHERE j.id=${id} AND g.environment=${env()} AND g.settlement='held'
    AND j.status IN ('queued','running','waiting-network','publishing') AND j.run_id IS NOT NULL
    AND j.updated_at<now()-interval '1 minute'`;
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
