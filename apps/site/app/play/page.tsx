import type { Metadata } from 'next';
import { ARCHETYPE_IDS } from '@sparkade/shared';
import { browseGames } from '@/lib/arcade';
import { SiteFrame, viewer } from '../components/site-frame';
import { gameTypeLabel } from '../components/arcade-ui';
import { GameGrid } from '../components/game-grid';
export const metadata: Metadata = { title: 'Play', alternates: { canonical: '/play' } };
export const dynamic = 'force-dynamic';
export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams,
    user = await viewer();
  const q = typeof params.q === 'string' ? params.q.slice(0, 120) : '',
    type = typeof params.type === 'string' ? params.type : '',
    sort = typeof params.sort === 'string' ? params.sort : 'recent';
  const page = Math.max(1, Math.min(1000, Number(params.page) || 1));
  const result = await browseGames({ q, type, sort, page, viewer: user?.userId });
  const href = (p: number) => `/play?${new URLSearchParams({ q, type, sort, page: String(p) })}`;
  return (
    <SiteFrame active="play">
      <section className="arc-hero">
        <span className="arc-kicker">The community arcade</span>
        <h1>
          Find your next
          <br />
          “one more go.”
        </h1>
        <p>Original games, made from real people’s ideas. Pick a world and jump in.</p>
      </section>
      <form className="arc-toolbar" action="/play">
        <label className="arc-search">
          Search games
          <input
            className="arc-input"
            type="search"
            name="q"
            defaultValue={q}
            maxLength={120}
            placeholder="A title, a world, a creator…"
          />
        </label>
        <label>
          Game type
          <select className="arc-input" name="type" defaultValue={type}>
            <option value="">All types</option>
            {ARCHETYPE_IDS.map((t) => (
              <option key={t} value={t}>
                {gameTypeLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort by
          <select className="arc-input" name="sort" defaultValue={sort}>
            <option value="recent">Most recent</option>
            <option value="plays">Most played</option>
            <option value="likes">Most liked</option>
          </select>
        </label>
        <button className="arc-button" type="submit">
          Find games
        </button>
        <a href="/play">Reset</a>
      </form>
      <section className="arc-section">
        <div className="arc-section-heading">
          <h2>{q ? `Results for “${q}”` : 'Ready to play'}</h2>
          <span>
            {gameTypeLabel(type || null)} · Page {page}
          </span>
        </div>
        <GameGrid games={result.games} signedIn={Boolean(user)} />
        <nav className="arc-pagination" aria-label="Game pages">
          {page > 1 && (
            <a className="arc-button-secondary" href={href(page - 1)}>
              ← Previous
            </a>
          )}
          {result.more && (
            <a className="arc-button-secondary" href={href(page + 1)}>
              Next →
            </a>
          )}
        </nav>
      </section>
    </SiteFrame>
  );
}
