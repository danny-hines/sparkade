import { GENERATED_GAME_ASSET_FILES } from '@sparkade/shared';
import type { Metadata } from 'next';
import type { PublicGame } from './public-games';

export const PUBLIC_GAME_SHARE_IMAGE_SIZES = {
  landscape: { width: 1200, height: 630 },
  square: { width: 1200, height: 1200 },
} as const;

export type PublicGameShareImageFormat = keyof typeof PUBLIC_GAME_SHARE_IMAGE_SIZES;

export function isPublicGameShareImageFormat(value: string): value is PublicGameShareImageFormat {
  return value === 'landscape' || value === 'square';
}

export function getPublicGameDisplayTitle(game: Pick<PublicGame, 'id' | 'title'>): string {
  return game.title?.trim() || `Game ${game.id.toUpperCase()}`;
}

export function getPublicGameShareDescription(
  game: Pick<PublicGame, 'id' | 'title' | 'status' | 'message' | 'spec'>,
): string {
  if (game.status !== 'ready') return game.message;
  const tagline = game.spec?.meta.tagline?.trim();
  return tagline || `Play ${getPublicGameDisplayTitle(game)}, made with Sparkade.`;
}

export function getPublicGameKeyArtUrl(game: Pick<PublicGame, 'assets'>): string | null {
  const value = game.assets[GENERATED_GAME_ASSET_FILES.keyArt];
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.blob.vercel-storage.com')
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function getPublicGameShareVersion(game: Pick<PublicGame, 'id' | 'updatedAt'>): string {
  const updatedAt = Date.parse(game.updatedAt);
  return Number.isFinite(updatedAt) ? updatedAt.toString(36) : game.id.toLowerCase();
}

export function getPublicGameSharePath(game: Pick<PublicGame, 'id' | 'updatedAt'>): string {
  return `/p/${game.id}?v=${getPublicGameShareVersion(game)}`;
}

export function getPublicGameShareImagePath(
  game: Pick<PublicGame, 'id' | 'updatedAt'>,
  format: PublicGameShareImageFormat,
): string {
  return `/p/${game.id}/share-image/${format}?v=${getPublicGameShareVersion(game)}`;
}

export function buildPublicGameMetadata(game: PublicGame): Metadata {
  const title = getPublicGameDisplayTitle(game);
  const description = getPublicGameShareDescription(game);
  const canonicalPath = `/p/${game.id}`;
  const isReady = game.status === 'ready';
  const landscapeImage = getPublicGameShareImagePath(game, 'landscape');
  const squareImage = getPublicGameShareImagePath(game, 'square');
  const landscapeAlt = `${title} game preview`;
  const indexable = isReady && game.feedVisibility === 'listed';

  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    manifest: `/p/${game.id}/manifest.webmanifest`,
    robots: { index: indexable, follow: indexable },
    openGraph: {
      type: 'website',
      siteName: 'Sparkade',
      title,
      description,
      url: isReady ? getPublicGameSharePath(game) : canonicalPath,
      images: isReady
        ? [
            {
              url: landscapeImage,
              ...PUBLIC_GAME_SHARE_IMAGE_SIZES.landscape,
              alt: landscapeAlt,
              type: 'image/png',
            },
            {
              url: squareImage,
              ...PUBLIC_GAME_SHARE_IMAGE_SIZES.square,
              alt: landscapeAlt,
              type: 'image/png',
            },
          ]
        : [],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: isReady ? [{ url: landscapeImage, alt: landscapeAlt }] : [],
    },
  };
}
