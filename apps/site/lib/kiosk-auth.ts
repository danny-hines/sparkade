import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { authenticateKioskToken, type KioskPrincipal } from './kiosks';
import { verifyGenerationToken } from '@sparkade/generation/service-auth';

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

export async function authorizeKioskRequest(
  request: NextRequest,
  allowWorker = false,
): Promise<AuthorizedKiosk | null> {
  const token = kioskBearerToken(request);
  if (!token) return null;
  if (allowWorker && token.startsWith('spk_worker_')) {
    const principal = verifyGenerationToken(
      token,
      'publication',
      process.env.SPARKADE_GENERATION_SECRET ?? '',
    );
    if (!principal) return null;
    return {
      kind: 'registered',
      kioskId: principal.kioskId,
      credentialId: null,
      name: principal.name,
      defaultFeedVisibility: principal.defaultFeedVisibility,
    };
  }
  const legacy = legacyKiosk(token);
  if (legacy) return legacy;
  const registered: KioskPrincipal | null = await authenticateKioskToken(token);
  return registered;
}
