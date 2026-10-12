import { getSiteMember } from '@/lib/site-access';
import { gameNotifications, updateGameNotifications } from '@/lib/notifications';
export const runtime = 'nodejs';
const headers = { 'cache-control': 'private, no-store' };
export async function GET() {
  const member = await getSiteMember();
  if (!member) return new Response(null, { status: 401, headers });
  return Response.json(await gameNotifications(member.userId), { headers });
}
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return new Response(null, { status: 403, headers });
  const member = await getSiteMember();
  if (!member) return new Response(null, { status: 401, headers });
  try {
    const body = await request.json();
    if (
      !body ||
      !Array.isArray(body.ids) ||
      !body.ids.every((id: unknown) => typeof id === 'string')
    )
      return new Response(null, { status: 400, headers });
    const claimed = await updateGameNotifications(
      member.userId,
      body.action,
      body.ids,
      body.through ?? '0',
    );
    return Response.json({ claimed }, { headers });
  } catch {
    return new Response(null, { status: 400, headers });
  }
}
