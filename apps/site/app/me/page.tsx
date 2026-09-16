import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { browseGames } from '@/lib/arcade';
import { getAccountSignup, SIGNUP_COOKIE } from '@/lib/signup';
import { SiteFrame, viewer } from '../components/site-frame';
import { GameGrid } from '../components/game-grid';
export const metadata = { title: 'Your arcade', robots: { index: false, follow: false } };
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await viewer();
  if (!user) redirect('/sign-in?redirect_url=/me');
  const params = await searchParams,
    favorites = params.tab === 'favorites',
    page = Math.max(1, Number(params.page) || 1);
  const [result, signup, jar] = await Promise.all([
    browseGames({ viewer: user.userId, mine: !favorites, favorites, page }),
    getAccountSignup(user.userId),
    cookies(),
  ]);
  return (
    <SiteFrame active="profile">
      <section className="arc-hero arc-profile-hero">
        <div>
          <span className="arc-kicker">Your corner of the arcade</span>
          <h1>@{user.handle}</h1>
          <p>Create, collect, and share something worth playing.</p>
          <div className="arc-hero-actions">
            <a className="arc-button-secondary" href="/me/profile">
              Edit profile
            </a>
            <a href={`/u/${user.handle}`}>View your public profile ↗</a>
          </div>
        </div>
        <div className="arc-panel arc-balance">
          <div className="arc-credit-number">
            {user.credits}
            <small>credits available</small>
          </div>
          <p>Buying credits is coming soon.</p>
          <a className="arc-button" href="/create">
            Create a game →
          </a>
        </div>
      </section>
      {(signup?.status === 'pending' || (!signup && jar.has(SIGNUP_COOKIE))) && (
        <p className="arc-message">
          Your signup still needs to be completed. <a href="/sign-up/complete">Finish signup →</a>
        </p>
      )}
      {params.notice && (
        <p className="arc-message" role="status">
          {params.notice}
        </p>
      )}
      <nav className="arc-tabs" aria-label="Your game collections">
        <a href="/me" aria-current={!favorites ? 'page' : undefined}>
          Created games
        </a>
        <a href="/me?tab=favorites" aria-current={favorites ? 'page' : undefined}>
          Favorites
        </a>
      </nav>
      <section className="arc-section">
        <div className="arc-section-heading">
          <h2>{favorites ? 'Saved for another round' : 'Games you made'}</h2>
          <span>
            {favorites ? 'Your likes, all in one place' : 'Unlisted games stay out of discovery'}
          </span>
        </div>
        <GameGrid games={result.games} owner={!favorites} signedIn />
        <nav className="arc-pagination" aria-label="Library pages">
          {page > 1 && (
            <a href={`/me?tab=${favorites ? 'favorites' : 'created'}&page=${page - 1}`}>
              ← Previous
            </a>
          )}
          {result.more && (
            <a href={`/me?tab=${favorites ? 'favorites' : 'created'}&page=${page + 1}`}>Next →</a>
          )}
        </nav>
      </section>
    </SiteFrame>
  );
}
