import { SignIn } from '@clerk/nextjs';
import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeReturnPath, SIGNUP_COOKIE } from '@/lib/signup';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign in',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string }>;
}) {
  const query = await searchParams;
  const destination =
    (await cookies()).has(SIGNUP_COOKIE) || query.redirect_url === '/sign-up/complete'
      ? '/sign-up/complete'
      : safeReturnPath(query.redirect_url);
  const { userId } = await auth();
  if (userId) redirect(destination);
  const signupUrl = `/sign-up?redirect_url=${encodeURIComponent(safeReturnPath(query.redirect_url))}`;
  return (
    <>
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
            <span>Welcome back</span>
            <h1>Your arcade awaits.</h1>
          </div>
          <SignIn
            routing="path"
            path="/sign-in"
            signUpUrl={signupUrl}
            forceRedirectUrl={destination}
            withSignUp={false}
          />
        </section>
      </main>
    </>
  );
}
