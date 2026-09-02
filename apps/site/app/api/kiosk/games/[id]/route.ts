import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedKioskRequest } from '@/lib/kiosk-auth';
import { isPublicGameStatus, updatePublicGame } from '@/lib/public-games';
import { GENERATED_GAME_ASSET_FILES, type GameSpec } from '@sparkade/shared';

export const runtime = 'nodejs';

const SOURCE_ID_PATTERN = /^[a-zA-Z0-9_-]{3,64}$/;
const MAX_SPEC_BYTES = 512 * 1024;
const PUBLIC_ASSET_FILENAMES = new Set<string>(Object.values(GENERATED_GAME_ASSET_FILES));

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isAuthorizedKioskRequest(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  if (typeof input.sourceId !== 'string' || !SOURCE_ID_PATTERN.test(input.sourceId)) {
    return NextResponse.json({ error: 'sourceId is invalid' }, { status: 400 });
  }
  if (!isPublicGameStatus(input.status)) {
    return NextResponse.json({ error: 'status is invalid' }, { status: 400 });
  }
  if (typeof input.stage !== 'string' || input.stage.length < 1 || input.stage.length > 80) {
    return NextResponse.json({ error: 'stage is invalid' }, { status: 400 });
  }
  if (typeof input.message !== 'string' || input.message.length < 1 || input.message.length > 500) {
    return NextResponse.json({ error: 'message is invalid' }, { status: 400 });
  }
  if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 120)) {
    return NextResponse.json({ error: 'title is invalid' }, { status: 400 });
  }
  if (
    input.spec !== undefined &&
    (typeof input.spec !== 'object' || input.spec === null || Array.isArray(input.spec))
  ) {
    return NextResponse.json({ error: 'spec is invalid' }, { status: 400 });
  }
  if (
    input.spec !== undefined &&
    Buffer.byteLength(JSON.stringify(input.spec), 'utf8') > MAX_SPEC_BYTES
  ) {
    return NextResponse.json({ error: 'spec is too large' }, { status: 413 });
  }
  if (
    input.assets !== undefined &&
    (typeof input.assets !== 'object' || input.assets === null || Array.isArray(input.assets))
  ) {
    return NextResponse.json({ error: 'assets are invalid' }, { status: 400 });
  }
  const assets = (input.assets ?? {}) as Record<string, unknown>;
  for (const [filename, url] of Object.entries(assets)) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(typeof url === 'string' ? url : '');
    } catch {
      return NextResponse.json({ error: 'asset URL is invalid' }, { status: 400 });
    }
    if (
      !PUBLIC_ASSET_FILENAMES.has(filename) ||
      parsedUrl.protocol !== 'https:' ||
      !parsedUrl.hostname.endsWith('.blob.vercel-storage.com')
    ) {
      return NextResponse.json({ error: 'asset is invalid' }, { status: 400 });
    }
  }

  const { id } = await context.params;
  const game = await updatePublicGame({
    id,
    sourceId: input.sourceId,
    status: input.status,
    stage: input.stage,
    message: input.message,
    ...(typeof input.title === 'string' ? { title: input.title } : {}),
    ...(input.spec ? { spec: input.spec as GameSpec } : {}),
    ...(input.assets ? { assets: input.assets as Record<string, string> } : {}),
  });
  if (!game) return NextResponse.json({ error: 'game not found' }, { status: 404 });
  return NextResponse.json({ game }, { headers: { 'cache-control': 'no-store' } });
}
