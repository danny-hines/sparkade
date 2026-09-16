import { clerkClient } from '@clerk/nextjs/server';
import { ensureArcadeSchema, env } from './arcade';
import { getSql } from './db';

export interface AdminAccount {
  userId: string;
  handle: string;
  email: string;
  balance: number;
  suspended: boolean;
}

export interface AccountSearchResult {
  accounts: AdminAccount[];
  more: boolean;
}

// The caller must authorize the admin before looking up private email addresses.
export async function searchAdminAccounts(query: string): Promise<AccountSearchResult> {
  const needle = query.trim().replace(/^@/, '').toLowerCase();
  if (needle.length < 2) return { accounts: [], more: false };
  await ensureArcadeSchema();
  const sql = getSql();
  const client = await clerkClient();
  const [handleRows, directory] = await Promise.all([
    sql`SELECT p.user_id,p.handle,p.suspended,COALESCE(a.balance,0) AS balance
      FROM arcade_profiles p LEFT JOIN credit_accounts a
        ON a.environment=p.environment AND a.clerk_user_id=p.user_id
      WHERE p.environment=${env()} AND strpos(lower(p.handle),${needle}) > 0
      ORDER BY (lower(p.handle)=${needle}) DESC,
        (strpos(lower(p.handle),${needle})=1) DESC,p.handle,p.user_id LIMIT 100`,
    client.users.getUserList({ query: needle, limit: 100 }),
  ]);
  // Clerk's query also matches names and phone numbers. Only email matches count here.
  const emailUsers = directory.data.filter((user) =>
    user.emailAddresses.some((email) => email.emailAddress.toLowerCase().includes(needle)),
  );
  const emailIds = emailUsers.map((user) => user.id);
  const emailRows = emailIds.length
    ? await sql`SELECT p.user_id,p.handle,p.suspended,COALESCE(a.balance,0) AS balance
        FROM arcade_profiles p LEFT JOIN credit_accounts a
          ON a.environment=p.environment AND a.clerk_user_id=p.user_id
        WHERE p.environment=${env()} AND p.user_id=ANY(${emailIds}::text[])`
    : [];
  const users = new Map(directory.data.map((user) => [user.id, user]));
  const missingIds = handleRows.map((row) => String(row.user_id)).filter((id) => !users.has(id));
  if (missingIds.length) {
    const hydrated = await client.users.getUserList({ userId: missingIds, limit: 100 });
    for (const user of hydrated.data) users.set(user.id, user);
  }
  const rows = new Map([...handleRows, ...emailRows].map((row) => [String(row.user_id), row]));
  const accounts: AdminAccount[] = [];
  for (const [userId, row] of rows) {
    const user = users.get(userId);
    if (!user) continue; // Ignore profiles whose identity has been deleted from Clerk.
    const email =
      user.emailAddresses.find((entry) => entry.emailAddress.toLowerCase().includes(needle)) ??
      user.emailAddresses.find((entry) => entry.id === user.primaryEmailAddressId) ??
      user.emailAddresses[0];
    accounts.push({
      userId,
      handle: String(row.handle),
      email: email?.emailAddress ?? '',
      balance: Number(row.balance),
      suspended: Boolean(row.suspended),
    });
  }
  const rank = (account: AdminAccount) => {
    const fields = [account.handle.toLowerCase(), account.email.toLowerCase()];
    return fields.includes(needle) ? 0 : fields.some((field) => field.startsWith(needle)) ? 1 : 2;
  };
  accounts.sort((a, b) => rank(a) - rank(b) || a.handle.localeCompare(b.handle));
  return {
    accounts: accounts.slice(0, 10),
    more: accounts.length > 10 || handleRows.length === 100 || directory.totalCount > 100,
  };
}
