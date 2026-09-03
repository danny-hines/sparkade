import { NextResponse } from 'next/server';
import { getPublicGame } from '@/lib/public-games';
import { renderPublicGameShareImage } from '@/lib/public-game-share-image';
import {
  getPublicGameDisplayTitle,
  getPublicGameKeyArtUrl,
  isPublicGameShareImageFormat,
} from '@/lib/public-game-sharing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string; format: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id, format } = await context.params;
  if (!isPublicGameShareImageFormat(format)) {
    return NextResponse.json({ error: 'share image not found' }, { status: 404 });
  }

  const game = await getPublicGame(id);
  if (!game || game.status !== 'ready') {
    return NextResponse.json({ error: 'game not ready' }, { status: 404 });
  }

  return renderPublicGameShareImage({
    format,
    gameId: game.id,
    keyArtUrl: getPublicGameKeyArtUrl(game),
    title: getPublicGameDisplayTitle(game),
  });
}
