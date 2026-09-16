import { reconcileWebsiteJob } from '@/lib/website-recovery';
import { start } from 'workflow/api';
import { generateGameWorkflow } from '@/workflows/generate-game';
import { ensureArcadeSchema, env } from '@/lib/arcade';
import { releaseWebsiteCredits } from '@/lib/website-generation';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getSql } from '@/lib/db';
import { ensureGenerationSchema, prefix, scope } from '@/lib/generation/store';
import { cleanPrivate } from '@/lib/generation/storage';

export const runtime = 'nodejs';
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get('authorization') ?? '';
  const hash = (s: string) => createHash('sha256').update(s).digest();
  if (!secret || !timingSafeEqual(hash(header), hash(`Bearer ${secret}`)))
    return new Response(null, { status: 401 });
  await ensureGenerationSchema();
  const sql = getSql();
  await ensureArcadeSchema();
  const running =
    await sql`SELECT g.job_id FROM arcade_generations g JOIN generation_jobs j ON j.id=g.job_id
    WHERE g.environment=${env()} AND g.settlement='held' AND j.status IN ('queued','running','waiting-network','publishing')
    AND j.run_id IS NOT NULL AND j.updated_at<now()-interval '1 minute' LIMIT 100`;
  for (const row of running) await reconcileWebsiteJob(String(row.job_id));
  await sql`UPDATE generation_jobs j SET status='failed',updated_at=now()
    FROM arcade_generations g WHERE g.job_id=j.id AND g.environment=${env()} AND g.settlement='held'
    AND (g.input_review='approved' OR (g.input_review='pending' AND g.review_policy='pg13-v1')) AND j.status IN ('queued','running','waiting-network','publishing')
    AND j.updated_at<now()-interval '24 hours'`;
  const unsettled =
    await sql`SELECT g.job_id FROM arcade_generations g JOIN generation_jobs j ON j.id=g.job_id
    WHERE g.environment=${env()} AND g.settlement='held' AND j.status IN ('failed','canceled') LIMIT 100`;
  for (const row of unsettled) await releaseWebsiteCredits(String(row.job_id));
  const queued =
    await sql`SELECT j.id,j.attempt FROM generation_jobs j JOIN arcade_generations g ON g.job_id=j.id
    JOIN arcade_settings s ON s.environment=g.environment WHERE g.environment=${env()} AND g.settlement='held'
    AND (g.input_review='approved' OR (g.input_review='pending' AND g.review_policy='pg13-v1')) AND s.enabled AND j.status='queued' AND j.run_id IS NULL LIMIT 100`;
  for (const row of queued)
    await start(generateGameWorkflow, [String(row.id), Number(row.attempt)]);
  const rows =
    await sql`SELECT id FROM generation_jobs WHERE scope=${scope()} AND (checkpoint<>'' OR cleanup_pending)
    AND (status='done' OR (status IN ('failed','canceled') AND updated_at<now()-interval '7 days')) LIMIT 100`;
  let cleaned = 0;
  for (const row of rows) {
    const expired =
      await sql`UPDATE generation_jobs SET checkpoint='',cleanup_pending=TRUE WHERE id=${row.id} AND (checkpoint<>'' OR cleanup_pending)
      AND (status='done' OR (status IN ('failed','canceled') AND updated_at<now()-interval '7 days')) RETURNING id`;
    if (expired.length) {
      await cleanPrivate(prefix(String(row.id)));
      await sql`UPDATE generation_jobs SET cleanup_pending=FALSE WHERE id=${row.id}`;
      cleaned++;
    }
  }
  return Response.json({ ok: true, cleaned });
}
