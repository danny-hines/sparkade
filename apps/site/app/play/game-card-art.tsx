'use client';

import Image from 'next/image';
import { useState } from 'react';

export function GameCardArt({
  src,
  title,
  preload,
}: {
  src: string | null;
  title: string;
  preload: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="arcade-card-placeholder" aria-label={`${title} artwork unavailable`}>
        <span aria-hidden="true">✦</span>
        <strong>Insert imagination</strong>
      </div>
    );
  }

  return (
    <Image
      className="arcade-card-image"
      src={src}
      unoptimized={src.startsWith('/api/games/')}
      alt={`${title} key art`}
      fill
      sizes="(max-width: 720px) calc(100vw - 30px), (max-width: 1080px) 50vw, 380px"
      preload={preload}
      onError={() => setFailed(true)}
    />
  );
}
