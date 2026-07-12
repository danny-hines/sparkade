// SQLite index (better-sqlite3, WAL). Game specs live on disk as files; the DB
// indexes them and owns jobs, scores, settings, and the immutable cost ledger.
import Database from 'better-sqlite3';
import { join } from 'node:path';
import type {
  ArchetypeId,
  CoverData,
  GameListItem,
  GameStatus,
  JobRecord,
  JobStatus,
  ScoreRow,
} from '@sparkade/shared';
import { ensureDir, nowIso } from '../util';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  archetype TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  golden INTEGER NOT NULL DEFAULT 0,
  job_id TEXT,
  cost_usd REAL,
  cover_json TEXT,
  failure_json TEXT,
  engine_version TEXT NOT NULL DEFAULT '',
  archetype_version TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'queued',
  detail TEXT NOT NULL DEFAULT '',
  prompt_text TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  preset_id TEXT,
  seed INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  has_photo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error_json TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  price_snapshot_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL,
  failed INTEGER NOT NULL DEFAULT 0,
  repair INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_by_job ON usage_events(job_id);
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  initials TEXT NOT NULL,
  score INTEGER NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scores_by_game ON scores(game_id, score DESC);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`;

export interface GameRow {
  id: string;
  title: string;
  tagline: string;
  archetype: ArchetypeId;
  status: GameStatus;
  createdAt: string;
  golden: boolean;
  jobId: string | null;
  costUsd: number | null;
  cover: CoverData | null;
  failure: { code: string; message: string } | null;
  engineVersion: string;
  archetypeVersion: string;
}

export class Db {
  readonly db: Database.Database;

  constructor(dir: string) {
    ensureDir(dir);
    this.db = new Database(join(dir, 'sparkade.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
    // Migration: cached-token accounting (added after launch; default 0 keeps history valid).
    const usageCols = this.db.prepare(`PRAGMA table_info(usage_events)`).all() as { name: string }[];
    if (!usageCols.some((c) => c.name === 'cached_tokens')) {
      this.db.exec(`ALTER TABLE usage_events ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0`);
    }
  }

  close(): void {
    this.db.close();
  }

  // ------------------------------------------------------------------ games

  upsertGame(row: GameRow): void {
    this.db
      .prepare(
        `INSERT INTO games (id, title, tagline, archetype, status, created_at, golden, job_id, cost_usd, cover_json, failure_json, engine_version, archetype_version)
         VALUES (@id, @title, @tagline, @archetype, @status, @createdAt, @golden, @jobId, @costUsd, @cover, @failure, @engineVersion, @archetypeVersion)
         ON CONFLICT(id) DO UPDATE SET
           title=@title, tagline=@tagline, archetype=@archetype, status=@status, golden=@golden,
           job_id=@jobId, cost_usd=@costUsd, cover_json=@cover, failure_json=@failure,
           engine_version=@engineVersion, archetype_version=@archetypeVersion`,
      )
      .run({
        ...row,
        golden: row.golden ? 1 : 0,
        cover: row.cover ? JSON.stringify(row.cover) : null,
        failure: row.failure ? JSON.stringify(row.failure) : null,
      });
  }

  setGameStatus(id: string, status: GameStatus, failure?: { code: string; message: string }): void {
    this.db
      .prepare(`UPDATE games SET status=?, failure_json=? WHERE id=?`)
      .run(status, failure ? JSON.stringify(failure) : null, id);
  }

  setGameCost(id: string, costUsd: number | null): void {
    this.db.prepare(`UPDATE games SET cost_usd=? WHERE id=?`).run(costUsd, id);
  }

  getGame(id: string): GameRow | null {
    const r = this.db.prepare(`SELECT * FROM games WHERE id=?`).get(id) as Record<string, unknown> | undefined;
    return r ? toGameRow(r) : null;
  }

  listGames(): GameRow[] {
    const rows = this.db.prepare(`SELECT * FROM games ORDER BY created_at DESC`).all() as Record<string, unknown>[];
    return rows.map(toGameRow);
  }

  deleteGame(id: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM scores WHERE game_id=?`).run(id);
      this.db.prepare(`DELETE FROM games WHERE id=?`).run(id);
      // usage_events are kept: the cost ledger is immutable (lifetime spend must survive deletes)
    });
    tx();
  }

  listItem(row: GameRow): GameListItem {
    const top = this.topScores(row.id, 1)[0] ?? null;
    return {
      id: row.id,
      title: row.title,
      tagline: row.tagline,
      archetype: row.archetype,
      status: row.status,
      createdAt: row.createdAt,
      topScore: top ? { initials: top.initials, score: top.score } : null,
      costUsd: row.costUsd,
      golden: row.golden,
      jobId: row.jobId,
      cover: row.cover,
      ...(row.failure ? { failure: row.failure } : {}),
    };
  }

  // ------------------------------------------------------------------- jobs

  insertJob(job: JobRecord, priceSnapshot: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT INTO jobs (id, game_id, status, stage, detail, prompt_text, source_kind, preset_id, seed, idempotency_key, has_photo, created_at, started_at, finished_at, error_json, attempt, price_snapshot_json)
         VALUES (@id, @gameId, @status, @stage, @detail, @promptText, @sourceKind, @presetId, @seed, @idempotencyKey, @hasPhoto, @createdAt, @startedAt, @finishedAt, @error, @attempt, @priceSnapshot)`,
      )
      .run({
        id: job.id,
        gameId: job.gameId,
        status: job.status,
        stage: job.stage,
        detail: job.detail,
        promptText: job.promptText,
        sourceKind: job.sourceKind,
        presetId: job.presetId ?? null,
        seed: job.seed,
        idempotencyKey: job.idempotencyKey,
        hasPhoto: job.hasPhoto ? 1 : 0,
        createdAt: job.createdAt,
        startedAt: job.startedAt ?? null,
        finishedAt: job.finishedAt ?? null,
        error: job.error ? JSON.stringify(job.error) : null,
        attempt: job.attempt,
        priceSnapshot: JSON.stringify(priceSnapshot),
      });
  }

  updateJob(
    id: string,
    fields: Partial<{
      status: JobStatus;
      stage: string;
      detail: string;
      startedAt: string;
      finishedAt: string;
      error: { code: string; message: string; stage: string } | null;
      attempt: number;
    }>,
  ): void {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };
    if (fields.status !== undefined) {
      sets.push('status=@status');
      params.status = fields.status;
    }
    if (fields.stage !== undefined) {
      sets.push('stage=@stage');
      params.stage = fields.stage;
    }
    if (fields.detail !== undefined) {
      sets.push('detail=@detail');
      params.detail = fields.detail;
    }
    if (fields.startedAt !== undefined) {
      sets.push('started_at=@startedAt');
      params.startedAt = fields.startedAt;
    }
    if (fields.finishedAt !== undefined) {
      sets.push('finished_at=@finishedAt');
      params.finishedAt = fields.finishedAt;
    }
    if (fields.error !== undefined) {
      sets.push('error_json=@error');
      params.error = fields.error ? JSON.stringify(fields.error) : null;
    }
    if (fields.attempt !== undefined) {
      sets.push('attempt=@attempt');
      params.attempt = fields.attempt;
    }
    if (!sets.length) return;
    this.db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id=@id`).run(params);
  }

  getJob(id: string): JobRecord | null {
    const r = this.db.prepare(`SELECT * FROM jobs WHERE id=?`).get(id) as Record<string, unknown> | undefined;
    return r ? toJobRecord(r, this.jobCost(id)) : null;
  }

  getJobByIdempotencyKey(key: string): JobRecord | null {
    const r = this.db.prepare(`SELECT * FROM jobs WHERE idempotency_key=?`).get(key) as
      | Record<string, unknown>
      | undefined;
    return r ? toJobRecord(r, this.jobCost(String(r.id))) : null;
  }

  getJobForGame(gameId: string): JobRecord | null {
    const r = this.db
      .prepare(`SELECT * FROM jobs WHERE game_id=? ORDER BY created_at DESC LIMIT 1`)
      .get(gameId) as Record<string, unknown> | undefined;
    return r ? toJobRecord(r, this.jobCost(String(r.id))) : null;
  }

  jobPriceSnapshot(id: string): Record<string, import('@sparkade/shared').PriceRow> {
    const r = this.db.prepare(`SELECT price_snapshot_json FROM jobs WHERE id=?`).get(id) as
      | { price_snapshot_json: string }
      | undefined;
    return r ? JSON.parse(r.price_snapshot_json) : {};
  }

  /** Interrupted jobs (queued/running/waiting) found at boot → failed-retryable. */
  reconcileInterruptedJobs(): string[] {
    const rows = this.db
      .prepare(`SELECT id, game_id FROM jobs WHERE status IN ('queued','running','waiting-network')`)
      .all() as { id: string; game_id: string }[];
    for (const r of rows) {
      this.updateJob(r.id, {
        status: 'failed',
        stage: 'failed',
        finishedAt: nowIso(),
        error: {
          code: 'interrupted',
          message: 'The cabinet restarted while this game was generating. Retry to continue.',
          stage: 'failed',
        },
      });
      this.setGameStatus(r.game_id, 'failed', {
        code: 'interrupted',
        message: 'Generation was interrupted by a restart.',
      });
    }
    return rows.map((r) => r.id);
  }

  // ------------------------------------------------------------ cost ledger

  insertUsage(ev: {
    jobId: string;
    gameId: string;
    stage: string;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    costUsd: number | null;
    failed: boolean;
    repair: boolean;
  }): void {
    this.db
      .prepare(
        `INSERT INTO usage_events (job_id, game_id, stage, model, provider, input_tokens, output_tokens, cached_tokens, cost_usd, failed, repair, at)
         VALUES (@jobId, @gameId, @stage, @model, @provider, @inputTokens, @outputTokens, @cachedTokens, @costUsd, @failed, @repair, @at)`,
      )
      .run({
        ...ev,
        cachedTokens: ev.cachedTokens ?? 0,
        failed: ev.failed ? 1 : 0,
        repair: ev.repair ? 1 : 0,
        at: nowIso(),
      });
  }

  /** Sum for a job. null if ANY event has unknown cost (never pretend $0.00). */
  jobCost(jobId: string): number | null {
    const rows = this.db
      .prepare(`SELECT cost_usd FROM usage_events WHERE job_id=?`)
      .all(jobId) as { cost_usd: number | null }[];
    if (rows.length === 0) return 0;
    let sum = 0;
    for (const r of rows) {
      if (r.cost_usd === null) return null;
      sum += r.cost_usd;
    }
    return sum;
  }

  /** Total cost across every attempt for a game (failed + repair calls included). */
  gameCost(gameId: string): number | null {
    const rows = this.db
      .prepare(`SELECT cost_usd FROM usage_events WHERE game_id=?`)
      .all(gameId) as { cost_usd: number | null }[];
    if (rows.length === 0) return 0;
    let sum = 0;
    for (const r of rows) {
      if (r.cost_usd === null) return null;
      sum += r.cost_usd;
    }
    return sum;
  }

  usageForJob(jobId: string): {
    stage: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    costUsd: number | null;
    failed: boolean;
    repair: boolean;
    at: string;
  }[] {
    const rows = this.db
      .prepare(`SELECT * FROM usage_events WHERE job_id=? ORDER BY id`)
      .all(jobId) as Record<string, unknown>[];
    return rows.map((r) => ({
      stage: String(r.stage),
      model: String(r.model),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      cachedTokens: Number(r.cached_tokens ?? 0),
      costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
      failed: Number(r.failed) === 1,
      repair: Number(r.repair) === 1,
      at: String(r.at),
    }));
  }

  usageForGame(gameId: string): ReturnType<Db['usageForJob']> {
    const rows = this.db
      .prepare(`SELECT * FROM usage_events WHERE game_id=? ORDER BY id`)
      .all(gameId) as Record<string, unknown>[];
    return rows.map((r) => ({
      stage: String(r.stage),
      model: String(r.model),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      cachedTokens: Number(r.cached_tokens ?? 0),
      costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
      failed: Number(r.failed) === 1,
      repair: Number(r.repair) === 1,
      at: String(r.at),
    }));
  }

  lifetimeSpendUsd(): number {
    const r = this.db
      .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage_events`)
      .get() as { total: number };
    return r.total;
  }

  // ------------------------------------------------------------------ scores

  topScores(gameId: string, limit = 10): ScoreRow[] {
    const rows = this.db
      .prepare(`SELECT initials, score, at FROM scores WHERE game_id=? ORDER BY score DESC, at ASC LIMIT ?`)
      .all(gameId, limit) as { initials: string; score: number; at: string }[];
    return rows;
  }

  addScore(gameId: string, initials: string, score: number): ScoreRow[] {
    this.db
      .prepare(`INSERT INTO scores (game_id, initials, score, at) VALUES (?,?,?,?)`)
      .run(gameId, initials, score, nowIso());
    // Keep only the top 50 per game (display shows 10) so the table can't grow unbounded.
    this.db
      .prepare(
        `DELETE FROM scores WHERE game_id=? AND id NOT IN
         (SELECT id FROM scores WHERE game_id=? ORDER BY score DESC, at ASC LIMIT 50)`,
      )
      .run(gameId, gameId);
    return this.topScores(gameId);
  }

  // ---------------------------------------------------------------- settings

  getSetting<T>(key: string): T | null {
    const r = this.db.prepare(`SELECT value_json FROM settings WHERE key=?`).get(key) as
      | { value_json: string }
      | undefined;
    return r ? (JSON.parse(r.value_json) as T) : null;
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value_json) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`,
      )
      .run(key, JSON.stringify(value));
  }
}

function toGameRow(r: Record<string, unknown>): GameRow {
  return {
    id: String(r.id),
    title: String(r.title),
    tagline: String(r.tagline ?? ''),
    archetype: String(r.archetype) as ArchetypeId,
    status: String(r.status) as GameStatus,
    createdAt: String(r.created_at),
    golden: Number(r.golden) === 1,
    jobId: r.job_id ? String(r.job_id) : null,
    costUsd: r.cost_usd === null || r.cost_usd === undefined ? null : Number(r.cost_usd),
    cover: r.cover_json ? JSON.parse(String(r.cover_json)) : null,
    failure: r.failure_json ? JSON.parse(String(r.failure_json)) : null,
    engineVersion: String(r.engine_version ?? ''),
    archetypeVersion: String(r.archetype_version ?? ''),
  };
}

function toJobRecord(r: Record<string, unknown>, costSoFarUsd: number | null): JobRecord {
  return {
    id: String(r.id),
    gameId: String(r.game_id),
    status: String(r.status) as JobStatus,
    stage: String(r.stage) as JobRecord['stage'],
    detail: String(r.detail ?? ''),
    promptText: String(r.prompt_text),
    sourceKind: String(r.source_kind) as JobRecord['sourceKind'],
    ...(r.preset_id ? { presetId: String(r.preset_id) } : {}),
    seed: Number(r.seed),
    idempotencyKey: String(r.idempotency_key),
    hasPhoto: Number(r.has_photo) === 1,
    createdAt: String(r.created_at),
    ...(r.started_at ? { startedAt: String(r.started_at) } : {}),
    ...(r.finished_at ? { finishedAt: String(r.finished_at) } : {}),
    costSoFarUsd,
    ...(r.error_json ? { error: JSON.parse(String(r.error_json)) } : {}),
    attempt: Number(r.attempt),
  };
}
