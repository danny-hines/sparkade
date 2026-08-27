import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { GENERATED_GAME_ASSET_FILES } from '@sparkade/shared';
import {
  GameAssetWorkspace,
  generatedAssetNames,
  imagePromptHash,
  readGameAssetManifest,
} from '../src/assets/manifest';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function png(color = '#aa3377'): Promise<Buffer> {
  return sharp({
    create: { width: 24, height: 12, channels: 4, background: color },
  })
    .png()
    .toBuffer();
}

describe('GameAssetWorkspace', () => {
  it('stores provenance and reuses only an exact, integrity-checked image', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sparkade-assets-'));
    dirs.push(dir);
    const workspace = new GameAssetWorkspace(dir, 'muse-image-1.0');
    const promptHash = imagePromptHash('paint the opening scene', Buffer.from('reference'));
    const image = await png();

    const entry = await workspace.store('storyIntro', image, 'story-scenes-v1', promptHash);

    expect(entry).toMatchObject({
      role: 'storyIntro',
      filename: GENERATED_GAME_ASSET_FILES.storyIntro,
      width: 24,
      height: 12,
      model: 'muse-image-1.0',
      promptVersion: 'story-scenes-v1',
      promptSha256: promptHash,
    });
    expect(workspace.load('storyIntro', 'story-scenes-v1', promptHash)?.equals(image)).toBe(true);
    expect(workspace.load('storyIntro', 'story-scenes-v2', promptHash)).toBeNull();
    expect(generatedAssetNames(dir)).toEqual(new Set([GENERATED_GAME_ASSET_FILES.storyIntro]));
  });

  it('rejects a file modified after its manifest was written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sparkade-assets-'));
    dirs.push(dir);
    const workspace = new GameAssetWorkspace(dir, 'muse-image-1.0');
    const promptHash = imagePromptHash('cover');
    await workspace.store('keyArt', await png('#112233'), 'key-art-v1', promptHash);
    writeFileSync(join(dir, GENERATED_GAME_ASSET_FILES.keyArt), await png('#ffffff'));

    expect(workspace.load('keyArt', 'key-art-v1', promptHash)).toBeNull();
    expect(generatedAssetNames(dir)).toEqual(new Set());
  });

  it('never serves a manifest filename outside the compiled allowlist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sparkade-assets-'));
    dirs.push(dir);
    const workspace = new GameAssetWorkspace(dir, 'muse-image-1.0');
    await workspace.store('keyArt', await png(), 'key-art-v1', imagePromptHash('cover'));
    const manifest = readGameAssetManifest(dir)!;
    manifest.assets[0]!.filename = '../game.json';
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    expect(readFileSync(join(dir, 'manifest.json'), 'utf8')).toContain('../game.json');

    expect(generatedAssetNames(dir).size).toBe(0);
  });
});
