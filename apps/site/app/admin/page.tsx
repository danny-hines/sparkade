import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ensureArcadeSchema, env } from '@/lib/arcade';
import { getSql } from '@/lib/db';
import { getAdminPageIdentity } from './page-access';
import { adminSections } from './sections';
import { AdminNotice, queryValue, type AdminQuery } from './admin-notice';

export const metadata = { title: 'Admin · Overview' };
export const dynamic = 'force-dynamic';

export default async function AdminPage({ searchParams }: { searchParams: Promise<AdminQuery> }) {
  if (!(await getAdminPageIdentity('/admin'))) return null;
  const query = await searchParams;
  // Preserve the old console's bookmarked game filters.
  const visibility = queryValue(query.visibility);
  if (visibility === 'listed' || visibility === 'unlisted')
    redirect(`/admin/games?visibility=${visibility}`);
  await ensureArcadeSchema();
  const activity =
    await getSql()`SELECT id,action,target_type,target_id,created_at FROM admin_audit_events
    WHERE environment=${env()} ORDER BY created_at DESC LIMIT 20`;
  return (
    <>
      <section className="admin-hero">
        <span className="admin-kicker">Operator console · {env()}</span>
        <h1>Admin overview</h1>
        <p>Manage your arcade, invite players, and keep game creation running smoothly.</p>
      </section>
      <AdminNotice query={query} />
      <section className="admin-tools" aria-label="Admin tools">
        {adminSections
          .filter((section) => section.href !== '/admin')
          .map((section) => (
            <Link className="admin-tool" key={section.href} href={section.href}>
              <h2>{section.label}</h2>
              <p>{section.description}</p>
              <span>Open {section.label.toLowerCase()} →</span>
            </Link>
          ))}
      </section>
      <section className="admin-section">
        <div className="admin-section-heading">
          <h2>Recent admin activity</h2>
          <p>Latest 20 actions</p>
        </div>
        {activity.length ? (
          <ul className="admin-activity">
            {activity.map((event) => (
              <li key={event.id}>
                <strong>{String(event.action).replaceAll('-', ' ')}</strong>
                <p>
                  {event.target_type} · {event.target_id}
                </p>
                <time dateTime={new Date(event.created_at).toISOString()}>
                  {new Date(event.created_at).toLocaleString('en-US', {
                    timeZone: 'UTC',
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}{' '}
                  UTC
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-empty">
            Admin actions will appear here as you manage invites, accounts, and creation.
          </p>
        )}
      </section>
    </>
  );
}
