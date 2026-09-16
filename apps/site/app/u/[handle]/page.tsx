import { notFound, redirect } from 'next/navigation';
import { browseGames } from '@/lib/arcade';
import { findPublicProfile } from '@/lib/profiles';
import { SiteFrame, viewer } from '../../components/site-frame';
import { GameGrid } from '../../components/game-grid';
export const dynamic = 'force-dynamic';
export default async function PublicProfile({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { handle } = await params;
  const profile = await findPublicProfile(handle);
  if (!profile) notFound();
  const page = Math.max(1, Math.min(1000, Math.floor(Number((await searchParams).page) || 1)));
  // Temporary redirects prevent cached redirect loops if an owner returns to an old name.
  if (handle !== profile.handle) redirect(`/u/${profile.handle}${page > 1 ? `?page=${page}` : ''}`);
  const user = await viewer();
  const result = await browseGames({ owner: profile.userId, viewer: user?.userId, page });
  return (
    <SiteFrame>
      <section className="arc-hero">
        <span className="arc-kicker">Meet the creator</span>
        <h1>@{handle}</h1>
        <p>A little imagination goes a long way.</p>
        {user?.userId === profile.userId && (
          <a className="arc-button-secondary" href="/me">
            Manage your games →
          </a>
        )}
      </section>
      <section className="arc-section">
        <div className="arc-section-heading">
          <h2>Published games</h2>
        </div>
        <GameGrid games={result.games} signedIn={Boolean(user)} />
        <nav className="arc-pagination" aria-label="Profile pages">
          {page > 1 && <a href={`/u/${handle}?page=${page - 1}`}>← Previous</a>}
          {result.more && <a href={`/u/${handle}?page=${page + 1}`}>Next →</a>}
        </nav>
      </section>
    </SiteFrame>
  );
}
