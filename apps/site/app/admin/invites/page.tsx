import type { Metadata } from 'next';
import { getAdminPageIdentity } from '../page-access';
import {
  DEFAULT_INVITE_CREDITS,
  DEFAULT_INVITE_EXPIRY_DAYS,
  DEFAULT_INVITE_MAX_RECIPIENTS,
  isInviteSecretConfigured,
  listCreditInvites,
} from '@/lib/invites';
import { createInviteAction, revokeInviteAction, updateInviteAction } from './actions';
import { CopyButton, CopyInviteLinkButton, ExpiryForm } from './copy-button';

export const metadata: Metadata = {
  title: 'Admin · Invites',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type InvitesPageProps = {
  searchParams: Promise<{ notice?: string | string[]; tone?: string | string[] }>;
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export default async function AdminInvitesPage({ searchParams }: InvitesPageProps) {
  if (!(await getAdminPageIdentity('/admin/invites'))) return null;

  const query = await searchParams;
  const notice = Array.isArray(query.notice) ? query.notice[0] : query.notice;
  const tone =
    (Array.isArray(query.tone) ? query.tone[0] : query.tone) === 'error' ? 'error' : 'success';
  const secretOk = isInviteSecretConfigured();
  const invites = secretOk ? await listCreditInvites({ includeCodes: true }) : [];

  return (
    <>
      <section className="admin-hero">
        <span className="admin-kicker">Operator console · credit invites</span>
        <h1>Invite friends with starting credits.</h1>
        <p>
          Each invite offers fixed credits per recipient up to a recipient limit. Signup without a
          code starts at zero credits. Manage generation access and spending in Creation.
        </p>
      </section>

      {notice ? (
        <div className={`admin-notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
          {notice}
        </div>
      ) : null}

      {!secretOk ? (
        <div className="admin-notice error" role="alert">
          Invite codes are unavailable: SPARKADE_INVITE_CODE_SECRET is missing or too short. Set at
          least 32 random characters (see apps/site/.env.example) and reload. No codes are shown
          until then.
        </div>
      ) : null}

      <section className="admin-section" aria-labelledby="create-title">
        <div className="admin-section-heading">
          <div>
            <span>New offer</span>
            <h2 id="create-title">Create an invite</h2>
          </div>
          <p>
            Defaults: {DEFAULT_INVITE_CREDITS} credits, {DEFAULT_INVITE_MAX_RECIPIENTS} recipients,{' '}
            {DEFAULT_INVITE_EXPIRY_DAYS} days.
          </p>
        </div>
        <form className="admin-pair-form admin-invite-form" action={createInviteAction}>
          <label>
            Internal label
            <input name="label" placeholder="Friends beta wave 1" maxLength={80} required />
          </label>
          <label>
            Credits per recipient
            <input
              name="creditsPerRecipient"
              type="number"
              min={1}
              max={10000}
              defaultValue={DEFAULT_INVITE_CREDITS}
              required
            />
          </label>
          <label>
            Recipient limit
            <input
              name="maxRecipients"
              type="number"
              min={1}
              max={100000}
              defaultValue={DEFAULT_INVITE_MAX_RECIPIENTS}
              required
            />
          </label>
          <label>
            Expires in (days)
            <input
              name="expiresInDays"
              type="number"
              min={1}
              max={366}
              defaultValue={DEFAULT_INVITE_EXPIRY_DAYS}
              required
            />
          </label>
          <button type="submit" disabled={!secretOk}>
            Create invite
          </button>
        </form>
      </section>

      <section className="admin-section" aria-labelledby="invites-title">
        <div className="admin-section-heading">
          <div>
            <span>Offers</span>
            <h2 id="invites-title">Invites</h2>
          </div>
          <p>{invites.length} total</p>
        </div>
        {invites.length ? (
          <div className="admin-kiosk-grid">
            {invites.map((invite) => (
              <article
                className={`admin-kiosk-card ${invite.status !== 'active' ? 'revoked' : ''}`}
                key={invite.id}
              >
                <div className="admin-card-topline">
                  <span
                    className={`admin-status-dot ${invite.status !== 'active' ? 'revoked' : ''}`}
                  />
                  <span>{invite.status}</span>
                  <strong>
                    {invite.redeemedCount}/{invite.maxRecipients} used
                  </strong>
                </div>
                <h3>{invite.label}</h3>
                <p className="admin-muted">
                  {invite.creditsPerRecipient} credits each · {invite.remainingSlots} remaining ·{' '}
                  {invite.totalCreditsIssued} issued
                </p>
                <p className="admin-muted">
                  Expires {formatDateTime(invite.expiresAt)}
                  {invite.revokedAt ? ` · revoked ${formatDateTime(invite.revokedAt)}` : ''}
                </p>
                <p className="admin-muted">
                  Code <code>{invite.code}</code>
                </p>
                <div className="admin-inline-form">
                  <CopyButton value={invite.code} label="Copy code" />
                  <CopyInviteLinkButton code={invite.code} />
                </div>
                {invite.status === 'active' || invite.status === 'exhausted' ? (
                  <form action={updateInviteAction} className="admin-inline-form">
                    <input type="hidden" name="inviteId" value={invite.id} />
                    <label>
                      Recipient limit (min {invite.redeemedCount})
                      <input
                        name="maxRecipients"
                        type="number"
                        min={invite.redeemedCount}
                        max={100000}
                        defaultValue={invite.maxRecipients}
                      />
                    </label>
                    <button type="submit">Update limit</button>
                  </form>
                ) : null}
                {invite.status === 'active' ? (
                  <ExpiryForm
                    action={updateInviteAction}
                    inviteId={invite.id}
                    currentExpiresAtIso={invite.expiresAt}
                    submitLabel="Update expiry"
                  />
                ) : null}
                {invite.status === 'expired' ? (
                  <ExpiryForm
                    action={updateInviteAction}
                    inviteId={invite.id}
                    currentExpiresAtIso={invite.expiresAt}
                    submitLabel="Extend expiry"
                    requireValue
                  />
                ) : null}
                {invite.status !== 'revoked' ? (
                  <details className="admin-danger-zone">
                    <summary>Revoke invite</summary>
                    <p>Future grants stop immediately. Issued credits are unaffected.</p>
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="inviteId" value={invite.id} />
                      <label>
                        Reason (audit trail)
                        <input
                          name="reason"
                          placeholder="Code shared too widely"
                          maxLength={200}
                          required
                        />
                      </label>
                      <button type="submit">Revoke {invite.label}</button>
                    </form>
                  </details>
                ) : null}
                <details>
                  <summary>Recipient history ({invite.redemptions.length})</summary>
                  {invite.redemptions.length ? (
                    <ul>
                      {invite.redemptions.map((redemption) => (
                        <li key={redemption.id}>
                          Account {redemption.recipientUserId} · {redemption.amount} credits ·{' '}
                          {formatDateTime(redemption.redeemedAt)} · ledger {redemption.ledgerId}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="admin-muted">No redemptions yet.</p>
                  )}
                </details>
              </article>
            ))}
          </div>
        ) : (
          <div className="admin-empty">No invites yet. Create the first offer above.</div>
        )}
      </section>
    </>
  );
}
