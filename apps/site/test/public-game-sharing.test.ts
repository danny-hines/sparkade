import { describe, expect, it } from 'vitest';
import type { PublicGame } from '../lib/public-games';
import {
  buildPublicGameMetadata,
  getPublicGameKeyArtUrl,
  getPublicGameShareImagePath,
  getPublicGameSharePath,
  getPublicGameShareVersion,
} from '../lib/public-game-sharing';

function publicGame(overrides: Partial<PublicGame> = {}): PublicGame {
  return {
    id: 'rbrchsx',
    kioskId: null,
    kioskName: 'Sparkade Cabinet',
    feedVisibility: 'listed',
    status: 'ready',
    stage: 'ready',
    message: 'Ready to play',
    title: 'Gilded Knuckle Oath',
    spec: null,
    assets: {
      'key-art.png':
        'https://sparkade.public.blob.vercel-storage.com/public-games/rbrchsx/key-art.png',
    },
    createdAt: '2026-09-02T08:50:00.000Z',
    updatedAt: '2026-09-02T08:54:05.001Z',
    readyAt: '2026-09-02T08:54:05.001Z',
    failedAt: null,
    ...overrides,
  };
}

describe('public game sharing', () => {
  it('builds stable, versioned game and image URLs', () => {
    const game = publicGame();
    const version = Date.parse(game.updatedAt).toString(36);

    expect(getPublicGameShareVersion(game)).toBe(version);
    expect(getPublicGameSharePath(game)).toBe(`/p/rbrchsx?v=${version}`);
    expect(getPublicGameShareImagePath(game, 'landscape')).toBe(
      `/p/rbrchsx/share-image/landscape?v=${version}`,
    );
  });

  it('publishes landscape and square metadata only for ready games', () => {
    const game = publicGame();
    const version = getPublicGameShareVersion(game);
    const metadata = buildPublicGameMetadata(game);

    expect(metadata).toMatchObject({
      title: 'Gilded Knuckle Oath',
      description: 'Play Gilded Knuckle Oath, made with Sparkade.',
      alternates: { canonical: '/p/rbrchsx' },
      openGraph: {
        type: 'website',
        url: `/p/rbrchsx?v=${version}`,
        images: [
          {
            url: `/p/rbrchsx/share-image/landscape?v=${version}`,
            width: 1200,
            height: 630,
          },
          {
            url: `/p/rbrchsx/share-image/square?v=${version}`,
            width: 1200,
            height: 1200,
          },
        ],
      },
      twitter: {
        card: 'summary_large_image',
        images: [{ url: `/p/rbrchsx/share-image/landscape?v=${version}` }],
      },
    });

    const generatingMetadata = buildPublicGameMetadata(
      publicGame({ status: 'generating', stage: 'art', message: 'Painting key art' }),
    );
    expect(generatingMetadata).toMatchObject({
      description: 'Painting key art',
      openGraph: { url: '/p/rbrchsx', images: [] },
      twitter: { images: [] },
    });
  });

  it('only accepts public Vercel Blob key art URLs', () => {
    expect(getPublicGameKeyArtUrl(publicGame())).toContain('.blob.vercel-storage.com/');
    expect(
      getPublicGameKeyArtUrl(
        publicGame({ assets: { 'key-art.png': 'https://example.com/private/key-art.png' } }),
      ),
    ).toBeNull();
    expect(getPublicGameKeyArtUrl(publicGame({ assets: {} }))).toBeNull();
  });
});
