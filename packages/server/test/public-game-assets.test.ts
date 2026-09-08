import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  preparePublicGameAsset,
  PUBLIC_GAME_ASSET_MAX_BYTES,
} from '../src/cloud/public-game-assets';

describe('public game upload copies', () => {
  it('losslessly compresses large PNGs below the upload cap without changing pixels or local bytes', async () => {
    const content = await sharp({
      create: { width: 1536, height: 1024, channels: 4, background: '#22aa66ff' },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(content.length).toBeGreaterThan(PUBLIC_GAME_ASSET_MAX_BYTES);
    const before = Buffer.from(content);
    const asset = { filename: 'platformer-backdrop-level-1.png', content };
    const ready = await preparePublicGameAsset(asset);
    expect(ready.content.length).toBeLessThan(PUBLIC_GAME_ASSET_MAX_BYTES);
    expect(await sharp(ready.content).raw().toBuffer()).toEqual(
      await sharp(content).raw().toBuffer(),
    );
    expect(content).toEqual(before);
    expect(ready.filename).toBe(asset.filename);
  });
  it('keeps small accepted sprites byte-identical', async () => {
    const asset = {
      filename: 'platformer-player-wall-shoot.png',
      content: Buffer.from('already small'),
    };
    expect(await preparePublicGameAsset(asset)).toBe(asset);
  });
});
