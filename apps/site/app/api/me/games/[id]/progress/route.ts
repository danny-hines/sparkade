import { auth } from '@clerk/nextjs/server';
import { websiteProgress } from '@/lib/website-progress';
export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { 'cache-control': 'private, no-store' };
  const { userId } = await auth();
  if (!userId) return new Response(null, { status: 404, headers });
  const data = await websiteProgress(userId, (await params).id);
  return data ? Response.json(data, { headers }) : new Response(null, { status: 404, headers });
}
