import { createHash } from 'node:crypto';
import { GENERATED_GAME_ASSET_FILES, ARCHETYPE_IDS } from '@sparkade/shared';
import { getSql } from './db';
import { resolveCreditEnvironment, getCreditBalance } from './invites';
import { ensureArcadeSchema } from './arcade-schema';
import { MAX_ACTIVE_WEBSITE_GAMES, type ActiveWebsiteGame } from './website-creation-policy';

export { ensureArcadeSchema } from './arcade-schema';
export const env = resolveCreditEnvironment;
export class ArcadeError extends Error {}
export class ActiveGameError extends ArcadeError {
  constructor(public readonly games: ActiveWebsiteGame[]) {
    super(
      `You already have ${MAX_ACTIVE_WEBSITE_GAMES} games in progress. Wait for one to finish before starting another.`,
    );
  }
}
export async function getActiveWebsiteGames(userId: string): Promise<ActiveWebsiteGame[]> {
  await ensureArcadeSchema();
  const rows =
    await getSql()`SELECT p.id,p.title FROM arcade_generations g JOIN public_games p ON p.id=g.game_id
    WHERE g.environment=${env()} AND g.user_id=${userId} AND g.settlement='held'
    ORDER BY g.created_at LIMIT ${MAX_ACTIVE_WEBSITE_GAMES}`;
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title || 'Your game in progress'),
  }));
}
export async function ensureProfile(userId: string) {
  await ensureArcadeSchema();
  // Public identity never falls back to an email address or unreviewed Clerk name.
  const handle = `player-${createHash('sha256').update(`${env()}:${userId}`).digest('hex').slice(0, 12)}`;
  const sql = getSql();
  await sql`INSERT INTO arcade_profiles(environment,user_id,handle) VALUES(${env()},${userId},${handle}) ON CONFLICT DO NOTHING`;
  const [row] =
    await sql`SELECT * FROM arcade_profiles WHERE environment=${env()} AND user_id=${userId}`;
  await sql`INSERT INTO arcade_profile_handles(environment,handle,user_id)
    VALUES(${env()},${row.handle},${userId}) ON CONFLICT DO NOTHING`;
  return {
    userId,
    handle: String(row.handle),
    suspended: Boolean(row.suspended),
    credits: await getCreditBalance(userId),
  };
}
export async function settings() {
  await ensureArcadeSchema();
  const sql = getSql();
  await sql`INSERT INTO arcade_settings(environment) VALUES(${env()}) ON CONFLICT DO NOTHING`;
  const [row] = await sql`SELECT * FROM arcade_settings WHERE environment=${env()}`;
  return {
    enabled: Boolean(row.enabled),
    price: Number(row.price),
    gameCap: Number(row.game_cap),
    dailyCap: Number(row.daily_cap),
    totalCap: Number(row.total_cap),
  };
}
export interface ArcadeCard {
  id: string;
  title: string;
  description: string | null;
  archetype: string | null;
  keyArtUrl: string | null;
  creatorHandle: string | null;
  creatorName: string | null;
  kioskName: string;
  likes: number;
  plays: number;
  favorite: boolean;
  status: string;
  moderation: string;
  feedVisibility: string;
  deleted: boolean;
  jobId: string | null;
  jobStatus: string | null;
  inputReview: string | null;
  stage: string;
}
export interface BrowseOptions {
  q?: string;
  type?: string;
  sort?: string;
  page?: number;
  limit?: number;
  viewer?: string;
  owner?: string;
  mine?: boolean;
  favorites?: boolean;
}
export async function browseGames(
  options: BrowseOptions = {},
): Promise<{ games: ArcadeCard[]; more: boolean }> {
  await ensureArcadeSchema();
  const sql = getSql(),
    environment = env();
  const limit = Math.max(1, Math.min(48, Math.floor(options.limit ?? 12)));
  const offset = (Math.max(1, Math.min(1000, Math.floor(options.page ?? 1))) - 1) * limit;
  const query = (options.q ?? '').trim().slice(0, 120);
  const type = ARCHETYPE_IDS.includes(options.type as (typeof ARCHETYPE_IDS)[number])
    ? options.type!
    : '';
  const sort = ['likes', 'plays'].includes(options.sort ?? '') ? options.sort! : 'recent';
  // All dynamic values are parameters; the ordering fragments are fixed strings.
  const order =
    sort === 'likes'
      ? 'likes DESC, p.ready_at DESC NULLS LAST, p.id DESC'
      : sort === 'plays'
        ? 'plays DESC, p.ready_at DESC NULLS LAST, p.id DESC'
        : options.mine
          ? 'p.created_at DESC, p.id DESC'
          : 'COALESCE(p.published_at,p.ready_at,p.created_at) DESC, p.id DESC';
  const rows = await sql.query(
    `SELECT p.*, p.spec_json->>'archetype' AS archetype,
    p.spec_json->'meta'->>'tagline' AS description, p.assets_json->>$1 AS art,
    u.handle, g.job_id,g.input_review,j.status AS job_status,
    (SELECT count(*)::int FROM arcade_favorites f WHERE f.environment=$2 AND f.game_id=p.id) AS likes,
    (SELECT count(*)::int FROM arcade_plays v WHERE v.environment=$2 AND v.game_id=p.id) AS plays,
    EXISTS(SELECT 1 FROM arcade_favorites f WHERE f.environment=$2 AND f.game_id=p.id AND f.user_id=$3) AS favorite
    FROM public_games p LEFT JOIN arcade_profiles u ON u.user_id=p.owner_id AND u.environment=p.environment
    LEFT JOIN arcade_generations g ON g.game_id=p.id LEFT JOIN generation_jobs j ON j.id=g.job_id
    WHERE (p.owner_id IS NULL OR p.environment=$2)
      AND (($4::boolean AND p.owner_id=$3) OR (p.deleted_at IS NULL AND p.moderation='approved' AND p.status='ready' AND p.spec_json IS NOT NULL
        AND ($5::boolean OR p.feed_visibility='listed')))
      AND ($6::text='' OR p.owner_id=$6)
      AND (NOT $5::boolean OR EXISTS(SELECT 1 FROM arcade_favorites f WHERE f.environment=$2 AND f.game_id=p.id AND f.user_id=$3))
      AND ($7::text='' OR p.spec_json->>'archetype'=$7)
      AND ($8::text='' OR strpos(lower(concat_ws(' ',p.title,p.spec_json->'meta'->>'tagline',u.handle)),lower($8))>0)
    ORDER BY ${order} LIMIT $9 OFFSET $10`,
    [
      GENERATED_GAME_ASSET_FILES.keyArt,
      environment,
      options.viewer ?? '',
      Boolean(options.mine),
      Boolean(options.favorites),
      options.owner ?? '',
      type,
      query,
      limit + 1,
      offset,
    ],
  );
  return {
    more: rows.length > limit,
    games: rows.slice(0, limit).map((r) => ({
      id: r.id,
      title: r.title || 'Your next game',
      description: r.description ?? null,
      archetype: r.archetype ?? null,
      keyArtUrl: r.moderation === 'approved' && !r.deleted_at ? (r.art ?? null) : null,
      creatorHandle: r.handle ?? null,
      creatorName: r.handle ?? null,
      kioskName: r.kiosk_name,
      likes: Number(r.likes),
      plays: Number(r.plays),
      favorite: Boolean(r.favorite),
      status: r.status,
      moderation: r.moderation,
      feedVisibility: r.feed_visibility,
      deleted: Boolean(r.deleted_at),
      jobId: r.job_id ?? null,
      jobStatus: r.job_status ?? null,
      inputReview: r.input_review ?? null,
      stage: r.stage,
    })),
  };
}
export async function setFavorite(userId: string, gameId: string, wanted: boolean) {
  const profile = await ensureProfile(userId);
  if (profile.suspended) throw new ArcadeError('Your account is paused.');
  const sql = getSql();
  if (!wanted) {
    await sql`DELETE FROM arcade_favorites WHERE environment=${env()} AND user_id=${userId} AND game_id=${gameId}`;
    return;
  }
  const rows = await sql`INSERT INTO arcade_favorites(environment,user_id,game_id)
    SELECT ${env()},${userId},id FROM public_games WHERE id=${gameId} AND deleted_at IS NULL AND moderation='approved' AND status='ready'
      AND (owner_id IS NULL OR environment=${env()}) ON CONFLICT DO NOTHING RETURNING game_id`;
  return rows.length > 0;
}
export async function manageGame(userId: string, gameId: string, action: string) {
  const profile = await ensureProfile(userId);
  if (profile.suspended) throw new ArcadeError('Your account is paused.');
  const sql = getSql();
  const rows = await sql`UPDATE public_games p SET
    feed_visibility=CASE WHEN ${action}='publish' THEN 'listed' WHEN ${action} IN ('unpublish','delete','restore') THEN 'unlisted' ELSE feed_visibility END,
    published_at=CASE WHEN ${action}='publish' AND feed_visibility<>'listed' THEN now() ELSE published_at END,
    deleted_at=CASE WHEN ${action}='delete' THEN now() WHEN ${action}='restore' THEN NULL ELSE deleted_at END,updated_at=now()
    WHERE id=${gameId} AND owner_id=${userId} AND environment=${env()}
    AND (${action} IN ('publish','unpublish','delete','restore'))
    AND (${action}<>'publish' OR (moderation='approved' AND status='ready' AND deleted_at IS NULL))
    AND (${action}<>'delete' OR NOT EXISTS(SELECT 1 FROM arcade_generations g WHERE g.game_id=p.id AND g.settlement='held'))
    AND (${action}<>'restore' OR deleted_at>now()-interval '7 days') RETURNING id`;
  if (!rows.length) throw new ArcadeError('That game cannot be changed right now.');
}
