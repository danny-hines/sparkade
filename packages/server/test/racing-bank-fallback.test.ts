import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import { RacingBankFallbackStore } from '../src/assets/racing-bank-fallback';
import { GeneratedAssetStorageError, imagePromptHash } from '../src/assets/manifest';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const root = () => {
  const path = mkdtempSync(join(tmpdir(), 'racing-bank-fallback-'));
  roots.push(path);
  return path;
};

it('persists the refusal before approval, then restores the exact neutral across instances', async () => {
  const dir = root(),
    key = imagePromptHash('rival1');
  const store = new RacingBankFallbackStore(dir);
  const neutral = await sharp({
    create: { width: 64, height: 64, channels: 4, background: '#113355' },
  })
    .png()
    .toBuffer();
  await store.recordRefusal(key, 'provider policy refusal');
  expect((await new RacingBankFallbackStore(dir).load(key))?.neutral).toBeUndefined();
  await store.approveNeutral(key, neutral);
  await store.recordRefusal(key, 'second concurrent refusal');
  expect((await new RacingBankFallbackStore(dir).load(key))?.neutral).toEqual(neutral);
  expect(await store.load(imagePromptHash('different roster concept'))).toBeNull();
});

it('does not turn corrupt checkpoints or invalid neutral images into a repeat request', async () => {
  const dir = root(),
    key = imagePromptHash('rival2');
  const store = new RacingBankFallbackStore(dir);
  await store.recordRefusal(key, 'refused');
  await expect(store.approveNeutral(key, Buffer.from('bad PNG'))).rejects.toBeInstanceOf(
    GeneratedAssetStorageError,
  );
  writeFileSync(join(dir, `${key}.json`), '{broken');
  await expect(store.load(key)).rejects.toBeInstanceOf(GeneratedAssetStorageError);
  await expect(store.recordRefusal(key, 'refused again')).rejects.toBeInstanceOf(
    GeneratedAssetStorageError,
  );
});
