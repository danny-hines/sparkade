import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { settings } from '@/lib/arcade';
import { SiteFrame, viewer } from '../components/site-frame';
import { CreateForm } from './create-form';
export const metadata = { title: 'Create a game', robots: { index: false, follow: false } };
export default async function CreatePage() {
  const user = await viewer();
  if (!user) redirect('/sign-in?redirect_url=/create');
  const config = await settings();
  return (
    <SiteFrame active="create">
      <section className="arc-hero">
        <span className="arc-kicker">Your imagination. Playable.</span>
        <h1>What will you make?</h1>
        <p>Give us an idea. We’ll build the world, the art, and the game.</p>
      </section>
      <div className="arc-create-layout">
        <section className="arc-panel">
          {!config.enabled && (
            <p className="arc-message">
              Creation is paused while we get the arcade ready. Your credits are safe.
            </p>
          )}
          {user.suspended && (
            <p className="arc-message">
              Your account is paused. Please contact the person who invited you.
            </p>
          )}
          {user.credits < config.price && (
            <p className="arc-message">
              You have {user.credits} credits. A game costs {config.price}. Buying credits is coming
              soon.
            </p>
          )}
          <CreateForm
            price={config.price}
            disabled={!config.enabled || user.suspended || user.credits < config.price}
            submissionKey={randomUUID()}
          />
        </section>
        <aside className="arc-panel">
          <span className="arc-kicker">Your balance</span>
          <div className="arc-credit-number">
            {user.credits}
            <small>credits available</small>
          </div>
          <p>Buying credits is coming soon.</p>
          <hr />
          <h2>From idea to arcade</h2>
          <ol className="arc-steps">
            <li>Submit your idea for a quick human review.</li>
            <li>We generate your game. Follow along in your library.</li>
            <li>After a final review, play and share its direct link.</li>
            <li>Publish when you want it in the public arcade.</li>
          </ol>
          <p className="arc-fine-print">
            This is a small beta. Reviews may take a little time. You can have one game in progress
            at a time.
          </p>
        </aside>
      </div>
    </SiteFrame>
  );
}
