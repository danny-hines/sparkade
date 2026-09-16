import type { PassCheckpoint } from '@sparkade/server/pipeline/durable-pass';
import type { PipelineState } from '@sparkade/server/pipeline/job-state';
import { ensureArcadeSchema, env } from './arcade';
import { getSql } from './db';
import { readPrivate } from './generation/storage';
import { readWebsiteFinal } from './website-generation';
import { reconcileWebsiteJob } from './website-recovery';
import { rejectionMessage } from './content-policy';

import {
  imageFilename,
  projectGenerationEvents,
  progressTiming,
  STAGES,
  type WebsiteProgress,
} from './generation-progress';

async function ownedGame(userId: string, id: string) {
  await ensureArcadeSchema();
  const [row] =
    await getSql()`SELECT p.id,p.title,p.moderation,p.status AS public_status,p.private_bundle,
    g.input_review,g.settlement,g.review_policy,j.id AS job_id,j.state,j.status,j.attempt,j.checkpoint,j.created_at,j.updated_at
    FROM arcade_generations g JOIN public_games p ON p.id=g.game_id JOIN generation_jobs j ON j.id=g.job_id
    WHERE p.id=${id} AND g.user_id=${userId} AND p.owner_id=${userId}
      AND g.environment=${env()} AND p.environment=g.environment AND p.deleted_at IS NULL`;
  return row;
}
export async function websiteProgress(userId: string, id: string): Promise<WebsiteProgress | null> {
  let row = await ownedGame(userId, id);
  if (!row) return null;
  if (await reconcileWebsiteJob(String(row.job_id))) row = (await ownedGame(userId, id))!;
  const state = row.state as PipelineState;
  const items = projectGenerationEvents(state.events ?? [], id, row.attempt);
  const reviews =
    await getSql()`SELECT phase,decision,category,created_at,completed_at FROM arcade_content_reviews
    WHERE job_id=${row.job_id} AND attempt=${row.attempt} ORDER BY created_at`;
  for (const review of reviews) {
    items.push({
      id: `review:${review.phase}:start`,
      kind: 'review',
      at: new Date(review.created_at).toISOString(),
      message:
        review.phase === 'input'
          ? 'Checking your idea and photo'
          : 'Checking the finished game and art',
    });
    if (review.decision)
      items.push({
        id: `review:${review.phase}:result`,
        kind: 'review',
        at: new Date(review.completed_at).toISOString(),
        message:
          review.decision === 'allow'
            ? review.phase === 'input'
              ? 'Idea and photo passed the content check'
              : 'Finished game passed the content check'
            : rejectionMessage(review.category),
      });
  }
  const terminal = ['done', 'failed', 'canceled'].includes(row.status);
  const rejected = row.moderation === 'rejected';
  const summary = rejected
    ? 'This game did not pass our content policy.'
    : row.status === 'done'
      ? 'Ready to play and share'
      : row.status === 'failed'
        ? 'Generation could not finish. Your credits are being returned.'
        : row.status === 'canceled'
          ? 'Creation canceled'
          : row.input_review === 'pending'
            ? 'Checking your idea and photo'
            : row.status === 'publishing' || row.status === 'review'
              ? 'Checking the finished game'
              : (STAGES[state.job?.stage ?? row.status] ?? 'Your game is taking shape');
  if (terminal)
    items.push({
      id: `outcome:${row.attempt}:${row.status}:${row.moderation}`,
      kind: row.status === 'done' && !rejected ? 'complete' : 'failure',
      message: `${summary}${row.settlement === 'released' ? ' Credits returned.' : ''}`,
      at: new Date(row.updated_at).toISOString(),
    });
  items.sort((a, b) => a.at.localeCompare(b.at));
  return {
    status: row.status,
    attempt: row.attempt,
    terminal,
    title: row.title || 'Your new game',
    summary,
    items: rejected ? items.map(({ image: _image, ...item }) => item) : items,
    timing: progressTiming({
      attempt: row.attempt,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      startedAt: state.job?.startedAt,
      status: row.status,
      stage: state.job?.stage,
      inputApproved: row.input_review === 'approved',
      rejected,
      events: state.events ?? [],
      reviews: reviews.map((review) => ({
        phase: review.phase,
        decision: review.decision,
        createdAt: new Date(review.created_at).toISOString(),
        completedAt: review.completed_at ? new Date(review.completed_at).toISOString() : null,
      })),
    }),
  };
}
export async function websiteAssetPreview(userId: string, id: string, filename: string) {
  if (!imageFilename(filename)) return null;
  const row = await ownedGame(userId, id);
  if (!row || row.input_review !== 'approved' || row.moderation === 'rejected') return null;
  const state = row.state as PipelineState;
  if (
    !(state.events ?? []).some(
      (e) => e.attempt === row.attempt && e.kind === 'asset' && e.payload?.filename === filename,
    )
  )
    return null;
  if (row.status === 'done') {
    const final = await readWebsiteFinal(id);
    const file = final?.files[filename];
    return file ? Buffer.from(file, 'base64') : null;
  }
  if (!row.checkpoint) return null;
  const checkpoint = await readPrivate<PassCheckpoint>(row.checkpoint);
  const data =
    checkpoint.files[`staging/${row.job_id}/assets/${filename}`] ??
    checkpoint.files[`games/${state.job!.gameId}/assets/${filename}`];
  return data ? Buffer.from(data, 'base64') : null;
}
