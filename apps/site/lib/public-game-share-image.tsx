import { ImageResponse } from 'next/og';
import React from 'react';
import {
  PUBLIC_GAME_SHARE_IMAGE_SIZES,
  type PublicGameShareImageFormat,
} from './public-game-sharing';

type PublicGameShareImageInput = {
  format: PublicGameShareImageFormat;
  gameId: string;
  keyArtUrl: string | null;
  title: string;
};

function imageTitle(title: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim();
  return normalized.length > 68 ? `${normalized.slice(0, 67).trimEnd()}…` : normalized;
}

function titleSize(title: string, format: PublicGameShareImageFormat): number {
  if (format === 'square') {
    if (title.length > 48) return 58;
    if (title.length > 30) return 70;
    return 84;
  }
  if (title.length > 48) return 42;
  if (title.length > 30) return 50;
  return 62;
}

function KeyArt({
  alt,
  format,
  url,
}: {
  alt: string;
  format: PublicGameShareImageFormat;
  url: string;
}) {
  const square = format === 'square';
  return (
    <img
      alt={alt}
      height={675}
      src={url}
      width={1200}
      style={{
        position: 'absolute',
        top: square ? 0 : -22.5,
        left: 0,
        width: 1200,
        height: 675,
        objectFit: 'cover',
        imageRendering: 'pixelated',
      }}
    />
  );
}

function BrandLabel() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        color: '#f4f5ff',
        fontSize: 25,
        fontWeight: 800,
        letterSpacing: 5,
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          display: 'flex',
          border: '3px solid #38e5ff',
          transform: 'rotate(45deg)',
        }}
      />
      SPARKADE
    </div>
  );
}

function LandscapeImage({ gameId, keyArtUrl, title }: Omit<PublicGameShareImageInput, 'format'>) {
  const displayTitle = imageTitle(title);
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        overflow: 'hidden',
        color: '#f4f5ff',
        background: 'linear-gradient(135deg, #07101f, #111833 58%, #07101f)',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      {keyArtUrl ? <KeyArt alt="" format="landscape" url={keyArtUrl} /> : null}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 1200,
          height: 630,
          display: 'flex',
          background:
            'linear-gradient(180deg, rgba(7,9,18,.48), rgba(7,9,18,.05) 38%, rgba(7,9,18,.84) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 32,
          bottom: 30,
          left: 285,
          width: 630,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <BrandLabel />
        <div
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '24px 30px 22px',
            border: '1px solid rgba(255,255,255,.18)',
            borderRadius: 18,
            background: 'rgba(7,9,18,.76)',
          }}
        >
          <div
            style={{
              display: 'flex',
              color: '#38e5ff',
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: 'uppercase',
            }}
          >
            Game {gameId.toUpperCase()}
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 12,
              color: '#ffffff',
              fontSize: titleSize(displayTitle, 'landscape'),
              fontWeight: 900,
              letterSpacing: -2,
              lineHeight: 1.02,
              textAlign: 'center',
            }}
          >
            {displayTitle}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            color: '#ffad4d',
            fontSize: 19,
            fontWeight: 800,
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}
        >
          Ready to play
        </div>
      </div>
    </div>
  );
}

function SquareImage({ gameId, keyArtUrl, title }: Omit<PublicGameShareImageInput, 'format'>) {
  const displayTitle = imageTitle(title);
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: '#f4f5ff',
        background: 'linear-gradient(145deg, #07101f, #111833 55%, #070912)',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 1200,
          height: 675,
          display: 'flex',
          flex: '0 0 675px',
          overflow: 'hidden',
          background: '#070912',
        }}
      >
        {keyArtUrl ? <KeyArt alt="" format="square" url={keyArtUrl} /> : null}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 1200,
            height: 675,
            display: 'flex',
            background: 'linear-gradient(180deg, rgba(7,9,18,.12), rgba(7,9,18,0) 72%, #0b1021)',
          }}
        />
      </div>
      <div
        style={{
          width: 1200,
          height: 525,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '52px 86px 58px',
          borderTop: '4px solid #38e5ff',
        }}
      >
        <BrandLabel />
        <div
          style={{
            display: 'flex',
            marginTop: 34,
            color: '#ffffff',
            fontSize: titleSize(displayTitle, 'square'),
            fontWeight: 900,
            letterSpacing: -2,
            lineHeight: 1.02,
            textAlign: 'center',
          }}
        >
          {displayTitle}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 28,
            color: '#ffad4d',
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: 3,
            textTransform: 'uppercase',
          }}
        >
          Game {gameId.toUpperCase()} · Ready to play
        </div>
      </div>
    </div>
  );
}

export function renderPublicGameShareImage(input: PublicGameShareImageInput): ImageResponse {
  const size = PUBLIC_GAME_SHARE_IMAGE_SIZES[input.format];
  const image =
    input.format === 'square' ? (
      <SquareImage gameId={input.gameId} keyArtUrl={input.keyArtUrl} title={input.title} />
    ) : (
      <LandscapeImage gameId={input.gameId} keyArtUrl={input.keyArtUrl} title={input.title} />
    );

  return new ImageResponse(image, {
    ...size,
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
