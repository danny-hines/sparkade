import Link from 'next/link';
import { listManagedPublicGames } from '@/lib/public-games';
import type { FeedVisibility } from '@/lib/kiosks';
import { GameCardArt } from '../../play/game-card-art';
import { getAdminPageIdentity } from '../page-access';
import { AdminNotice, queryValue, type AdminQuery } from '../admin-notice';
import { setGameVisibilityAction } from '../actions';
export const metadata = { title: 'Admin · Games' };
export const dynamic = 'force-dynamic';
function visibilityLabel(value: FeedVisibility) {
  return value === 'listed' ? 'Listed' : 'Unlisted';
}
export default async function GamesPage({ searchParams }: { searchParams: Promise<AdminQuery> }) {
  if (!(await getAdminPageIdentity('/admin/games'))) return null;
  const [allGames, query] = await Promise.all([listManagedPublicGames(), searchParams]);
  const requested = queryValue(query.visibility);
  const visibility = requested === 'listed' || requested === 'unlisted' ? requested : 'all';
  const games =
    visibility === 'all' ? allGames : allGames.filter((game) => game.feedVisibility === visibility);
  return (
    <>
      <section className="admin-hero">
        <span className="admin-kicker">Cloud library</span>
        <h1>Games</h1>
        <p>
          Manage cabinet feed visibility and open online creations for review. Creators control
          publishing for their own games.
        </p>
      </section>
      <AdminNotice query={query} />
      <section className="admin-section" aria-labelledby="games-title">
        <div className="admin-section-heading admin-games-heading">
          <div>
            <span>Cloud library</span>
            <h2 id="games-title">Game library</h2>
          </div>
          <nav className="admin-filters" aria-label="Game visibility filter">
            {(['all', 'listed', 'unlisted'] as const).map((filter) => (
              <Link
                key={filter}
                className={visibility === filter ? 'active' : ''}
                aria-current={visibility === filter ? 'page' : undefined}
                href={filter === 'all' ? '/admin/games' : `/admin/games?visibility=${filter}`}
              >
                {filter[0].toUpperCase()}
                {filter.slice(1)}
              </Link>
            ))}
          </nav>
        </div>
        {games.length ? (
          <div className="admin-game-list">
            {games.map((game, index) => (
              <article className="admin-game-row" key={game.id}>
                <Link
                  className="admin-game-art"
                  href={
                    game.ownerId && game.moderation !== 'approved'
                      ? `/admin/creation#game-${game.id}`
                      : `/p/${game.id}`
                  }
                  aria-label={`Open ${game.title}`}
                >
                  <GameCardArt src={game.keyArtUrl} title={game.title} preload={index === 0} />
                </Link>
                <div className="admin-game-copy">
                  <div className="admin-game-meta">
                    <span className={`admin-visibility ${game.feedVisibility}`}>
                      {visibilityLabel(game.feedVisibility)}
                    </span>
                    <span>
                      {game.ownerId && game.moderation !== 'approved'
                        ? game.moderation
                        : game.status}
                    </span>
                  </div>
                  <h3>{game.title}</h3>
                  <p>
                    {game.ownerId ? 'Created online' : `Created from ${game.kioskName}`} · /p/
                    {game.id}
                  </p>
                </div>
                <div className="admin-game-actions">
                  {game.ownerId ? (
                    <Link href={`/admin/creation#game-${game.id}`}>Manage creation →</Link>
                  ) : (
                    <form action={setGameVisibilityAction}>
                      <input type="hidden" name="gameId" value={game.id} />
                      <input
                        type="hidden"
                        name="feedVisibility"
                        value={game.feedVisibility === 'listed' ? 'unlisted' : 'listed'}
                      />
                      <button type="submit">
                        {game.feedVisibility === 'listed' ? 'Remove from feed' : 'List publicly'}
                      </button>
                    </form>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="admin-empty">No games match this visibility filter.</div>
        )}
      </section>
      <p className="admin-muted">Showing up to 100 recent games.</p>
    </>
  );
}
