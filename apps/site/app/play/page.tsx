import type { Metadata } from 'next';
import Link from 'next/link';
import { listRecentPublicGames, type PublicGameFeedItem } from '@/lib/public-games';
import { GameCardArt } from './game-card-art';

export const metadata: Metadata = {
  title: 'Play',
  description: 'Play the latest games created on Sparkade cabinets.',
  alternates: { canonical: '/play' },
  openGraph: {
    title: 'Play the latest Sparkade games',
    description: 'Fresh games from Sparkade cabinets, ready to play in your browser.',
    url: '/play',
  },
};

export const dynamic = 'force-dynamic';

type PlayPageProps = {
  searchParams: Promise<{ after?: string | string[] }>;
};

const ARCHETYPE_LABELS: Record<string, string> = {
  adventure: 'Adventure',
  fighter: 'Fighter',
  hshooter: 'Side-scrolling shooter',
  platformer: 'Platformer',
  shooter: 'Vertical shooter',
};

function publishedLabel(readyAt: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(readyAt));
}

function gameTypeLabel(game: PublicGameFeedItem): string {
  return game.archetype
    ? (ARCHETYPE_LABELS[game.archetype] ?? 'Arcade original')
    : 'Arcade original';
}

export default async function PlayPage({ searchParams }: PlayPageProps) {
  const requestedCursor = (await searchParams).after;
  const after = typeof requestedCursor === 'string' ? requestedCursor : undefined;
  const page = await listRecentPublicGames({ after });

  return (
    <main className="arcade-page">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="ambient-glow ambient-glow-cyan" aria-hidden="true" />
      <div className="ambient-glow ambient-glow-orange" aria-hidden="true" />

      <header className="site-header page-shell">
        <Link className="brand" href="/" aria-label="Sparkade home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-word">Sparkade</span>
        </Link>
        <nav className="site-nav" aria-label="Primary navigation">
          <Link className="header-link" href="/#updates">
            Updates
            <span aria-hidden="true">↘</span>
          </Link>
        </nav>
      </header>

      <section className="arcade-intro page-shell" aria-labelledby="arcade-title">
        <div className="eyebrow">
          <span className="eyebrow-light" aria-hidden="true" />
          The public arcade
        </div>
        <h1 id="arcade-title">
          Fresh from
          <br />
          <span>the cabinets.</span>
        </h1>
        <p>
          Every game here began as someone’s idea at a Sparkade cabinet. Pick one and jump in—no
          quarters required.
        </p>
      </section>

      <section className="arcade-feed page-shell" aria-label="Recently published games">
        <div className="arcade-feed-heading">
          <h2>Recently published</h2>
          <span>{page.games.length > 0 ? 'Newest first' : 'Waiting for players'}</span>
        </div>

        {page.games.length > 0 ? (
          <div className="arcade-game-grid">
            {page.games.map((game, index) => (
              <Link
                className="arcade-game-card"
                href={`/p/${game.id}`}
                aria-label={`Play ${game.title}`}
                key={game.id}
              >
                <div className="arcade-card-art">
                  <GameCardArt src={game.keyArtUrl} title={game.title} preload={index === 0} />
                  <div className="arcade-card-scanlines" aria-hidden="true" />
                  <span className="arcade-card-play">
                    Play now <span aria-hidden="true">↗</span>
                  </span>
                </div>
                <div className="arcade-card-copy">
                  <div className="arcade-card-meta">
                    <span>{gameTypeLabel(game)}</span>
                    <time dateTime={game.readyAt}>{publishedLabel(game.readyAt)}</time>
                  </div>
                  <h2>{game.title}</h2>
                  <p>
                    Created from <strong>{game.kioskName}</strong>
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="arcade-empty">
            <span aria-hidden="true">✦</span>
            <h2>The floor is warming up.</h2>
            <p>Published cabinet creations will appear here as soon as they’re ready to play.</p>
          </div>
        )}

        {after || page.nextCursor ? (
          <nav className="arcade-pagination" aria-label="Game feed pages">
            {after ? <Link href="/play">← Latest games</Link> : <span />}
            {page.nextCursor ? (
              <Link href={`/play?after=${encodeURIComponent(page.nextCursor)}`}>More games →</Link>
            ) : (
              <span className="arcade-end">You reached the end</span>
            )}
          </nav>
        ) : null}
      </section>

      <footer className="site-footer page-shell">
        <Link className="brand brand-small" href="/" aria-label="Sparkade home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-word">Sparkade</span>
        </Link>
        <p>Made with dangerous levels of nostalgia.</p>
        <span>© {new Date().getUTCFullYear()} Sparkade</span>
      </footer>
    </main>
  );
}
