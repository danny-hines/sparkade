import { reconcileWebsiteJob } from '@/lib/website-recovery';
import { notFound, redirect } from 'next/navigation';
import { getSql } from '@/lib/db';
import { ensureArcadeSchema, env } from '@/lib/arcade';
import { SiteFrame, viewer } from '../../../components/site-frame';
import { OwnerControls, SubmitButton } from '../../../components/game-controls';
import { cancelGameAction, retryGameAction } from '../../../components/arcade-actions';
import { JobRefresh } from './refresh';
export const metadata = { title: 'Your game', robots: { index: false, follow: false } };
export default async function MyGame({ params }: { params: Promise<{ id: string }> }) {
  const user = await viewer();
  if (!user) redirect('/sign-in?redirect_url=/me');
  await ensureArcadeSchema();
  const { id } = await params;
  const [game] =
    await getSql()`SELECT p.*,g.prompt,g.job_id,g.price,g.settlement,g.input_review,j.attempt,j.checkpoint,j.status AS job_status
    FROM public_games p JOIN arcade_generations g ON g.game_id=p.id JOIN generation_jobs j ON j.id=g.job_id
    WHERE p.id=${id} AND p.owner_id=${user.userId} AND p.environment=${env()}`;
  if (!game) notFound();
  if (await reconcileWebsiteJob(String(game.job_id))) {
    game.job_status = 'failed';
    game.settlement = 'released';
  }
  const ready = game.status === 'ready' && game.moderation === 'approved',
    terminal = ['done', 'failed', 'canceled'].includes(game.job_status);
  const status = game.deleted_at
    ? 'Deleted'
    : ready
      ? 'Ready for your next adventure'
      : game.job_status === 'review'
        ? 'One final review'
        : game.job_status === 'canceled'
          ? 'Creation canceled'
          : game.job_status === 'failed'
            ? 'This game couldn’t be completed'
            : game.input_review === 'pending'
              ? 'Your idea is in the review queue'
              : 'Your game is taking shape';
  return (
    <SiteFrame active="profile">
      <section className="arc-hero">
        <a href="/me">← Your library</a>
        <h1>{game.title || status}</h1>
        <p>{status}</p>
      </section>
      <section className="arc-panel">
        <span className="arc-kicker">Your original idea</span>
        <p className="arc-prompt">{game.prompt}</p>
        <p>
          {game.settlement === 'held'
            ? `${game.price} credits reserved until your game is approved.`
            : game.settlement === 'released'
              ? `${game.price} credits returned to your balance.`
              : `${game.price} credits spent.`}
        </p>
        {!terminal && (
          <>
            <p>
              {game.input_review === 'pending'
                ? 'We review ideas before generation starts. No provider work has started yet.'
                : game.job_status === 'review'
                  ? 'Your game is generated. We’re checking its content before it can be played and shared.'
                  : `Current stage: ${String(game.stage).replaceAll('-', ' ')}`}
            </p>
            <JobRefresh />
          </>
        )}
        {ready && !game.deleted_at && (
          <div className="arc-hero-actions">
            <a className="arc-button" href={`/p/${id}`}>
              Play & share →
            </a>
            <p>
              {game.feed_visibility === 'listed'
                ? 'Published in the public arcade.'
                : 'Only people with its link can find this game.'}
            </p>
          </div>
        )}
        {game.input_review === 'pending' && game.job_status === 'queued' && (
          <form action={cancelGameAction}>
            <input type="hidden" name="jobId" value={game.job_id} />
            <SubmitButton className="arc-button-secondary">Cancel and return credits</SubmitButton>
          </form>
        )}
        <OwnerControls
          id={id}
          published={game.feed_visibility === 'listed'}
          deleted={Boolean(game.deleted_at)}
          ready={ready}
          canDelete={terminal}
        />
        {game.job_status === 'failed' &&
          game.attempt === 1 &&
          game.checkpoint &&
          game.input_review === 'approved' &&
          game.moderation === 'pending' &&
          !game.deleted_at && (
            <form action={retryGameAction}>
              <input type="hidden" name="jobId" value={game.job_id} />
              <SubmitButton className="arc-button-secondary">
                Retry once · {game.price} credits
              </SubmitButton>
            </form>
          )}
        {game.job_status === 'failed' && (
          <p>
            The credits have been returned. <a href="/create">Try a new idea →</a>
          </p>
        )}
      </section>
    </SiteFrame>
  );
}
