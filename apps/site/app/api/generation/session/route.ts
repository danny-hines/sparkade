import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { signGenerationToken, type GenerationPrincipal } from '@sparkade/generation/service-auth';
import { authorizeKioskRequest, kioskBearerToken } from '@/lib/kiosk-auth';
import { getAdminIdentity } from '@/lib/admin-auth';

export const runtime = 'nodejs';

// The portal authenticates devices/users before issuing a short-lived session
// for the generation API. Model credentials stay on the server.
export async function POST(request: NextRequest) {
  const origin =
    process.env.SPARKADE_GENERATION_BACKEND === 'vercel'
      ? request.nextUrl.origin
      : process.env.SPARKADE_GENERATION_ORIGIN;
  const secret = process.env.SPARKADE_GENERATION_SECRET ?? '';
  if (!origin || secret.length < 32) {
    return NextResponse.json({ error: 'Cloud generation is not configured' }, { status: 503 });
  }
  const source = request.headers.get('origin');
  if (source && source !== request.nextUrl.origin && !kioskBearerToken(request)) {
    return NextResponse.json({ error: 'Cross-origin request denied' }, { status: 403 });
  }
  let principal: GenerationPrincipal;
  const token = kioskBearerToken(request);
  if (token) {
    const kiosk = await authorizeKioskRequest(request);
    if (!kiosk)
      return NextResponse.json(
        { error: 'Register this cabinet before generating' },
        { status: 401 },
      );
    principal = {
      owner: kiosk.kioskId
        ? `kiosk:${kiosk.kioskId}`
        : `legacy:${createHash('sha256').update(token).digest('hex')}`,
      kioskId: kiosk.kioskId,
      name: kiosk.name ?? 'Sparkade Cabinet',
      defaultFeedVisibility: kiosk.defaultFeedVisibility,
    };
  } else {
    // Website generation is initially operator-only. Opening paid generation
    // to all accounts also requires the product's billing/credit policy.
    const identity = await getAdminIdentity();
    if (!identity?.authorized) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    principal = {
      owner: `user:${identity.userId}`,
      kioskId: null,
      name: identity.displayName.slice(0, 80),
      defaultFeedVisibility: 'unlisted',
    };
  }
  return NextResponse.json(
    {
      origin: new URL(origin).origin,
      token: signGenerationToken(principal, 'generation', secret),
      expiresAt: Date.now() + 300_000,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
