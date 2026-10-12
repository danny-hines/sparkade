import { ensureArcadeSchema } from './arcade-schema';
import { getSql } from './db';
import { resolveCreditEnvironment as env } from './invites';

export const MAX_INVITED_EMAILS_PER_REQUEST = 200;

export interface InvitedEmail {
  email: string;
  invitedAt: string;
}

/** Lowercased address, or null when it is not a plausible single email address. */
export function normalizeInvitedEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:".]+$/.test(email))
    return null;
  return email;
}

/** Accepts commas, semicolons, spaces, or one address per line. */
export function parseInvitedEmails(raw: string): { emails: string[]; invalid: string[] } {
  const emails = new Set<string>();
  const invalid: string[] = [];
  for (const entry of raw.split(/[\s,;]+/).filter(Boolean)) {
    const email = normalizeInvitedEmail(entry);
    if (email) emails.add(email);
    else invalid.push(entry.slice(0, 80));
  }
  return { emails: [...emails], invalid };
}

/** The subset of `emails` that is on this environment's invite list. */
export async function findInvitedEmails(emails: string[]): Promise<string[]> {
  const candidates = [...new Set(emails.map((email) => email.trim().toLowerCase()))].filter(
    Boolean,
  );
  if (!candidates.length) return [];
  await ensureArcadeSchema();
  const rows = await getSql()`SELECT email FROM site_access_emails
    WHERE environment=${env()} AND email=ANY(${candidates}::text[])`;
  return rows.map((row) => String(row.email));
}

export async function listInvitedEmails(): Promise<InvitedEmail[]> {
  await ensureArcadeSchema();
  const rows = await getSql()`SELECT email,created_at FROM site_access_emails
    WHERE environment=${env()} ORDER BY email`;
  return rows.map((row) => ({
    email: String(row.email),
    invitedAt: new Date(row.created_at as string | Date).toISOString(),
  }));
}

/** Returns the addresses newly added; existing invites are left unchanged. */
export async function addInvitedEmails(emails: string[], actorUserId: string): Promise<string[]> {
  if (!emails.length) return [];
  await ensureArcadeSchema();
  const rows = await getSql()`WITH added AS (
      INSERT INTO site_access_emails(environment,email,invited_by_user_id)
      SELECT ${env()},email,${actorUserId} FROM unnest(${emails}::text[]) AS email
      ON CONFLICT DO NOTHING RETURNING email)
    INSERT INTO admin_audit_events(id,environment,actor_user_id,action,target_type,target_id)
    SELECT gen_random_uuid()::text,${env()},${actorUserId},'access-invite','email',email FROM added
    RETURNING target_id`;
  return rows.map((row) => String(row.target_id));
}

/** Removal takes effect on the person's next request. */
export async function removeInvitedEmail(email: string, actorUserId: string): Promise<boolean> {
  await ensureArcadeSchema();
  const rows = await getSql()`WITH removed AS (
      DELETE FROM site_access_emails WHERE environment=${env()} AND email=${email} RETURNING email)
    INSERT INTO admin_audit_events(id,environment,actor_user_id,action,target_type,target_id)
    SELECT gen_random_uuid()::text,${env()},${actorUserId},'access-remove','email',email FROM removed
    RETURNING target_id`;
  return rows.length > 0;
}
