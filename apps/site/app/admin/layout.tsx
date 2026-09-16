import { UserButton } from '@clerk/nextjs';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { NotificationBell } from '../components/notifications';
import { AdminNav } from './admin-nav';
import { adminPageIdentity } from './page-access';
import './admin.css';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  const identity = await adminPageIdentity();
  // Anonymous page guards redirect to sign-in with their exact return URL.
  if (!identity) return <>{children}</>;
  if (!identity.authorized)
    return (
      <>
        <main className="admin-page admin-access-page">
          <section className="admin-access-card">
            <span className="admin-kicker">Operator access</span>
            <h1>Signed in, but not cleared.</h1>
            <p>{identity.reason}</p>
            <p className="admin-muted">Signed in as {identity.email || identity.userId}</p>
            <Link href="/">Back to the arcade</Link>
            <UserButton />
          </section>
        </main>
      </>
    );
  return (
    <>
      <div className="admin-page">
        <a href="#admin-content" className="admin-skip-link">
          Skip to admin content
        </a>
        <header className="admin-header admin-shell">
          <Link className="brand" href="/admin" aria-label="Sparkade admin overview">
            <span className="brand-mark" aria-hidden="true">
              <span />
            </span>
            <span className="brand-word">
              Sparkade <small>Admin</small>
            </span>
          </Link>
          <div className="admin-account">
            <Link href="/">View site ↗</Link>
            <span>{identity.displayName}</span>
            <NotificationBell />
            <UserButton />
          </div>
        </header>
        <div className="admin-nav-bar">
          <AdminNav />
        </div>
        <main id="admin-content" className="admin-content admin-shell">
          {children}
        </main>
      </div>
    </>
  );
}
