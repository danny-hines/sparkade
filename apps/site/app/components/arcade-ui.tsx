import type { ReactNode } from 'react';
import { NotificationBell } from './notifications';

import { GameCardArt } from '../play/game-card-art';

export type ArcadeNavKey = 'home' | 'play' | 'create' | 'profile';

export type ArcadeViewer = {
  handle: string;
  credits: number;
  admin: boolean;
  accountMenu?: ReactNode;
} | null;

export type ArcadeGame = {
  href?: string;
  id: string;
  title: string;
  description?: string | null;
  archetype: string | null;
  keyArtUrl: string | null;
  creatorHandle?: string | null;
  creatorName?: string | null;
  kioskName?: string;
  plays?: number;
  likes?: number;
};

const NAV_ITEMS: Array<{ key: ArcadeNavKey; label: string; href: string }> = [
  { key: 'home', label: 'Home', href: '/' },
  { key: 'play', label: 'Play', href: '/play' },
  { key: 'create', label: 'Create', href: '/create' },
];

export function gameTypeLabel(type: string | null): string {
  switch ((type ?? '').trim().toLowerCase()) {
    case 'adventure':
      return 'Adventure';
    case 'fighter':
      return 'Fighter';
    case 'hshooter':
      return 'Horizontal shooter';
    case 'platformer':
      return 'Platformer';
    case 'shooter':
      return 'Shooter';
    case 'racing':
      return 'Racing';
    case '':
      return 'Arcade';
    default:
      return 'Arcade';
  }
}

export function ArcadeHeader({ viewer, active }: { viewer: ArcadeViewer; active?: ArcadeNavKey }) {
  return (
    <header className="arc-header">
      <div className="arc-shell arc-header-inner">
        <a className="arc-brand" href="/" aria-label="Sparkade home">
          <span className="arc-brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="arc-brand-word">Sparkade</span>
        </a>
        <nav className="arc-nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.key}
              className="arc-nav-link"
              href={item.href}
              aria-current={active === item.key ? 'page' : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="arc-header-account">
          {viewer ? (
            <>
              <a
                className="arc-account-link"
                href="/me"
                aria-current={active === 'profile' ? 'page' : undefined}
              >
                <span className="arc-account-handle">@{viewer.handle}</span>
                <span className="arc-account-balance">
                  {viewer.credits} {viewer.credits === 1 ? 'credit' : 'credits'}
                </span>
              </a>
              {viewer.admin ? (
                <a className="arc-nav-link arc-admin-link" href="/admin">
                  Admin
                </a>
              ) : null}
              <NotificationBell />
              {viewer.accountMenu}
            </>
          ) : (
            <>
              <a className="arc-nav-link" href="/sign-in">
                Sign in
              </a>
              <a className="arc-button arc-button-small" href="/sign-up">
                Sign up
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function ArcadeGameCard({
  game,
  action,
  children,
}: {
  game: ArcadeGame;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const creatorLabel = game.creatorName ?? game.creatorHandle ?? game.kioskName ?? null;
  const stats: string[] = [];
  if (typeof game.plays === 'number') {
    stats.push(`${game.plays} ${game.plays === 1 ? 'play' : 'plays'}`);
  }
  if (typeof game.likes === 'number') {
    stats.push(`${game.likes} ${game.likes === 1 ? 'like' : 'likes'}`);
  }

  return (
    <article className="arc-card" aria-labelledby={`arc-game-${game.id}`}>
      <a
        className="arc-card-art"
        href={game.href ?? `/p/${game.id}`}
        aria-label={`${game.href ? 'View' : 'Play'} ${game.title}`}
        tabIndex={0}
      >
        <GameCardArt src={game.keyArtUrl} title={game.title} preload={false} />
        <span className="arc-card-scanlines" aria-hidden="true" />
        <span className="arc-card-play" aria-hidden="true">
          {game.href ? 'View game' : 'Play'} <span>→</span>
        </span>
      </a>
      <div className="arc-card-body">
        <p className="arc-card-meta">
          <span>{gameTypeLabel(game.archetype)}</span>
          {stats.length > 0 ? <span>{stats.join(' · ')}</span> : null}
        </p>
        <h3 className="arc-card-title" id={`arc-game-${game.id}`}>
          <a href={game.href ?? `/p/${game.id}`}>{game.title}</a>
        </h3>
        {game.description ? <p className="arc-card-description">{game.description}</p> : null}
        {creatorLabel ? (
          <p className="arc-card-byline">
            by{' '}
            {game.creatorHandle ? (
              <a href={`/u/${game.creatorHandle}`}>
                {game.creatorName ?? `@${game.creatorHandle}`}
              </a>
            ) : (
              creatorLabel
            )}
          </p>
        ) : null}
        {action ? <div className="arc-card-action">{action}</div> : null}
        {children}
      </div>
    </article>
  );
}

export function ArcadeEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="arc-empty" role="status">
      <span aria-hidden="true">✦</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className="arc-empty-action">{action}</div> : null}
    </div>
  );
}

export function ArcadeFooter() {
  return (
    <footer className="arc-footer">
      <div className="arc-shell arc-footer-inner">
        <a className="arc-brand" href="/" aria-label="Sparkade home">
          <span className="arc-brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="arc-brand-word">Sparkade</span>
        </a>
        <nav className="arc-footer-nav" aria-label="Footer">
          <a href="/">Home</a>
          <a href="/play">Play</a>
          <a href="/create">Create</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
        <p className="arc-footer-note">Your idea. Your arcade.</p>
      </div>
    </footer>
  );
}
