import { UserButton } from '@clerk/nextjs';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminIdentity } from '@/lib/admin-auth';
import { listManagedKiosks, type FeedVisibility } from '@/lib/kiosks';
import { listManagedPublicGames } from '@/lib/public-games';
import { GameCardArt } from '../play/game-card-art';
import {
  pairKioskAction,
  renameKioskAction,
  revokeKioskAction,
  setGameVisibilityAction,
  setKioskVisibilityAction,
} from './actions';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type AdminPageProps = {
  searchParams: Promise<{
    notice?: string | string[];
    tone?: string | string[];
    visibility?: string | string[];
  }>;
};

function relativeTime(value: string | null): string {
  if (!value) return 'Never connected';
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (elapsedMinutes < 1) return 'Connected just now';
  if (elapsedMinutes < 60) return `Seen ${elapsedMinutes}m ago`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `Seen ${hours}h ago`;
  return `Seen ${Math.floor(hours / 24)}d ago`;
}

function visibilityLabel(value: FeedVisibility): string {
  return value === 'listed' ? 'Listed' : 'Unlisted';
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const identity = await getAdminIdentity();
  if (!identity) redirect('/sign-in?redirect_url=/admin');
  if (!identity.authorized) {
    return (
      <main className="admin-page admin-access-page">
        <section className="admin-access-card">
          <span className="admin-kicker">Operator access</span>
          <h1>Signed in, but not cleared.</h1>
          <p>{identity.reason}</p>
          <p className="admin-muted">Signed in as {identity.email || identity.userId}</p>
          <UserButton />
        </section>
      </main>
    );
  }

  const query = await searchParams;
  const requestedVisibility = Array.isArray(query.visibility)
    ? query.visibility[0]
    : query.visibility;
  const visibility: 'all' | FeedVisibility =
    requestedVisibility === 'listed' || requestedVisibility === 'unlisted'
      ? requestedVisibility
      : 'all';
  const [kiosks, allGames] = await Promise.all([
    listManagedKiosks(identity.userId),
    listManagedPublicGames(),
  ]);
  const games =
    visibility === 'all' ? allGames : allGames.filter((game) => game.feedVisibility === visibility);
  const notice = Array.isArray(query.notice) ? query.notice[0] : query.notice;
  const tone =
    (Array.isArray(query.tone) ? query.tone[0] : query.tone) === 'error' ? 'error' : 'success';

  return (
    <main className="admin-page">
      <div className="ambient-grid" aria-hidden="true" />
      <header className="admin-header admin-shell">
        <Link className="brand" href="/" aria-label="Sparkade home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-word">Sparkade</span>
        </Link>
        <div className="admin-account">
          <span>{identity.displayName}</span>
          <UserButton />
        </div>
      </header>

      <section className="admin-hero admin-shell">
        <span className="admin-kicker">Operator console</span>
        <h1>Keep every cabinet in reach.</h1>
        <p>
          Pair kiosks without handling credentials, then control what reaches the public arcade.
        </p>
      </section>

      {notice ? (
        <div className={`admin-notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
          {notice}
        </div>
      ) : null}

      <section className="admin-section admin-shell" aria-labelledby="pair-title">
        <div className="admin-section-heading">
          <div>
            <span>Device setup</span>
            <h2 id="pair-title">Pair a kiosk</h2>
          </div>
          <p>Enter the code shown in Settings → Registration on the cabinet.</p>
        </div>
        <form className="admin-pair-form" action={pairKioskAction}>
          <label>
            Pairing code
            <input
              name="code"
              placeholder="K7M4-PQ9D"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={9}
              required
            />
          </label>
          <label>
            Kiosk name
            <input name="name" placeholder="Meta SEA" maxLength={80} required />
          </label>
          <label>
            New game visibility
            <select name="defaultFeedVisibility" defaultValue="unlisted">
              <option value="unlisted">Unlisted by default</option>
              <option value="listed">List in public feed</option>
            </select>
          </label>
          <button type="submit">Pair kiosk</button>
        </form>
      </section>

      <section className="admin-section admin-shell" aria-labelledby="kiosks-title">
        <div className="admin-section-heading">
          <div>
            <span>Fleet</span>
            <h2 id="kiosks-title">Kiosks</h2>
          </div>
          <p>{kiosks.length} registered</p>
        </div>
        {kiosks.length ? (
          <div className="admin-kiosk-grid">
            {kiosks.map((kiosk) => (
              <article
                className={`admin-kiosk-card ${kiosk.revokedAt ? 'revoked' : ''}`}
                key={kiosk.id}
              >
                <div className="admin-card-topline">
                  <span className={`admin-status-dot ${kiosk.revokedAt ? 'revoked' : ''}`} />
                  <span>{kiosk.revokedAt ? 'Revoked' : relativeTime(kiosk.lastSeenAt)}</span>
                  <strong>{kiosk.gameCount} games</strong>
                </div>
                <form action={renameKioskAction} className="admin-inline-form">
                  <input type="hidden" name="kioskId" value={kiosk.id} />
                  <label>
                    Name
                    <input
                      name="name"
                      defaultValue={kiosk.name}
                      maxLength={80}
                      disabled={!!kiosk.revokedAt}
                    />
                  </label>
                  <button type="submit" disabled={!!kiosk.revokedAt}>
                    Save
                  </button>
                </form>
                <form action={setKioskVisibilityAction} className="admin-inline-form">
                  <input type="hidden" name="kioskId" value={kiosk.id} />
                  <label>
                    New games
                    <select
                      name="defaultFeedVisibility"
                      defaultValue={kiosk.defaultFeedVisibility}
                      disabled={!!kiosk.revokedAt}
                    >
                      <option value="unlisted">Unlisted</option>
                      <option value="listed">Listed publicly</option>
                    </select>
                  </label>
                  <button type="submit" disabled={!!kiosk.revokedAt}>
                    Update
                  </button>
                </form>
                {!kiosk.revokedAt ? (
                  <details className="admin-danger-zone">
                    <summary>Revoke access</summary>
                    <p>This cabinet will stop publishing and must pair again.</p>
                    <form action={revokeKioskAction}>
                      <input type="hidden" name="kioskId" value={kiosk.id} />
                      <button type="submit">Revoke {kiosk.name}</button>
                    </form>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="admin-empty">No kiosks yet. Open Registration on a cabinet to begin.</div>
        )}
      </section>

      <section className="admin-section admin-shell" aria-labelledby="games-title">
        <div className="admin-section-heading admin-games-heading">
          <div>
            <span>Cloud library</span>
            <h2 id="games-title">Published games</h2>
          </div>
          <nav className="admin-filters" aria-label="Game visibility filter">
            {(['all', 'listed', 'unlisted'] as const).map((filter) => (
              <Link
                className={visibility === filter ? 'active' : ''}
                href={
                  filter === 'all'
                    ? '/admin#games-title'
                    : `/admin?visibility=${filter}#games-title`
                }
                key={filter}
              >
                {filter[0]?.toUpperCase()}
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
                  href={`/p/${game.id}`}
                  aria-label={`Open ${game.title}`}
                >
                  <GameCardArt src={game.keyArtUrl} title={game.title} preload={index === 0} />
                </Link>
                <div className="admin-game-copy">
                  <div className="admin-game-meta">
                    <span className={`admin-visibility ${game.feedVisibility}`}>
                      {visibilityLabel(game.feedVisibility)}
                    </span>
                    <span>{game.status}</span>
                  </div>
                  <h3>{game.title}</h3>
                  <p>
                    Created from {game.kioskName} · /p/{game.id}
                  </p>
                </div>
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
              </article>
            ))}
          </div>
        ) : (
          <div className="admin-empty">No games match this visibility filter.</div>
        )}
      </section>
    </main>
  );
}
