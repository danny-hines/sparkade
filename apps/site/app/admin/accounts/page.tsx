import { randomUUID } from 'node:crypto';
import { env } from '@/lib/arcade';
import { listInvitedEmails } from '@/lib/invited-emails';
import { SubmitButton } from '../../components/game-controls';
import { getAdminPageIdentity } from '../page-access';
import { AdminNotice, type AdminQuery } from '../admin-notice';
import { AccountForm } from './account-form';
import { removeInvitedEmailAction } from './actions';
import { InviteEmailsForm } from './invite-emails-form';
export const metadata = { title: 'Admin · Accounts' };
export const dynamic = 'force-dynamic';
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<AdminQuery>;
}) {
  if (!(await getAdminPageIdentity('/admin/accounts'))) return null;
  const operationKey = randomUUID();
  const invited = await listInvitedEmails();
  return (
    <>
      <section className="admin-hero">
        <span className="admin-kicker">Player access · {env()}</span>
        <h1>Accounts</h1>
        <p>
          Invite people, grant credits, pause accounts, and restore access. Every change is
          recorded.
        </p>
      </section>
      <AdminNotice query={await searchParams} />
      <section className="arc-panel arc-section" aria-labelledby="invited-title">
        <h2 id="invited-title">Who can sign in</h2>
        <p>
          Sparkade is invite-only. People can sign up and sign in only with a verified email on this
          list; send them to <code>/sign-up</code>. Admins always have access. Removing an email
          takes effect on that person’s next page load.
        </p>
        <InviteEmailsForm />
        <h3>
          {invited.length} invited {invited.length === 1 ? 'email' : 'emails'}
        </h3>
        {invited.length ? (
          <ul className="admin-access-list">
            {invited.map((entry) => (
              <li key={entry.email}>
                <div>
                  <strong>{entry.email}</strong>
                  <time dateTime={entry.invitedAt}>
                    Invited{' '}
                    {new Date(entry.invitedAt).toLocaleDateString('en-US', {
                      timeZone: 'UTC',
                      dateStyle: 'medium',
                    })}
                  </time>
                </div>
                <form action={removeInvitedEmailAction}>
                  <input type="hidden" name="email" value={entry.email} />
                  <SubmitButton className="arc-text-button">Remove</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-empty">No one is invited yet. Only admins can sign in.</p>
        )}
      </section>
      <section className="arc-panel arc-section">
        <h2>Accounts & credit grants</h2>
        <AccountForm key={operationKey} operationKey={operationKey} />
      </section>
    </>
  );
}
