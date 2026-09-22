import { describe, expect, it, vi } from 'vitest';
import { JobState } from '@sparkade/server/pipeline/job-state';
import type { PassCheckpoint } from '@sparkade/server/pipeline/durable-pass';
import {
  readCheckpoint,
  readCheckpointFile,
  writeCheckpoint,
  type StoredCheckpoint,
} from '../lib/generation/checkpoints';

const storage = vi.hoisted(() => ({
  blobs: new Map<string, unknown>(),
  reads: [] as string[],
  writes: [] as string[],
}));
vi.mock('../lib/generation/storage', () => ({
  readPrivate: async (url: string) => {
    storage.reads.push(url);
    if (!storage.blobs.has(url)) throw new Error('Unavailable blob');
    return structuredClone(storage.blobs.get(url));
  },
  writePrivate: async (url: string, value: unknown) => {
    storage.writes.push(url);
    storage.blobs.set(url, structuredClone(value));
    return url;
  },
}));

const checkpoint = (files: Record<string, string>): PassCheckpoint => ({
  state: new JobState().state,
  files,
});
const image = (text: string) => Buffer.from(text.repeat(30_000)).toString('base64');

describe('incremental generation checkpoints', () => {
  it('reads legacy snapshots and reuses immutable files through resume, rename and deletion', async () => {
    const first = checkpoint({
      'staging/job/a.png': image('a'),
      'staging/job/b.png': image('b'),
      'partial.json': 'e30=',
    });
    storage.blobs.set('legacy', first);
    expect(await readCheckpoint('legacy')).toEqual(first);
    expect(await readCheckpointFile(first, 'partial.json')).toBe('e30=');
    const saved = await writeCheckpoint('job/checkpoints/1.json', first);
    const stored = storage.blobs.get(saved.url) as StoredCheckpoint;
    expect(stored.files).toEqual({ 'partial.json': 'e30=' });
    expect(Object.keys(stored.fileRefs!)).toHaveLength(2);
    const restored = await readCheckpoint(saved.url);
    expect(restored.files).toEqual(first.files);
    const second = await writeCheckpoint('job/checkpoints/2.json', restored, restored);
    expect(second.metrics.newPacks).toBe(0);
    expect(second.metrics.reusedBytes).toBe(60_000);
    expect(second.metrics.uploadedBytes).toBeLessThan(saved.metrics.uploadedBytes / 10);
    const moved = checkpoint({
      'games/game/a.png': first.files['staging/job/a.png']!,
      'partial.json': 'e30=',
    });
    const third = await writeCheckpoint('job/checkpoints/3.json', moved, restored);
    expect(third.metrics.newPacks).toBe(0);
    expect((await readCheckpoint(third.url)).files).toEqual(moved.files);
    const changed = checkpoint({ ...moved.files, 'games/game/a.png': image('c') });
    const fourth = await writeCheckpoint(
      'job/checkpoints/4.json',
      changed,
      await readCheckpoint(third.url),
    );
    expect(fourth.metrics.newPacks).toBe(1);
    expect((await readCheckpoint(fourth.url)).files).toEqual(changed.files);
    expect((await readCheckpoint(saved.url)).files).toEqual(first.files);
  });

  it('loads only the requested image pack for previews, with checksum validation on cold reads', async () => {
    const saved = await writeCheckpoint(
      'preview/checkpoints/1.json',
      checkpoint({
        'a.png': image('abc'.repeat(40)),
        'b.png': image('xyz'.repeat(40)),
      }),
    );
    expect(saved.metrics.newPacks).toBe(2);
    const stored = storage.blobs.get(saved.url) as StoredCheckpoint;
    // A fresh server instance has no in-memory pack cache.
    vi.resetModules();
    const cold = await import('../lib/generation/checkpoints');
    storage.reads.length = 0;
    expect(await cold.readCheckpointFile(stored, 'a.png')).toEqual(image('abc'.repeat(40)));
    expect(storage.reads).toEqual([stored.fileRefs!['a.png']!.pack]);
    expect(await cold.readCheckpointFile(stored, 'missing.png')).toBeUndefined();
    expect((await cold.readCheckpoint(saved.url)).files['b.png']).toEqual(image('xyz'.repeat(40)));
  });

  it('propagates missing or corrupt file packs and permits a later storage retry', async () => {
    const saved = await writeCheckpoint(
      'integrity/checkpoints/1.json',
      checkpoint({ 'a.png': image('d') }),
    );
    const stored = structuredClone(storage.blobs.get(saved.url)) as StoredCheckpoint;
    const ref = stored.fileRefs!['a.png']!;
    const original = storage.blobs.get(ref.pack);
    ref.pack = 'uncached-pack';
    storage.blobs.set('integrity/checkpoints/corrupt.json', stored);
    await expect(readCheckpoint('integrity/checkpoints/corrupt.json')).rejects.toThrow(
      'Unavailable',
    );
    storage.blobs.set(ref.pack, { [ref.sha256]: 'tampered' });
    await expect(readCheckpoint('integrity/checkpoints/corrupt.json')).rejects.toThrow('integrity');
    storage.blobs.set(ref.pack, original);
    expect((await readCheckpoint('integrity/checkpoints/corrupt.json')).files['a.png']).toEqual(
      image('d'),
    );
  });
});
