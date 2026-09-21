import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KioskRegistration } from '../src/cloud/kiosk-registration';
import { DEFAULT_KIOSK_DISPLAY_COPY } from '@sparkade/shared';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sparkade-registration-'));
  dirs.push(dir);
  return dir;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('KioskRegistration', () => {
  it('creates a short pairing code without sending the device secret', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return jsonResponse({ code: 'K7M4-PQ9D', expiresAt: '2030-01-01T00:10:00.000Z' }, 201);
    }) as unknown as typeof fetch;
    const dataDir = tempDataDir();
    const registration = new KioskRegistration('https://sparkade.dev/', dataDir, fetchImpl);

    await expect(registration.startPairing()).resolves.toMatchObject({
      state: 'pairing',
      pairingCode: 'K7M4-PQ9D',
    });

    const body = JSON.parse(String(requests[0]?.init?.body)) as Record<string, string>;
    expect(body.credentialId).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(body.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(body)).not.toContain('spk_kiosk_');
    const identityPath = join(dataDir, 'cloud-registration.json');
    expect(statSync(identityPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(identityPath, 'utf8')).toContain('spk_kiosk_');
    expect(registration.authorizationToken()).toBeNull();
  });

  it('learns its registered name and keeps the credential across restarts', async () => {
    let paired = false;
    const authorizations: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/kiosk/pairings')) {
        return jsonResponse({ code: 'K7M4-PQ9D', expiresAt: '2030-01-01T00:10:00.000Z' }, 201);
      }
      authorizations.push(String((init?.headers as Record<string, string>)?.authorization));
      return paired
        ? jsonResponse({
            state: 'registered',
            kioskId: 'kiosk-1',
            name: 'Meta SEA',
            defaultFeedVisibility: 'listed',
          })
        : jsonResponse({
            state: 'pending',
            code: 'K7M4-PQ9D',
            expiresAt: '2030-01-01T00:10:00.000Z',
          });
    }) as unknown as typeof fetch;
    const dataDir = tempDataDir();
    const registration = new KioskRegistration('https://sparkade.dev/', dataDir, fetchImpl);
    await registration.startPairing();
    await expect(registration.refresh()).resolves.toMatchObject({ state: 'pairing' });

    paired = true;
    await expect(registration.refresh()).resolves.toEqual({
      state: 'registered',
      origin: 'https://sparkade.dev/',
      name: 'Meta SEA',
      defaultFeedVisibility: 'listed',
      displayCopy: DEFAULT_KIOSK_DISPLAY_COPY,
    });
    expect(registration.authorizationToken()).toMatch(/^spk_kiosk_/);
    expect(authorizations[0]).toMatch(/^Bearer spk_kiosk_/);

    const reopened = new KioskRegistration('https://sparkade.dev/', dataDir, fetchImpl);
    expect(reopened.status()).toMatchObject({ state: 'registered', name: 'Meta SEA' });
    expect(reopened.authorizationToken()).toBe(registration.authorizationToken());
  });

  it('keeps a legacy key while pairing, then switches to the device credential', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/api/kiosk/pairings')
        ? jsonResponse({ code: 'K7M4-PQ9D', expiresAt: '2030-01-01T00:10:00.000Z' }, 201)
        : jsonResponse({
            state: 'registered',
            kioskId: 'kiosk-1',
            name: 'Renamed cabinet',
            defaultFeedVisibility: 'unlisted',
          }),
    ) as unknown as typeof fetch;
    const registration = new KioskRegistration('https://sparkade.dev/', tempDataDir(), fetchImpl, {
      apiKey: 'legacy-secret',
      kioskName: 'Old cabinet',
    });

    expect(registration.status()).toMatchObject({
      state: 'registered',
      legacy: true,
      name: 'Old cabinet',
    });
    await expect(registration.startPairing(true)).resolves.toMatchObject({ state: 'pairing' });
    expect(registration.authorizationToken()).toBe('legacy-secret');
    await expect(registration.refresh()).resolves.toMatchObject({
      state: 'registered',
      name: 'Renamed cabinet',
      defaultFeedVisibility: 'unlisted',
    });
    expect(registration.authorizationToken()).toMatch(/^spk_kiosk_/);
  });

  it('persists updated display copy through outages and restarts, and accepts a default reset', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ code: 'K7M4-PQ9D', expiresAt: '2030-01-01T00:10:00.000Z' }, 201),
      );
    const dataDir = tempDataDir();
    const registration = new KioskRegistration('https://sparkade.dev/', dataDir, fetchImpl);
    await registration.startPairing();
    const registered = {
      state: 'registered',
      kioskId: 'kiosk-1',
      name: 'Cabinet',
      defaultFeedVisibility: 'unlisted',
    };
    const eventCopy = { title: 'Launch Party', tagline: 'Make something worth playing' };
    fetchImpl.mockResolvedValueOnce(jsonResponse({ ...registered, displayCopy: eventCopy }));
    expect((await registration.refresh()).displayCopy).toEqual(eventCopy);

    const updated = { ...eventCopy, title: 'Day Two' };
    fetchImpl.mockResolvedValueOnce(jsonResponse({ ...registered, displayCopy: updated }));
    expect((await registration.refresh()).displayCopy).toEqual(updated);

    fetchImpl.mockRejectedValue(new Error('offline'));
    const reopened = new KioskRegistration('https://sparkade.dev/', dataDir, fetchImpl);
    expect(reopened.status().displayCopy).toEqual(updated);
    expect(await reopened.refresh()).toMatchObject({ state: 'error', displayCopy: updated });

    // An older cloud rollout or a malformed payload must not erase the event copy.
    for (const displayCopy of [undefined, { title: 'Incomplete' }, { title: 42, tagline: 'Bad' }]) {
      fetchImpl.mockResolvedValueOnce(jsonResponse({ ...registered, displayCopy }));
      expect((await reopened.refresh()).displayCopy).toEqual(updated);
    }
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({ ...registered, displayCopy: DEFAULT_KIOSK_DISPLAY_COPY }),
    );
    expect((await reopened.refresh()).displayCopy).toEqual(DEFAULT_KIOSK_DISPLAY_COPY);
    expect(
      new KioskRegistration('https://sparkade.dev/', dataDir, fetchImpl).status().displayCopy,
    ).toEqual(DEFAULT_KIOSK_DISPLAY_COPY);
  });
});
