import { describe, expect, it } from 'vitest';
import { requiredPlatformerActionPoses, type PlatformerPlayStyle } from '@sparkade/shared';
import { completeGeneratedPlatformerPoses } from '../src/platformer/game';
import {
  platformerActionFrame,
  platformerWallDrawX,
  type PlatformerPoseState,
} from '../src/platformer/poses';

const state: PlatformerPoseState = {
  grounded: true,
  base: 'sideIdle',
  runContact: 1,
  facing: 1,
  wall: 0,
  firing: false,
  aimUp: false,
  attackFacing: 1,
  meleeT: 0,
};

describe('composed movement and action animation', () => {
  it.each([
    [{ firing: true }, 'shoot', false],
    [{ firing: true, aimUp: true }, 'shootUp', false],
    [{ firing: true, base: 'walk1' }, 'runShoot1', false],
    [{ firing: true, base: 'walk2', runContact: 2, aimUp: true }, 'runShootUp2', false],
    [{ firing: true, grounded: false }, 'jumpShoot', false],
    [{ firing: true, grounded: false, aimUp: true, attackFacing: -1 }, 'jumpShootUp', true],
    [{ grounded: false, wall: 1 }, 'wallSlide', false],
    [{ firing: true, grounded: false, wall: 1, attackFacing: -1 }, 'wallShoot', false],
    [{ firing: true, grounded: false, wall: -1, aimUp: true }, 'wallShootUp', true],
    [{ meleeT: 0.45 }, 'meleeWindup', false],
    [{ meleeT: 0.3, attackFacing: -1 }, 'meleeStrike', true],
    [{ meleeT: 0.45, grounded: false }, 'jumpMeleeWindup', false],
    [{ meleeT: 0.3, grounded: false }, 'jumpMeleeStrike', false],
  ] as const)('selects state %j', (change, pose, flip) => {
    expect(platformerActionFrame({ ...state, ...change })).toEqual({ pose, flip });
  });

  it.each([
    ['acrobat', 0],
    ['runAndGun', 8],
    ['towerClimber', 1],
    ['meleeAction', 4],
    ['armedClimber', 11],
  ] as const)('requires only %s actions', (style, count) => {
    expect(requiredPlatformerActionPoses({ playStyle: style as PlatformerPlayStyle })).toHaveLength(
      count,
    );
  });

  it('requires forward running and airborne fire when an acrobat can acquire a projectile', () => {
    expect(
      requiredPlatformerActionPoses({
        playStyle: 'acrobat',
        abilityLoadout: [{ kind: 'projectile', name: 'Bolt', visualConcept: 'A blue bolt' }],
      }),
    ).toEqual(['shoot', 'runShoot1', 'runShoot2', 'jumpShoot']);
  });

  it('keeps legacy base sets loadable but fails closed for missing required combo actions', () => {
    const image = {} as CanvasImageSource;
    const base = Object.fromEntries(
      ['idle', 'sideIdle', 'walk1', 'walk2', 'jump'].map((p) => [p, image]),
    );
    expect(completeGeneratedPlatformerPoses(base)).toBeTruthy();
    const required = requiredPlatformerActionPoses({ playStyle: 'armedClimber' });
    const complete = { ...base, ...Object.fromEntries(required.map((p) => [p, image])) };
    expect(completeGeneratedPlatformerPoses(complete, required)?.wallShoot).toBe(image);
    delete complete.wallShoot;
    expect(completeGeneratedPlatformerPoses(complete, required)).toBeNull();
  });
});

describe('visible wall contact alignment', () => {
  it('anchors opaque pixels outside a right wall despite wide transparent gutters', () => {
    const bounds = { left: 0.1, right: 0.85 };
    const x = platformerWallDrawX(77, 40, bounds, false, -Infinity, 100);
    expect(x + 40 * bounds.right).toBe(100);
  });
  it('mirrors the same contact edge on the left wall', () => {
    const bounds = { left: 0.1, right: 0.85 };
    const x = platformerWallDrawX(90, 40, bounds, true, 100, Infinity);
    expect(x + 40 * (1 - bounds.right)).toBe(100);
  });
  it('releases the visual offset once the jump clears the wall', () => {
    expect(platformerWallDrawX(30, 40, { left: 0.1, right: 0.85 }, false, -Infinity, 100)).toBe(30);
  });
});
