import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  sql: vi.fn(),
}));

vi.mock('../lib/db', () => ({
  getSql: () => database.sql,
}));

import {
  decodePublicGameFeedCursor,
  encodePublicGameFeedCursor,
  listRecentPublicGames,
} from '../lib/public-games';

describe('public game feed', () => {
  beforeAll(() => {
    database.sql.mockImplementation(async (strings: TemplateStringsArray) => {
      const query = strings.join('?');
      return query.includes('FROM public_games') ? database.rows : [];
    });
  });

  beforeEach(() => {
    database.rows = [];
    database.sql.mockClear();
  });

  it('round-trips valid cursors and rejects malformed input', () => {
    const cursor = { readyAt: '2026-09-02T08:54:05.001Z', id: 'rbrchsx' };
    expect(decodePublicGameFeedCursor(encodePublicGameFeedCursor(cursor))).toEqual(cursor);
    expect(decodePublicGameFeedCursor('not-a-cursor')).toBeNull();
    expect(decodePublicGameFeedCursor('x'.repeat(257))).toBeNull();
  });

  it('returns only the requested page and creates a cursor from its final game', async () => {
    database.rows = [
      {
        id: 'rbrchsx',
        kiosk_name: 'Meta SEA',
        title: 'Gilded Knuckle Oath',
        archetype: 'fighter',
        key_art_url: 'https://assets.public.blob.vercel-storage.com/key-art.png',
        ready_at: '2026-09-02T08:54:05.001Z',
      },
      {
        id: 'dp7js5d',
        kiosk_name: 'Meta Connect 2026 Kiosk #1',
        title: 'Atlas of Hollow Stars',
        archetype: 'adventure',
        key_art_url: 'https://assets.public.blob.vercel-storage.com/atlas.png',
        ready_at: '2026-09-02T04:18:07.569Z',
      },
      {
        id: '9bcdfgh',
        kiosk_name: 'Sparkade Cabinet',
        title: 'Older Game',
        archetype: 'platformer',
        key_art_url: null,
        ready_at: '2026-09-01T22:00:00.000Z',
      },
    ];

    const page = await listRecentPublicGames({ limit: 2 });

    expect(page.games.map((game) => game.id)).toEqual(['rbrchsx', 'dp7js5d']);
    expect(decodePublicGameFeedCursor(page.nextCursor ?? undefined)).toEqual({
      readyAt: '2026-09-02T04:18:07.569Z',
      id: 'dp7js5d',
    });
    const feedCall = database.sql.mock.calls.find(([strings]) =>
      (strings as TemplateStringsArray).join('?').includes('FROM public_games'),
    );
    expect((feedCall?.[0] as TemplateStringsArray).join('?')).toContain("WHERE status = 'ready'");
    expect((feedCall?.[0] as TemplateStringsArray).join('?')).toContain(
      'ORDER BY ready_at DESC, id DESC',
    );
    expect(feedCall?.slice(1)).toEqual(['key-art.png', 3]);
  });

  it('uses the cursor as a keyset boundary and sanitizes untrusted asset URLs', async () => {
    const after = encodePublicGameFeedCursor({
      readyAt: '2026-09-02T04:18:07.569Z',
      id: 'dp7js5d',
    });
    database.rows = [
      {
        id: '9bcdfgh',
        kiosk_name: 'Sparkade Cabinet',
        title: null,
        archetype: 'platformer',
        key_art_url: 'https://example.com/not-public.png',
        ready_at: new Date('2026-09-01T22:00:00.000Z'),
      },
    ];

    const page = await listRecentPublicGames({ after, limit: 12 });

    expect(page.games[0]).toMatchObject({
      id: '9bcdfgh',
      title: 'Game 9BCDFGH',
      keyArtUrl: null,
    });
    expect(page.nextCursor).toBeNull();
    const feedCall = database.sql.mock.calls.at(-1);
    expect((feedCall?.[0] as TemplateStringsArray).join('?')).toContain(
      '(ready_at, id) < (?::timestamptz, ?)',
    );
    expect(feedCall?.slice(1)).toEqual(['key-art.png', '2026-09-02T04:18:07.569Z', 'dp7js5d', 13]);
  });
});
