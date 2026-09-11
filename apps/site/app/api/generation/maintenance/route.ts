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
