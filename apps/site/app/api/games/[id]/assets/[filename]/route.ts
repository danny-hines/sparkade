import { auth } from '@clerk/nextjs/server';
import { getSql } from '@/lib/db';
import { ensureArcadeSchema, env } from '@/lib/arcade';
import { getAdminIdentity } from '@/lib/admin-auth';
import { readWebsiteFinal } from '@/lib/website-generation';
export const runtime = 'nodejs';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; filename: string }> },
) {
  const { id, filename } = await params;
  if (!/^[a-zA-Z0-9_.-]+$/.test(filename)) return new Response(null, { status: 404 });
  await ensureArcadeSchema();
  const [game] =
    await getSql()`SELECT owner_id,moderation,deleted_at FROM public_games WHERE id=${id} AND environment=${env()}`;
  if (!game || game.deleted_at) return new Response(null, { status: 404 });
  if (game.moderation !== 'approved') {
    const { userId } = await auth();
    if (!userId || !(await getAdminIdentity())?.authorized)
      return new Response(null, { status: 404 });
  }
  const final = await readWebsiteFinal(id),
    asset = final?.bundle.manifest.assets.find((a) => a.filename === filename);
  if (!asset || !final?.files[filename]) return new Response(null, { status: 404 });
  return new Response(Buffer.from(final.files[filename], 'base64'), {
    headers: {
      'content-type': asset.mimeType,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
