import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameDetail } from '../src/api';
import { loadLikenessAssets } from '../src/likeness-assets';

const requested: string[] = [];

class FakeImage {
  onload: ((event: Event) => void) | null = null;
  onerror: ((event: Event | string) => void) | null = null;
  private value = '';

  get src(): string {
    return this.value;
  }

  set src(value: string) {
    this.value = value;
    requested.push(value);
    queueMicrotask(() => this.onload?.(new Event('load')));
  }
}

const legacyAssets: GameDetail['assets'] = {
  head12: true,
  head12Side: false,
  head12Back: false,
  head16: true,
  head16Side: false,
  head16Back: false,
  portrait: true,
};

describe('loadLikenessAssets', () => {
  beforeEach(() => {
    requested.length = 0;
    vi.stubGlobal('Image', FakeImage);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('loads legacy front assets without requesting missing directional files', async () => {
    const result = await loadLikenessAssets('old-game', legacyAssets);

    expect(result).not.toBeNull();
    expect(result?.head12Side).toBeNull();
    expect(result?.head16Back).toBeNull();
    expect(requested).toEqual([
      '/api/games/old-game/assets/head12.png',
      '/api/games/old-game/assets/head16.png',
      '/api/games/old-game/assets/portrait.png',
    ]);
  });

  it('loads every available directional view under its stable filename', async () => {
    await loadLikenessAssets('new-game', {
      ...legacyAssets,
      head12Side: true,
      head12Back: true,
      head16Side: true,
      head16Back: true,
    });

    expect(requested).toEqual([
      '/api/games/new-game/assets/head12.png',
      '/api/games/new-game/assets/head12-side.png',
      '/api/games/new-game/assets/head12-back.png',
      '/api/games/new-game/assets/head16.png',
      '/api/games/new-game/assets/head16-side.png',
      '/api/games/new-game/assets/head16-back.png',
      '/api/games/new-game/assets/portrait.png',
    ]);
  });
});
