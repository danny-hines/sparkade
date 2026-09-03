'use client';

import { useEffect, useState } from 'react';
import type { PublicGame } from '@/lib/public-games';
import { GameShareActions } from './game-share-actions';
import { PublicGamePlayer } from './public-game-player';

const STATUS_LABELS = {
  queued: 'Reserved',
  generating: 'Building',
  ready: 'Ready',
  failed: 'Needs attention',
} as const;

function isTerminal(status: PublicGame['status']): boolean {
  return status === 'ready' || status === 'failed';
}

export function GameStatus({ initialGame }: { initialGame: PublicGame }) {
  const [game, setGame] = useState(initialGame);

  useEffect(() => {
    if (isTerminal(initialGame.status)) return;
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetch(`/api/games/${encodeURIComponent(initialGame.id)}`, {
          cache: 'no-store',
        });
        if (response.ok) {
          const payload = (await response.json()) as { game: PublicGame };
          if (!active) return;
          setGame(payload.game);
          if (isTerminal(payload.game.status)) return;
        }
      } catch {
        // A missed poll is harmless; generation continues on the cabinet.
      }
      if (active) timeout = setTimeout(poll, 3000);
    };

    timeout = setTimeout(poll, 1500);
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
    };
  }, [initialGame.id, initialGame.status]);

  return (
    <div className={`portal-status portal-status-${game.status}`} aria-live="polite">
      <div className="portal-status-line">
        <span className="portal-status-dot" aria-hidden="true" />
        <span>{STATUS_LABELS[game.status]}</span>
      </div>
      <p className="portal-id">Game {game.id.toUpperCase()}</p>
      <p className="portal-origin">
        Created from <strong>{game.kioskName}</strong>
      </p>
      <h1>
        {game.title ??
          (game.status === 'queued' ? 'Your game has a home.' : 'Sparkade is building.')}
      </h1>
      <p className="portal-message">{game.message}</p>
      {game.status === 'ready' ? <GameShareActions game={game} /> : null}
      {game.status === 'ready' && game.spec ? (
        <PublicGamePlayer id={game.id} spec={game.spec} assets={game.assets} />
      ) : game.status === 'ready' ? (
        <p className="portal-note">
          The cabinet build is complete, but its browser-play data has not synced yet.
        </p>
      ) : game.status === 'failed' ? (
        <p className="portal-note">
          The link is safe. The cabinet can retry generation without changing it.
        </p>
      ) : (
        <div className="portal-progress" aria-label="Generation in progress">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      )}
      <p className="portal-updated">
        Stage: {game.stage.replaceAll('-', ' ')} · updated{' '}
        <time dateTime={game.updatedAt}>{game.updatedAt.slice(11, 16)} UTC</time>
      </p>
    </div>
  );
}
