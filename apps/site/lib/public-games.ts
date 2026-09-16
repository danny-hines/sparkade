import { randomInt } from 'node:crypto';
import { GENERATED_GAME_ASSET_FILES, type GameSpec } from '@sparkade/shared';
import { getSql } from './db';
import type { FeedVisibility } from './kiosks';
import { resolveCreditEnvironment } from './invites';

export const PUBLIC_GAME_ID_PATTERN = /^[2-9bcdfghjkmnpqrstvwxyz]{7}$/i;
const PUBLIC_GAME_ALPHABET = '23456789bcdfghjkmnpqrstvwxyz';
const PUBLIC_GAME_STATUSES = ['queued', 'generating', 'ready', 'failed'] as const;

export type PublicGameStatus = (typeof PUBLIC_GAME_STATUSES)[number];

export interface PublicGame {
  id: string;
  ownerId?: string | null;
  kioskId: string | null;
  kioskName: string;
  feedVisibility: FeedVisibility;
  status: PublicGameStatus;
  stage: string;
  message: string;
  title: string | null;
  spec: GameSpec | null;
  assets: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  readyAt: string | null;
  failedAt: string | null;
}

export interface PublicGameFeedItem {
  id: string;
  kioskName: string;
  title: string;
  archetype: string | null;
  keyArtUrl: string | null;
  readyAt: string;
}

export interface PublicGameFeedPage {
  games: PublicGameFeedItem[];
  nextCursor: string | null;
}

export interface ManagedPublicGame {
  id: string;
  ownerId: string | null;
  moderation: string;
  kioskId: string | null;
  kioskName: string;
  title: string;
  status: PublicGameStatus;
  feedVisibility: FeedVisibility;
  keyArtUrl: string | null;
  createdAt: string;
  readyAt: string | null;
}

type PublicGameRow = {
  id: string;
  owner_id?: string | null;
  kiosk_id: string | null;
  kiosk_name: string;
  feed_visibility: FeedVisibility;
  status: PublicGameStatus;
  stage: string;
  message: string;
  title: string | null;
  spec_json: GameSpec | string | null;
  assets_json: Record<string, string> | string | null;
  created_at: string | Date;
  updated_at: string | Date;
  ready_at: string | Date | null;
  failed_at: string | Date | null;
};

type PublicGameFeedRow = {
  id: string;
  kiosk_name: string;
  title: string | null;
  archetype: string | null;
  key_art_url: string | null;
  ready_at: string | Date;
};

type ManagedPublicGameRow = {
  id: string;
  owner_id: string | null;
  moderation: string;
  kiosk_id: string | null;
  kiosk_name: string;
  title: string | null;
  status: PublicGameStatus;
  feed_visibility: FeedVisibility;
  key_art_url: string | null;
  created_at: string | Date;
  ready_at: string | Date | null;
};

type PublicGameFeedCursor = {
  readyAt: string;
  id: string;
};

let schemaPromise: Promise<void> | null = null;

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRow(row: PublicGameRow): PublicGame {
  let spec: GameSpec | null = null;
  if (typeof row.spec_json === 'string') {
    try {
      spec = JSON.parse(row.spec_json) as GameSpec;
    } catch {
      spec = null;
    }
  } else if (row.spec_json && typeof row.spec_json === 'object') {
    spec = row.spec_json;
  }
  let assets: Record<string, string> = {};
  if (typeof row.assets_json === 'string') {
    try {
      assets = JSON.parse(row.assets_json) as Record<string, string>;
    } catch {
      assets = {};
    }
  } else if (row.assets_json && typeof row.assets_json === 'object') {
    assets = row.assets_json;
  }
  return {
    id: row.id,
    ownerId: row.owner_id ?? null,
    kioskId: row.kiosk_id,
    kioskName: row.kiosk_name,
    feedVisibility: row.feed_visibility,
    status: row.status,
    stage: row.stage,
    message: row.message,
    title: row.title,
    spec,
    assets,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    readyAt: row.ready_at ? iso(row.ready_at) : null,
    failedAt: row.failed_at ? iso(row.failed_at) : null,
  };
}

function safePublicAssetUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.blob.vercel-storage.com')
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function mapFeedRow(row: PublicGameFeedRow): PublicGameFeedItem {
  return {
    id: row.id,
    kioskName: row.kiosk_name,
    title: row.title?.trim() || `Game ${row.id.toUpperCase()}`,
    archetype: row.archetype,
    keyArtUrl: safePublicAssetUrl(row.key_art_url),
    readyAt: iso(row.ready_at),
  };
}

export function encodePublicGameFeedCursor(cursor: PublicGameFeedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodePublicGameFeedCursor(value: string | undefined): PublicGameFeedCursor | null {
  if (!value || value.length > 256) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const cursor = parsed as Record<string, unknown>;
    if (typeof cursor.readyAt !== 'string' || typeof cursor.id !== 'string') return null;
    const id = normalizePublicGameId(cursor.id);
    const timestamp = Date.parse(cursor.readyAt);
    if (!id || !Number.isFinite(timestamp)) return null;
    return { readyAt: new Date(timestamp).toISOString(), id };
  } catch {
    return null;
  }
}

export function createPublicGameId(): string {
  let id = '';
  for (let index = 0; index < 7; index += 1) {
    id += PUBLIC_GAME_ALPHABET[randomInt(PUBLIC_GAME_ALPHABET.length)];
  }
  return id;
}

export async function ensurePublicGamesSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS public_games (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL UNIQUE,
          kiosk_name TEXT NOT NULL DEFAULT 'Sparkade Cabinet',
          status TEXT NOT NULL DEFAULT 'queued'
            CHECK (status IN ('queued', 'generating', 'ready', 'failed')),
          stage TEXT NOT NULL DEFAULT 'queued',
          message TEXT NOT NULL DEFAULT 'Waiting for the cabinet to begin',
          title TEXT,
          spec_json JSONB,
          assets_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ready_at TIMESTAMPTZ,
          failed_at TIMESTAMPTZ
        )
      `;
      await sql`
        ALTER TABLE public_games
        ADD COLUMN IF NOT EXISTS kiosk_name TEXT NOT NULL DEFAULT 'Sparkade Cabinet'
      `;
      await sql`
        ALTER TABLE public_games
        ADD COLUMN IF NOT EXISTS spec_json JSONB
      `;
      await sql`
        ALTER TABLE public_games
        ADD COLUMN IF NOT EXISTS assets_json JSONB NOT NULL DEFAULT '{}'::jsonb
      `;
      await sql`
        ALTER TABLE public_games
        ADD COLUMN IF NOT EXISTS kiosk_id TEXT
      `;
      await sql`
        ALTER TABLE public_games
        ADD COLUMN IF NOT EXISTS feed_visibility TEXT NOT NULL DEFAULT 'listed'
      `;
      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'public_games_feed_visibility_check' AND conrelid='public_games'::regclass
          ) THEN
            ALTER TABLE public_games
            ADD CONSTRAINT public_games_feed_visibility_check
            CHECK (feed_visibility IN ('listed', 'unlisted'));
          END IF;
        END $$
      `;
      await sql`ALTER TABLE public_games ADD COLUMN IF NOT EXISTS owner_id TEXT,
        ADD COLUMN IF NOT EXISTS environment TEXT,
        ADD COLUMN IF NOT EXISTS moderation TEXT NOT NULL DEFAULT 'approved',
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS version_hash TEXT,
        ADD COLUMN IF NOT EXISTS private_bundle TEXT,
        ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ`;
      await sql`
        CREATE INDEX IF NOT EXISTS public_games_status_updated
        ON public_games (status, updated_at DESC)
      `;
    })();
  }

  try {
    await schemaPromise;
  } catch (error) {
    schemaPromise = null;
    throw error;
  }
}

export function isPublicGameStatus(value: unknown): value is PublicGameStatus {
  return PUBLIC_GAME_STATUSES.includes(value as PublicGameStatus);
}

export function normalizePublicGameId(id: string): string | null {
  const normalized = id.trim().toLowerCase();
  return PUBLIC_GAME_ID_PATTERN.test(normalized) ? normalized : null;
}

export async function reservePublicGame(
  sourceId: string,
  kiosk: {
    id: string | null;
    name: string;
    defaultFeedVisibility: FeedVisibility;
  },
): Promise<PublicGame> {
  await ensurePublicGamesSchema();
  const sql = getSql();
  const existing = await sql`
    UPDATE public_games
    SET kiosk_id = COALESCE(kiosk_id, ${kiosk.id}),
        kiosk_name = ${kiosk.name}
    WHERE source_id = ${sourceId} AND owner_id IS NULL AND deleted_at IS NULL
      AND (${kiosk.id}::text IS NULL OR kiosk_id IS NULL OR kiosk_id = ${kiosk.id})
    RETURNING id, kiosk_id, kiosk_name, feed_visibility, status, stage, message, title, spec_json, assets_json, created_at, updated_at, ready_at, failed_at
  `;
  if (existing[0]) return mapRow(existing[0] as PublicGameRow);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = createPublicGameId();
    const inserted = await sql`
      INSERT INTO public_games (
        id, source_id, kiosk_id, kiosk_name, feed_visibility
      )
      VALUES (
        ${id}, ${sourceId}, ${kiosk.id}, ${kiosk.name}, ${kiosk.defaultFeedVisibility}
      )
      ON CONFLICT DO NOTHING
      RETURNING id, kiosk_id, kiosk_name, feed_visibility, status, stage, message, title, spec_json, assets_json, created_at, updated_at, ready_at, failed_at
    `;
    if (inserted[0]) return mapRow(inserted[0] as PublicGameRow);

    const raced = await sql`
      SELECT id, kiosk_id, kiosk_name, feed_visibility, status, stage, message, title, spec_json, assets_json, created_at, updated_at, ready_at, failed_at
      FROM public_games
      WHERE source_id = ${sourceId} AND owner_id IS NULL AND deleted_at IS NULL
        AND (${kiosk.id}::text IS NULL OR kiosk_id IS NULL OR kiosk_id = ${kiosk.id})
      LIMIT 1
    `;
    if (raced[0]) return mapRow(raced[0] as PublicGameRow);
  }

  throw new Error('Could not reserve a unique public game ID');
}

export async function getPublicGame(id: string): Promise<PublicGame | null> {
  const normalized = normalizePublicGameId(id);
  if (!normalized) return null;
  await ensurePublicGamesSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT id, owner_id, kiosk_id, kiosk_name, feed_visibility, status, stage, message, title, spec_json, assets_json, created_at, updated_at, ready_at, failed_at
    FROM public_games
    WHERE id = ${normalized} AND deleted_at IS NULL AND moderation='approved'
      AND (owner_id IS NULL OR environment=${resolveCreditEnvironment()})
    LIMIT 1
  `;
  return rows[0] ? mapRow(rows[0] as PublicGameRow) : null;
}

export async function listRecentPublicGames(
  options: {
    after?: string;
    limit?: number;
  } = {},
): Promise<PublicGameFeedPage> {
  await ensurePublicGamesSchema();
  const sql = getSql();
  const limit = Math.max(1, Math.min(48, Math.floor(options.limit ?? 12)));
  const cursor = decodePublicGameFeedCursor(options.after);
  const keyArtFilename = GENERATED_GAME_ASSET_FILES.keyArt;
  const rows = cursor
    ? await sql`
        SELECT id,
               kiosk_name,
               title,
               spec_json ->> 'archetype' AS archetype,
               assets_json ->> ${keyArtFilename} AS key_art_url,
               ready_at
        FROM public_games
        WHERE status = 'ready'
          AND feed_visibility = 'listed' AND deleted_at IS NULL AND moderation='approved'
          AND (owner_id IS NULL OR environment=${resolveCreditEnvironment()})
          AND spec_json IS NOT NULL
          AND ready_at IS NOT NULL
          AND (ready_at, id) < (${cursor.readyAt}::timestamptz, ${cursor.id})
        ORDER BY ready_at DESC, id DESC
        LIMIT ${limit + 1}
      `
    : await sql`
        SELECT id,
               kiosk_name,
               title,
               spec_json ->> 'archetype' AS archetype,
               assets_json ->> ${keyArtFilename} AS key_art_url,
               ready_at
        FROM public_games
        WHERE status = 'ready'
          AND feed_visibility = 'listed' AND deleted_at IS NULL AND moderation='approved'
          AND (owner_id IS NULL OR environment=${resolveCreditEnvironment()})
          AND spec_json IS NOT NULL
          AND ready_at IS NOT NULL
        ORDER BY ready_at DESC, id DESC
        LIMIT ${limit + 1}
      `;
  const games = rows.slice(0, limit).map((row) => mapFeedRow(row as PublicGameFeedRow));
  const lastGame = games.at(-1);
  return {
    games,
    nextCursor:
      rows.length > limit && lastGame
        ? encodePublicGameFeedCursor({ readyAt: lastGame.readyAt, id: lastGame.id })
        : null,
  };
}

export async function updatePublicGame(input: {
  id: string;
  sourceId: string;
  kioskId?: string | null;
  status: PublicGameStatus;
  stage: string;
  message: string;
  title?: string | null;
  spec?: GameSpec;
  assets?: Record<string, string>;
}): Promise<PublicGame | null> {
  const id = normalizePublicGameId(input.id);
  if (!id) return null;
  await ensurePublicGamesSchema();
  const sql = getSql();
  const serializedSpec = input.spec ? JSON.stringify(input.spec) : null;
  const serializedAssets = input.assets ? JSON.stringify(input.assets) : null;
  const rows = await sql`
    UPDATE public_games
    SET status = ${input.status},
        stage = ${input.stage},
        message = ${input.message},
        title = COALESCE(${input.title ?? null}, title),
        spec_json = COALESCE(${serializedSpec}::jsonb, spec_json),
        assets_json = COALESCE(${serializedAssets}::jsonb, assets_json),
        updated_at = NOW(),
        ready_at = CASE WHEN ${input.status} = 'ready' THEN COALESCE(ready_at, NOW()) ELSE ready_at END,
        failed_at = CASE WHEN ${input.status} = 'failed' THEN NOW() ELSE NULL END
    WHERE id = ${id}
      AND source_id = ${input.sourceId} AND owner_id IS NULL AND deleted_at IS NULL
      AND (${input.kioskId ?? null}::text IS NULL OR kiosk_id = ${input.kioskId ?? null})
    RETURNING id, kiosk_id, kiosk_name, feed_visibility, status, stage, message, title, spec_json, assets_json, created_at, updated_at, ready_at, failed_at
  `;
  return rows[0] ? mapRow(rows[0] as PublicGameRow) : null;
}

export async function listManagedPublicGames(limit = 100): Promise<ManagedPublicGame[]> {
  await ensurePublicGamesSchema();
  const sql = getSql();
  const keyArtFilename = GENERATED_GAME_ASSET_FILES.keyArt;
  const rows = await sql`
    SELECT id, owner_id, moderation,
           kiosk_id,
           kiosk_name,
           title,
           status,
           feed_visibility,
           assets_json ->> ${keyArtFilename} AS key_art_url,
           created_at,
           ready_at
    FROM public_games
    WHERE deleted_at IS NULL AND (owner_id IS NULL OR environment=${resolveCreditEnvironment()})
    ORDER BY created_at DESC, id DESC
    LIMIT ${Math.max(1, Math.min(250, Math.floor(limit)))}
  `;
  return rows.map((value) => {
    const row = value as ManagedPublicGameRow;
    return {
      id: row.id,
      ownerId: row.owner_id ?? null,
      moderation: row.moderation,
      kioskId: row.kiosk_id,
      kioskName: row.kiosk_name,
      title: row.title?.trim() || `Game ${row.id.toUpperCase()}`,
      status: row.status,
      feedVisibility: row.feed_visibility,
      keyArtUrl: row.owner_id
        ? row.moderation === 'approved'
          ? `/api/games/${row.id}/assets/${keyArtFilename}`
          : null
        : safePublicAssetUrl(row.key_art_url),
      createdAt: iso(row.created_at),
      readyAt: optionalIso(row.ready_at),
    };
  });
}

function optionalIso(value: string | Date | null): string | null {
  return value ? iso(value) : null;
}

export async function setPublicGameFeedVisibility(
  id: string,
  visibility: FeedVisibility,
): Promise<boolean> {
  const normalized = normalizePublicGameId(id);
  if (!normalized || (visibility !== 'listed' && visibility !== 'unlisted')) return false;
  await ensurePublicGamesSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE public_games
    SET feed_visibility = ${visibility}, updated_at = NOW()
    WHERE id = ${normalized} AND owner_id IS NULL AND deleted_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}
