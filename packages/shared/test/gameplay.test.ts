import { describe, expect, it } from 'vitest';
import {
  PLATFORMER_MOVEMENT_PROFILES,
  difficultyScale,
  resolveHeroFeel,
  resolvePlatformerMovement,
} from '../src/constants';

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

describe('resolvePlatformerMovement', () => {
  it('keeps omitted and balanced profiles identical to the original physics', () => {
    const original = {
      gravity: 1,
      jump: 1,
      speed: 1,
      groundAcceleration: 1,
      groundBraking: 1,
      airControl: 0.65,
      airBraking: 0.65,
      terminalVelocity: 1,
      jumpCutoff: 1,
    };
    expect(resolvePlatformerMovement(undefined)).toEqual(original);
    expect(resolvePlatformerMovement('balanced')).toEqual(original);
  });

  it('gives every named profile a distinct bounded control character', () => {
    expect(PLATFORMER_MOVEMENT_PROFILES).toEqual([
      'balanced',
      'precision',
      'momentum',
      'floaty',
      'heavy',
    ]);
    expect(resolvePlatformerMovement('precision').groundBraking).toBeGreaterThan(1);
    expect(resolvePlatformerMovement('momentum').groundBraking).toBeLessThan(0.5);
    expect(resolvePlatformerMovement('floaty').gravity).toBeLessThan(0.8);
    expect(resolvePlatformerMovement('heavy').gravity).toBeGreaterThan(1);
  });

  it('never shrinks the validated baseline jump envelope', () => {
    for (const profile of PLATFORMER_MOVEMENT_PROFILES) {
      const movement = resolvePlatformerMovement(profile);
      // Ballistic height is proportional to v^2/g; full-speed horizontal
      // airtime reach is proportional to speed*v/g. Both must remain at least
      // baseline because the geometry linter validates against that baseline.
      expect(
        movement.jump ** 2 / movement.gravity,
        `${profile} vertical reach`,
      ).toBeGreaterThanOrEqual(1);
      expect(
        (movement.speed * movement.jump) / movement.gravity,
        `${profile} horizontal reach`,
      ).toBeGreaterThanOrEqual(1);
      expect(movement.jump / movement.gravity, `${profile} airtime`).toBeGreaterThanOrEqual(1);
    }
  });

  it('preserves the legacy one-sided feel overlay', () => {
    const movement = resolvePlatformerMovement('balanced', {
      gravityScale: 0.8,
      jumpScale: 1.2,
      speedScale: 1.25,
    });
    expect(movement.gravity).toBe(0.8);
    expect(movement.jump).toBe(1.2);
    expect(movement.speed).toBe(1.25);
    expect(movement.groundAcceleration).toBe(1.25);
    expect(movement.airControl).toBe(0.65 * 1.25);
  });
});
