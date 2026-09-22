import { createHash, randomUUID } from 'node:crypto';
import sharp, { type OverlayOptions } from 'sharp';
import { FatalError, RetryableError } from 'workflow';
import { stageProvider } from '@sparkade/server/providers/index';
import { withProviderRequestPolicy } from '@sparkade/server/providers/request-policy';
import { defaultConfig } from '@sparkade/server/storage/config';
import { providerUsageEvent } from '@sparkade/server/pipeline/durable-provider';
import type { PassCheckpoint, ProviderTask } from '@sparkade/server/pipeline/durable-pass';
import type { CloudGameBundle, CompleteRequest } from '@sparkade/shared';
import { getSql } from './db';
import { ArcadeError, env } from './arcade';
import { readPrivate } from './generation/storage';
import { readCheckpointFile } from './generation/checkpoints';
import { acquireSlot, releaseSlot, type GenerationRow } from './generation/store';
import { websiteSpendPolicy } from './website-spend';
import { MetaBudgetError, MetaCapacityError } from './kiosk-meta-spend';
import {
  assertWebsiteRunnable,
  releaseWebsiteCredits,
  websiteGeneration,
} from './website-generation';
import {
  CONTENT_POLICY,
  CONTENT_REVIEW_PROMPT,
  CONTENT_REVIEW_SCHEMA,
  parseContentVerdict,
  rejectionMessage,
  type ContentVerdict,
} from './content-policy';

/** A leased, persisted decision. Replays reuse it; crashes cannot create unlimited paid attempts. */
export async function reviewContent(
  row: GenerationRow,
  phase: 'input' | 'output',
  version: string,
  content: unknown,
  image?: Buffer,
): Promise<ContentVerdict> {
  const sql = getSql();
  const prior =
    () => sql`SELECT * FROM arcade_content_reviews WHERE job_id=${row.id} AND attempt=${row.attempt}
    AND phase=${phase} AND policy=${CONTENT_POLICY} AND version_hash=${version}`;
  const [saved] = await prior();
  if (saved?.decision)
    return parseContentVerdict(
      JSON.stringify({ decision: saved.decision, category: saved.category }),
    );
  const slot = await acquireSlot(row.owner);
  if (!slot) throw new RetryableError('Waiting for content check capacity', { retryAfter: '15s' });
  try {
    const token = randomUUID();
    await sql`INSERT INTO arcade_content_reviews(job_id,attempt,phase,policy,version_hash)
    VALUES(${row.id},${row.attempt},${phase},${CONTENT_POLICY},${version}) ON CONFLICT DO NOTHING`;
    const claimed =
      await sql`UPDATE arcade_content_reviews SET lease_token=${token},lease_until=now()+interval '3 minutes',
    provider_attempts=provider_attempts+1 WHERE job_id=${row.id} AND attempt=${row.attempt} AND phase=${phase}
    AND policy=${CONTENT_POLICY} AND version_hash=${version} AND decision IS NULL AND provider_attempts<2
    AND (lease_until IS NULL OR lease_until<now()) RETURNING provider_attempts`;
    if (!claimed.length) {
      const [current] = await prior();
      if (current?.decision)
        return parseContentVerdict(
          JSON.stringify({ decision: current.decision, category: current.category }),
        );
      if (current?.lease_until && new Date(current.lease_until).getTime() > Date.now())
        throw new RetryableError('Content check in progress', { retryAfter: '15s' });
      throw new FatalError('The content check could not finish. Your credits will be returned.');
    }
    try {
      await assertWebsiteRunnable(row, phase === 'input');
      const { provider, model } = stageProvider(row.state.config ?? defaultConfig(), 'design');
      const user = JSON.stringify({ phase, content });
      if (Buffer.byteLength(user) > 160_000) throw new Error('Review input exceeds limit');
      const request: CompleteRequest = {
        system: CONTENT_REVIEW_PROMPT,
        user,
        image,
        maxTokens: 160,
        effort: 'minimal',
        temperature: 1,
        timeoutMs: 35_000,
        jsonSchema: CONTENT_REVIEW_SCHEMA,
      };
      const response = await withProviderRequestPolicy(
        websiteSpendPolicy(row, phase === 'input' ? 'input-review' : 'generation'),
        () => provider.complete(request, { model }),
      );
      const task: ProviderTask = {
        id: `review-${phase}-${version}-${claimed[0]!.provider_attempts}`,
        kind: 'text',
        stage: 'design',
        model,
        request: { ...request, image: image?.toString('base64') },
      };
      const event = {
        ...providerUsageEvent(task, { kind: 'text', response }, row.state, row.attempt),
        stage: `review:${phase}`,
      };
      await sql`INSERT INTO generation_usage(job_id,request_id,event) VALUES(${row.id},${event.requestId},${JSON.stringify(event)}::jsonb) ON CONFLICT DO NOTHING`;
      const verdict = parseContentVerdict(response.text);
      const completed =
        await sql`UPDATE arcade_content_reviews SET decision=${verdict.decision},category=${verdict.category},
      model=${response.model ?? model},completed_at=now(),lease_token=NULL,lease_until=NULL
      WHERE job_id=${row.id} AND attempt=${row.attempt} AND phase=${phase} AND policy=${CONTENT_POLICY}
      AND version_hash=${version} AND lease_token=${token} AND decision IS NULL RETURNING decision`;
      if (!completed.length)
        throw new RetryableError('Content check lease changed', { retryAfter: '15s' });
      return verdict;
    } catch (error) {
      await sql`UPDATE arcade_content_reviews SET lease_token=NULL,lease_until=NULL
      WHERE job_id=${row.id} AND attempt=${row.attempt} AND phase=${phase} AND policy=${CONTENT_POLICY}
      AND version_hash=${version} AND lease_token=${token}`;
      if (error instanceof RetryableError) throw error;
      if (error instanceof MetaBudgetError || error instanceof MetaCapacityError) {
        await sql`UPDATE arcade_content_reviews SET provider_attempts=GREATEST(0,provider_attempts-1)
          WHERE job_id=${row.id} AND attempt=${row.attempt} AND phase=${phase}
          AND policy=${CONTENT_POLICY} AND version_hash=${version}`;
        throw new RetryableError(error.message, { retryAfter: error instanceof MetaCapacityError ? '10s' : '5m' });
      }
      if (Number(claimed[0]!.provider_attempts) < 2 && !(error instanceof ArcadeError))
        throw new RetryableError('Content check temporarily unavailable', { retryAfter: '15s' });
      throw new FatalError('The content check could not finish. Your credits will be returned.');
    }
  } finally {
    await releaseSlot(slot);
  }
}

async function rejectGame(row: GenerationRow, verdict: ContentVerdict) {
  const sql = getSql();
  await sql.transaction([
    sql`SELECT id FROM generation_jobs WHERE id=${row.id} FOR UPDATE`,
    sql`WITH stopped AS (UPDATE generation_jobs j SET status='failed',updated_at=now()
      FROM arcade_generations g WHERE j.id=${row.id} AND j.attempt=${row.attempt}
      AND j.status IN ('queued','running','waiting-network','publishing') AND g.job_id=j.id
      AND g.environment=${env()} AND g.settlement='held' RETURNING j.id)
      UPDATE arcade_generations SET input_review='rejected' WHERE job_id IN (SELECT id FROM stopped)`,
    sql`UPDATE public_games p SET status='failed',stage='failed',moderation='rejected',feed_visibility='unlisted',
      message=${rejectionMessage(verdict.category)},updated_at=now() FROM arcade_generations g,generation_jobs j
      WHERE g.job_id=${row.id} AND g.environment=${env()} AND g.game_id=p.id AND g.input_review='rejected'
      AND j.id=g.job_id AND j.attempt=${row.attempt} AND j.status='failed'`,
  ]);
  await releaseWebsiteCredits(row.id);
}
export async function reviewWebsiteInput(row: GenerationRow): Promise<boolean> {
  if (!row.owner.startsWith('website:')) return true;
  const web = await websiteGeneration(row.id);
  if (!web || web.review_policy !== CONTENT_POLICY || web.input_review === 'approved') return true;
  await assertWebsiteRunnable(row, true);
  const checkpoint = await readPrivate<PassCheckpoint>(row.checkpoint);
  const photo = await readCheckpointFile(checkpoint, `staging/${row.id}/photo.jpg`);
  if (row.state.job?.hasPhoto && !photo)
    throw new FatalError('Source photo unavailable for content check.');
  const content = { prompt: row.state.job?.promptText, brief: row.state.job?.creationBrief };
  const version = createHash('sha256')
    .update(JSON.stringify(content))
    .update(photo ?? '')
    .digest('hex');
  const verdict = await reviewContent(
    row,
    'input',
    version,
    content,
    photo ? Buffer.from(photo, 'base64') : undefined,
  );
  if (verdict.decision === 'reject') {
    await rejectGame(row, verdict);
    return false;
  }
  const sql = getSql();
  const changed =
    await sql`UPDATE arcade_generations g SET input_review='approved' FROM generation_jobs j,public_games p
    WHERE g.job_id=${row.id} AND g.environment=${env()} AND g.input_review='pending' AND g.settlement='held'
    AND j.id=g.job_id AND j.attempt=${row.attempt} AND j.status='queued' AND p.id=g.game_id
    AND p.deleted_at IS NULL AND p.moderation='pending' RETURNING g.game_id`;
  if (changed.length)
    await sql`UPDATE public_games SET message='Content check passed. Starting generation.',updated_at=now()
    WHERE id=${changed[0]!.game_id} AND moderation='pending'`;
  await assertWebsiteRunnable(row);
  return true;
}

/** All visual assets are checked in a bounded contact sheet. Source photos are never included. */
export async function outputReviewImage(bundle: CloudGameBundle, files: Record<string, string>) {
  const images = bundle.manifest.assets.filter((a) => a.mimeType.startsWith('image/'));
  if (images.length > 64) throw new Error('Too many images for content review');
  if (!images.length) return undefined;
  const tile = 256,
    columns = Math.min(images.length, 4);
  const layers: OverlayOptions[] = [];
  for (const [i, asset] of images.entries()) {
    const bytes = files[asset.filename];
    if (!bytes) throw new Error('Missing review image');
    const input = await sharp(Buffer.from(bytes, 'base64'), {
      limitInputPixels: 16_000_000,
      failOn: 'warning',
    })
      .resize(tile, tile, { fit: 'contain', background: '#e5e5e5' })
      .flatten({ background: '#e5e5e5' })
      .png()
      .toBuffer();
    layers.push({ input, left: (i % columns) * tile, top: Math.floor(i / columns) * tile });
  }
  return sharp({
    create: {
      width: columns * tile,
      height: Math.ceil(images.length / columns) * tile,
      channels: 3,
      background: '#e5e5e5',
    },
  })
    .composite(layers)
    .jpeg({ quality: 85 })
    .toBuffer();
}
export async function reviewWebsiteOutput(
  row: GenerationRow,
  version: string,
  bundle: CloudGameBundle,
  files: Record<string, string>,
) {
  const image = await outputReviewImage(bundle, files);
  const verdict = await reviewContent(
    row,
    'output',
    version,
    {
      spec: bundle.spec,
      imagesInReadingOrder: bundle.manifest.assets
        .filter((a) => a.mimeType.startsWith('image/'))
        .map((a) => a.filename),
    },
    image,
  );
  if (verdict.decision === 'reject') {
    await rejectGame(row, verdict);
    return false;
  }
  return true;
}
