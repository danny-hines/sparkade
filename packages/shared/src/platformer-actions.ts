import type { PlatformerSpec } from './types';
import { platformerMechanics } from './play-styles';

export const PLATFORMER_BASE_POSES = ['idle', 'sideIdle', 'walk1', 'walk2', 'jump'] as const;
export type PlatformerBasePose = (typeof PLATFORMER_BASE_POSES)[number];

/** Canonical movement faces RIGHT; wall frames put the wall on RIGHT and wallShoot aims LEFT. */
export const PLATFORMER_ACTION_DESCRIPTIONS = {
  shoot:
    'stand facing RIGHT with a bent rear arm and forward arm extended horizontally, empty palm aimed RIGHT to emit a bolt; feet planted',
  shootUp:
    'stand facing RIGHT, forward elbow bent, wrist above the elbow beside the face, empty palm facing UP near eye level; feet planted',
  runShoot1:
    'RIGHT-facing running contact A with the camera-side leg forward, far leg back, and the forward arm extended horizontally to fire RIGHT; preserve the reference running legs',
  runShoot2:
    'RIGHT-facing running contact B with the far-side leg forward, camera-side leg back, and the forward arm extended horizontally to fire RIGHT; preserve the reference running legs',
  runShootUp1:
    'RIGHT-facing running contact A with camera-side leg forward; elbow bent with wrist above it beside the face, empty palm facing UP near eye level; preserve the reference running legs',
  runShootUp2:
    'RIGHT-facing running contact B with far-side leg forward; elbow bent with wrist above it beside the face, empty palm facing UP near eye level; preserve the reference running legs',
  jumpShoot:
    'RIGHT-facing airborne jump with knees bent and the forward arm extended horizontally, empty palm aimed RIGHT; both feet airborne',
  jumpShootUp:
    'RIGHT-facing airborne jump with knees bent, elbow bent with wrist above it beside the face, empty palm facing UP near eye level; both feet airborne',
  wallSlide:
    'cling to an imaginary wall immediately to the RIGHT: face and chest toward RIGHT, hands braced beside the face and bent knees with feet pressing toward RIGHT; no actual wall drawn',
  wallShoot:
    'brace feet and one hand against an imaginary wall immediately to the RIGHT, twist the head and upper torso LEFT, and extend the free arm LEFT to fire away from the wall; no actual wall drawn',
  wallShootUp:
    'brace bent legs and one hand against an imaginary wall immediately to the RIGHT; free elbow bent with wrist above it beside the face and empty palm facing UP near eye level; no actual wall drawn',
  meleeWindup:
    'RIGHT-facing grounded attack windup: knees flexed, shoulders coiled, attacking empty hand pulled back beside the torso ready to strike RIGHT',
  meleeStrike:
    'RIGHT-facing grounded attack impact: shoulders uncoiled and empty attacking arm thrust RIGHT in a compact powerful palm strike; feet planted wide',
  jumpMeleeWindup:
    'RIGHT-facing airborne attack windup: bent knees, shoulders coiled and empty attacking hand pulled back beside the torso; both feet airborne',
  jumpMeleeStrike:
    'RIGHT-facing airborne attack impact: bent knees and empty attacking arm thrust RIGHT in a compact powerful palm strike; both feet airborne',
} as const;
export type PlatformerActionPose = keyof typeof PLATFORMER_ACTION_DESCRIPTIONS;
export type PlatformerPose = PlatformerBasePose | PlatformerActionPose;

export const PLATFORMER_ACTION_ASSET_ROLES = {
  shoot: 'platformerShoot',
  shootUp: 'platformerShootUp',
  runShoot1: 'platformerRunShoot1',
  runShoot2: 'platformerRunShoot2',
  runShootUp1: 'platformerRunShootUp1',
  runShootUp2: 'platformerRunShootUp2',
  jumpShoot: 'platformerJumpShoot',
  jumpShootUp: 'platformerJumpShootUp',
  wallSlide: 'platformerWallSlide',
  wallShoot: 'platformerWallShoot',
  wallShootUp: 'platformerWallShootUp',
  meleeWindup: 'platformerMeleeWindup',
  meleeStrike: 'platformerMeleeStrike',
  jumpMeleeWindup: 'platformerJumpMeleeWindup',
  jumpMeleeStrike: 'platformerJumpMeleeStrike',
} as const;

export function requiredPlatformerActionPoses(
  spec: Pick<PlatformerSpec, 'playStyle' | 'mechanics' | 'abilityLoadout'>,
): PlatformerActionPose[] {
  const { traversal, combat } = platformerMechanics(spec);
  const poses: PlatformerActionPose[] = [];
  if (combat === 'blaster' || spec.abilityLoadout?.some((a) => a.kind === 'projectile')) {
    poses.push('shoot', 'runShoot1', 'runShoot2', 'jumpShoot');
    if (combat === 'blaster') poses.push('shootUp', 'runShootUp1', 'runShootUp2', 'jumpShootUp');
  }
  if (combat === 'melee')
    poses.push('meleeWindup', 'meleeStrike', 'jumpMeleeWindup', 'jumpMeleeStrike');
  if (traversal === 'wallJump') {
    poses.push('wallSlide');
    if (combat === 'blaster') poses.push('wallShoot', 'wallShootUp');
  }
  return poses;
}

export function platformerActionReference(
  pose: PlatformerActionPose,
): PlatformerBasePose | 'wallSlide' {
  if (pose === 'wallShoot' || pose === 'wallShootUp') return 'wallSlide';
  if (pose.startsWith('runShoot')) return pose.endsWith('1') ? 'walk1' : 'walk2';
  if (pose.startsWith('jump')) return 'jump';
  return 'sideIdle';
}
