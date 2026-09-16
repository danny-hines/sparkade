import { UserButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { CompletionForm } from './completion-form';

export default async function CompleteSignupPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in?redirect_url=/sign-up/complete');
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
