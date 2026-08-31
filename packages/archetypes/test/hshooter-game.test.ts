import { describe, expect, it } from 'vitest';
import type { HShooterLevel } from '@sparkade/shared';
import { corridorSurfaceDecorations } from '../src/hshooter/decor';
import {
  GENERATED_HSHOOTER_BOSS_DRAW_SIZE,
  GENERATED_HSHOOTER_BOSS_HIT_SIZE,
  GENERATED_HSHOOTER_ENEMY_ATLAS_CELL_SIZE,
  GENERATED_HSHOOTER_ENEMY_DRAW_SIZE,
  GENERATED_HSHOOTER_ENEMY_HIT_SIZE,
  GENERATED_HSHOOTER_ENEMY_ROLES,
  GENERATED_HSHOOTER_PLAYER_DRAW_SIZE,
  HSHOOTER_GENERATED_BACKDROP_DIM_ALPHA,
  HSHOOTER_PROCEDURAL_BACKDROP_ALPHA,
  generatedHShooterBossDrawRect,
  generatedHShooterBossMuzzleX,
  generatedHShooterEnemyAtlasX,
  hshooterCraftAnchorsFromRgba,
  hshooterEnemyTravelRotation,
  hshooterBossAttackCadenceS,
  hshooterBackdropPanDistance,
  hshooterBossTelegraphDurationS,
  hshooterBossTelegraphProgress,
  horizontalSpriteDimensions,
  usesDetailedHShooterPresentation,
} from '../src/hshooter/game';
import {
  HSHOOTER_PICKUP_COLLECTION_SCREEN_X,
  HSHOOTER_PICKUP_SCREEN_SPEED_PX,
  HSHOOTER_PICKUP_VERTICAL_SPEED_PX,
  HSHOOTER_TURRET_DODGE_CLEARANCE_PX,
  planHShooterPickupTrajectory,
  planHShooterWavePlacement,
  sampleHShooterPickupTrajectoryY,
} from '../src/hshooter/encounters';

function corridorLevel(): HShooterLevel {
  const cols = 100;
  const solid = '#'.repeat(cols);
  const open = `#${'.'.repeat(cols - 2)}#`;
  const hazard = `#${'.'.repeat(38)}^${'.'.repeat(cols - 41)}#`;
  return {
    name: 'Fixture Run',
    musicSong: 'theme',
    scroll: 30,
    durationS: 45,
    tiles: [solid, solid, open, hazard, open, solid, solid],
    legend: { '#': 'solid', '^': 'hazard' },
    waves: [],
    pickups: [],
  };
}

function encounterLevel(): HShooterLevel {
  const cols = 120;
  const solid = '#'.repeat(cols);
  const open = '.'.repeat(cols);
  return {
    name: 'Encounter Fixture',
    musicSong: 'theme',
    scroll: 30,
    durationS: 45,
    tiles: [solid, solid, ...Array.from({ length: 15 }, () => open), solid, solid],
    legend: { '#': 'solid' },
    waves: [],
    pickups: [],
  };
}

describe('H-scroll presentation helpers', () => {
  it('keeps published specs on legacy presentation until they explicitly opt in', () => {
    expect(usesDetailedHShooterPresentation(undefined)).toBe(false);
    expect(usesDetailedHShooterPresentation('chunky')).toBe(false);
    expect(usesDetailedHShooterPresentation('detailed')).toBe(true);
  });

  it('paces generated panorama travel over the complete authored level duration', () => {
    expect(hshooterBackdropPanDistance({ scroll: 30, durationS: 45 })).toBe(1350);
    expect(hshooterBackdropPanDistance({ scroll: 0, durationS: 0 })).toBe(1);
    expect(HSHOOTER_GENERATED_BACKDROP_DIM_ALPHA).toBeGreaterThan(0);
    expect(HSHOOTER_PROCEDURAL_BACKDROP_ALPHA).toBeGreaterThan(0);
    expect(HSHOOTER_GENERATED_BACKDROP_DIM_ALPHA + HSHOOTER_PROCEDURAL_BACKDROP_ALPHA).toBeLessThan(
      0.75,
    );
  });

  it('swaps top-down sprite dimensions into the horizontal flight plane', () => {
    expect(horizontalSpriteDimensions({ w: 48, h: 32 })).toEqual({ w: 32, h: 48 });
    expect(horizontalSpriteDimensions({ w: 16, h: 12 }, 4)).toEqual({ w: 8, h: 12 });
  });

  it('centers a larger generated boss while retaining a forgiving hit box', () => {
    expect(generatedHShooterBossDrawRect(420, 135)).toEqual({
      x: 384,
      y: 111,
      w: 72,
      h: 48,
    });
    expect(GENERATED_HSHOOTER_BOSS_HIT_SIZE.w).toBeLessThan(GENERATED_HSHOOTER_BOSS_DRAW_SIZE.w);
    expect(GENERATED_HSHOOTER_BOSS_HIT_SIZE.h).toBeLessThan(GENERATED_HSHOOTER_BOSS_DRAW_SIZE.h);
    expect(generatedHShooterBossMuzzleX(420)).toBe(388);
  });

  it('gives every boss pattern an explicit windup before its real firing cadence', () => {
    expect(hshooterBossAttackCadenceS('fan', 1200)).toBeCloseTo(1.2);
    expect(hshooterBossAttackCadenceS('spiral', 900)).toBeCloseTo(0.3);
    for (const pattern of ['fan', 'spiral', 'walls', 'aimed'] as const) {
      const cadence = hshooterBossAttackCadenceS(pattern, 1200);
      const windup = hshooterBossTelegraphDurationS(pattern, 1200);
      expect(windup).toBeGreaterThanOrEqual(0.14);
      expect(windup).toBeLessThan(cadence);
      expect(hshooterBossTelegraphProgress(cadence - windup, pattern, 1200)).toBe(0);
      expect(hshooterBossTelegraphProgress(cadence, pattern, 1200)).toBe(1);
    }
  });

  it('maps the atomic enemy atlas in behavior-role order with forgiving hit boxes', () => {
    expect(GENERATED_HSHOOTER_ENEMY_ROLES).toEqual([
      'popcorn',
      'weaver',
      'tank',
      'turret',
      'kamikaze',
    ]);
    expect(GENERATED_HSHOOTER_ENEMY_ROLES.map(generatedHShooterEnemyAtlasX)).toEqual([
      0,
      GENERATED_HSHOOTER_ENEMY_ATLAS_CELL_SIZE,
      GENERATED_HSHOOTER_ENEMY_ATLAS_CELL_SIZE * 2,
      GENERATED_HSHOOTER_ENEMY_ATLAS_CELL_SIZE * 3,
      GENERATED_HSHOOTER_ENEMY_ATLAS_CELL_SIZE * 4,
    ]);
    for (const role of GENERATED_HSHOOTER_ENEMY_ROLES) {
      expect(GENERATED_HSHOOTER_ENEMY_HIT_SIZE[role].w).toBeLessThanOrEqual(
        GENERATED_HSHOOTER_ENEMY_DRAW_SIZE[role].w,
      );
      expect(GENERATED_HSHOOTER_ENEMY_HIT_SIZE[role].h).toBeLessThanOrEqual(
        GENERATED_HSHOOTER_ENEMY_DRAW_SIZE[role].h,
      );
    }
  });

  it('derives rear and muzzle effect anchors from the generated craft silhouette', () => {
    const width = 10;
    const height = 6;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const opaque = (x: number, y: number) => {
      rgba[(y * width + x) * 4 + 3] = 255;
    };
    for (let y = 1; y <= 4; y++) {
      for (let x = 2; x <= 7; x++) opaque(x, y);
    }
    opaque(1, 3);
    opaque(1, 4);
    opaque(8, 2);
    opaque(8, 3);

    const anchors = hshooterCraftAnchorsFromRgba(rgba, width, height);
    expect(GENERATED_HSHOOTER_PLAYER_DRAW_SIZE).toEqual({ w: 30, h: 20 });
    expect(anchors.rear.x).toBeCloseTo(-10.5);
    expect(anchors.muzzle.x).toBeCloseTo(10.5);
    expect(anchors.rear.y).toBeGreaterThan(anchors.muzzle.y);

    expect(hshooterCraftAnchorsFromRgba(new Uint8ClampedArray(0), 0, 0)).toEqual({
      rear: { x: -15, y: 0 },
      muzzle: { x: 15, y: 0 },
    });
  });

  it('rotates homing silhouettes from their authored left-facing baseline', () => {
    expect(hshooterEnemyTravelRotation(-1, 0)).toBeCloseTo(0);
    expect(hshooterEnemyTravelRotation(-1, -1)).toBeCloseTo(Math.PI / 4);
    expect(hshooterEnemyTravelRotation(-1, 1)).toBeCloseTo(-Math.PI / 4);
    expect(Math.abs(hshooterEnemyTravelRotation(1, 0))).toBeCloseTo(Math.PI);
  });

  it('places deterministic decoration only on exposed solid cells', () => {
    const level = corridorLevel();
    const first = corridorSurfaceDecorations(level, 1234);
    const again = corridorSurfaceDecorations(level, 1234);
    expect(first).toEqual(again);
    expect(first.length).toBeGreaterThan(1);

    const kindAt = (x: number, y: number) => {
      const ch = level.tiles[y]?.[x] ?? '.';
      return ch === '.' ? 'empty' : level.legend[ch];
    };
    for (const cell of first) {
      expect(kindAt(cell.x, cell.y)).toBe('solid');
      expect([
        kindAt(cell.x, cell.y - 1),
        kindAt(cell.x + 1, cell.y),
        kindAt(cell.x, cell.y + 1),
        kindAt(cell.x - 1, cell.y),
      ]).toContain('empty');
    }
    expect(first.every((cell, index) => index === 0 || cell.x - first[index - 1]!.x >= 9)).toBe(
      true,
    );
  });

  it('does not spend gameplay RNG state or place fixtures in a sealed solid grid', () => {
    const level = corridorLevel();
    level.tiles = Array.from({ length: 7 }, () => '#'.repeat(100));
    expect(corridorSurfaceDecorations(level, 99)).toEqual([]);
  });
});

describe('H-scroll terrain-aware encounter placement', () => {
  it('plans a complete collectible path at a speed the player can follow', () => {
    const level = encounterLevel();
    const plan = planHShooterPickupTrajectory(level, 4, 80);

    expect(plan.complete).toBe(true);
    expect(plan.points.length).toBeGreaterThan(100);
    expect(plan.interceptElapsedS).toBeGreaterThan(2);
    expect(512 + 10 - HSHOOTER_PICKUP_SCREEN_SPEED_PX * plan.interceptElapsedS).toBeCloseTo(
      HSHOOTER_PICKUP_COLLECTION_SCREEN_X,
    );
    for (let index = 1; index < plan.points.length; index++) {
      const before = plan.points[index - 1]!;
      const after = plan.points[index]!;
      const dt = after.elapsedS - before.elapsedS;
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(
        HSHOOTER_PICKUP_VERTICAL_SPEED_PX * dt + 0.001,
      );
    }
    const halfway = plan.points[Math.floor(plan.points.length / 2)]!;
    expect(sampleHShooterPickupTrajectoryY(plan, halfway.elapsedS)).toBeCloseTo(halfway.y);
  });

  it('rejects pickups that hit a hazard curtain or arrive too late to collect', () => {
    const blocked = encounterLevel();
    const blockTx = 35;
    blocked.legend['^'] = 'hazard';
    blocked.tiles = blocked.tiles.map(
      (row) => row.slice(0, blockTx) + '^' + row.slice(blockTx + 1),
    );
    const blockedPlan = planHShooterPickupTrajectory(blocked, 4);
    expect(blockedPlan).toMatchObject({
      complete: false,
      failureReason: 'clearance',
    });
    expect(blockedPlan.failureTileColumn).toBeGreaterThanOrEqual(blockTx);
    expect(blockedPlan.failureTileColumn).toBeLessThanOrEqual(blockTx + 1);

    const late = planHShooterPickupTrajectory(encounterLevel(), 44);
    expect(late).toMatchObject({ complete: false, failureReason: 'late' });
  });

  it('shifts a flying formation together until every member clears the corridor', () => {
    const level = encounterLevel();
    const plan = planHShooterWavePlacement(
      level,
      {
        t: 4,
        enemyType: 'popcorn',
        count: 5,
        formation: 'line',
        path: 'dive',
        hp: 1,
        fireRate: 0,
      },
      400,
      36,
    );

    expect(plan.complete).toBe(true);
    expect(plan.rejectedIndices).toEqual([]);
    expect(plan.placements).toHaveLength(5);
    expect(Math.min(...plan.placements.map(({ y }) => y))).toBeGreaterThan(32);
  });

  it('checks every member at its own formation-offset spawn column', () => {
    const level = encounterLevel();
    const baseX = 400;
    const blockedTx = Math.floor((baseX + 34) / 16);
    level.tiles = level.tiles.map((row, y) => {
      if (y < 2 || y > 16) return row;
      return row.slice(0, blockedTx) + '#' + row.slice(blockedTx + 1);
    });

    const plan = planHShooterWavePlacement(
      level,
      {
        t: 4,
        enemyType: 'weaver',
        count: 3,
        formation: 'column',
        path: 'sine',
        hp: 2,
        fireRate: 0.25,
      },
      baseX,
    );

    expect(plan.complete).toBe(false);
    expect(plan.rejectedIndices).toEqual([1]);
    expect(plan.placements.map(({ index }) => index)).toEqual([0, 2]);
    expect(plan.placements.map(({ x }) => x)).toEqual([baseX, baseX + 68]);
  });

  it('mounts turrets to exposed surfaces only when a firing window and dodge lane remain', () => {
    const level = encounterLevel();
    const wave = {
      t: 4,
      enemyType: 'turret' as const,
      count: 2,
      formation: 'column' as const,
      path: 'hold' as const,
      hp: 5,
      fireRate: 0.5,
    };
    const mounted = planHShooterWavePlacement(level, wave, 400);

    expect(HSHOOTER_TURRET_DODGE_CLEARANCE_PX).toBe(48);
    expect(mounted.complete).toBe(true);
    expect(mounted.placements).toHaveLength(2);
    expect(mounted.placements.every(({ mount }) => mount === 'ceiling')).toBe(true);
    expect(mounted.placements.every(({ y }) => y === 39)).toBe(true);

    const narrow = encounterLevel();
    const solid = '#'.repeat(narrow.tiles[0]!.length);
    const open = '.'.repeat(narrow.tiles[0]!.length);
    narrow.tiles = [
      ...Array.from({ length: 8 }, () => solid),
      open,
      open,
      open,
      ...Array.from({ length: 8 }, () => solid),
    ];
    const rejected = planHShooterWavePlacement(narrow, { ...wave, count: 1 }, 400);
    expect(rejected.complete).toBe(false);
    expect(rejected.placements).toEqual([]);
  });
});
