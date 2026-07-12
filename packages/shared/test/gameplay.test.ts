import { describe, expect, it } from 'vitest';
import { difficultyScale, resolveHeroFeel } from '../src/constants';

describe('difficultyScale', () => {
  it('is neutral by default, softer when chill, harder when spicy', () => {
    expect(difficultyScale(undefined)).toEqual({ hp: 1, fire: 1 });
    expect(difficultyScale('standard')).toEqual({ hp: 1, fire: 1 });
    expect(difficultyScale('chill').hp).toBeLessThan(1);
    expect(difficultyScale('chill').fire).toBeLessThan(1);
    expect(difficultyScale('spicy').hp).toBeGreaterThan(1);
    expect(difficultyScale('spicy').fire).toBeGreaterThan(1);
  });
});

describe('resolveHeroFeel', () => {
  it('is neutral (1,1,1) when omitted, so existing games are byte-identical', () => {
    expect(resolveHeroFeel(undefined)).toEqual({ gravity: 1, jump: 1, speed: 1 });
    expect(resolveHeroFeel({})).toEqual({ gravity: 1, jump: 1, speed: 1 });
  });

  it('ONLY ever raises reach: a heavier/slower spec is clamped back to baseline', () => {
    // The reachability lint uses a fixed jump kernel; this clamp is what keeps
    // that kernel a valid lower bound. A spec that tries to shrink reach (heavy
    // gravity, weak jump, slow run) — which could strand a validated level —
    // must clamp back to >= baseline.
    const bad = resolveHeroFeel({ gravityScale: 2, jumpScale: 0.4, speedScale: 0.5 });
    expect(bad.gravity).toBe(1); // never heavier than baseline
    expect(bad.jump).toBe(1); // never weaker than baseline
    expect(bad.speed).toBe(1); // never slower than baseline
  });

  it('passes valid in-range values through unchanged', () => {
    expect(resolveHeroFeel({ gravityScale: 0.8, jumpScale: 1.2, speedScale: 1.25 })).toEqual({
      gravity: 0.8,
      jump: 1.2,
      speed: 1.25,
    });
  });

  it('clamps floaty/fast extremes to the safe floor and ceiling', () => {
    expect(resolveHeroFeel({ gravityScale: 0.1 }).gravity).toBe(0.72);
    expect(resolveHeroFeel({ jumpScale: 9 }).jump).toBe(1.25);
    expect(resolveHeroFeel({ speedScale: 9 }).speed).toBe(1.3);
  });
});
