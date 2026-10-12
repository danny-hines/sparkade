import { getSiteMember } from '@/lib/site-access';
import { readWebsitePhoto } from '@/lib/website-photo';

export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
  const member = await getSiteMember();
  if (!member) return new Response(null, { status: 404, headers });
  const { id } = await params;
  let photo = await readWebsitePhoto(id, member.userId);
  if (!photo && member.admin.authorized) photo = await readWebsitePhoto(id, member.userId, true);
  if (!photo) return new Response(null, { status: 404, headers });
  return new Response(new Uint8Array(photo), {
    headers: { ...headers, 'content-type': 'image/jpeg' },
  });
}
