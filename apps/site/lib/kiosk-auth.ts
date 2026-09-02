import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { authenticateKioskToken, type KioskPrincipal } from './kiosks';

export interface AuthorizedKiosk {
  kind: 'registered' | 'legacy';
  kioskId: string | null;
  credentialId: string | null;
  name: string | null;
  defaultFeedVisibility: 'listed' | 'unlisted';
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function legacyKiosk(token: string): AuthorizedKiosk | null {
  const expected = process.env.SPARKADE_KIOSK_API_KEY?.trim();
  if (!expected || !timingSafeEqual(digest(token), digest(expected))) return null;
  return {
    kind: 'legacy',
    kioskId: null,
    credentialId: null,
    name: null,
    defaultFeedVisibility: 'listed',
  };
}

export function kioskBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const supplied = authorization.slice('Bearer '.length).trim();
  return supplied || null;
}

export async function authorizeKioskRequest(request: NextRequest): Promise<AuthorizedKiosk | null> {
  const token = kioskBearerToken(request);
  if (!token) return null;
  const legacy = legacyKiosk(token);
  if (legacy) return legacy;
  const registered: KioskPrincipal | null = await authenticateKioskToken(token);
  return registered;
}
