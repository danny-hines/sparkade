import { getAdminIdentity } from '@/lib/admin-auth';
import { searchAdminAccounts } from '@/lib/admin-account-search';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function GET(request: Request) {
  try {
    const admin = await getAdminIdentity();
    if (!admin) return json({ error: 'Sign in to search accounts.' }, 401);
    if (!admin.authorized) return json({ error: 'Admin access required.' }, 403);
    const query = (new URL(request.url).searchParams.get('q') ?? '').trim();
    if (
      query.length > 254 ||
      [...query].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    ) {
      return json({ error: 'Enter a username or email address, up to 254 characters.' }, 400);
    }
    if (query.replace(/^@/, '').length < 2) return json({ accounts: [], more: false });
    return json(await searchAdminAccounts(query));
  } catch {
    return json({ error: 'Could not search accounts. Please try again.' }, 503);
  }
}
