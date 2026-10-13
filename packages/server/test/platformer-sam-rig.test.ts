import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SamResponseCache } from '../src/assets/platformer-sam-rig';

describe('SAM response cache', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const input = { scale: 6, pad: 8, background: 'gray' as const };

  it('calls once per key, reuses identical images across games, and records spend', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'sam-rig-'));
    dirs.push(cacheDir);
    const calls: string[] = [];
    const segment = async (_png: Buffer, concept: string) => {
      calls.push(concept);
      if (concept === 'tail') throw new Error('SAM did not return a completed response');
      return { model: 'sam-3.1', responseId: `r-${calls.length}`, rawOutput: '', masks: [] };
    };
    const png = Buffer.from('frame-a');
    const live = new SamResponseCache({ cacheDir, live: true, segment, maxLiveCalls: 3 });
    const first = await live.get({ game: 'g1', frame: 'walk-1', concept: 'leg', input, png });
    expect(first?.responseId).toBe('r-1');
    expect(
      (await live.get({ game: 'g1', frame: 'walk-1', concept: 'leg', input, png }))?.responseId,
    ).toBe('r-1');
    const twin = await live.get({ game: 'g2', frame: 'walk-1', concept: 'leg', input, png });
    expect(twin?.copiedFrom).toBe(join('g1', 'walk-1', 'leg@x6p8-gray.json'));
    expect(existsSync(join(cacheDir, 'g2', 'walk-1', 'leg@x6p8-gray.json'))).toBe(true);
    const failed = await live.get({ game: 'g1', frame: 'walk-1', concept: 'tail', input, png });
    expect(failed?.error).toMatch('completed');
    expect(calls).toEqual(['leg', 'tail']);
    expect(live.usage).toMatchObject({
      liveCalls: 2,
      failedCalls: 1,
      cacheHits: 1,
      dedupedHits: 1,
    });
    expect(live.usage.estimatedCostUsd).toBeCloseTo(0.005);
    expect(live.ledgerTotals()).toEqual({ calls: 2, failures: 1, estimatedCostUsd: 0.005 });
    expect(readFileSync(join(cacheDir, 'ledger.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2);

    // Offline: cached keys still resolve; new ones are reported missing.
    const offline = new SamResponseCache({ cacheDir, live: false, maxLiveCalls: 0 });
    expect(
      (await offline.get({ game: 'g1', frame: 'walk-1', concept: 'leg', input, png }))?.responseId,
    ).toBe('r-1');
    expect(
      await offline.get({ game: 'g1', frame: 'walk-1', concept: 'arm', input, png }),
    ).toBeNull();
    expect(offline.usage.missing).toBe(1);

    // A changed image under the same key is not served stale, and the live
    // call cap holds.
    const capped = new SamResponseCache({ cacheDir, live: true, segment, maxLiveCalls: 0 });
    expect(
      await capped.get({
        game: 'g1',
        frame: 'walk-1',
        concept: 'leg',
        input,
        png: Buffer.from('frame-b'),
      }),
    ).toBeNull();
    expect(calls).toHaveLength(2);
  });
});
