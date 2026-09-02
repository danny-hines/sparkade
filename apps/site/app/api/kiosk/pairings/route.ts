import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  createKioskPairing,
  KIOSK_CREDENTIAL_HASH_PATTERN,
  KIOSK_CREDENTIAL_ID_PATTERN,
  PairingCodeError,
  PairingRateLimitError,
} from '@/lib/kiosks';

export const runtime = 'nodejs';

function requestFingerprint(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const address = forwarded || request.headers.get('x-real-ip') || 'unknown';
  return createHash('sha256').update(address).digest('hex');
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const input = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  if (
    typeof input.credentialId !== 'string' ||
    !KIOSK_CREDENTIAL_ID_PATTERN.test(input.credentialId) ||
    typeof input.secretHash !== 'string' ||
    !KIOSK_CREDENTIAL_HASH_PATTERN.test(input.secretHash)
  ) {
    return NextResponse.json({ error: 'invalid pairing request' }, { status: 400 });
  }

  try {
    const pairing = await createKioskPairing({
      credentialId: input.credentialId,
      secretHash: input.secretHash,
      requestFingerprint: requestFingerprint(request),
    });
    return NextResponse.json(pairing, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof PairingRateLimitError) {
      return NextResponse.json({ error: 'too many pairing requests' }, { status: 429 });
    }
    if (error instanceof PairingCodeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Could not create kiosk pairing', error instanceof Error ? error.name : 'Error');
    return NextResponse.json({ error: 'pairing service unavailable' }, { status: 503 });
  }
}
