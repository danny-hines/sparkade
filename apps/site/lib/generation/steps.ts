import { getWorkflowMetadata, RetryableError } from 'workflow';
import { put } from '@vercel/blob';
import { defaultConfig } from '@sparkade/server/storage/config';
import {
  advancePipeline,
  type PassCheckpoint,
  type ProviderResult,
  type ProviderTask,
} from '@sparkade/server/pipeline/durable-pass';
import {
  executeProviderTask,
  providerUsageEvent,
} from '@sparkade/server/pipeline/durable-provider';
import { ProviderHttpError, ProviderAuthError } from '@sparkade/server/providers/base';
import type { CloudGameBundle } from '@sparkade/shared';
import { getSql } from '../db';
import { reservePublicGame } from '../public-games';
import { getJob, scope, prefix, acquireSlot, releaseSlot, syncPublicProgress } from './store';
import { readPrivate, readOptionalPrivate, writePrivate, cleanPrivate } from './storage';

export async function claimGeneration(id: string, attempt: number) {
  'use step';
  const row = await getJob(id);
  if (!row || row.attempt !== attempt || ['done', 'failed', 'canceled'].includes(row.status))
    return false;
  const runId = getWorkflowMetadata().workflowRunId;
  const rows = await getSql()`UPDATE generation_jobs SET run_id=${runId}, updated_at=now()
    WHERE id=${id} AND attempt=${attempt} AND (run_id IS NULL OR run_id=${runId}) RETURNING id`;
  return rows.length > 0;
}

interface PassResult {
  done: boolean;
  stopped: boolean;
  pending: string[];
}
export async function advanceGeneration(
  id: string,
  attempt: number,
  pass: number,
): Promise<PassResult> {
  'use step';
  const row = await getJob(id);
  if (!row || row.attempt !== attempt || ['done', 'failed', 'canceled'].includes(row.status))
    return { done: false, stopped: true, pending: [] };
  const sql = getSql();
  const prior =
    await sql`SELECT result FROM generation_passes WHERE job_id=${id} AND attempt=${attempt} AND pass=${pass}`;
  if (prior[0]) return prior[0].result as PassResult;
  const checkpoint = await readPrivate<PassCheckpoint>(row.checkpoint);
  checkpoint.state = row.state;
  const ledger = await sql`SELECT event FROM generation_usage WHERE job_id=${id}`;
  for (const paid of ledger)
    if (!checkpoint.state.usage.some((u) => u.requestId === paid.event.requestId))
      checkpoint.state.usage.push(paid.event);
  const saved =
    await sql`SELECT request_id, result_url FROM generation_requests WHERE job_id=${id} AND request_id LIKE ${`${attempt}:%`} AND result_url IS NOT NULL`;
  const responses: Record<string, ProviderResult> = {};
  // Keep Blob download concurrency bounded independently of provider concurrency.
  for (let i = 0; i < saved.length; i += 8)
    await Promise.all(
      saved.slice(i, i + 8).map(async (s) => {
        responses[String(s.request_id).slice(String(attempt).length + 1)] =
          await readPrivate<ProviderResult>(String(s.result_url));
      }),
    );
  const output = await advancePipeline(checkpoint, responses, row.state.config ?? defaultConfig());
  const checkpointUrl = await writePrivate(`${prefix(id)}checkpoints/${attempt}-${pass}.json`, {
    state: output.state,
    files: output.files,
    history: output.history,
  });
  for (const task of output.pending) {
    const url = await writePrivate(`${prefix(id)}requests/${attempt}/${task.id}.json`, task);
    await sql`INSERT INTO generation_requests(job_id,request_id,request_url) VALUES(${id},${`${attempt}:${task.id}`},${url})
      ON CONFLICT DO NOTHING`;
  }
  const status = output.state.job!.status;
  const result = {
    done: status === 'done',
    stopped: status === 'failed' || status === 'canceled',
    pending: output.pending.map((task) => task.id),
  };
  await sql.transaction([
    sql`UPDATE generation_jobs SET state=${JSON.stringify(output.state)}::jsonb,
      checkpoint=${checkpointUrl},status=${status === 'done' ? 'publishing' : status}, updated_at=now()
      WHERE id=${id} AND attempt=${attempt} AND status NOT IN ('canceled','failed','done')`,
    sql`INSERT INTO generation_passes(job_id,attempt,pass,result) VALUES(${id},${attempt},${pass},${JSON.stringify(result)}::jsonb)
      ON CONFLICT DO NOTHING`,
  ]);
  await syncPublicProgress(id, attempt);
  return result;
}

export async function runProviderRequest(id: string, attempt: number, requestId: string) {
  'use step';
  const row = await getJob(id);
  if (!row || row.attempt !== attempt || ['done', 'failed', 'canceled'].includes(row.status))
    return;
  const sql = getSql();
  const storageId = `${attempt}:${requestId}`;
  const rows =
    await sql`SELECT * FROM generation_requests WHERE job_id=${id} AND request_id=${storageId}`;
  const saved = rows[0];
  if (!saved) throw new Error('Missing generation request');
  if (saved.result_url) return;
  const token = await acquireSlot(row.owner);
  if (!token) throw new RetryableError('Waiting for generation capacity', { retryAfter: '10s' });
  try {
    const task = await readPrivate<ProviderTask>(String(saved.request_url));
    let result = await readOptionalPrivate<ProviderResult>(
      `${prefix(id)}responses/${attempt}/${requestId}.json`,
    );
    if (!result) {
      const count = await sql`UPDATE generation_requests SET provider_attempts=provider_attempts+1
      WHERE job_id=${id} AND request_id=${storageId} RETURNING provider_attempts`;
      try {
        if (Number(count[0]?.provider_attempts) > 4) {
          result = {
            kind: 'error',
            status: 400,
            message: 'Provider request failed after four attempts. Retry the game to continue.',
          };
        } else {
          result = await executeProviderTask(
            task,
            row.state.config ?? defaultConfig(),
            row.state.job!.gameId,
          );
        }
      } catch (error) {
        if (
          !(error instanceof ProviderAuthError) &&
          (!(error instanceof ProviderHttpError) || error.transient)
        )
          throw error;
        result = {
          kind: 'error',
          message: error.message.slice(0, 500),
          status: error instanceof ProviderAuthError ? 401 : error.status,
        };
      }
    }
    const url = await writePrivate(`${prefix(id)}responses/${attempt}/${requestId}.json`, result);
    const event = providerUsageEvent(task, result, row.state, attempt);
    await sql.transaction([
      sql`UPDATE generation_requests SET result_url=${url} WHERE job_id=${id} AND request_id=${storageId}`,
      sql`INSERT INTO generation_usage(job_id,request_id,event) VALUES(${id},${event.requestId},${JSON.stringify(event)}::jsonb)
        ON CONFLICT DO NOTHING`,
    ]);
  } finally {
    await releaseSlot(token);
  }
}
// Event bursts can queue many image requests behind the shared slots. Allow
// up to a day of capacity waits; actual paid attempts stay capped at four above.
runProviderRequest.maxRetries = 8640;

export async function publishGeneration(id: string, attempt: number) {
  'use step';
  const row = await getJob(id);
  if (!row || row.attempt !== attempt || row.status === 'canceled' || row.status === 'done') return;
  const checkpoint = await readPrivate<PassCheckpoint>(row.checkpoint);
  const gameId = row.state.job!.gameId;
  const base = `games/${gameId}/`;
  const parse = <T>(path: string): T =>
    JSON.parse(Buffer.from(checkpoint.files[base + path]!, 'base64').toString('utf8'));
  const bundle: CloudGameBundle = {
    spec: parse('game.json'),
    meta: parse('meta.json'),
    manifest: parse('assets/manifest.json'),
  };
  const principal = row.principal;
  const publicGame = await reservePublicGame(`${scope()}:${id}`, {
    id: principal.kioskId,
    name: principal.name,
    defaultFeedVisibility: scope() === 'preview' ? 'unlisted' : principal.defaultFeedVisibility,
  });
  const assets: Record<string, string> = {};
  for (const asset of bundle.manifest.assets) {
    const data = checkpoint.files[base + 'assets/' + asset.filename];
    if (!data) throw new Error('Missing finished asset');
    const blob = await put(
      `public-games/${publicGame.id}/${asset.filename}`,
      Buffer.from(data, 'base64'),
      {
        access: 'public',
        contentType: asset.mimeType,
        addRandomSuffix: false,
        allowOverwrite: true,
      },
    );
    assets[asset.filename] = blob.url;
  }
  const bundleUrl = await writePrivate(`${prefix(id)}final/bundle.json`, { bundle, assets });
  // The job row lock serializes publication with cancellation. The public game
  // and its downloadable bundle become ready in the same transaction.
  const sql = getSql();
  await sql.transaction([
    sql`SELECT id FROM generation_jobs WHERE id=${id} FOR UPDATE`,
    sql`UPDATE public_games SET status='ready',stage='done',message='Ready to play',
      title=${bundle.spec.meta.title},spec_json=${JSON.stringify(bundle.spec)}::jsonb,
      assets_json=${JSON.stringify(assets)}::jsonb,ready_at=COALESCE(ready_at,now()),failed_at=NULL,updated_at=now()
      WHERE id=${publicGame.id} AND source_id=${`${scope()}:${id}`} AND EXISTS
        (SELECT 1 FROM generation_jobs WHERE id=${id} AND attempt=${attempt} AND status='publishing')`,
    sql`UPDATE generation_jobs SET status='done',bundle=${bundleUrl},public_id=${publicGame.id},updated_at=now()
      WHERE id=${id} AND attempt=${attempt} AND status='publishing'`,
  ]);
}

export async function failGeneration(id: string, attempt: number, message: string) {
  'use step';
  const row = await getJob(id);
  if (!row || row.attempt !== attempt || ['done', 'canceled'].includes(row.status)) return;
  row.state.job!.status = 'failed';
  row.state.job!.stage = 'failed';
  row.state.job!.error = { code: 'cloud-step', message: message.slice(0, 500), stage: 'failed' };
  row.state.game!.status = 'failed';
  row.state.game!.failure = { code: 'cloud-step', message: message.slice(0, 500) };
  await getSql()`UPDATE generation_jobs SET status='failed',state=${JSON.stringify(row.state)}::jsonb,updated_at=now()
    WHERE id=${id} AND attempt=${attempt} AND status NOT IN ('done','canceled')`;
  await syncPublicProgress(id, attempt);
}

export async function cleanupGeneration(id: string) {
  'use step';
  if ((await getJob(id))?.status === 'done') await cleanPrivate(prefix(id));
}
