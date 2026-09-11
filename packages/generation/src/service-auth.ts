// Node-only authentication shared by the portal and generation service.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface GenerationPrincipal {
  owner: string;
  kioskId: string | null;
  name: string;
  defaultFeedVisibility: 'listed' | 'unlisted';
}

export function signGenerationToken(
  principal: GenerationPrincipal,
  audience: 'generation' | 'publication',
  secret: string,
  now = Date.now(),
): string {
  if (secret.length < 32)
    throw new Error('Generation service secret must have at least 32 characters');
  const payload = Buffer.from(
    JSON.stringify({ ...principal, audience, expires: now + 300_000 }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `spk_worker_${payload}.${signature}`;
}

export function verifyGenerationToken(
  token: string,
  audience: 'generation' | 'publication',
  secret: string,
  now = Date.now(),
): GenerationPrincipal | null {
  if (secret.length < 32 || token.length > 4096 || !token.startsWith('spk_worker_')) return null;
  const [payload, supplied, extra] = token.slice(11).split('.');
  if (!payload || !supplied || extra) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const signature = Buffer.from(supplied, 'base64url');
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (
      value.audience !== audience ||
      !Number.isFinite(value.expires) ||
      value.expires <= now ||
      value.expires > now + 300_000 ||
      typeof value.owner !== 'string' ||
      value.owner.length > 200 ||
      !/^(kiosk|user|legacy):[a-zA-Z0-9_-]+$/.test(value.owner) ||
      (value.kioskId !== null && typeof value.kioskId !== 'string') ||
      typeof value.name !== 'string' ||
      value.name.length > 80 ||
      !['listed', 'unlisted'].includes(value.defaultFeedVisibility)
    )
      return null;
    return {
      owner: value.owner,
      kioskId: value.kioskId,
      name: value.name,
      defaultFeedVisibility: value.defaultFeedVisibility,
    };
  } catch {
    return null;
  }
}
