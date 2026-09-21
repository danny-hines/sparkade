import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ game: vi.fn(), top: vi.fn(), add: vi.fn(), limit: vi.fn() }));
vi.mock('../lib/public-games', () => ({ getPublicGame: mocks.game }));
vi.mock('../lib/scores', () => ({ topScores: mocks.top, addScore: mocks.add }));
vi.mock('../lib/invites', () => ({ resolveCreditEnvironment: () => 'test' }));
vi.mock('../lib/signup', () => ({
  limitSignupRequests: mocks.limit,
  SignupRateLimitError: class extends Error {},
}));
import { GET, POST } from '../app/api/games/[id]/scores/route';
import { SignupRateLimitError } from '../lib/signup';

const url = 'https://sparkade.dev/api/games/7kmp2qx/scores';
const context = { params: Promise.resolve({ id: '7KMP2QX' }) };
const scores = [{ initials: 'ABC', score: 12345, at: '2026-09-20T00:00:00.000Z' }];
const request = (body: unknown, origin = 'https://sparkade.dev') =>
  new Request(url, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.game.mockResolvedValue({ id: '7kmp2qx', status: 'ready' });
  mocks.top.mockResolvedValue(scores);
  mocks.add.mockResolvedValue(scores);
});

describe('public high scores', () => {
  it('allows visitors to read fresh scores using the canonical game ID', async () => {
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(scores);
    expect(mocks.top).toHaveBeenCalledWith('7kmp2qx');
  });

  it('returns an empty leaderboard for a game nobody has scored in', async () => {
    mocks.top.mockResolvedValue([]);
    expect(await (await GET(new Request(url), context)).json()).toEqual([]);
  });

  it.each([null, { id: '7kmp2qx', status: 'generating' }])(
    'does not expose or accept scores for unavailable games (%j)',
    async (game) => {
      mocks.game.mockResolvedValue(game);
      expect((await GET(new Request(url), context)).status).toBe(404);
      expect((await POST(request({ initials: 'ABC', score: 12345 }), context)).status).toBe(404);
      expect(mocks.top).not.toHaveBeenCalled();
      expect(mocks.add).not.toHaveBeenCalled();
    },
  );

  it('persists valid guest scores and returns the updated board', async () => {
    const response = await POST(request({ initials: 'ab.', score: 12345 }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(scores);
    expect(mocks.add).toHaveBeenCalledWith('7kmp2qx', 'AB.', 12345);
    expect(mocks.limit).toHaveBeenCalledWith(expect.any(String), false, 'test:scores');
  });

  it.each([
    null,
    {},
    { initials: 'AB', score: 100 },
    { initials: '<!>', score: 100 },
    { initials: 'ABC', score: -1 },
    { initials: 'ABC', score: 1.5 },
    { initials: 'ABC', score: '100' },
    { initials: 'ABC', score: 100_000_000 },
  ])('rejects invalid submissions (%j)', async (body) => {
    expect((await POST(request(body), context)).status).toBe(400);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON, oversized requests, and cross-origin submissions', async () => {
    expect(
      (
        await POST(
          new Request(url, {
            method: 'POST',
            headers: { origin: 'https://sparkade.dev' },
            body: '{',
          }),
          context,
        )
      ).status,
    ).toBe(400);
    expect((await POST(request({ initials: 'A'.repeat(1024), score: 1 }), context)).status).toBe(
      413,
    );
    expect(
      (await POST(request({ initials: 'ABC', score: 1 }, 'https://elsewhere.test'), context))
        .status,
    ).toBe(403);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('distinguishes rate limits from storage outages', async () => {
    mocks.limit.mockRejectedValueOnce(new SignupRateLimitError('Too many scores'));
    expect((await POST(request({ initials: 'ABC', score: 1 }), context)).status).toBe(429);
    expect(mocks.add).not.toHaveBeenCalled();
    mocks.add.mockRejectedValueOnce(new Error('Offline'));
    expect((await POST(request({ initials: 'ABC', score: 1 }), context)).status).toBe(503);
  });
});
