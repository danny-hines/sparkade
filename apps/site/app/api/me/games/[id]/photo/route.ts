import { auth } from '@clerk/nextjs/server';
import { getAdminIdentity } from '@/lib/admin-auth';
import { readWebsitePhoto } from '@/lib/website-photo';

export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
  const { userId } = await auth();
  if (!userId) return new Response(null, { status: 404, headers });
  const { id } = await params;
  let photo = await readWebsitePhoto(id, userId);
  if (!photo && (await getAdminIdentity())?.authorized)
    photo = await readWebsitePhoto(id, userId, true);
  if (!photo) return new Response(null, { status: 404, headers });
  return new Response(new Uint8Array(photo), {
    headers: { ...headers, 'content-type': 'image/jpeg' },
  });
}
