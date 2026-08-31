import { describe, expect, it } from 'vitest';
import {
  GENERATED_SHOOTER_ENEMY_DRAW_SIZE,
  GENERATED_SHOOTER_ENEMY_HIT_SIZE,
  generatedShooterEnemyAtlasX,
  shooterBackdropTravelDistance,
  shooterBossAttackCadenceS,
  shooterBossTelegraphDurationS,
  shooterBossTelegraphProgress,
  shooterCraftAnchorsFromRgba,
  shooterEnemyTravelRotation,
} from '../src/shooter/game';

describe('vertical-shooter presentation contracts', () => {
  it('derives muzzle and exhaust anchors from opaque top and bottom silhouette edges', () => {
    const width = 8;
    const height = 12;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 2; y <= 9; y++) {
      for (let x = y < 4 ? 3 : y > 7 ? 5 : 2; x <= (y < 4 ? 4 : y > 7 ? 6 : 5); x++) {
        rgba[(y * width + x) * 4 + 3] = 255;
      }
    }
    const anchors = shooterCraftAnchorsFromRgba(rgba, width, height);
    expect(anchors.muzzle.y).toBeLessThan(0);
    expect(anchors.rear.y).toBeGreaterThan(0);
    expect(anchors.muzzle.x).toBeLessThan(anchors.rear.x);
    expect(shooterCraftAnchorsFromRgba(new Uint8ClampedArray(0), 0, 0)).toEqual({
      rear: { x: 0, y: 18 },
      muzzle: { x: 0, y: -18 },
    });
  });

  it('rotates native downward-facing homing art into actual velocity', () => {
    expect(shooterEnemyTravelRotation(0, 1)).toBeCloseTo(0);
    expect(shooterEnemyTravelRotation(1, 0)).toBeCloseTo(-Math.PI / 2);
    expect(shooterEnemyTravelRotation(-1, 0)).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(shooterEnemyTravelRotation(0, -1))).toBeCloseTo(Math.PI);
  });

  it('keeps generated draw scale independent from collision scale and atlas order stable', () => {
    for (const role of ['popcorn', 'weaver', 'tank', 'turret', 'kamikaze'] as const) {
      expect(GENERATED_SHOOTER_ENEMY_DRAW_SIZE[role].w).toBeGreaterThan(
        GENERATED_SHOOTER_ENEMY_HIT_SIZE[role].w,
      );
      expect(GENERATED_SHOOTER_ENEMY_DRAW_SIZE[role].h).toBeGreaterThan(
        GENERATED_SHOOTER_ENEMY_HIT_SIZE[role].h,
      );
    }
    expect(generatedShooterEnemyAtlasX('popcorn')).toBe(0);
    expect(generatedShooterEnemyAtlasX('kamikaze')).toBe(384);
  });

  it('scales telegraphs to attack cadence and flyover travel to authored duration', () => {
    expect(shooterBossAttackCadenceS('spiral', 900)).toBeCloseTo(0.3);
    for (const pattern of ['fan', 'spiral', 'walls', 'aimed'] as const) {
      const cadence = shooterBossAttackCadenceS(pattern, 1200);
      const telegraph = shooterBossTelegraphDurationS(pattern, 1200);
      expect(telegraph).toBeGreaterThan(0);
      expect(telegraph).toBeLessThan(cadence);
      expect(shooterBossTelegraphProgress(cadence - telegraph, pattern, 1200)).toBe(0);
      expect(shooterBossTelegraphProgress(cadence, pattern, 1200)).toBe(1);
    }
    expect(shooterBackdropTravelDistance({ scroll: 45, durationS: 80 })).toBe(3600);
    expect(shooterBackdropTravelDistance({ scroll: 0, durationS: 0 })).toBe(1);
  });
});
