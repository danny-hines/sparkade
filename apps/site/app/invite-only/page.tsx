import { SignOutButton } from '@clerk/nextjs';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSiteAccess } from '@/lib/site-access';

export const metadata: Metadata = {
  title: 'Invite only',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function InviteOnlyPage() {
  const access = await getSiteAccess();
  if (access.status === 'member') redirect('/me');
  return (
    <main className="auth-page">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="ambient-glow ambient-glow-cyan" aria-hidden="true" />
      <section className="auth-card">
        <Link className="brand" href="/" aria-label="Sparkade home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-word">Sparkade</span>
        </Link>
        <div className="auth-heading">
          <span>Invite only</span>
          <h1>You’re not on the list yet.</h1>
        </div>
        {access.status === 'denied' ? (
          <>
            <p className="signup-offer">
              {access.reason === 'unverified' ? (
                <>
                  <strong>{access.email}</strong> is invited but not verified yet. Sign in again and
                  finish verifying it.
                </>
              ) : (
                <>
                  Sparkade is open to invited email addresses only, and{' '}
                  <strong>{access.email || 'this account'}</strong> hasn’t been invited. Ask the
                  person who invited you to add your email, or sign in with the address they used.
                </>
              )}
            </p>
            <div className="signup-form">
              <SignOutButton redirectUrl="/sign-in">
                <button className="signup-button" type="button">
                  Sign out and use another email
                </button>
              </SignOutButton>
              <SignOutButton redirectUrl="/play">
                <button className="signup-text-button" type="button">
                  Sign out and play shared games
                </button>
              </SignOutButton>
            </div>
          </>
        ) : (
          <>
            <p className="signup-offer">
              Sparkade is open to invited email addresses only. Sign in with the address you were
              invited with.
            </p>
            <p className="signup-footer">
              <Link href="/sign-in">Sign in</Link> · <Link href="/play">Play shared games</Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
