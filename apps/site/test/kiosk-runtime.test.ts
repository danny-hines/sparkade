import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { kioskRuntimeReport } from '../lib/kiosk-runtime';
vi.mock('../lib/kiosk-auth', () => ({ authorizeKioskRequest: vi.fn(), kioskBearerToken: vi.fn() }));
vi.mock('../lib/kiosks', () => ({
  getKioskCredentialStatus: vi.fn(),
  recordKioskRuntime: vi.fn(),
}));
import { authorizeKioskRequest, kioskBearerToken } from '../lib/kiosk-auth';
import { recordKioskRuntime } from '../lib/kiosks';
import { GET } from '../app/api/kiosk/registration/route';
const reportHeaders = () =>
  new Headers({
    'x-sparkade-platform': 'portal',
    'x-sparkade-version': '0.4.0',
    'x-sparkade-version-code': '6',
    'x-sparkade-model': 'Portal+',
    'x-sparkade-update-channel': 'pilot',
    'x-sparkade-update-state': 'ready',
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(recordKioskRuntime).mockResolvedValue(undefined);
});
describe('Portal version reports', () => {
  it('accepts bounded runtime metadata and ignores clients without it', () => {
    expect(kioskRuntimeReport(reportHeaders())).toEqual({
      platform: 'portal',
      version: '0.4.0',
      versionCode: 6,
      model: 'Portal+',
      channel: 'pilot',
      updateState: 'ready',
    });
    expect(kioskRuntimeReport(new Headers())).toBeNull();
    for (const [name, value] of [
      ['version', 'garbage'],
      ['version-code', '6e3'],
      ['version-code', '9999999999'],
      ['model', 'x'.repeat(81)],
      ['update-channel', 'arbitrary'],
      ['update-state', 'unknown'],
    ]) {
      const headers = reportHeaders();
      headers.set(`x-sparkade-${name}`, value);
      expect(kioskRuntimeReport(headers)).toBeNull();
    }
  });
  it('never accepts unauthenticated version reports', async () => {
    vi.mocked(kioskBearerToken).mockReturnValue(null);
    const response = await GET(
      new NextRequest('https://sparkade.dev/api/kiosk/registration', { headers: reportHeaders() }),
    );
    expect(response.status).toBe(401);
    expect(recordKioskRuntime).not.toHaveBeenCalled();
  });
  it('uses the authenticated kiosk ID, and preserves the registration response', async () => {
    vi.mocked(kioskBearerToken).mockReturnValue('test-token');
    vi.mocked(authorizeKioskRequest).mockResolvedValue({
      kind: 'registered',
      kioskId: 'real-kiosk',
      credentialId: 'test-credential',
      name: 'Test Portal',
      defaultFeedVisibility: 'unlisted',
      displayCopy: { title: 'Launch Party', tagline: 'Make a game' },
    });
    const headers = reportHeaders();
    headers.set('x-sparkade-kiosk-id', 'someone-else');
    const response = await GET(
      new NextRequest('https://sparkade.dev/api/kiosk/registration', { headers }),
    );
    expect(recordKioskRuntime).toHaveBeenCalledWith('real-kiosk', kioskRuntimeReport(headers));
    expect(await response.json()).toMatchObject({
      state: 'registered',
      kioskId: 'real-kiosk',
      name: 'Test Portal',
      displayCopy: { title: 'Launch Party', tagline: 'Make a game' },
    });
  });
  it('keeps old clients working without writing an empty report', async () => {
    vi.mocked(kioskBearerToken).mockReturnValue('test-token');
    vi.mocked(authorizeKioskRequest).mockResolvedValue({
      kind: 'registered',
      kioskId: 'real-kiosk',
      credentialId: 'test-credential',
      name: 'Test',
      defaultFeedVisibility: 'unlisted',
    });
    expect((await GET(new NextRequest('https://sparkade.dev/api/kiosk/registration'))).status).toBe(
      200,
    );
    expect(recordKioskRuntime).not.toHaveBeenCalled();
  });
  it('keeps registration available if version reporting fails', async () => {
    vi.mocked(kioskBearerToken).mockReturnValue('test-token');
    vi.mocked(authorizeKioskRequest).mockResolvedValue({
      kind: 'registered',
      kioskId: 'real-kiosk',
      credentialId: 'test-credential',
      name: 'Test',
      defaultFeedVisibility: 'unlisted',
    });
    vi.mocked(recordKioskRuntime).mockRejectedValue(new Error('report write unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(
        (
          await GET(
            new NextRequest('https://sparkade.dev/api/kiosk/registration', {
              headers: reportHeaders(),
            }),
          )
        ).status,
      ).toBe(200);
    } finally {
      log.mockRestore();
    }
  });
});
