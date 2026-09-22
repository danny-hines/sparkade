import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ArtifactCache } from '../src/pipeline/artifact-cache';
import { PipelineSuspended } from '../src/pipeline/durable';
import { settleAll } from '../src/pipeline/parallel';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

it('restores processed buffers across passes and recomputes changed identities', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sparkade-artifact-cache-'));
  dirs.push(dir);
  const compute = vi.fn(async () => ({
    reference: Buffer.from('raw'),
    png: Buffer.from('sprite'),
  }));
  await new ArtifactCache(dir).getOrCompute('identity-a-v1', compute);
  const restored = await new ArtifactCache(dir).getOrCompute('identity-a-v1', compute);
  expect(Buffer.isBuffer(restored.png)).toBe(true);
  expect(restored.png.toString()).toBe('sprite');
  expect(compute).toHaveBeenCalledOnce();
  await new ArtifactCache(dir).getOrCompute('identity-b-v1', compute);
  expect(compute).toHaveBeenCalledTimes(2);
});

it('does not cache suspended computations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sparkade-artifact-cache-'));
  dirs.push(dir);
  const cache = new ArtifactCache(dir);
  await expect(
    cache.getOrCompute('pending', async () => {
      throw new PipelineSuspended();
    }),
  ).rejects.toThrow(PipelineSuspended);
  expect(await cache.getOrCompute('pending', async () => Buffer.from('finished'))).toEqual(
    Buffer.from('finished'),
  );
});

it('drains a slower processing branch before propagating suspension', async () => {
  let finish!: () => void;
  let drained = false;
  const sibling = new Promise<void>((resolve) => {
    finish = resolve;
  }).then(() => {
    drained = true;
  });
  const result = settleAll([Promise.reject(new PipelineSuspended()), sibling]);
  let returned = false;
  void result.catch(() => {
    returned = true;
  });
  await Promise.resolve();
  expect(returned).toBe(false);
  finish();
  await expect(result).rejects.toThrow(PipelineSuspended);
  expect(drained).toBe(true);
});
