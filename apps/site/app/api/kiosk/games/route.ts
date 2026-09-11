import { NextRequest, NextResponse } from 'next/server';
import { authorizeKioskRequest } from '@/lib/kiosk-auth';
import { normalizeKioskName } from '@/lib/kiosks';
import { reservePublicGame } from '@/lib/public-games';

export const runtime = 'nodejs';

const SOURCE_ID_PATTERN = /^[a-zA-Z0-9_-]{3,64}$/;
export async function POST(request: NextRequest) {
  const principal = await authorizeKioskRequest(request, true);
  if (!principal) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const input = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const sourceId = input.sourceId;
  if (typeof sourceId !== 'string' || !SOURCE_ID_PATTERN.test(sourceId)) {
    return NextResponse.json({ error: 'sourceId is invalid' }, { status: 400 });
  }
  const kioskName =
    principal.kind === 'registered'
      ? principal.name
      : normalizeKioskName(
          typeof input.kioskName === 'string' ? input.kioskName : 'Sparkade Cabinet',
        );
  if (!kioskName) {
    return NextResponse.json({ error: 'kioskName is invalid' }, { status: 400 });
  }

  const game = await reservePublicGame(sourceId, {
    id: principal.kioskId,
    name: kioskName,
    defaultFeedVisibility: principal.defaultFeedVisibility,
  });
  return NextResponse.json(
    {
      game,
      url: new URL(`/p/${game.id}`, request.nextUrl.origin).toString(),
    },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
}
