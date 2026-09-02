import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getPublicGame } from '@/lib/public-games';
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
  const title = game.title ? `${game.title} — shared game` : `Game ${game.id.toUpperCase()}`;
  return {
    title,
    description: game.status === 'ready' ? 'A Sparkade game, ready to play.' : game.message,
    alternates: { canonical: `/p/${game.id}` },
    manifest: `/p/${game.id}/manifest.webmanifest`,
    robots: { index: false, follow: false },
    openGraph: { title, description: game.message, url: `/p/${game.id}` },
  };
}

export default async function PublicGamePage({ params }: PublicGamePageProps) {
  const { id } = await params;
  const game = await findGame(id);
  if (!game) notFound();

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
        <Link className="portal-link" href="/">
          Back to Sparkade <span aria-hidden="true">→</span>
        </Link>
      </section>
    </main>
  );
}
