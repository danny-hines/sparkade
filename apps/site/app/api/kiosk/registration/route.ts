import { NextRequest, NextResponse } from 'next/server';
import { authorizeKioskRequest, kioskBearerToken } from '@/lib/kiosk-auth';
import { getKioskCredentialStatus } from '@/lib/kiosks';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const token = kioskBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const principal = await authorizeKioskRequest(request);
  if (principal?.kind === 'registered') {
    return NextResponse.json(
      {
        state: 'registered',
        kioskId: principal.kioskId,
        name: principal.name,
        defaultFeedVisibility: principal.defaultFeedVisibility,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  if (principal?.kind === 'legacy') {
    return NextResponse.json(
      {
        state: 'registered',
        kioskId: null,
        name: 'Legacy cabinet',
        defaultFeedVisibility: 'listed',
        legacy: true,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  const status = await getKioskCredentialStatus(token);
  return NextResponse.json(status, { headers: { 'cache-control': 'no-store' } });
}
