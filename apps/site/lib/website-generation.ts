import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARCHETYPE_IDS, type ArchetypeId, type CloudGameBundle } from '@sparkade/shared';
import { defaultConfig } from '@sparkade/server/storage/config';
import { JobState } from '@sparkade/server/pipeline/job-state';
import { GenerationRunner } from '@sparkade/server/pipeline/runner';
import { GameFiles } from '@sparkade/server/storage/files';
import { SseHub } from '@sparkade/server/pipeline/sse';
import { collectFiles, type PassCheckpoint } from '@sparkade/server/pipeline/durable-pass';
import { getSql } from './db';
import { createPublicGameId } from './public-games';
import { ArcadeError, ensureProfile, env, settings, ensureArcadeSchema } from './arcade';
import { scope, prefix, getJob, type GenerationRow } from './generation/store';
import { readPrivate, writePrivate } from './generation/storage';

export interface WebsiteGeneration {
  job_id: string;
  game_id: string;
  user_id: string;
  environment: string;
  input_review: string;
  settlement: string;
  price: number;
  game_cap: number;
}
export async function websiteGeneration(id: string): Promise<WebsiteGeneration | null> {
  await ensureArcadeSchema();
  const [row] =
    await getSql()`SELECT * FROM arcade_generations WHERE job_id=${id} AND environment=${env()}`;
  return (row as WebsiteGeneration) ?? null;
}
export function validateWebsiteInput(prompt: string, archetype: string, key: string) {
  prompt = prompt.trim();
  if (
    !prompt ||
    prompt.length > 1200 ||
    !ARCHETYPE_IDS.includes(archetype as ArchetypeId) ||
    !/^[a-zA-Z0-9_-]{16,128}$/.test(key)
  )
    throw new ArcadeError('Choose a game type and describe your game in 1–1,200 characters.');
  return { prompt, archetype: archetype as ArchetypeId, key };
}
/** No provider work occurs here. Admission, credit hold and ownership commit together. */
export async function createWebsiteGame(
  userId: string,
  promptText: string,
  type: string,
  key: string,
) {
  const input = validateWebsiteInput(promptText, type, key);
  const profile = await ensureProfile(userId),
    config = await settings();
  const sql = getSql();
  const hash = createHash('sha256')
    .update(JSON.stringify([input.prompt, input.archetype]))
    .digest('hex');
  const duplicate =
    await sql`SELECT * FROM arcade_generations WHERE environment=${env()} AND user_id=${userId} AND idempotency_key=${key}`;
  if (duplicate[0]) {
    if (duplicate[0].input_hash !== hash)
      throw new ArcadeError('That submission was already used for a different game.');
    return String(duplicate[0].game_id);
  }
  if (profile.suspended) throw new ArcadeError('Your account is paused.');
  if (!config.enabled || config.gameCap <= 0 || config.dailyCap <= 0 || config.totalCap <= 0)
    throw new ArcadeError('Creation is paused. Your credits are safe.');
  if (profile.credits < config.price)
    throw new ArcadeError(
      `You need ${config.price} credits to create a game. Buying credits is coming soon.`,
    );
  const dir = mkdtempSync(join(tmpdir(), 'sparkade-website-')),
    db = new JobState();
  db.state.config = defaultConfig();
  let files: Record<string, string>;
  try {
    const runner = new GenerationRunner(
      db,
      new GameFiles(dir),
      { get: defaultConfig },
      new SseHub(),
    );
    runner.createJob(
      {
        idempotencyKey: key,
        promptText: input.prompt,
        sourceKind: 'typed',
        requestedArchetype: input.archetype,
      },
      { defer: true },
    );
    files = collectFiles(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const id = db.state.job!.id,
    gameId = createPublicGameId();
  const checkpoint = await writePrivate(`${prefix(id)}checkpoints/initial.json`, {
    state: db.state,
    files,
  });
  const principal = {
    owner: `website:${env()}:${userId}`,
    kioskId: null,
    name: profile.handle,
    defaultFeedVisibility: 'unlisted',
  };
  const results = await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtext(${`arcade-admission:${env()}`}))`,
    sql`SELECT balance FROM credit_accounts WHERE environment=${env()} AND clerk_user_id=${userId} FOR UPDATE`,
    sql`INSERT INTO generation_jobs(id,scope,owner,idempotency_key,input_hash,principal,state,checkpoint)
      SELECT ${id},${scope()},${principal.owner},${key},${hash},${JSON.stringify(principal)}::jsonb,${JSON.stringify(db.state)}::jsonb,${checkpoint}
      FROM arcade_settings s,credit_accounts a,arcade_profiles p
      WHERE s.environment=${env()} AND s.enabled AND s.game_cap>0 AND s.daily_cap>0 AND s.total_cap>0
      AND a.environment=s.environment AND a.clerk_user_id=${userId} AND a.balance>=s.price
      AND p.environment=s.environment AND p.user_id=a.clerk_user_id AND NOT p.suspended
      AND NOT EXISTS(SELECT 1 FROM arcade_generations g WHERE g.environment=s.environment AND g.user_id=${userId} AND g.settlement='held')
      AND (SELECT count(*) FROM arcade_generations g WHERE g.environment=s.environment AND g.settlement='held')<100
      ON CONFLICT DO NOTHING RETURNING id`,
    sql`INSERT INTO public_games(id,source_id,kiosk_name,feed_visibility,owner_id,environment,moderation,message)
      SELECT ${gameId},${`${scope()}:${id}`},${profile.handle},'unlisted',${userId},${env()},'pending','Waiting for prompt review'
      WHERE EXISTS(SELECT 1 FROM generation_jobs WHERE id=${id})`,
    sql`INSERT INTO arcade_generations(job_id,game_id,environment,user_id,idempotency_key,input_hash,prompt,archetype,price,game_cap)
      SELECT ${id},${gameId},s.environment,${userId},${key},${hash},${input.prompt},${input.archetype},s.price,s.game_cap
      FROM arcade_settings s WHERE s.environment=${env()} AND EXISTS(SELECT 1 FROM generation_jobs WHERE id=${id})`,
    sql`WITH debit AS (INSERT INTO credit_ledger(id,environment,clerk_user_id,amount,kind,reason,operation_id)
      SELECT ${randomUUID()},environment,user_id,-price,'generation_hold','Credits reserved for game creation',${`hold:${id}`}
      FROM arcade_generations WHERE job_id=${id} ON CONFLICT DO NOTHING RETURNING *)
      UPDATE credit_accounts a SET balance=balance+d.amount,updated_at=now() FROM debit d
      WHERE a.environment=d.environment AND a.clerk_user_id=d.clerk_user_id`,
    sql`UPDATE generation_jobs SET public_id=${gameId} WHERE id=${id}`,
  ]);
  if (!results[2]?.length) {
    const raced =
      await sql`SELECT * FROM arcade_generations WHERE environment=${env()} AND user_id=${userId} AND idempotency_key=${key}`;
    if (raced[0]?.input_hash === hash) return String(raced[0].game_id);
    throw new ArcadeError(
      'You already have a game in progress, your balance changed, or creation is paused.',
    );
  }
  return gameId;
}

/** Idempotent: every terminal failure/rejection returns the original held credits once. */
export async function releaseWebsiteCredits(id: string) {
  await ensureArcadeSchema();
  const sql = getSql();
  await sql`WITH released AS (UPDATE arcade_generations g SET settlement='released'
    FROM generation_jobs j WHERE g.job_id=${id} AND g.environment=${env()} AND g.settlement='held'
    AND j.id=g.job_id AND j.status IN ('failed','canceled') RETURNING g.*,j.attempt),
    receipt AS (INSERT INTO credit_ledger(id,environment,clerk_user_id,amount,kind,reason,operation_id)
      SELECT ${randomUUID()},environment,user_id,price,'generation_release','Game did not complete; credits returned','release:'||job_id||':'||attempt
      FROM released ON CONFLICT DO NOTHING RETURNING *)
    UPDATE credit_accounts a SET balance=balance+r.amount,updated_at=now() FROM receipt r
    WHERE a.environment=r.environment AND a.clerk_user_id=r.clerk_user_id`;
}
export async function assertWebsiteRunnable(row: GenerationRow) {
  if (!row.owner.startsWith('website:')) return;
  const sql = getSql();
  const [allowed] =
    await sql`SELECT g.job_id FROM arcade_generations g JOIN arcade_profiles p ON p.environment=g.environment AND p.user_id=g.user_id
    JOIN arcade_settings s ON s.environment=g.environment JOIN public_games v ON v.id=g.game_id
    JOIN generation_jobs j ON j.id=g.job_id
    WHERE g.job_id=${row.id} AND g.environment=${env()} AND g.input_review='approved' AND g.settlement='held'
      AND s.enabled AND NOT p.suspended AND v.deleted_at IS NULL AND v.moderation='pending'
      AND j.attempt=${row.attempt} AND j.status IN ('queued','running','waiting-network','publishing')`;
  if (!allowed) throw new ArcadeError('Creation stopped by account, review, or budget controls.');
}

export interface PrivateWebsiteGame {
  bundle: CloudGameBundle;
  files: Record<string, string>;
}
export async function stageWebsiteResult(
  row: GenerationRow,
  checkpoint: PassCheckpoint,
  bundle: CloudGameBundle,
) {
  await assertWebsiteRunnable(row);
  const web = await websiteGeneration(row.id);
  if (!web) throw new ArcadeError('Missing website game');
  const base = `games/${row.state.job!.gameId}/assets/`,
    files: Record<string, string> = {},
    assets: Record<string, string> = {};
  for (const asset of bundle.manifest.assets) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(asset.filename) || !checkpoint.files[base + asset.filename])
      throw new Error('Missing finished asset');
    files[asset.filename] = checkpoint.files[base + asset.filename];
    assets[asset.filename] = `/api/games/${web.game_id}/assets/${asset.filename}`;
  }
  const final = { bundle, files };
  const hash = createHash('sha256').update(JSON.stringify(final)).digest('hex');
  const url = await writePrivate(`${prefix(row.id)}final/${hash}.json`, final);
  const sql = getSql();
  await sql.transaction([
    sql`SELECT id FROM generation_jobs WHERE id=${row.id} FOR UPDATE`,
    sql`UPDATE public_games SET spec_json=${JSON.stringify(bundle.spec)}::jsonb,assets_json=${JSON.stringify(assets)}::jsonb,
      title=${bundle.spec.meta.title},version_hash=${hash},private_bundle=${url},stage='review',message='Waiting for game review',updated_at=now()
      WHERE id=${web.game_id} AND deleted_at IS NULL AND moderation='pending'
      AND EXISTS(SELECT 1 FROM generation_jobs WHERE id=${row.id} AND attempt=${row.attempt} AND status='publishing')`,
    sql`UPDATE generation_jobs SET status='review',bundle=${url},updated_at=now() WHERE id=${row.id} AND attempt=${row.attempt} AND status='publishing'`,
  ]);
}
export async function cancelWebsiteGame(userId: string, id: string) {
  await ensureArcadeSchema();
  const sql = getSql();
  await sql`UPDATE generation_jobs j SET status='canceled',updated_at=now() FROM arcade_generations g
    WHERE j.id=${id} AND g.job_id=j.id AND g.environment=${env()} AND g.user_id=${userId}
      AND j.status='queued' AND j.run_id IS NULL AND g.input_review='pending'`;
  await releaseWebsiteCredits(id);
}

export async function reviewWebsiteGame(
  actor: string,
  id: string,
  decision: string,
  version: string,
  reason: string,
) {
  await ensureArcadeSchema();
  if (!['approve-input', 'approve-output', 'reject', 'takedown'].includes(decision))
    throw new ArcadeError('Unknown review decision');
  if (!reason.trim()) throw new ArcadeError('Add a reason for the audit log.');
  const sql = getSql(),
    auditId = randomUUID();
  const result = await sql.transaction([
    sql`SELECT id FROM generation_jobs WHERE id=${id} FOR UPDATE`,
    sql`WITH changed AS (UPDATE arcade_generations g SET
      input_review=CASE WHEN ${decision}='approve-input' THEN 'approved' WHEN ${decision}='reject' THEN 'rejected' ELSE input_review END,
      settlement=CASE WHEN ${decision}='approve-output' THEN 'captured' ELSE settlement END
      FROM generation_jobs j,public_games p WHERE g.job_id=${id} AND g.environment=${env()} AND j.id=g.job_id AND p.id=g.game_id
      AND p.deleted_at IS NULL AND (
        (${decision}='approve-input' AND g.input_review='pending' AND g.settlement='held' AND j.status='queued') OR
        (${decision}='approve-output' AND g.input_review='approved' AND g.settlement='held' AND j.status='review' AND p.moderation='pending' AND p.version_hash=${version} AND ${version}<>'') OR
        (${decision}='reject' AND g.settlement='held' AND (j.status='review' OR (j.status='queued' AND g.input_review='pending'))) OR
        (${decision}='takedown' AND p.moderation='approved' AND j.status='done')) RETURNING g.*),
      audit AS (INSERT INTO admin_audit_events(id,environment,actor_user_id,action,target_type,target_id,details_json)
        SELECT ${auditId},environment,${actor},${decision},'website-game',game_id,${JSON.stringify({ reason: reason.trim().slice(0, 1000), version })}::jsonb FROM changed RETURNING id)
      SELECT * FROM changed`,
    sql`UPDATE generation_jobs j SET status=CASE WHEN ${decision}='approve-output' THEN 'done' ELSE 'failed' END,updated_at=now()
      FROM arcade_generations g WHERE j.id=${id} AND g.job_id=j.id AND g.environment=${env()}
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE id=${auditId})
      AND ((${decision}='approve-output' AND g.settlement='captured' AND j.status='review') OR (${decision}='reject' AND g.input_review='rejected' AND j.status IN ('queued','review')))`,
    sql`UPDATE public_games p SET moderation=CASE WHEN ${decision}='approve-output' THEN 'approved' ELSE 'rejected' END,
      status=CASE WHEN ${decision}='approve-output' THEN 'ready' ELSE 'failed' END,
      stage=CASE WHEN ${decision}='approve-output' THEN 'done' ELSE 'failed' END,
      message=CASE WHEN ${decision}='approve-output' THEN 'Ready to play' ELSE 'Game unavailable' END,
      feed_visibility='unlisted',ready_at=CASE WHEN ${decision}='approve-output' THEN now() ELSE ready_at END,updated_at=now()
      FROM arcade_generations g,generation_jobs j WHERE g.job_id=${id} AND g.environment=${env()} AND p.id=g.game_id AND j.id=g.job_id
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE id=${auditId})
      AND ((${decision}='approve-output' AND g.settlement='captured' AND j.status='done' AND p.moderation='pending') OR
        (${decision}='reject' AND g.input_review='rejected' AND j.status='failed') OR (${decision}='takedown' AND j.status='done'))`,
  ]);
  if (!result[1]?.length)
    throw new ArcadeError('The game changed or is no longer eligible for that decision.');
  await releaseWebsiteCredits(id);
  return decision === 'approve-input' ? await getJob(id) : null;
}
export async function readWebsiteFinal(gameId: string) {
  await ensureArcadeSchema();
  const [row] =
    await getSql()`SELECT private_bundle,version_hash FROM public_games WHERE id=${gameId} AND environment=${env()}`;
  if (!row?.private_bundle) return null;
  const final = await readPrivate<PrivateWebsiteGame>(row.private_bundle);
  if (createHash('sha256').update(JSON.stringify(final)).digest('hex') !== row.version_hash)
    throw new Error('Game version integrity check failed');
  return final;
}

/** One customer retry; same original credit price and the same cumulative provider cap. */
export async function retryWebsiteGame(userId: string, id: string) {
  await ensureArcadeSchema();
  const sql = getSql(),
    row = await getJob(id);
  if (!row || !row.owner.startsWith('website:')) throw new ArcadeError('Game not found.');
  const state = structuredClone(row.state);
  state.job!.attempt = row.attempt + 1;
  state.job!.status = 'queued';
  state.job!.stage = 'queued';
  state.job!.error = undefined;
  state.job!.startedAt = undefined;
  state.job!.finishedAt = undefined;
  state.game!.status = 'queued';
  state.game!.failure = null;
  const result = await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtext(${`arcade-admission:${env()}`}))`,
    sql`SELECT id FROM generation_jobs WHERE id=${id} FOR UPDATE`,
    sql`SELECT balance FROM credit_accounts WHERE environment=${env()} AND clerk_user_id=${userId} FOR UPDATE`,
    sql`UPDATE arcade_generations g SET settlement='held' FROM generation_jobs j,credit_accounts a,arcade_settings s,arcade_profiles u,public_games p
      WHERE g.job_id=${id} AND g.environment=${env()} AND g.user_id=${userId} AND g.input_review='approved' AND g.settlement='released'
      AND j.id=g.job_id AND j.status='failed' AND j.attempt=1 AND j.checkpoint<>''
      AND a.environment=g.environment AND a.clerk_user_id=g.user_id AND a.balance>=g.price
      AND s.environment=g.environment AND s.enabled AND u.environment=g.environment AND u.user_id=g.user_id AND NOT u.suspended
      AND p.id=g.game_id AND p.deleted_at IS NULL AND p.moderation='pending'
      AND NOT EXISTS(SELECT 1 FROM arcade_generations other WHERE other.environment=g.environment AND other.user_id=g.user_id AND other.settlement='held')
      AND COALESCE((SELECT sum(COALESCE(charged,reserved)) FROM arcade_spend WHERE job_id=g.job_id),0)<LEAST(g.game_cap,s.game_cap)
      RETURNING g.*`,
    sql`WITH debit AS (INSERT INTO credit_ledger(id,environment,clerk_user_id,amount,kind,reason,operation_id)
      SELECT ${randomUUID()},environment,user_id,-price,'generation_hold','One retry of game generation',${`retry-hold:${id}`}
      FROM arcade_generations WHERE job_id=${id} AND environment=${env()} AND user_id=${userId} AND settlement='held'
      AND EXISTS(SELECT 1 FROM generation_jobs WHERE id=${id} AND status='failed' AND attempt=1)
      ON CONFLICT DO NOTHING RETURNING *) UPDATE credit_accounts a SET balance=balance+d.amount,updated_at=now() FROM debit d WHERE a.environment=d.environment AND a.clerk_user_id=d.clerk_user_id`,
    sql`UPDATE generation_jobs j SET attempt=2,status='queued',run_id=NULL,state=${JSON.stringify(state)}::jsonb,updated_at=now()
      FROM arcade_generations g WHERE j.id=${id} AND g.job_id=j.id AND g.user_id=${userId} AND g.environment=${env()}
      AND g.settlement='held' AND j.status='failed' AND j.attempt=1 RETURNING j.*`,
    sql`UPDATE public_games p SET status='queued',stage='queued',message='Waiting to retry',updated_at=now()
      FROM arcade_generations g,generation_jobs j WHERE g.job_id=${id} AND j.id=g.job_id AND p.id=g.game_id
      AND g.environment=${env()} AND g.user_id=${userId} AND j.status='queued' AND j.attempt=2 AND p.deleted_at IS NULL`,
  ]);
  if (!result[3]?.length)
    throw new ArcadeError(
      'This game cannot be retried: check your credits, remaining budget, or retry limit.',
    );
  return result[5][0] as GenerationRow;
}
