import { put } from '@vercel/blob';
import { readPublicGamePng, PublicAssetUploadError } from '@/lib/public-game-upload';
import { NextRequest, NextResponse } from 'next/server';
import { GENERATED_GAME_ASSET_FILES } from '@sparkade/shared';
import { authorizeKioskRequest } from '@/lib/kiosk-auth';
import { getPublicGame, normalizePublicGameId } from '@/lib/public-games';

export const runtime = 'nodejs';
export const maxDuration = 60;

const PUBLIC_ASSET_FILENAMES = new Set<string>(Object.values(GENERATED_GAME_ASSET_FILES));

type RouteContext = { params: Promise<{ id: string; filename: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const principal = await authorizeKioskRequest(request, true);
  if (!principal) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id: rawId, filename } = await context.params;
  const id = normalizePublicGameId(rawId);
  if (!id || !PUBLIC_ASSET_FILENAMES.has(filename)) {
    return NextResponse.json({ error: 'asset not found' }, { status: 404 });
  }
  const game = await getPublicGame(id);
  if (!game || game.ownerId || (principal.kioskId !== null && game.kioskId !== principal.kioskId)) {
    return NextResponse.json({ error: 'game not found' }, { status: 404 });
  }
  if (request.headers.get('content-type') !== 'image/png') {
    return NextResponse.json({ error: 'asset must be a PNG' }, { status: 415 });
  }
  let content: Uint8Array;
  try {
    content = await readPublicGamePng(request);
  } catch (error) {
    if (error instanceof PublicAssetUploadError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  const blob = await put(`public-games/${id}/${filename}`, Buffer.from(content), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'image/png',
  });

  return NextResponse.json(
    { filename, url: blob.url },
    { headers: { 'cache-control': 'no-store' } },
  );
}
