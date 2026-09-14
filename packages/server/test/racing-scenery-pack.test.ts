import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import type { RacingSpec } from '@sparkade/shared';
import { GameAssetWorkspace, readGameAssetManifest } from '../src/assets/manifest';
import { mockGeneratedImage } from '../src/assets/game-art';
import {
  generateRacingSceneryPack,
  racingSceneryObjectPrompts,
} from '../src/assets/racing-scenery-pack';
import { processGeneratedRacingPanorama } from '../src/assets/racing-scenery';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const spec = {
  palette: ['#ff8833', '#554488'],
  identity: {
    worldConcept: 'Clockwork bakery',
    artDirection: 'copper and cream',
    boost: { mode: 'pickups', displayName: 'Sugar stars', appearanceConcept: 'one pink star' },
  },
} as RacingSpec;

it('checkpoints each object, drains a failed slot, and retries only that slot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'racing-objects-'));
  roots.push(dir);
  const workspace = new GameAssetWorkspace(dir, 'test-model');
  const reference = Buffer.from('world-reference');
  const calls = Array<number>(6).fill(0);
  let broken = true;
  let lastSettled = false;
  const run = () =>
    generateRacingSceneryPack({
      spec,
      workspace,
      reference,
      async generate(prompt, slot) {
        calls[slot] = calls[slot]! + 1;
        if (slot === 5) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          lastSettled = true;
        }
        if (slot === 2 && broken) return Buffer.from('invalid image');
        return mockGeneratedImage(prompt);
      },
      checkActive() {},
      validationFailure() {},
    });
  await expect(run()).rejects.toThrow();
  expect(lastSettled).toBe(true);
  expect(workspace.load('racingSceneryAtlas', 'bad', 'bad')).toBeNull();
  broken = false;
  const atlas = await run();
  expect(calls).toEqual([1, 1, 3, 1, 1, 1]);
  expect(await sharp(atlas).metadata()).toMatchObject({ width: 288, height: 192 });
  expect(readGameAssetManifest(dir)!.assets.map((a) => a.role)).toEqual(['racingSceneryAtlas']);
  await run();
  expect(calls).toEqual([1, 1, 3, 1, 1, 1]);
});

it('keeps the collectible premise in exactly its own slot', () => {
  const prompts = racingSceneryObjectPrompts(spec);
  expect(prompts).toHaveLength(6);
  expect(prompts[5]).toContain('one pink star');
  expect(prompts.slice(0, 5).every((p) => !p.includes('one pink star'))).toBe(true);
});

it('preserves the horizon-bearing bottom of a provider panorama', async () => {
  const raw = await sharp({
    create: { width: 1024, height: 512, channels: 3, background: '#123456' },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 1024, height: 100, channels: 3, background: '#ff6600' },
        })
          .png()
          .toBuffer(),
        left: 0,
        top: 412,
      },
    ])
    .png()
    .toBuffer();
  const image = await processGeneratedRacingPanorama(raw);
  const bottom = await sharp(image)
    .extract({ left: 700, top: 479, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect([...bottom]).toEqual([255, 102, 0]);
});
