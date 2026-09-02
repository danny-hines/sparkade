import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function isAuthorizedKioskRequest(request: NextRequest): boolean {
  const expected = process.env.SPARKADE_KIOSK_API_KEY;
  if (!expected) return false;
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return false;
  const supplied = authorization.slice('Bearer '.length).trim();
  if (!supplied) return false;
  return timingSafeEqual(digest(supplied), digest(expected));
}
