import { getSql } from './db';
import { ensureKioskSchema } from './kiosks';

let schema: Promise<void> | undefined;
export function ensureKioskBillingSchema(): Promise<void> {
  return (schema ??= (async () => {
    await ensureKioskSchema();
    const sql = getSql();
    await sql`CREATE TABLE IF NOT EXISTS kiosk_meta_credentials (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, owner_user_id TEXT NOT NULL,
      label TEXT NOT NULL, encrypted_key TEXT NOT NULL, key_suffix TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at TIMESTAMPTZ)`;
    await sql`CREATE TABLE IF NOT EXISTS kiosk_meta_assignments (
      kiosk_id TEXT NOT NULL REFERENCES kiosks(id), scope TEXT NOT NULL,
      credential_id TEXT NOT NULL REFERENCES kiosk_meta_credentials(id),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(kiosk_id,scope))`;
    await sql`CREATE TABLE IF NOT EXISTS kiosk_billing_events (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, actor_user_id TEXT NOT NULL,
      action TEXT NOT NULL, kiosk_id TEXT, credential_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    // 'shared' is the built-in server credential; UUIDs identify saved overrides.
    // Keep the ledger independent of job/media cleanup and key rotation.
    await sql`CREATE TABLE IF NOT EXISTS kiosk_meta_limits (
      scope TEXT NOT NULL, key_id TEXT NOT NULL, daily_usd NUMERIC(16,6), weekly_usd NUMERIC(16,6),
      concurrency INTEGER, paused BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(scope,key_id),
      CHECK(daily_usd>=0), CHECK(weekly_usd>=0), CHECK(concurrency>0))`;
    await sql`CREATE TABLE IF NOT EXISTS kiosk_meta_spend (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, key_id TEXT NOT NULL, owner TEXT NOT NULL,
      job_id TEXT, model TEXT NOT NULL, operation TEXT NOT NULL,
      reserved NUMERIC(16,6) NOT NULL CHECK(reserved>=0), charged NUMERIC(16,6) CHECK(charged>=0),
      active_until TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    await sql`CREATE INDEX IF NOT EXISTS kiosk_meta_spend_period ON kiosk_meta_spend(scope,key_id,created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS kiosk_meta_spend_active ON kiosk_meta_spend(scope,key_id,active_until)
      WHERE active_until IS NOT NULL`;
  })().catch((error) => {
    schema = undefined;
    throw error;
  }));
}
