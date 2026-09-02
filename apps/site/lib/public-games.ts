import { randomInt } from 'node:crypto';
import { getSql } from './db';

export const PUBLIC_GAME_ID_PATTERN = /^[2-9bcdfghjkmnpqrstvwxyz]{7}$/i;
const PUBLIC_GAME_ALPHABET = '23456789bcdfghjkmnpqrstvwxyz';
const PUBLIC_GAME_STATUSES = ['queued', 'generating', 'ready', 'failed'] as const;

export type PublicGameStatus = (typeof PUBLIC_GAME_STATUSES)[number];

export interface PublicGame {
  id: string;
  kioskName: string;
  status: PublicGameStatus;
  stage: string;
  message: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  readyAt: string | null;
  failedAt: string | null;
}

type PublicGameRow = {
  id: string;
  kiosk_name: string;
  status: PublicGameStatus;
  stage: string;
  message: string;
  title: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  ready_at: string | Date | null;
  failed_at: string | Date | null;
};

let schemaPromise: Promise<void> | null = null;

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRow(row: PublicGameRow): PublicGame {
  return {
    id: row.id,
    kioskName: row.kiosk_name,
    status: row.status,
    stage: row.stage,
    message: row.message,
    title: row.title,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    readyAt: row.ready_at ? iso(row.ready_at) : null,
    failedAt: row.failed_at ? iso(row.failed_at) : null,
  };
}

function createPublicGameId(): string {
  let id = '';
  for (let index = 0; index < 7; index += 1) {
    id += PUBLIC_GAME_ALPHABET[randomInt(PUBLIC_GAME_ALPHABET.length)];
  }
  return id;
}

async function ensureSchema(): Promise<void> {
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

export async function reservePublicGame(sourceId: string, kioskName: string): Promise<PublicGame> {
  await ensureSchema();
  const sql = getSql();
  const existing = await sql`
    UPDATE public_games
    SET kiosk_name = ${kioskName}
    WHERE source_id = ${sourceId}
    RETURNING id, kiosk_name, status, stage, message, title, created_at, updated_at, ready_at, failed_at
  `;
  if (existing[0]) return mapRow(existing[0] as PublicGameRow);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = createPublicGameId();
    const inserted = await sql`
      INSERT INTO public_games (id, source_id, kiosk_name)
      VALUES (${id}, ${sourceId}, ${kioskName})
      ON CONFLICT DO NOTHING
      RETURNING id, kiosk_name, status, stage, message, title, created_at, updated_at, ready_at, failed_at
    `;
    if (inserted[0]) return mapRow(inserted[0] as PublicGameRow);

    const raced = await sql`
      SELECT id, kiosk_name, status, stage, message, title, created_at, updated_at, ready_at, failed_at
      FROM public_games
      WHERE source_id = ${sourceId}
      LIMIT 1
    `;
    if (raced[0]) return mapRow(raced[0] as PublicGameRow);
  }

  throw new Error('Could not reserve a unique public game ID');
}

export async function getPublicGame(id: string): Promise<PublicGame | null> {
  const normalized = normalizePublicGameId(id);
  if (!normalized) return null;
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT id, kiosk_name, status, stage, message, title, created_at, updated_at, ready_at, failed_at
    FROM public_games
    WHERE id = ${normalized}
    LIMIT 1
  `;
  return rows[0] ? mapRow(rows[0] as PublicGameRow) : null;
}

export async function updatePublicGame(input: {
  id: string;
  sourceId: string;
  status: PublicGameStatus;
  stage: string;
  message: string;
  title?: string | null;
}): Promise<PublicGame | null> {
  const id = normalizePublicGameId(input.id);
  if (!id) return null;
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE public_games
    SET status = ${input.status},
        stage = ${input.stage},
        message = ${input.message},
        title = COALESCE(${input.title ?? null}, title),
        updated_at = NOW(),
        ready_at = CASE WHEN ${input.status} = 'ready' THEN COALESCE(ready_at, NOW()) ELSE ready_at END,
        failed_at = CASE WHEN ${input.status} = 'failed' THEN NOW() ELSE NULL END
    WHERE id = ${id} AND source_id = ${input.sourceId}
    RETURNING id, kiosk_name, status, stage, message, title, created_at, updated_at, ready_at, failed_at
  `;
  return rows[0] ? mapRow(rows[0] as PublicGameRow) : null;
}
