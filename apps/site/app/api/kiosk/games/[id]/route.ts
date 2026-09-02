import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedKioskRequest } from '@/lib/kiosk-auth';
import { isPublicGameStatus, updatePublicGame } from '@/lib/public-games';

export const runtime = 'nodejs';

const SOURCE_ID_PATTERN = /^[a-zA-Z0-9_-]{3,64}$/;

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

  const { id } = await context.params;
  const game = await updatePublicGame({
    id,
    sourceId: input.sourceId,
    status: input.status,
    stage: input.stage,
    message: input.message,
    ...(typeof input.title === 'string' ? { title: input.title } : {}),
  });
  if (!game) return NextResponse.json({ error: 'game not found' }, { status: 404 });
  return NextResponse.json({ game }, { headers: { 'cache-control': 'no-store' } });
}
