import { put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { GENERATED_GAME_ASSET_FILES } from '@sparkade/shared';
import { authorizeKioskRequest } from '@/lib/kiosk-auth';
import { getPublicGame, normalizePublicGameId } from '@/lib/public-games';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_ASSET_BYTES = 4 * 1024 * 1024;
const PUBLIC_ASSET_FILENAMES = new Set<string>(Object.values(GENERATED_GAME_ASSET_FILES));

type RouteContext = { params: Promise<{ id: string; filename: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const principal = await authorizeKioskRequest(request);
  if (!principal) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id: rawId, filename } = await context.params;
  const id = normalizePublicGameId(rawId);
  if (!id || !PUBLIC_ASSET_FILENAMES.has(filename)) {
    return NextResponse.json({ error: 'asset not found' }, { status: 404 });
  }
  const game = await getPublicGame(id);
  if (!game || (principal.kioskId !== null && game.kioskId !== principal.kioskId)) {
    return NextResponse.json({ error: 'game not found' }, { status: 404 });
  }
  if (request.headers.get('content-type') !== 'image/png') {
    return NextResponse.json({ error: 'asset must be a PNG' }, { status: 415 });
  }
  const contentLength = Number(request.headers.get('content-length'));
  if (!Number.isFinite(contentLength) || contentLength < 1 || contentLength > MAX_ASSET_BYTES) {
    return NextResponse.json({ error: 'asset size is invalid' }, { status: 413 });
  }
  if (!request.body) {
    return NextResponse.json({ error: 'asset body is required' }, { status: 400 });
  }

  const blob = await put(`public-games/${id}/${filename}`, request.body, {
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
