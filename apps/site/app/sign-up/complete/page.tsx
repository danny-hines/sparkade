import { UserButton } from '@clerk/nextjs';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSiteAccess, INVITE_ONLY_PATH } from '@/lib/site-access';
import { CompletionForm } from './completion-form';

export default async function CompleteSignupPage() {
  const access = await getSiteAccess();
  if (access.status === 'signed-out') redirect('/sign-in?redirect_url=/sign-up/complete');
  if (access.status === 'denied') redirect(INVITE_ONLY_PATH);
  return (
    <>
      <main className="auth-page">
        <section className="auth-card">
          <div className="account-heading">
            <Link className="brand" href="/">
              Sparkade
            </Link>
            <UserButton />
          </div>
          <div className="auth-heading">
            <span>Welcome aboard</span>
            <h1>One last step.</h1>
          </div>
          <CompletionForm />
          <p className="signup-footer">
            Need to verify your email? Open your account menu above, then retry.
          </p>
        </section>
      </main>
    </>
  );
}
