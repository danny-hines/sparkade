import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARCHETYPE_IDS, type ArchetypeId, type CloudGameBundle } from '@sparkade/shared';
import { buildCreationPrompt } from '@sparkade/web/creation-brief';
import { defaultConfig } from '@sparkade/server/storage/config';
import { JobState } from '@sparkade/server/pipeline/job-state';
import { GenerationRunner } from '@sparkade/server/pipeline/runner';
import { GameFiles } from '@sparkade/server/storage/files';
import { SseHub } from '@sparkade/server/pipeline/sse';
import { collectFiles, type PassCheckpoint } from '@sparkade/server/pipeline/durable-pass';
import { getSql } from './db';
import { createPublicGameId } from './public-games';
import {
  ArcadeError,
  ActiveGameError,
  getActiveWebsiteGames,
  ensureProfile,
  env,
  settings,
  ensureArcadeSchema,
} from './arcade';
import { scope, prefix, getJob, type GenerationRow } from './generation/store';
import { readPrivate, writePrivate } from './generation/storage';
import { normalizeWebsitePhoto } from './website-photo';
import { MAX_ACTIVE_WEBSITE_GAMES } from './website-creation-policy';
import { CONTENT_POLICY } from './content-policy';
import { reviewWebsiteOutput } from './website-content-review';
import type { AdminIdentity } from './admin-auth';

export interface WebsiteGeneration {
  job_id: string;
  game_id: string;
  user_id: string;
  environment: string;
  input_review: string;
  admin_bypass: boolean;
  review_policy: string;
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
export function validateWebsiteInput(
  prompt: string,
  archetype: string,
  key: string,
  heroName = '',
) {
  prompt = prompt.trim();
  heroName = heroName.trim();
  if (!ARCHETYPE_IDS.includes(archetype as ArchetypeId) || !/^[a-zA-Z0-9_-]{16,128}$/.test(key))
    throw new ArcadeError('Choose a valid game type and try again.');
  if (prompt.length > 1200)
    throw new ArcadeError('Keep your game idea to 1,200 characters or fewer.');
  if (heroName.length > 48) throw new ArcadeError('Keep the hero name to 48 characters or fewer.');
  return { prompt, archetype: archetype as ArchetypeId, key, heroName: heroName || undefined };
}
function checkCreationAccount(
  profile: Awaited<ReturnType<typeof ensureProfile>>,
  config: Awaited<ReturnType<typeof settings>>,
) {
  if (profile.suspended) throw new ArcadeError('Your account is paused.');
  if (!config.enabled || config.gameCap <= 0 || config.dailyCap <= 0 || config.totalCap <= 0)
    throw new ArcadeError('Creation is paused. Your credits are safe.');
  if (profile.credits < config.price)
    throw new ArcadeError(
      `You need ${config.price} credits to create a game. Buying credits is coming soon.`,
    );
}

/** No provider work occurs here. Admission, credit hold and ownership commit together. */
export async function createWebsiteGame(
  userId: string,
  promptText: string,
  type: string,
  key: string,
  heroName = '',
  photoUpload?: FormDataEntryValue | null,
  // Server-verified identity only; never derive this from submitted form fields.
  admin?: AdminIdentity | null,
) {
  // New submissions, including admin submissions, use the same automated policy.
  void admin;
  const adminBypass = false;
  const input = validateWebsiteInput(promptText, type, key, heroName);
  const photo = await normalizeWebsitePhoto(photoUpload);
  const generationPrompt =
    input.prompt ||
    buildCreationPrompt({
      heroName: input.heroName ?? '',
      archetypeLabel: input.archetype === 'hshooter' ? 'horizontal shooter' : input.archetype,
      details: '',
    });
  const profile = await ensureProfile(userId),
    config = await settings();
  const sql = getSql();
  // Preserve the fingerprint of unnamed submissions created before this field existed.
  const hash = createHash('sha256')
    .update(
      JSON.stringify([input.prompt, input.archetype, ...(input.heroName ? [input.heroName] : [])]),
    )
    .update(photo ?? '')
    .digest('hex');
  const existingSubmission = async () => {
    const [duplicate] =
      await sql`SELECT game_id,input_hash FROM arcade_generations WHERE environment=${env()} AND user_id=${userId} AND idempotency_key=${key}`;
    if (!duplicate) return null;
    if (duplicate.input_hash !== hash)
      throw new ArcadeError('That submission was already used for a different game.');
    return String(duplicate.game_id);
  };
  const duplicate = await existingSubmission();
  if (duplicate) return duplicate;
  checkCreationAccount(profile, config);
  const active = await getActiveWebsiteGames(userId);
  if (active.length >= MAX_ACTIVE_WEBSITE_GAMES) {
    // A duplicate request may have committed between the two reads.
    const accepted = await existingSubmission();
    if (accepted) return accepted;
    throw new ActiveGameError(active);
  }
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
        promptText: generationPrompt,
        sourceKind: 'typed',
        requestedArchetype: input.archetype,
        ...(photo ? { photo } : {}),
        creationBrief: {
          version: 1,
          archetype: input.archetype,
          ...(input.prompt ? { details: input.prompt } : {}),
          ...(input.heroName ? { heroName: input.heroName } : {}),
        },
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
      AND (SELECT count(*) FROM arcade_generations g WHERE g.environment=s.environment AND g.user_id=${userId} AND g.settlement='held')<${MAX_ACTIVE_WEBSITE_GAMES}
      AND (SELECT count(*) FROM arcade_generations g WHERE g.environment=s.environment AND g.settlement='held')<100
      ON CONFLICT DO NOTHING RETURNING id`,
    sql`INSERT INTO public_games(id,source_id,kiosk_name,feed_visibility,owner_id,environment,moderation,message)
      SELECT ${gameId},${`${scope()}:${id}`},${profile.handle},'unlisted',${userId},${env()},'pending',${'Checking your idea and photo'}
      WHERE EXISTS(SELECT 1 FROM generation_jobs WHERE id=${id})`,
    sql`INSERT INTO arcade_generations(job_id,game_id,environment,user_id,idempotency_key,input_hash,prompt,archetype,price,game_cap,input_review,admin_bypass,review_policy)
      SELECT ${id},${gameId},s.environment,${userId},${key},${hash},${generationPrompt},${input.archetype},s.price,s.game_cap,${'pending'},${adminBypass},${CONTENT_POLICY}
      FROM arcade_settings s WHERE s.environment=${env()} AND EXISTS(SELECT 1 FROM generation_jobs WHERE id=${id})`,
    sql`WITH debit AS (INSERT INTO credit_ledger(id,environment,clerk_user_id,amount,kind,reason,operation_id)
      SELECT ${randomUUID()},environment,user_id,-price,'generation_hold','Credits reserved for game creation',${`hold:${id}`}
      FROM arcade_generations WHERE job_id=${id} ON CONFLICT DO NOTHING RETURNING *)
      UPDATE credit_accounts a SET balance=balance+d.amount,updated_at=now() FROM debit d
      WHERE a.environment=d.environment AND a.clerk_user_id=d.clerk_user_id`,
    sql`UPDATE generation_jobs SET public_id=${gameId} WHERE id=${id}`,
    sql`INSERT INTO admin_audit_events(id,environment,actor_user_id,action,target_type,target_id,details_json)
      SELECT ${randomUUID()},environment,user_id,'admin-bypass-input','website-game',game_id,
        '{"reason":"Creator is an authenticated allowlisted admin"}'::jsonb
      FROM arcade_generations WHERE job_id=${id} AND admin_bypass`,
  ]);
  if (!results[2]?.length) {
    const raced = await existingSubmission();
    if (raced) return raced;
    // Admission can lose a race after the preflight check. Explain the current
    // blocker without reserving another game's credits or exposing someone else's job.
    const [currentProfile, currentConfig, currentGame] = await Promise.all([
      ensureProfile(userId),
      settings(),
      getActiveWebsiteGames(userId),
    ]);
    checkCreationAccount(currentProfile, currentConfig);
    if (currentGame.length >= MAX_ACTIVE_WEBSITE_GAMES) throw new ActiveGameError(currentGame);
    const [{ count }] =
      await sql`SELECT count(*) FROM arcade_generations WHERE environment=${env()} AND settlement='held'`;
    if (Number(count) >= 100)
      throw new ArcadeError('The creation queue is full. Please try again shortly.');
    throw new ArcadeError('Creation availability changed. Please try again.');
  }
  return gameId;
}

/** Recover an admin's own pre-exemption submission or an interrupted dispatch. */
export async function resumeAdminWebsiteGame(admin: AdminIdentity, gameId: string) {
  if (!admin.authorized) throw new ArcadeError('Admin access required.');
  await ensureArcadeSchema();
  const sql = getSql();
  await sql.transaction([
    sql`SELECT j.id FROM generation_jobs j JOIN arcade_generations g ON g.job_id=j.id
      WHERE g.game_id=${gameId} AND g.environment=${env()} AND g.user_id=${admin.userId} FOR UPDATE OF j`,
    sql`WITH changed AS (UPDATE arcade_generations g SET input_review='approved',admin_bypass=TRUE
      FROM generation_jobs j,public_games p,arcade_profiles u,arcade_settings s
      WHERE g.game_id=${gameId} AND g.environment=${env()} AND g.user_id=${admin.userId}
      AND j.id=g.job_id AND j.status='queued' AND j.run_id IS NULL
      AND g.review_policy='legacy' AND g.settlement='held' AND g.input_review IN ('pending','approved') AND NOT g.admin_bypass
      AND p.id=g.game_id AND p.deleted_at IS NULL AND p.moderation='pending'
      AND u.environment=g.environment AND u.user_id=g.user_id AND NOT u.suspended
      AND s.environment=g.environment AND s.enabled RETURNING g.*)
      INSERT INTO admin_audit_events(id,environment,actor_user_id,action,target_type,target_id,details_json)
      SELECT ${randomUUID()},environment,user_id,'admin-bypass-input','website-game',game_id,
        '{"reason":"Admin resumed their own queued submission"}'::jsonb FROM changed`,
    sql`UPDATE public_games p SET message='Starting generation',updated_at=now()
      FROM arcade_generations g,generation_jobs j
      WHERE p.id=${gameId} AND p.id=g.game_id AND g.environment=${env()} AND g.user_id=${admin.userId}
      AND g.admin_bypass AND g.input_review='approved' AND g.settlement='held'
      AND j.id=g.job_id AND j.status='queued' AND j.run_id IS NULL
      AND p.deleted_at IS NULL AND p.moderation='pending'`,
  ]);
  const [generation] =
    await sql`SELECT g.job_id FROM arcade_generations g JOIN generation_jobs j ON j.id=g.job_id
    WHERE g.game_id=${gameId} AND g.environment=${env()} AND g.user_id=${admin.userId}
      AND g.admin_bypass AND g.input_review='approved' AND g.settlement='held'
      AND j.status='queued' AND j.run_id IS NULL`;
  if (!generation) return null;
  const row = await getJob(String(generation.job_id));
  if (!row) return null;
  await assertWebsiteRunnable(row);
  return row;
}

/** Owner recovery for a saved submission whose workflow dispatch was interrupted. */
export async function resumeWebsiteGame(userId: string, gameId: string) {
  await ensureArcadeSchema();
  const [generation] =
    await getSql()`SELECT g.job_id FROM arcade_generations g JOIN generation_jobs j ON j.id=g.job_id
    WHERE g.game_id=${gameId} AND g.environment=${env()} AND g.user_id=${userId} AND g.settlement='held'
    AND (g.input_review='approved' OR (g.input_review='pending' AND g.review_policy=${CONTENT_POLICY}))
    AND j.status='queued' AND j.run_id IS NULL`;
  if (!generation) return null;
  const row = await getJob(String(generation.job_id));
  if (!row) return null;
  await assertWebsiteRunnable(row, true);
  return row;
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
export async function assertWebsiteRunnable(row: GenerationRow, allowInputReview = false) {
  if (!row.owner.startsWith('website:')) return;
  const sql = getSql();
  const [allowed] =
    await sql`SELECT g.job_id FROM arcade_generations g JOIN arcade_profiles p ON p.environment=g.environment AND p.user_id=g.user_id
    JOIN arcade_settings s ON s.environment=g.environment JOIN public_games v ON v.id=g.game_id
    JOIN generation_jobs j ON j.id=g.job_id
    WHERE g.job_id=${row.id} AND g.environment=${env()}
      AND (g.input_review='approved' OR (${allowInputReview} AND g.input_review='pending' AND g.review_policy=${CONTENT_POLICY} AND j.status='queued')) AND g.settlement='held'
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
  if (
    web.review_policy === CONTENT_POLICY &&
    !(await reviewWebsiteOutput(row, hash, bundle, files))
  )
    return;
  const automatic = web.review_policy === CONTENT_POLICY || web.admin_bypass;
  const sql = getSql();
  const results = await sql.transaction([
    sql`SELECT id FROM generation_jobs WHERE id=${row.id} FOR UPDATE`,
    sql`WITH staged AS (UPDATE public_games p SET spec_json=${JSON.stringify(bundle.spec)}::jsonb,assets_json=${JSON.stringify(assets)}::jsonb,
      title=${bundle.spec.meta.title},version_hash=${hash},private_bundle=${url},
      stage=CASE WHEN ${automatic} THEN 'done' ELSE 'review' END,
      message=CASE WHEN ${automatic} THEN 'Ready to play' ELSE 'Waiting for game review' END,
      status=CASE WHEN ${automatic} THEN 'ready' ELSE p.status END,
      moderation=CASE WHEN ${automatic} THEN 'approved' ELSE p.moderation END,
      ready_at=CASE WHEN ${automatic} THEN now() ELSE p.ready_at END,feed_visibility='unlisted',updated_at=now()
      FROM arcade_generations g,generation_jobs j,arcade_settings s,arcade_profiles u
      WHERE p.id=${web.game_id} AND p.deleted_at IS NULL AND p.moderation='pending'
      AND g.game_id=p.id AND g.job_id=j.id AND g.environment=${env()} AND g.input_review='approved' AND g.settlement='held'
      AND j.id=${row.id} AND j.attempt=${row.attempt} AND j.status='publishing'
      AND s.environment=g.environment AND s.enabled
      AND u.environment=g.environment AND u.user_id=g.user_id AND NOT u.suspended
      RETURNING p.id,g.environment,g.user_id,g.admin_bypass),
      audit AS (INSERT INTO admin_audit_events(id,environment,actor_user_id,action,target_type,target_id,details_json)
        SELECT ${randomUUID()},environment,user_id,'admin-bypass-output','website-game',id,
          ${JSON.stringify({ reason: 'Admin-created game completed without manual review', version: hash })}::jsonb
        FROM staged WHERE admin_bypass RETURNING id)
      SELECT * FROM staged`,
    sql`UPDATE arcade_generations g SET settlement='captured' FROM public_games p,generation_jobs j
      WHERE g.job_id=${row.id} AND g.environment=${env()} AND ${automatic} AND g.settlement='held'
      AND p.id=g.game_id AND p.moderation='approved' AND p.version_hash=${hash}
      AND j.id=g.job_id AND j.attempt=${row.attempt} AND j.status='publishing'`,
    sql`UPDATE generation_jobs j SET status=CASE WHEN ${automatic} THEN 'done' ELSE 'review' END,bundle=${url},updated_at=now()
      FROM arcade_generations g,public_games p
      WHERE j.id=${row.id} AND j.attempt=${row.attempt} AND j.status='publishing'
      AND g.job_id=j.id AND g.environment=${env()} AND p.id=g.game_id AND p.version_hash=${hash}
      AND ((${automatic} AND g.settlement='captured' AND p.moderation='approved')
        OR (NOT ${automatic} AND g.settlement='held' AND p.moderation='pending'))`,
  ]);
  if (!results[1]?.length) throw new ArcadeError('The game changed before it could be completed.');
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
        (${decision}='approve-input' AND g.review_policy='legacy' AND g.input_review='pending' AND g.settlement='held' AND j.status='queued') OR
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
      WHERE g.job_id=${id} AND g.environment=${env()} AND g.user_id=${userId} AND (g.input_review='approved' OR (g.input_review='pending' AND g.review_policy=${CONTENT_POLICY})) AND g.settlement='released'
      AND j.id=g.job_id AND j.status='failed' AND j.attempt=1 AND j.checkpoint<>'' AND NOT j.cleanup_pending
      AND a.environment=g.environment AND a.clerk_user_id=g.user_id AND a.balance>=g.price
      AND s.environment=g.environment AND s.enabled AND u.environment=g.environment AND u.user_id=g.user_id AND NOT u.suspended
      AND p.id=g.game_id AND p.deleted_at IS NULL AND p.moderation='pending'
      AND (SELECT count(*) FROM arcade_generations other WHERE other.environment=g.environment AND other.user_id=g.user_id AND other.settlement='held')<${MAX_ACTIVE_WEBSITE_GAMES}
      AND (SELECT count(*) FROM arcade_generations other WHERE other.environment=g.environment AND other.settlement='held')<100
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
  if (!result[3]?.length) {
    const active = await getActiveWebsiteGames(userId);
    if (active.length >= MAX_ACTIVE_WEBSITE_GAMES) throw new ActiveGameError(active);
    throw new ArcadeError(
      'This game cannot be retried: check your credits, remaining budget, or retry limit.',
    );
  }
  return result[5][0] as GenerationRow;
}
