import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signGenerationToken } from '@sparkade/generation/service-auth';
import { authorizeKioskRequest } from '../lib/kiosk-auth';

vi.mock('../lib/kiosks', () => ({ authenticateKioskToken: vi.fn(async () => null) }));
afterEach(() => vi.unstubAllEnvs());

describe('worker publication credentials', () => {
  it('accepts publication credentials only on explicitly enabled routes', async () => {
    const secret = 'test-portal-generation-secret-at-least-32';
    vi.stubEnv('SPARKADE_GENERATION_SECRET', secret);
    const principal = {
      owner: 'kiosk:device',
      kioskId: 'device',
      name: 'Cabinet',
      defaultFeedVisibility: 'unlisted' as const,
    };
    const request = (audience: 'generation' | 'publication') =>
      new NextRequest('https://sparkade.dev/api/kiosk/games', {
        headers: { authorization: `Bearer ${signGenerationToken(principal, audience, secret)}` },
      });
    expect(await authorizeKioskRequest(request('generation'), true)).toBeNull();
    expect(await authorizeKioskRequest(request('publication'))).toBeNull();
    expect(await authorizeKioskRequest(request('publication'), true)).toMatchObject({
      kioskId: 'device',
      defaultFeedVisibility: 'unlisted',
    });
  });
});
