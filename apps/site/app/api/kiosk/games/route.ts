import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedKioskRequest } from '@/lib/kiosk-auth';
import { reservePublicGame } from '@/lib/public-games';

export const runtime = 'nodejs';

const SOURCE_ID_PATTERN = /^[a-zA-Z0-9_-]{3,64}$/;
const DEFAULT_KIOSK_NAME = 'Sparkade Cabinet';

function normalizeKioskName(value: unknown): string | null {
  if (value === undefined) return DEFAULT_KIOSK_NAME;
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80) return null;
  for (const character of name) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return null;
  }
  return name;
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedKioskRequest(request)) {
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
  const kioskName = normalizeKioskName(input.kioskName);
  if (!kioskName) {
    return NextResponse.json({ error: 'kioskName is invalid' }, { status: 400 });
  }

  const game = await reservePublicGame(sourceId, kioskName);
  return NextResponse.json(
    {
      game,
      url: new URL(`/p/${game.id}`, request.nextUrl.origin).toString(),
    },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
}
