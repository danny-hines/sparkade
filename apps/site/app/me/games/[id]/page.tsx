import { reconcileWebsiteJob } from '@/lib/website-recovery';
import { notFound, redirect } from 'next/navigation';
import { getSql } from '@/lib/db';
import { ensureArcadeSchema, env } from '@/lib/arcade';
import { SiteFrame, viewer } from '../../../components/site-frame';
import { OwnerControls, RetryGameControl, SubmitButton } from '../../../components/game-controls';
import {
  cancelGameAction,
  startAdminGameAction,
  startGameAction,
} from '../../../components/arcade-actions';
import { websiteProgress } from '@/lib/website-progress';
import { GenerationFeed } from '../../../components/generation-feed';
import { SourcePhoto } from '../../../components/source-photo';
import { websiteRetry, type WebsiteRetryRow } from '@/lib/website-retry';
export const metadata = { title: 'Your game', robots: { index: false, follow: false } };
export default async function MyGame({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const user = await viewer();
  if (!user) redirect('/sign-in?redirect_url=/me');
  await ensureArcadeSchema();
  const { id } = await params;
  const [game] =
    await getSql()`SELECT p.*,g.prompt,g.job_id,g.price,g.settlement,g.input_review,g.admin_bypass,g.review_policy,j.run_id,j.attempt,
    j.checkpoint<>'' AS has_checkpoint,j.cleanup_pending,j.status AS job_status,
    j.state->'job'->'creationBrief'->>'heroName' AS hero_name,
    j.state->'job'->>'hasPhoto'='true' AND j.checkpoint<>'' AND NOT j.cleanup_pending
      AND j.status NOT IN ('done','canceled') AND g.input_review<>'rejected' AND p.deleted_at IS NULL AS has_photo
    FROM public_games p JOIN arcade_generations g ON g.game_id=p.id JOIN generation_jobs j ON j.id=g.job_id
    WHERE p.id=${id} AND p.owner_id=${user.userId} AND p.environment=${env()}`;
  if (!game) notFound();
  if (await reconcileWebsiteJob(String(game.job_id))) {
    game.job_status = 'failed';
    game.settlement = 'released';
  }
  const progress = await websiteProgress(user.userId, id);
  const retry = websiteRetry(game as WebsiteRetryRow);
  const notice = (await searchParams).notice;
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
              ? 'Checking your idea and photo'
              : 'Your game is taking shape';
  return (
    <SiteFrame active="profile">
      <section className="arc-hero">
        <a href="/me">← Your library</a>
        <h1>{game.title || status}</h1>
        <p>{status}</p>
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
      </section>
      {notice && (
        <p className="arc-message" role="status">
          {notice}
        </p>
      )}
      {retry && (
        <section className="arc-panel arc-retry-panel" aria-labelledby="retry-game-title">
          <h2 id="retry-game-title">What went wrong</h2>
          {progress?.failure && <p>{progress.failure}</p>}
          {retry.available && (
            <p>
              Retry with your saved idea, hero name, and photo. Each game gets one retry; credits
              are returned if that attempt fails too.
            </p>
          )}
          <RetryGameControl retry={retry} className="arc-button" />
          {!retry.available && <a href="/create">Create a new game →</a>}
        </section>
      )}
      {progress && <GenerationFeed key={`${id}:${game.attempt}`} gameId={id} initial={progress} />}
      <section className="arc-panel">
        <span className="arc-kicker">Your original idea</span>
        {game.hero_name && (
          <p>
            Hero name: <strong>{game.hero_name}</strong>
          </p>
        )}
        <p className="arc-prompt">{game.prompt}</p>
        {game.has_photo && <SourcePhoto gameId={id} />}
        <p>
          {game.settlement === 'held'
            ? `${game.price} credits reserved until your game is ready.`
            : game.settlement === 'released'
              ? `${game.price} credits returned to your balance.`
              : `${game.price} credits spent.`}
        </p>
        {!terminal && (
          <>
            <p>
              {game.input_review === 'pending'
                ? 'Muse is checking your idea and photo. Generation begins automatically when they pass.'
                : game.job_status === 'review'
                  ? 'Your game is generated. We’re checking its content before it can be played and shared.'
                  : `Current stage: ${String(game.stage).replaceAll('-', ' ')}`}
            </p>
          </>
        )}
        {(game.review_policy === 'pg13-v1' || user.admin) &&
          game.job_status === 'queued' &&
          !game.run_id &&
          !game.deleted_at &&
          game.settlement === 'held' && (
            <form
              action={game.review_policy === 'pg13-v1' ? startGameAction : startAdminGameAction}
            >
              <input type="hidden" name="id" value={id} />
              <SubmitButton>Start generation</SubmitButton>
            </form>
          )}
        {game.input_review === 'pending' && game.job_status === 'queued' && !game.run_id && (
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
      </section>
    </SiteFrame>
  );
}
