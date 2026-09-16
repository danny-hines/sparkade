'use server';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { start } from 'workflow/api';
import { requireAdminIdentity } from '@/lib/admin-auth';
import { ensureArcadeSchema, env, ArcadeError } from '@/lib/arcade';
import { getSql } from '@/lib/db';
import { reviewWebsiteGame } from '@/lib/website-generation';
import { generateGameWorkflow } from '@/workflows/generate-game';

function settingsNotice(message: string): never {
  redirect(`/admin/creation?notice=${encodeURIComponent(message)}`);
}

export async function saveCreationSettings(form: FormData) {
  const admin = await requireAdminIdentity();
  await ensureArcadeSchema();
  const enabled = form.get('enabled') === 'on',
    price = Number(form.get('price'));
  const game = Number(form.get('gameCap')),
    daily = Number(form.get('dailyCap')),
    total = Number(form.get('totalCap'));
  if (
    !Number.isInteger(price) ||
    price < 1 ||
    price > 10000 ||
    [game, daily, total].some((n) => !Number.isFinite(n) || n < 0 || n > 10000) ||
    (enabled && Math.min(game, daily, total) <= 0)
  )
    settingsNotice('Set a positive credit price and valid dollar limits before enabling creation.');
  if (
    enabled &&
    (process.env.SPARKADE_GENERATION_BACKEND !== 'vercel' ||
      !(
        process.env.GENERATION_BLOB_READ_WRITE_TOKEN ||
        (process.env.SPARKADE_PROVIDER === 'mock' &&
          process.env.SPARKADE_LOCAL_GENERATION_STORAGE_DIR)
      ))
  )
    settingsNotice(
      'Configure the durable generation backend and private Blob storage before enabling creation.',
    );
  const sql = getSql();
  await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtext(${`arcade-spend:${env()}`}))`,
    sql`INSERT INTO arcade_settings(environment,enabled,price,game_cap,daily_cap,total_cap) VALUES(${env()},${enabled},${price},${game},${daily},${total})
      ON CONFLICT(environment) DO UPDATE SET enabled=EXCLUDED.enabled,price=EXCLUDED.price,game_cap=EXCLUDED.game_cap,daily_cap=EXCLUDED.daily_cap,total_cap=EXCLUDED.total_cap`,
    sql`INSERT INTO admin_audit_events(id,environment,actor_user_id,action,target_type,target_id,details_json)
      VALUES(${randomUUID()},${env()},${admin.userId},'creation-settings','environment',${env()},${JSON.stringify({ enabled, price, game, daily, total })}::jsonb)`,
  ]);
  revalidatePath('/', 'layout');
  redirect('/admin/creation?notice=Settings+saved');
}
export async function reviewAction(form: FormData) {
  const admin = await requireAdminIdentity();
  let message = 'Review saved.';
  try {
    const row = await reviewWebsiteGame(
      admin.userId,
      String(form.get('jobId')),
      String(form.get('decision')),
      String(form.get('version') ?? ''),
      String(form.get('reason') ?? ''),
    );
    if (row) {
      try {
        await start(generateGameWorkflow, [row.id, row.attempt]);
      } catch {
        message = 'Prompt approved. Dispatch is pending; use Resume approved jobs below.';
      }
    }
  } catch (error) {
    message = error instanceof ArcadeError ? error.message : 'Could not save this review.';
  }
  revalidatePath('/', 'layout');
  redirect(`/admin/creation?notice=${encodeURIComponent(message)}`);
}
export async function resumeApprovedAction() {
  await requireAdminIdentity();
  await ensureArcadeSchema();
  const rows =
    await getSql()`SELECT j.id,j.attempt FROM generation_jobs j JOIN arcade_generations g ON g.job_id=j.id
    WHERE g.environment=${env()} AND (g.input_review='approved' OR (g.input_review='pending' AND g.review_policy='pg13-v1')) AND g.settlement='held' AND j.status='queued' AND j.run_id IS NULL LIMIT 100`;
  for (const row of rows) await start(generateGameWorkflow, [row.id, row.attempt]);
  revalidatePath('/admin/creation');
  redirect('/admin/creation?notice=Queued+jobs+dispatched');
}
