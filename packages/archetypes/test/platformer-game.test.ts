import { describe, expect, it } from 'vitest';
import { resolvePlatformerMovement } from '@sparkade/shared';
import {
  completeGeneratedPlatformerPoses,
  generatedPlatformerFootLanded,
  generatedPlatformerGaitFrame,
  generatedPlatformerGaitRate,
  generatedPlatformerGroundAnimation,
  platformerAbilityNoticeFrame,
  generatedPlatformerBossDrawRect,
  generatedPlatformerEnemyDrawRect,
  generatedPlatformerPlayerDrawRect,
  generatedPlatformerPoseDrawSize,
  generatedPlatformerPropDrawRect,
  platformerBossTelegraphAuraBands,
  platformerShooterFacingDirection,
  platformerShooterMuzzlePoint,
  platformerSpringDrawRect,
  platformerSurfaceMaterial,
  shouldMaskLegacyPlatformerForeground,
  stepPlatformerHorizontalVelocity,
} from '../src/platformer/game';

describe('platformer movement profiles', () => {
  it('makes precision accelerate and stop faster while momentum preserves speed', () => {
    const balanced = resolvePlatformerMovement('balanced');
    const precision = resolvePlatformerMovement('precision');
    const momentum = resolvePlatformerMovement('momentum');

    const accelerate = (movement: typeof balanced) =>
      stepPlatformerHorizontalVelocity(0, 1, 142 * movement.speed, 0.1, true, movement);
    expect(accelerate(precision)).toBeGreaterThan(accelerate(balanced));

    const release = (movement: typeof balanced) =>
      stepPlatformerHorizontalVelocity(100, 0, 142 * movement.speed, 0.1, true, movement);
    expect(release(precision)).toBeLessThan(release(balanced));
    expect(release(momentum)).toBeGreaterThan(release(balanced));
  });

  it('makes precision air correction stronger than momentum air correction', () => {
    const precision = resolvePlatformerMovement('precision');
    const momentum = resolvePlatformerMovement('momentum');
    const correct = (movement: typeof precision) =>
      stepPlatformerHorizontalVelocity(80, -1, 142 * movement.speed, 0.1, false, movement);
    expect(correct(precision)).toBeLessThan(correct(momentum));
  });

  it('preserves momentum on ice while keeping ordinary ground unchanged', () => {
    const balanced = resolvePlatformerMovement('balanced');
    const normalStop = stepPlatformerHorizontalVelocity(100, 0, 142, 0.1, true, balanced);
    const iceStop = stepPlatformerHorizontalVelocity(100, 0, 142, 0.1, true, balanced, 'ice');
    const normalStart = stepPlatformerHorizontalVelocity(0, 1, 142, 0.1, true, balanced);
    const iceStart = stepPlatformerHorizontalVelocity(0, 1, 142, 0.1, true, balanced, 'ice');

    expect(normalStop).toBe(5);
    expect(iceStop).toBeGreaterThan(normalStop);
    expect(iceStart).toBeGreaterThan(0);
    expect(iceStart).toBeLessThan(normalStart);
  });

  it('adds bounded directional conveyor speed that the player can oppose', () => {
    const balanced = resolvePlatformerMovement('balanced');
    expect(stepPlatformerHorizontalVelocity(0, 0, 142, 0.1, true, balanced, 'conveyorRight')).toBe(
      42,
    );
    expect(stepPlatformerHorizontalVelocity(0, 0, 142, 0.1, true, balanced, 'conveyorLeft')).toBe(
      -42,
    );
    expect(
      stepPlatformerHorizontalVelocity(0, -1, 142, 0.1, true, balanced, 'conveyorRight'),
    ).toBeLessThan(0);
    expect(stepPlatformerHorizontalVelocity(0, 0, 142, 0.1, false, balanced, 'conveyorRight')).toBe(
      0,
    );
  });

  it('resolves seams without opposing-conveyor jitter', () => {
    expect(platformerSurfaceMaterial(['solid', 'ice'])).toBe('ice');
    expect(platformerSurfaceMaterial(['ice', 'conveyorRight'])).toBe('conveyorRight');
    expect(platformerSurfaceMaterial(['conveyorLeft', 'conveyorRight'])).toBe('normal');
    expect(platformerSurfaceMaterial(['platform', 'solid'])).toBe('normal');
  });
});

describe('generated platformer player poses', () => {
  it('uses intent for walking and keeps a coasting player side-on', () => {
    expect(generatedPlatformerGroundAnimation(1, 60, 0)).toBe('walk');
    expect(generatedPlatformerGroundAnimation(0, 60, 0.2)).toBe('sideIdle');
    expect(generatedPlatformerGroundAnimation(0, 60, 2)).toBe('sideIdle');
    expect(generatedPlatformerGroundAnimation(1, 0, 0)).toBe('sideIdle');
  });

  it('turns from side idle to front idle after one stationary second', () => {
    expect(generatedPlatformerGroundAnimation(0, 0, 0)).toBe('sideIdle');
    expect(generatedPlatformerGroundAnimation(0, 0, 0.99)).toBe('sideIdle');
    expect(generatedPlatformerGroundAnimation(0, 0, 1)).toBe('idle');
  });

  it('keeps foreground masking exclusive to compact legacy saves', () => {
    expect(shouldMaskLegacyPlatformerForeground(undefined, 'tall-humanoid', 14, 32)).toBe(true);
    expect(shouldMaskLegacyPlatformerForeground(2, 'tall-humanoid', 28, 32)).toBe(false);
    expect(shouldMaskLegacyPlatformerForeground(undefined, 'standard', 14, 32)).toBe(false);
    expect(shouldMaskLegacyPlatformerForeground(undefined, 'tall-humanoid', 32, 32)).toBe(false);
  });

  it('activates only one complete five-frame identity set', () => {
    const image = {} as CanvasImageSource;
    expect(
      completeGeneratedPlatformerPoses({
        idle: image,
        sideIdle: image,
        walk1: image,
        walk2: image,
        jump: image,
      }),
    ).toEqual({ idle: image, sideIdle: image, walk1: image, walk2: image, jump: image });
    expect(completeGeneratedPlatformerPoses({ idle: image, walk1: image, jump: image })).toBeNull();
    expect(completeGeneratedPlatformerPoses(null)).toBeNull();
  });

  it('visually overlaps the tile cap without changing the collision body', () => {
    const rect = generatedPlatformerPlayerDrawRect(100, 50, 12, 28);
    expect(rect).toEqual({ x: 94, y: 48, w: 24, h: 32 });
    expect(rect.y + rect.h).toBe(50 + 28 + 2);
  });

  it('keeps legacy density-2 and new density-4 art in the same logical footprint', () => {
    expect(generatedPlatformerPoseDrawSize(56, 64)).toEqual({ w: 28, h: 32 });
    expect(generatedPlatformerPoseDrawSize(112, 128)).toEqual({ w: 28, h: 32 });
    expect(generatedPlatformerPoseDrawSize(48, 64)).toEqual({ w: 24, h: 32 });
  });

  it('uses a speed-driven contact, side-idle, contact, side-idle gait with bob and squash', () => {
    expect(generatedPlatformerGaitRate(88)).toBeCloseTo(8.21, 2);
    expect(generatedPlatformerGaitRate(142)).toBeCloseTo(13.25, 2);
    const beats = [0, 1, 2, 3, 4, 5].map((phase) => generatedPlatformerGaitFrame(phase));
    expect(beats.map(({ pose }) => pose)).toEqual([
      'walk1',
      'walk1',
      'sideIdle',
      'walk2',
      'walk2',
      'sideIdle',
    ]);
    // The beat after each contact squashes; the passing side idle rises.
    expect(beats.map(({ compression }) => compression)).toEqual([0, 1, 0, 0, 1, 0]);
    expect(beats.map(({ bob }) => bob)).toEqual([0, 0, 1, 0, 0, 1]);
    expect(beats.map(({ runContact }) => runContact)).toEqual([1, 1, 1, 2, 2, 1]);
    const compressed = generatedPlatformerPlayerDrawRect(100, 50, 12, 28, 28, 32, 1);
    expect(compressed).toEqual({ x: 92, y: 49, w: 28, h: 31 });
    expect(compressed.y + compressed.h).toBe(50 + 28 + 2);
  });

  it('splits the same cycle into eight beats when run in-betweens are ready', () => {
    const beats = [0, 0.75, 1.5, 2.25, 3, 3.75, 4.5, 5.25].map((phase) =>
      generatedPlatformerGaitFrame(phase, { inbetweens: true }),
    );
    expect(beats.map(({ pose }) => pose)).toEqual([
      'walk1',
      'runMid1',
      'sideIdle',
      'runMid2',
      'walk2',
      'runMid2',
      'sideIdle',
      'runMid1',
    ]);
    // Firing while running still chooses from the contact each in-between leans from.
    expect(beats.map(({ base }) => base)).toEqual([
      'walk1',
      'walk1',
      'sideIdle',
      'walk2',
      'walk2',
      'walk2',
      'sideIdle',
      'walk1',
    ]);
    expect(beats.map(({ runContact }) => runContact)).toEqual([1, 1, 1, 2, 2, 2, 1, 1]);
    expect(beats.map(({ compression }) => compression)).toEqual([0, 1, 0, 0, 0, 1, 0, 0]);
    expect(beats.map(({ bob }) => bob)).toEqual([0, 0, 1, 1, 0, 0, 1, 1]);
    // Foot contacts land on the same phases with or without in-betweens.
    expect(generatedPlatformerGaitFrame(3, { inbetweens: true }).pose).toBe('walk2');
    expect(generatedPlatformerGaitFrame(3).pose).toBe('walk2');
  });

  it('lands a foot (and kicks up dust) only when the gait reaches a contact beat', () => {
    expect(generatedPlatformerFootLanded(2.9, 3.1)).toBe(true);
    expect(generatedPlatformerFootLanded(5.8, 6.05)).toBe(true);
    expect(generatedPlatformerFootLanded(3.1, 3.3)).toBe(false);
    expect(generatedPlatformerFootLanded(0.8, 1.2)).toBe(false);
    expect(generatedPlatformerFootLanded(4.9, 5.1)).toBe(false);
    // A run that starts from rest is already on its first contact.
    expect(generatedPlatformerFootLanded(0, 0.2)).toBe(false);
  });

  it('centers the larger generated boss over the stable collision body and ground line', () => {
    const rect = generatedPlatformerBossDrawRect(200, 90, 26, 30);
    expect(rect).toEqual({ x: 189, y: 74, w: 48, h: 48 });
    expect(rect.y + rect.h).toBe(90 + 30 + 2);
  });

  it('centers generated enemies over their stable behavior colliders', () => {
    const walker = generatedPlatformerEnemyDrawRect('walker', 100, 50, 14, 14);
    expect(walker).toEqual({ x: 95, y: 41, w: 24, h: 24 });
    expect(walker.y + walker.h).toBe(50 + 14 + 1);

    const flyer = generatedPlatformerEnemyDrawRect('flyer', 100, 50, 14, 14);
    expect(flyer).toEqual({ x: 94, y: 43, w: 26, h: 22 });
  });

  it('faces shooters toward the player and emits from the corresponding visual edge', () => {
    expect(platformerShooterFacingDirection(80, 100, 1)).toBe(-1);
    expect(platformerShooterFacingDirection(120, 100, -1)).toBe(1);
    expect(platformerShooterFacingDirection(100.2, 100, -1)).toBe(-1);

    const rect = { x: 90, y: 40, w: 24, h: 24 };
    const left = platformerShooterMuzzlePoint(rect, -1);
    const right = platformerShooterMuzzlePoint(rect, 1);
    expect(left.x).toBeLessThan(rect.x + rect.w / 2);
    expect(right.x).toBeGreaterThan(rect.x + rect.w / 2);
    expect(left.y).toBe(52);
    expect(right.y).toBe(52);
  });

  it('accelerates the boss silhouette warning while keeping every ring in range', () => {
    const early = platformerBossTelegraphAuraBands(0, 0.45, 4);
    const ready = platformerBossTelegraphAuraBands(0.44, 0.45, 4);
    expect(ready[0]!.alpha).toBeGreaterThan(early[0]!.alpha);
    for (const band of [...early, ...ready]) {
      expect(band.radius).toBeGreaterThanOrEqual(1);
      expect(band.radius).toBeLessThanOrEqual(4);
      expect(band.alpha).toBeGreaterThan(0);
      expect(band.alpha).toBeLessThanOrEqual(1);
    }
  });

  it('renders density-four springs at the original one-tile gameplay size', () => {
    const rect = platformerSpringDrawRect(101, 81, 14, 14);
    expect(rect).toEqual({ x: 100, y: 79, w: 16, h: 16 });
    expect(rect.y + rect.h).toBe(81 + 14);
  });

  it('animates generated pickups inside their unchanged collision footprint', () => {
    const coin = generatedPlatformerPropDrawRect('coin', 100, 50, 12, 12, 0);
    expect(coin).toEqual({ x: 100, y: 49.25, w: 12, h: 12 });

    const heart = generatedPlatformerPropDrawRect('heart', 100, 50, 12, 12, Math.PI / 8);
    expect(heart.x).toBe(100);
    expect(heart.w).toBe(12);
    expect(heart.h).toBeGreaterThan(12);

    const powerup = generatedPlatformerPropDrawRect('powerup', 100, 50, 12, 12, 0);
    expect(powerup).toEqual({ x: 100, y: 48.5, w: 12, h: 12 });
  });
});

describe('platformer ability announcement', () => {
  it('holds, rises, and then fades away', () => {
    expect(platformerAbilityNoticeFrame(0)).toEqual({ alpha: 1, rise: 0 });
    expect(platformerAbilityNoticeFrame(0.9).alpha).toBe(1);
    expect(platformerAbilityNoticeFrame(0.9).rise).toBeGreaterThan(0);
    expect(platformerAbilityNoticeFrame(1.4).alpha).toBeLessThan(1);
    expect(platformerAbilityNoticeFrame(1.8)).toEqual({ alpha: 0, rise: 18 });
  });
});
