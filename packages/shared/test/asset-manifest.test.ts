import { describe, expect, it } from 'vitest';
import { isForeignGameAsset, knownGameAssets } from '../src/asset-manifest';

const known = {
  role: 'keyArt',
  filename: 'key-art.png',
  mimeType: 'image/png',
  width: 480,
  height: 320,
  model: 'muse-image-1.0',
  promptVersion: 'v1',
  promptSha256: 'a'.repeat(64),
  sha256: 'b'.repeat(64),
};
/** An entry a newer build might add. */
const foreign = { ...known, role: 'futureThing', filename: 'future-thing.png' };

describe('asset manifest validation', () => {
  it('keeps known entries and skips well-formed entries from newer builds', () => {
    expect(isForeignGameAsset(foreign)).toBe(true);
    expect(knownGameAssets([known, foreign])).toEqual([known]);
  });

  it('still rejects malformed, impostor, and duplicate entries', () => {
    // A known role with a bad field is corruption, not a newer build.
    expect(knownGameAssets([{ ...known, sha256: 'nope' }])).toBeNull();
    // An unknown role may not claim a known role's file or escape the folder.
    expect(knownGameAssets([{ ...foreign, filename: 'key-art.png' }])).toBeNull();
    expect(knownGameAssets([{ ...foreign, filename: '../escape.png' }])).toBeNull();
    expect(knownGameAssets([{ ...foreign, sha256: 'x' }])).toBeNull();
    expect(
      knownGameAssets([known, { ...foreign, filename: 'key-art.png', role: 'other' }]),
    ).toBeNull();
    expect(knownGameAssets([foreign, foreign])).toBeNull();
    expect(knownGameAssets('not a list')).toBeNull();
  });
});
