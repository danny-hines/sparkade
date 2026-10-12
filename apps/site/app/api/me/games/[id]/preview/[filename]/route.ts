import { getSiteMember } from '@/lib/site-access';
import { websiteAssetPreview } from '@/lib/website-progress';
export const runtime = 'nodejs';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; filename: string }> },
) {
  const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
  const member = await getSiteMember();
  if (!member) return new Response(null, { status: 404, headers });
  const { id, filename } = await params;
  const bytes = await websiteAssetPreview(member.userId, id, filename);
  if (!bytes) return new Response(null, { status: 404, headers });
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...headers,
      'content-type': /\.webp$/i.test(filename)
        ? 'image/webp'
        : /\.png$/i.test(filename)
          ? 'image/png'
          : 'image/jpeg',
    },
  });
}
