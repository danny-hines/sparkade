import { NextResponse } from 'next/server';
import { getPublicGame } from '@/lib/public-games';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const game = await getPublicGame(id);
  if (!game) return NextResponse.json({ error: 'game not found' }, { status: 404 });
  return NextResponse.json({ game }, { headers: { 'cache-control': 'no-store' } });
}
