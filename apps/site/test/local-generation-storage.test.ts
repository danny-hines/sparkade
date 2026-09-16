import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  localStorageRoot,
  writeLocal,
  readLocal,
  cleanLocal,
} from '../lib/generation/local-storage';
afterEach(() => vi.unstubAllEnvs());
describe('explicit local mock storage', () => {
  it('cannot silently replace real provider storage', () => {
    vi.stubEnv('SPARKADE_LOCAL_GENERATION_STORAGE_DIR', '/tmp/test-local');
    vi.stubEnv('SPARKADE_PROVIDER', 'meta');
    expect(() => localStorageRoot()).toThrow('mock provider');
  });
  it('round trips checkpoints, rejects path traversal, and retains final versions during cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sparkade-storage-test-'));
    try {
      const key = await writeLocal(root, 'job/checkpoint.json', { value: 7 });
      expect(await readLocal(root, key)).toEqual({ value: 7 });
      await writeLocal(root, 'job/final/version.json', { approved: true });
      await expect(writeLocal(root, '../outside.json', {})).rejects.toThrow('Invalid');
      await expect(readLocal(root, 'https://example.com/blob')).rejects.toThrow('Invalid');
      await cleanLocal(root, 'job');
      expect(await readLocal(root, key)).toBeNull();
      expect(await readLocal(root, 'job/final/version.json')).toEqual({ approved: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
