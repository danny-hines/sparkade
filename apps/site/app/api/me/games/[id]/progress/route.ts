import { getSiteMember } from '@/lib/site-access';
import { websiteProgress } from '@/lib/website-progress';
export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { 'cache-control': 'private, no-store' };
  const member = await getSiteMember();
  if (!member) return new Response(null, { status: 404, headers });
  const data = await websiteProgress(member.userId, (await params).id);
  return data ? Response.json(data, { headers }) : new Response(null, { status: 404, headers });
}
