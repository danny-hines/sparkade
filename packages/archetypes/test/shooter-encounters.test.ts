import { describe, expect, it } from 'vitest';
import type { ShooterWave } from '@sparkade/shared';
import {
  isShooterWaveDense,
  planShooterWaveCenterX,
  shooterFormationBounds,
  shooterFormationOffsets,
} from '../src/shooter/encounters';

const wave = (overrides: Partial<ShooterWave> = {}): ShooterWave => ({
  t: 8,
  enemyType: 'popcorn',
  count: 5,
  formation: 'vee',
  path: 'dive',
  hp: 1,
  fireRate: 0,
  ...overrides,
});

describe('vertical-shooter encounter composition', () => {
  it('shares canonical formation geometry with runtime placement', () => {
    expect(shooterFormationOffsets(wave())).toEqual([
      { x: 0, y: 0 },
      { x: -26, y: -20 },
      { x: 26, y: -20 },
      { x: -52, y: -40 },
      { x: 52, y: -40 },
    ]);
    expect(shooterFormationBounds(wave({ formation: 'column', count: 4 }))).toMatchObject({
      width: 0,
      stagger: 108,
    });
  });

  it('clamps the formation as one group and rejects impossible spans', () => {
    expect(planShooterWaveCenterX(wave({ formation: 'line', count: 8 }), 20)).toBe(140);
    expect(planShooterWaveCenterX(wave({ formation: 'line', count: 8 }), 500)).toBe(372);
    expect(planShooterWaveCenterX(wave({ formation: 'line', count: 30 }), 256)).toBeNull();
  });

  it('identifies swarms, bullet emitters, and armored groups as dense', () => {
    expect(isShooterWaveDense(wave({ count: 6 }))).toBe(true);
    expect(isShooterWaveDense(wave({ count: 4, fireRate: 0.9 }))).toBe(true);
    expect(isShooterWaveDense(wave({ enemyType: 'tank', count: 3, hp: 8 }))).toBe(true);
    expect(isShooterWaveDense(wave())).toBe(false);
  });
});
