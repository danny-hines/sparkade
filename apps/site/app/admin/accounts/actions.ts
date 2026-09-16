'use server';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdminIdentity } from '@/lib/admin-auth';
import { ensureArcadeSchema, env } from '@/lib/arcade';
import { getSql } from '@/lib/db';
export async function accountAdminAction(form: FormData) {
  const admin = await requireAdminIdentity();
  await ensureArcadeSchema();
  const sql = getSql();
  const userId = String(form.get('userId') ?? ''),
    action = String(form.get('action')),
    reason = String(form.get('reason') ?? '').trim();
  if (!userId || !reason || !['grant', 'suspend', 'restore'].includes(action))
    redirect('/admin/accounts?tone=error&notice=Choose+an+account,+action,+and+audit+reason.');
  const [profile] =
    await sql`SELECT user_id FROM arcade_profiles WHERE environment=${env()} AND user_id=${userId}`;
  if (!profile)
    redirect(
      '/admin/accounts?tone=error&notice=Choose+an+existing+account+from+the+search+results.',
    );
  if (action === 'grant') {
    const amount = Number(form.get('credits')),
      key = String(form.get('key'));
    if (
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > 10000 ||
      !/^[a-zA-Z0-9_-]{16,128}$/.test(key)
    )
      redirect('/admin/accounts?tone=error&notice=Enter+1%E2%80%9310,000+credits.');
    await sql`WITH entry AS (INSERT INTO credit_ledger(id,environment,clerk_user_id,amount,kind,reason,actor_user_id,operation_id)
      VALUES(${randomUUID()},${env()},${userId},${amount},'admin_grant',${reason.slice(0, 1000)},${admin.userId},${`admin:${key}`}) ON CONFLICT DO NOTHING RETURNING *),
      balance AS (INSERT INTO credit_accounts(environment,clerk_user_id,balance) SELECT environment,clerk_user_id,amount FROM entry
        ON CONFLICT(environment,clerk_user_id) DO UPDATE SET balance=credit_accounts.balance+EXCLUDED.balance,updated_at=now())
      INSERT INTO admin_audit_events(id,environment,actor_user_id,action,target_type,target_id,details_json)
      SELECT ${randomUUID()},environment,${admin.userId},'credit-grant','account',clerk_user_id,${JSON.stringify({ amount, reason })}::jsonb FROM entry`;
  } else
    await sql.transaction([
      sql`UPDATE arcade_profiles SET suspended=${action === 'suspend'} WHERE environment=${env()} AND user_id=${userId}`,
      sql`UPDATE public_games SET moderation='rejected',feed_visibility='unlisted',updated_at=now() WHERE environment=${env()} AND owner_id=${userId} AND ${action}='suspend'`,
      sql`INSERT INTO admin_audit_events(id,environment,actor_user_id,action,target_type,target_id,details_json)
      VALUES(${randomUUID()},${env()},${admin.userId},${action},'account',${userId},${JSON.stringify({ reason })}::jsonb)`,
    ]);
  revalidatePath('/', 'layout');
  redirect('/admin/accounts?notice=Account+updated');
}
