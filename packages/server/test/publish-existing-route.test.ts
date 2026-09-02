import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicGamePublication } from '@sparkade/shared';
import { registerRoutes } from '../src/api/routes';

const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  while (apps.length) await apps.pop()?.close();
});

function harness(options: {
  status?: 'ready' | 'generating';
  golden?: boolean;
  publication?: PublicGamePublication;
  configured?: boolean;
}) {
  const app = Fastify();
  apps.push(app);
  const publishExisting = vi.fn(async () =>
    Promise.resolve(
      options.publication ?? {
        status: 'publishing' as const,
        link: { id: '7kmp2qx', url: 'https://sparkade.dev/p/7kmp2qx' },
      },
    ),
  );
  registerRoutes(app, {
    db: {
      getGame: (id: string) =>
        id === 'game-1'
          ? {
              id,
              title: 'Moon Moth Mayhem',
              status: options.status ?? 'ready',
              golden: options.golden ?? false,
            }
          : null,
    } as never,
    files: {} as never,
    configStore: {} as never,
    runner: {} as never,
    hub: {} as never,
    publicGames: options.configured === false ? null : ({ publishExisting } as never),
    version: 'test',
    instanceId: 'test-instance',
    port: 0,
  });
  return { app, publishExisting };
}

describe('publish existing game route', () => {
  it('starts a background publish for a ready player-created game', async () => {
    const { app, publishExisting } = harness({});

    const response = await app.inject({ method: 'POST', url: '/api/games/game-1/publish' });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      publication: { status: 'publishing', link: { id: '7kmp2qx' } },
    });
    expect(publishExisting).toHaveBeenCalledWith('game-1');
  });

  it('returns an already-published game without starting a duplicate URL', async () => {
    const publication: PublicGamePublication = {
      status: 'published',
      link: { id: '7kmp2qx', url: 'https://sparkade.dev/p/7kmp2qx' },
    };
    const { app } = harness({ publication });

    const response = await app.inject({ method: 'POST', url: '/api/games/game-1/publish' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ publication });
  });

  it('rejects built-in, unfinished, and unconfigured publishing attempts', async () => {
    const builtIn = harness({ golden: true });
    const unfinished = harness({ status: 'generating' });
    const unconfigured = harness({ configured: false });

    const responses = await Promise.all([
      builtIn.app.inject({ method: 'POST', url: '/api/games/game-1/publish' }),
      unfinished.app.inject({ method: 'POST', url: '/api/games/game-1/publish' }),
      unconfigured.app.inject({ method: 'POST', url: '/api/games/game-1/publish' }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([409, 409, 503]);
  });
});
