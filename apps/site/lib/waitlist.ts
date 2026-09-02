import { getSql } from './db';

let schemaPromise: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS waitlist_subscribers (
          email TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          consent_version TEXT NOT NULL,
          consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
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

export async function addWaitlistSubscriber(
  email: string,
  source: string,
): Promise<'joined' | 'duplicate'> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO waitlist_subscribers (email, source, consent_version)
    VALUES (${email}, ${source}, 'updates-v1')
    ON CONFLICT (email) DO NOTHING
    RETURNING email
  `;
  return rows.length > 0 ? 'joined' : 'duplicate';
}
