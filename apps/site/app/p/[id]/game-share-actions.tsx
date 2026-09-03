'use client';

import { useEffect, useState } from 'react';
import type { PublicGame } from '@/lib/public-games';
import {
  getPublicGameDisplayTitle,
  getPublicGameShareDescription,
  getPublicGameSharePath,
} from '@/lib/public-game-sharing';

type CopyState = 'idle' | 'copied' | 'failed';

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Copy command was rejected');
}

export function GameShareActions({ game }: { game: PublicGame }) {
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>('idle');

  useEffect(() => {
    setCanNativeShare(typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timeout = window.setTimeout(() => setCopyState('idle'), 2600);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  const shareUrl = () => new URL(getPublicGameSharePath(game), window.location.origin).toString();

  const copyShareLink = async () => {
    try {
      await copyText(shareUrl());
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const shareGame = async () => {
    try {
      await navigator.share({
        title: getPublicGameDisplayTitle(game),
        text: getPublicGameShareDescription(game),
        url: shareUrl(),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      await copyShareLink();
    }
  };

  return (
    <div className="portal-share" aria-label="Share this game">
      <span className="portal-share-label">Share this game</span>
      <div className="portal-share-actions">
        {canNativeShare ? (
          <button
            className="portal-share-button portal-share-button-primary"
            onClick={shareGame}
            type="button"
          >
            Share
          </button>
        ) : null}
        <button className="portal-share-button" onClick={copyShareLink} type="button">
          Copy link
        </button>
      </div>
      <span className="portal-share-feedback" role="status">
        {copyState === 'copied'
          ? 'Versioned link copied.'
          : copyState === 'failed'
            ? 'Could not copy automatically.'
            : ''}
      </span>
    </div>
  );
}
