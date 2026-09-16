import { GENERATED_GAME_ASSET_FILES } from '@sparkade/shared';
import { readWebsiteFinal } from '@/lib/website-generation';
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

  const final = game.ownerId ? await readWebsiteFinal(game.id) : null;
  const art = final?.files[GENERATED_GAME_ASSET_FILES.keyArt];
  const response = renderPublicGameShareImage({
    format,
    gameId: game.id,
    keyArtUrl: art ? `data:image/png;base64,${art}` : getPublicGameKeyArtUrl(game),
    title: getPublicGameDisplayTitle(game),
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
