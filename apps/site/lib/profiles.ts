import { getSql } from './db';
import { ArcadeError, ensureArcadeSchema, ensureProfile, env } from './arcade';
import { USERNAME_PATTERN, UsernameError, validateUsername } from './usernames';

export async function changeUsername(userId: string, input: string): Promise<string> {
  const profile = await ensureProfile(userId);
  if (profile.suspended) throw new ArcadeError('Your account is paused.');
  // Existing generated usernames remain valid when saved without a change.
  if (input.trim().toLowerCase() === profile.handle) return profile.handle;
  const handle = validateUsername(input);
  const sql = getSql(),
    environment = env();
  const results = await sql.transaction([
    // Serialize claims and renames across all app instances. The history and
    // current profile update commit together; another user cannot take an alias.
    sql`SELECT pg_advisory_xact_lock(hashtext(${`profile-handles:${environment}`}))`,
    sql`SELECT suspended FROM arcade_profiles WHERE environment=${environment} AND user_id=${userId} FOR UPDATE`,
    sql`INSERT INTO arcade_profile_handles(environment,handle,user_id)
      SELECT environment,handle,user_id FROM arcade_profiles WHERE environment=${environment} AND user_id=${userId}
      ON CONFLICT DO NOTHING`,
    sql`INSERT INTO arcade_profile_handles AS h(environment,handle,user_id)
      SELECT environment,${handle},user_id FROM arcade_profiles
      WHERE environment=${environment} AND user_id=${userId} AND NOT suspended
      ON CONFLICT(environment,handle) DO UPDATE SET handle=EXCLUDED.handle
        WHERE h.user_id=EXCLUDED.user_id RETURNING handle`,
    sql`UPDATE arcade_profiles p SET handle=${handle}
      WHERE environment=${environment} AND user_id=${userId} AND NOT suspended
      AND EXISTS(SELECT 1 FROM arcade_profile_handles h WHERE h.environment=p.environment AND h.user_id=p.user_id AND h.handle=${handle})
      RETURNING handle`,
  ]);
  if (results[1][0]?.suspended) throw new ArcadeError('Your account is paused.');
  if (!results[4].length)
    throw new UsernameError('That username is already taken. Please choose another.');
  return handle;
}

export async function findPublicProfile(input: string) {
  const handle = input.toLowerCase();
  if (!USERNAME_PATTERN.test(handle)) return null;
  await ensureArcadeSchema();
  const [row] = await getSql()`SELECT p.user_id,p.handle FROM arcade_profile_handles h
    JOIN arcade_profiles p ON p.environment=h.environment AND p.user_id=h.user_id
    WHERE h.environment=${env()} AND h.handle=${handle} AND NOT p.suspended`;
  return row ? { userId: String(row.user_id), handle: String(row.handle) } : null;
}
