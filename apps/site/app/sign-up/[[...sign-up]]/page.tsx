import { SignUp } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { lookupInviteOffer } from '@/lib/invites';
import { readSignupAttempt, safeReturnPath, SIGNUP_COOKIE } from '@/lib/signup';
import { SignupForm } from '../signup-form';

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; redirect_url?: string }>;
}) {
  const { userId } = await auth();
  if (userId) redirect('/sign-up/complete');
  const query = await searchParams;
  const attempt = await readSignupAttempt((await cookies()).get(SIGNUP_COOKIE)?.value);
  const offer = attempt?.code ? await lookupInviteOffer(attempt.code) : null;
  return (
    <main className="auth-page">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="ambient-glow ambient-glow-cyan" aria-hidden="true" />
      <section className="auth-card">
        <Link className="brand" href="/">
          Sparkade
        </Link>
        <div className="auth-heading">
          <span>Your next game starts here</span>
          <h1>Join the arcade.</h1>
        </div>
        {!attempt ? (
          <SignupForm
            code={typeof query.invite === 'string' ? query.invite.slice(0, 100) : ''}
            returnPath={safeReturnPath(query.redirect_url)}
          />
        ) : (
          <>
            <p className="signup-offer">
              {offer?.valid
                ? `${offer.credits} starting credits with your invite. Credits are added after email verification, while the offer has space and is still active.`
                : attempt.code
                  ? 'Your invite is no longer available. You can change it below or finish signup and choose another code.'
                  : 'Your account will start with 0 credits. Buying credits is coming soon.'}
            </p>
            <>
              <SignUp
                routing="path"
                path="/sign-up"
                signInUrl="/sign-in"
                forceRedirectUrl="/sign-up/complete"
                signInForceRedirectUrl="/sign-up/complete"
              />
            </>
            <details className="signup-change">
              <summary>Change your invite choice</summary>
              <SignupForm code={attempt.code ?? ''} returnPath={attempt.returnPath} />
            </details>
          </>
        )}
        <p className="signup-footer">
          Already have an account? <Link href="/sign-in">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
