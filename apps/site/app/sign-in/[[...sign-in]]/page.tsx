import { ClerkProvider, SignIn } from '@clerk/nextjs';
import Link from 'next/link';

export default function SignInPage() {
  return (
    <ClerkProvider>
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
            <span>Operator access</span>
            <h1>Step behind the cabinet.</h1>
          </div>
          <SignIn routing="path" path="/sign-in" forceRedirectUrl="/admin" />
        </section>
      </main>
    </ClerkProvider>
  );
}
