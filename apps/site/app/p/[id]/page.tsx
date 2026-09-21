import { viewer } from '../../components/site-frame';
import { FavoriteButton } from '../../components/game-controls';
import { HighScoresButton } from '../../components/high-scores-button';
import { ensureArcadeSchema, env } from '@/lib/arcade';
import { getSql } from '@/lib/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getPublicGame } from '@/lib/public-games';
import { buildPublicGameMetadata } from '@/lib/public-game-sharing';
import { GameStatus } from './game-status';

type PublicGamePageProps = {
  params: Promise<{ id: string }>;
};

const findGame = cache(getPublicGame);

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PublicGamePageProps): Promise<Metadata> {
  const { id } = await params;
  const game = await findGame(id);
  if (!game) return { title: 'Game not found' };
  return buildPublicGameMetadata(game);
}

export default async function PublicGamePage({ params }: PublicGamePageProps) {
  const { id } = await params;
  const game = await findGame(id);
  if (!game) notFound();
  await ensureArcadeSchema();
  const user = await viewer();
  const [stats] = await getSql()`SELECT
    (SELECT handle FROM arcade_profiles WHERE environment=${env()} AND user_id=${game.ownerId ?? ''}) AS handle,
    EXISTS(SELECT 1 FROM arcade_favorites WHERE environment=${env()} AND user_id=${user?.userId ?? ''} AND game_id=${game.id}) AS saved`;

  return (
    <main className="portal-page">
      <div className="portal-grid" aria-hidden="true" />
      <section className="portal-card">
        <Link className="brand" href="/" aria-label="Sparkade home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-word">Sparkade</span>
        </Link>
        <GameStatus initialGame={game} />
        {game.status === 'ready' && (
          <div className="arc-hero-actions">
            <FavoriteButton
              id={game.id}
              saved={Boolean(stats.saved)}
              signedIn={Boolean(user)}
              returnTo={`/p/${game.id}`}
            />
            <HighScoresButton id={game.id} title={game.title ?? 'Untitled game'} />
            {stats.handle && <Link href={`/u/${stats.handle}`}>More by @{stats.handle} →</Link>}
          </div>
        )}
        <Link className="portal-link" href="/">
          Back to Sparkade <span aria-hidden="true">→</span>
        </Link>
      </section>
    </main>
  );
}
