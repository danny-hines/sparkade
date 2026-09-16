import { ARCHETYPE_IDS } from '@sparkade/shared';
import { browseGames } from '@/lib/arcade';
import { SiteFrame, viewer } from './components/site-frame';
import { gameTypeLabel } from './components/arcade-ui';
import { GameGrid } from './components/game-grid';
export const dynamic = 'force-dynamic';
export default async function HomePage() {
  const user = await viewer();
  const [recent, top] = await Promise.all([
    browseGames({ limit: 6, viewer: user?.userId }),
    browseGames({ limit: 3, sort: 'likes', viewer: user?.userId }),
  ]);
  return (
    <SiteFrame active="home">
      <section className="arc-hero arc-home-hero">
        <span className="arc-kicker">A new kind of arcade</span>
        <h1>
          Small games.
          <br />
          <em>Big imagination.</em>
        </h1>
        <p>Play something someone dreamed up. Then turn your own idea into a game worth sharing.</p>
        <div className="arc-hero-actions">
          <a className="arc-button" href="/create">
            Create a game <span aria-hidden="true">↗</span>
          </a>
          <a className="arc-button-secondary" href="/play">
            Explore the arcade
          </a>
        </div>
        <div className="arc-type-links">
          {ARCHETYPE_IDS.map((type) => (
            <a key={type} href={`/play?type=${type}`}>
              {gameTypeLabel(type)} ↗
            </a>
          ))}
        </div>
      </section>
      <section className="arc-section">
        <div className="arc-section-heading">
          <div>
            <span className="arc-kicker">Fresh from the community</span>
            <h2>Recently published</h2>
          </div>
          <a href="/play">View all →</a>
        </div>
        <GameGrid games={recent.games} signedIn={Boolean(user)} />
      </section>
      {top.games.some((g) => g.likes > 0) && (
        <section className="arc-section">
          <div className="arc-section-heading">
            <div>
              <span className="arc-kicker">Player favorites</span>
              <h2>Most loved</h2>
            </div>
            <a href="/play?sort=likes">See the favorites →</a>
          </div>
          <GameGrid games={top.games.filter((g) => g.likes > 0)} signedIn={Boolean(user)} />
        </section>
      )}
      <section className="arc-panel arc-create-banner">
        <div>
          <span className="arc-kicker">Friends beta</span>
          <h2>Your idea gets the next turn.</h2>
          <p>Start with a prompt. Get a playable game. Publish it when you’re ready.</p>
        </div>
        <a className="arc-button" href="/create">
          Make something yours →
        </a>
      </section>
    </SiteFrame>
  );
}
