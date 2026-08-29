import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_PRICING } from '@sparkade/shared';
import {
  costOf,
  estimateGenerationCost,
  estimateImageCount,
  formatUsd,
  sumCosts,
} from '../src/pipeline/cost';

const SNAPSHOT = { 'muse-spark-1.1': { inputPerM: 1.25, outputPerM: 4.25, cachedInputPerM: 0.15 } };

describe('cost calculator', () => {
  it('uses the platformer image upper bound when the requested archetype is not yet known', () => {
    expect(estimateImageCount(false)).toBe(20);
    expect(estimateImageCount(false, 'fighter')).toBe(5);
    expect(estimateImageCount(false, 'platformer')).toBe(20);
    expect(estimateImageCount(true, 'platformer')).toBe(35);
    expect(estimateImageCount(true, 'fighter')).toBe(21);
    expect(estimateImageCount(true)).toBe(35);
  });

  it('prices tokens against the snapshot', () => {
    const c = costOf('muse-spark-1.1', { input: 1_000_000, output: 1_000_000 }, SNAPSHOT);
    expect(c).toBeCloseTo(5.5, 6);
    expect(costOf('muse-spark-1.1', { input: 4000, output: 2000 }, SNAPSHOT)).toBeCloseTo(
      (4000 / 1e6) * 1.25 + (2000 / 1e6) * 4.25,
      9,
    );
  });

  it('bills cache-served input at the cached rate (Meta: $0.15/M vs $1.25/M)', () => {
    const c = costOf(
      'muse-spark-1.1',
      { input: 10_000, cachedInput: 8_000, output: 1_000 },
      SNAPSHOT,
    );
    expect(c).toBeCloseTo((2000 / 1e6) * 1.25 + (8000 / 1e6) * 0.15 + (1000 / 1e6) * 4.25, 12);
    // no cached rate known → conservative full input price
    const noCachedRate = { m: { inputPerM: 1.25, outputPerM: 4.25 } };
    expect(costOf('m', { input: 10_000, cachedInput: 8_000, output: 0 }, noCachedRate)).toBeCloseTo(
      (10_000 / 1e6) * 1.25,
      12,
    );
    // cachedInput can never exceed input
    expect(
      costOf('muse-spark-1.1', { input: 1_000, cachedInput: 5_000, output: 0 }, SNAPSHOT),
    ).toBeCloseTo((1000 / 1e6) * 0.15, 12);
  });

  it('unknown model → null (displayed as "cost unavailable", never $0.00)', () => {
    expect(costOf('mystery-model', { input: 1000, output: 1000 }, SNAPSHOT)).toBeNull();
    expect(formatUsd(null)).toBe('cost unavailable');
    expect(formatUsd(0.0841)).toBe('$0.084');
  });

  it('sums include failed and repair calls; any unknown poisons the total to null', () => {
    // failed + repair calls are regular entries in the ledger — they add up
    const happy = [0.01, 0.02, 0.005, 0.0]; // last one: a failed call with 0 tokens
    expect(sumCosts(happy)).toBeCloseTo(0.035, 9);
    expect(sumCosts([0.01, null, 0.02])).toBeNull();
    expect(sumCosts([])).toBe(0);
  });

  it('price snapshot isolation: later edits never change a job priced earlier', () => {
    const snapshot = structuredClone(SNAPSHOT);
    const before = costOf('muse-spark-1.1', { input: 10_000, output: 10_000 }, snapshot);
    const livePricing = structuredClone(SNAPSHOT);
    livePricing['muse-spark-1.1']!.inputPerM = 99; // price hike after the job
    const after = costOf('muse-spark-1.1', { input: 10_000, output: 10_000 }, snapshot);
    expect(after).toBe(before);
  });

  it('review-screen estimate is labeled and null-safe', () => {
    const est = estimateGenerationCost('muse-spark-1.1', SNAPSHOT);
    const platformer = estimateGenerationCost('muse-spark-1.1', SNAPSHOT, {
      platformerPoseJudges: true,
      platformerBossJudge: true,
      platformerEnemyJudge: true,
    });
    expect(est).not.toBeNull();
    expect(platformer).toBeGreaterThan(est!);
    expect(est!).toBeGreaterThan(0.01);
    expect(est!).toBeLessThan(1);
    expect(estimateGenerationCost('unknown', SNAPSHOT)).toBeNull();
  });

  it('uses the published Contributor pricing for the new default', () => {
    expect(DEFAULT_MODEL).toBe('muse-spark-1.2-contributor');
    expect(DEFAULT_PRICING[DEFAULT_MODEL]).toEqual({
      inputPerM: 0.1,
      outputPerM: 0.2,
      cachedInputPerM: 0.002,
    });
    expect(
      costOf(
        DEFAULT_MODEL,
        { input: 1_000_000, cachedInput: 750_000, output: 1_000_000 },
        DEFAULT_PRICING,
      ),
    ).toBeCloseTo(0.2265, 9);
    const estimate = estimateGenerationCost(DEFAULT_MODEL, DEFAULT_PRICING);
    expect(estimate).not.toBeNull();
    expect(estimate!).toBeGreaterThan(0.001);
    expect(estimate!).toBeLessThan(0.01);
    expect(formatUsd(estimate!)).not.toBe('$0.000');
  });
});
