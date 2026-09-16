import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { getActiveWebsiteGames, settings } from '@/lib/arcade';
import { SiteFrame, viewer } from '../components/site-frame';
import { JobRefresh } from '../me/games/[id]/refresh';
import { MAX_ACTIVE_WEBSITE_GAMES } from '@/lib/website-creation-policy';
import { CreateForm } from './create-form';
export const metadata = { title: 'Create a game', robots: { index: false, follow: false } };
export default async function CreatePage() {
  const user = await viewer();
  if (!user) redirect('/sign-in?redirect_url=/create');
  const [config, activeGames] = await Promise.all([settings(), getActiveWebsiteGames(user.userId)]);
  return (
    <SiteFrame active="create">
      <section className="arc-hero">
        <span className="arc-kicker">Your imagination. Playable.</span>
        <h1>What will you make?</h1>
        <p>
          Share an idea or let Spark surprise you. We’ll build the world, the art, and the game.
        </p>
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
              You have {user.credits} credits. Creating a game costs {config.price} credits. Buying
              credits is coming soon.
            </p>
          )}
          <CreateForm
            activeGames={activeGames}
            price={config.price}
            disabled={!config.enabled || user.suspended || user.credits < config.price}
            submissionKey={randomUUID()}
          />
          {activeGames.length > 0 && (
            <JobRefresh message="This page updates automatically as game slots become available." />
          )}
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
            <li>
              Choose your game type and add any personal touches. Spark checks your idea and photo
              automatically.
            </li>
            <li>We generate your game. Follow along in your library.</li>
            <li>After an automatic final content check, play and share its direct link.</li>
            <li>Publish when you want it in the public arcade.</li>
          </ol>
          <p className="arc-fine-print">
            Keep it PG-13 or under. Profanity and light fighting are fine; sexual, hateful, or
            graphic content is not. You can have up to {MAX_ACTIVE_WEBSITE_GAMES} games in progress
            at a time.
          </p>
        </aside>
      </div>
    </SiteFrame>
  );
}
