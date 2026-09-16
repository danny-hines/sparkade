import { getSql } from './db';
import { ensureCreditSchema } from './invites';
import { ensurePublicGamesSchema } from './public-games';
import { ensureGenerationSchema } from './generation/store';

let schema: Promise<void> | undefined;
export function ensureArcadeSchema() {
  return (schema ??= (async () => {
    await ensureCreditSchema();
    await ensurePublicGamesSchema();
    await ensureGenerationSchema();
    const sql = getSql();
    await sql`CREATE TABLE IF NOT EXISTS arcade_profiles (
      environment TEXT NOT NULL, user_id TEXT NOT NULL, handle TEXT NOT NULL,
      suspended BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(environment,user_id), UNIQUE(environment,handle))`;
    // Keep every claimed handle attached to its owner, including after a rename.
    await sql`CREATE TABLE IF NOT EXISTS arcade_profile_handles (
      environment TEXT NOT NULL, handle TEXT NOT NULL, user_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(environment,handle),
      FOREIGN KEY(environment,user_id) REFERENCES arcade_profiles(environment,user_id))`;
    await sql`INSERT INTO arcade_profile_handles(environment,handle,user_id)
      SELECT environment,handle,user_id FROM arcade_profiles ON CONFLICT DO NOTHING`;
    await sql`CREATE TABLE IF NOT EXISTS arcade_settings (
      environment TEXT PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT FALSE,
      price INTEGER NOT NULL DEFAULT 10 CHECK(price>0),
      game_cap NUMERIC NOT NULL DEFAULT 0 CHECK(game_cap>=0),
      daily_cap NUMERIC NOT NULL DEFAULT 0 CHECK(daily_cap>=0),
      total_cap NUMERIC NOT NULL DEFAULT 0 CHECK(total_cap>=0))`;
    await sql`CREATE TABLE IF NOT EXISTS arcade_generations (
      job_id TEXT PRIMARY KEY REFERENCES generation_jobs(id), game_id TEXT NOT NULL UNIQUE REFERENCES public_games(id),
      environment TEXT NOT NULL, user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, input_hash TEXT NOT NULL,
      prompt TEXT NOT NULL, archetype TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>0), game_cap NUMERIC NOT NULL,
      input_review TEXT NOT NULL DEFAULT 'pending' CHECK(input_review IN ('pending','approved','rejected')),
      settlement TEXT NOT NULL DEFAULT 'held' CHECK(settlement IN ('held','captured','released')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(environment,user_id,idempotency_key))`;
    await sql`ALTER TABLE arcade_generations ADD COLUMN IF NOT EXISTS admin_bypass BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE arcade_generations ADD COLUMN IF NOT EXISTS review_policy TEXT NOT NULL DEFAULT 'legacy'`;
    await sql`ALTER TABLE arcade_generations ADD COLUMN IF NOT EXISTS runtime_checked_at TIMESTAMPTZ`;
    await sql`CREATE TABLE IF NOT EXISTS arcade_content_reviews (
      job_id TEXT NOT NULL REFERENCES arcade_generations(job_id), attempt INTEGER NOT NULL,
      phase TEXT NOT NULL CHECK(phase IN ('input','output')), policy TEXT NOT NULL, version_hash TEXT NOT NULL,
      decision TEXT CHECK(decision IN ('allow','reject')), category TEXT, model TEXT,
      provider_attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ,
      PRIMARY KEY(job_id,attempt,phase,policy,version_hash))`;
    // Admission and retries enforce the per-user limit under the same transaction lock.
    await sql`DROP INDEX IF EXISTS arcade_one_active_per_user`;
    await sql`CREATE INDEX IF NOT EXISTS arcade_active_per_user ON arcade_generations(environment,user_id) WHERE settlement='held'`;
    await sql`CREATE TABLE IF NOT EXISTS arcade_spend (
      id TEXT PRIMARY KEY, environment TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES arcade_generations(job_id),
      reserved NUMERIC NOT NULL CHECK(reserved>=0), charged NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    await sql`CREATE INDEX IF NOT EXISTS arcade_spend_environment_time ON arcade_spend(environment,created_at)`;
    await sql`CREATE TABLE IF NOT EXISTS arcade_notifications (
      id BIGSERIAL PRIMARY KEY,environment TEXT NOT NULL,user_id TEXT NOT NULL,
      game_id TEXT NOT NULL REFERENCES public_games(id),job_id TEXT NOT NULL REFERENCES generation_jobs(id),
      attempt INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('ready','rejected','failed','removed')),
      title TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),read_at TIMESTAMPTZ,toast_at TIMESTAMPTZ,
      UNIQUE(environment,user_id,job_id,attempt,kind))`;
    await sql`CREATE INDEX IF NOT EXISTS arcade_notifications_owner ON arcade_notifications(environment,user_id,id DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS arcade_favorites (
      environment TEXT NOT NULL,user_id TEXT NOT NULL,game_id TEXT NOT NULL REFERENCES public_games(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(environment,user_id,game_id))`;
    await sql`CREATE TABLE IF NOT EXISTS arcade_plays (
      environment TEXT NOT NULL,game_id TEXT NOT NULL REFERENCES public_games(id), viewer TEXT NOT NULL,
      bucket BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(environment,game_id,viewer,bucket))`;
    await sql`CREATE TABLE IF NOT EXISTS arcade_play_tickets (
      id TEXT PRIMARY KEY,environment TEXT NOT NULL,game_id TEXT NOT NULL REFERENCES public_games(id),
      viewer TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(), consumed BOOLEAN NOT NULL DEFAULT FALSE)`;
  })().catch((error) => {
    schema = undefined;
    throw error;
  }));
}
