import { describe, expect, it, vi } from 'vitest';
import type { GameSpec, JobEvent } from '@sparkade/shared';
import { PublicGamePublisher } from '../src/cloud/public-games';
import { SseHub } from '../src/pipeline/sse';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('PublicGamePublisher', () => {
  it('reserves one stable link and publishes progress through completion', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/api/kiosk/games')) {
        return response({ game: { id: '7kmp2qx' } }, 201);
      }
      if (url.includes('/assets/')) {
        const filename = url.split('/').at(-1)!;
        return response({ filename, url: `https://blob.example/${filename}` });
      }
      return response({ game: { id: '7kmp2qx' } });
    }) as unknown as typeof fetch;
    const hub = new SseHub();
    const spec = {
      specVersion: 1,
      archetype: 'platformer',
      meta: { title: 'Moon Moth Mayhem' },
    } as GameSpec;
    const publisher = new PublicGamePublisher(
      'https://sparkade.dev/',
      'secret-key',
      'Meta Menlo Park',
      {
        getGame: () => ({ title: 'Moon Moth Mayhem' }) as never,
      },
      hub,
      fetchImpl,
      () => spec,
      () => [
        { filename: 'platformer-player-idle.png', content: Buffer.from('png-one') },
        { filename: 'platformer-player-jump.png', content: Buffer.from('png-two') },
      ],
    );

    await expect(publisher.reserveAndTrack('j-one', 'g-one')).resolves.toEqual({
      id: '7kmp2qx',
      url: 'https://sparkade.dev/p/7kmp2qx',
    });

    hub.emit({
      type: 'progress',
      jobId: 'j-one',
      stage: 'designing',
      detail: 'Inventing the world',
      elapsedMs: 100,
      costSoFarUsd: 0,
    });
    hub.emit({
      type: 'progress',
      jobId: 'j-one',
      stage: 'writing-spec',
      detail: 'Writing the first level',
      elapsedMs: 150,
      costSoFarUsd: 0,
    });
    hub.emit({
      type: 'done',
      jobId: 'j-one',
      gameId: 'g-one',
      elapsedMs: 200,
      costUsd: 0.1,
    });

    await vi.waitFor(() => expect(requests).toHaveLength(5));
    expect(requests[0]?.init?.headers).toEqual({
      authorization: 'Bearer secret-key',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      sourceId: 'g-one',
      kioskName: 'Meta Menlo Park',
    });
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      sourceId: 'g-one',
      status: 'generating',
      stage: 'designing',
      message: 'Inventing the world',
    });
    expect(requests.slice(2, 4).map((request) => request.url)).toEqual([
      'https://sparkade.dev/api/kiosk/games/7kmp2qx/assets/platformer-player-idle.png',
      'https://sparkade.dev/api/kiosk/games/7kmp2qx/assets/platformer-player-jump.png',
    ]);
    expect(JSON.parse(String(requests[4]?.init?.body))).toMatchObject({
      status: 'ready',
      stage: 'done',
      title: 'Moon Moth Mayhem',
      spec,
      assets: {
        'platformer-player-idle.png': 'https://blob.example/platformer-player-idle.png',
        'platformer-player-jump.png': 'https://blob.example/platformer-player-jump.png',
      },
    });
    expect(publisher.publicationForGame('g-one')).toEqual({
      status: 'published',
      link: { id: '7kmp2qx', url: 'https://sparkade.dev/p/7kmp2qx' },
    });

    await publisher.reserveAndTrack('j-two', 'g-one');
    expect(requests.filter((request) => request.url.endsWith('/api/kiosk/games'))).toHaveLength(1);
  });

  it('keeps local generation available when reservation fails', async () => {
    const fetchImpl = vi.fn(async () =>
      response({ error: 'unavailable' }, 503),
    ) as unknown as typeof fetch;
    const publisher = new PublicGamePublisher(
      'https://sparkade.dev/',
      'secret-key',
      'Sparkade Lab',
      { getGame: () => null },
      new SseHub(),
      fetchImpl,
    );
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(publisher.reserveAndTrack('j-one', 'g-one')).resolves.toBeNull();
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it('restores a reserved link and makes interrupted work retryable after restart', async () => {
    let persisted: unknown = null;
    const store = {
      getGame: () => ({ title: 'Moon Moth Mayhem' }) as never,
      getSetting: <T>() => persisted as T | null,
      setSetting: (_key: string, value: unknown) => {
        persisted = value;
      },
    };
    const fetchImpl = vi.fn(async () =>
      response({ game: { id: '7kmp2qx' } }, 201),
    ) as unknown as typeof fetch;
    const publisher = new PublicGamePublisher(
      'https://sparkade.dev/',
      'secret-key',
      'Sparkade Lab',
      store,
      new SseHub(),
      fetchImpl,
    );

    await publisher.reserveAndTrack('j-one', 'g-one');

    const reopened = new PublicGamePublisher(
      'https://sparkade.dev/',
      'secret-key',
      'Sparkade Lab',
      store,
      new SseHub(),
      fetchImpl,
    );
    expect(reopened.linkForGame('g-one')).toEqual({
      id: '7kmp2qx',
      url: 'https://sparkade.dev/p/7kmp2qx',
    });
    expect(reopened.publicationForGame('g-one')?.status).toBe('failed');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('publishes an existing ready game in the background and reuses its URL', async () => {
    let releaseFinalUpdate = () => {};
    const finalUpdateGate = new Promise<void>((resolve) => {
      releaseFinalUpdate = resolve;
    });
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/api/kiosk/games')) {
        return response({ game: { id: '7kmp2qx' } }, 201);
      }
      if (url.includes('/assets/')) {
        const filename = url.split('/').at(-1)!;
        return response({ filename, url: `https://blob.example/${filename}` });
      }
      await finalUpdateGate;
      return response({ game: { id: '7kmp2qx' } });
    }) as unknown as typeof fetch;
    const publisher = new PublicGamePublisher(
      'https://sparkade.dev/',
      'secret-key',
      'Sparkade Lab',
      { getGame: () => ({ title: 'Moon Moth Mayhem', status: 'ready' }) as never },
      new SseHub(),
      fetchImpl,
      () => ({ specVersion: 1, archetype: 'platformer' }) as GameSpec,
      () => [{ filename: 'platformer-player-idle.png', content: Buffer.from('png') }],
    );

    await expect(publisher.publishExisting('g-one')).resolves.toMatchObject({
      status: 'publishing',
      link: { id: '7kmp2qx' },
    });
    await expect(publisher.publishExisting('g-one')).resolves.toMatchObject({
      status: 'publishing',
    });
    expect(requests.filter((url) => url.endsWith('/api/kiosk/games'))).toHaveLength(1);

    releaseFinalUpdate();
    await vi.waitFor(() => expect(publisher.publicationForGame('g-one')?.status).toBe('published'));
    await expect(publisher.publishExisting('g-one')).resolves.toMatchObject({
      status: 'published',
      link: { id: '7kmp2qx' },
    });
    expect(requests.filter((url) => url.endsWith('/api/kiosk/games'))).toHaveLength(1);
  });

  it('returns a failed background publish to a retryable state', async () => {
    let uploadFails = true;
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/api/kiosk/games')) {
        return response({ game: { id: '7kmp2qx' } }, 201);
      }
      if (url.includes('/assets/')) {
        const filename = url.split('/').at(-1)!;
        return uploadFails
          ? response({ error: 'unavailable' }, 503)
          : response({ filename, url: `https://blob.example/${filename}` });
      }
      return response({ game: { id: '7kmp2qx' } });
    }) as unknown as typeof fetch;
    const publisher = new PublicGamePublisher(
      'https://sparkade.dev/',
      'secret-key',
      'Sparkade Lab',
      { getGame: () => ({ title: 'Moon Moth Mayhem', status: 'ready' }) as never },
      new SseHub(),
      fetchImpl,
      () => ({ specVersion: 1, archetype: 'platformer' }) as GameSpec,
      () => [{ filename: 'platformer-player-idle.png', content: Buffer.from('png') }],
    );
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await publisher.publishExisting('g-one');
    await vi.waitFor(() => expect(publisher.publicationForGame('g-one')?.status).toBe('failed'), {
      timeout: 3_000,
    });

    uploadFails = false;
    await publisher.publishExisting('g-one');
    await vi.waitFor(() => expect(publisher.publicationForGame('g-one')?.status).toBe('published'));
    expect(requests.filter((url) => url.endsWith('/api/kiosk/games'))).toHaveLength(1);
    warning.mockRestore();
  });

  it('maps failures to a retry-safe public message', async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/api/kiosk/games')) {
        return response({ game: { id: '9bcdfgh' } }, 201);
      }
      bodies.push(JSON.parse(String(init?.body)));
      return response({ game: { id: '9bcdfgh' } });
    }) as unknown as typeof fetch;
    const hub = new SseHub();
    const publisher = new PublicGamePublisher(
      'https://sparkade.dev/',
      'secret-key',
      'Sparkade Lab',
      { getGame: () => null },
      hub,
      fetchImpl,
    );
    await publisher.reserveAndTrack('j-one', 'g-one');

    const event: JobEvent = {
      type: 'failed',
      jobId: 'j-one',
      gameId: 'g-one',
      code: 'provider-unavailable',
      message: 'sensitive provider detail',
      stage: 'building-assets',
      elapsedMs: 100,
      costSoFarUsd: 0,
    };
    hub.emit(event);

    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      sourceId: 'g-one',
      status: 'failed',
      stage: 'building-assets',
      message: 'Generation paused. This link will update after a retry.',
    });
  });
});
