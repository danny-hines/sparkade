import type { PlatformerBasePose, PlatformerPose } from '@sparkade/shared';

export interface PlatformerPoseState {
  grounded: boolean;
  base: PlatformerBasePose;
  runContact: 1 | 2;
  facing: number;
  wall: number;
  firing: boolean;
  aimUp: boolean;
  attackFacing: number;
  meleeT: number;
}

/** Resolve movement + action together, so firing never stops the running legs.
 * Wall frames are authored with the wall on RIGHT (wallShoot fires LEFT). */
export function platformerActionFrame(state: PlatformerPoseState): {
  pose: PlatformerPose;
  flip: boolean;
} {
  const s = state;
  let pose: PlatformerPose = s.base;
  let facing = s.facing;
  if (s.meleeT > 0.2) {
    pose = s.grounded
      ? s.meleeT > 0.36
        ? 'meleeWindup'
        : 'meleeStrike'
      : s.meleeT > 0.36
        ? 'jumpMeleeWindup'
        : 'jumpMeleeStrike';
    facing = s.attackFacing;
  } else if (!s.grounded && s.wall) {
    pose = s.firing ? (s.aimUp ? 'wallShootUp' : 'wallShoot') : 'wallSlide';
    facing = s.wall;
  } else if (s.firing) {
    pose = !s.grounded
      ? s.aimUp
        ? 'jumpShootUp'
        : 'jumpShoot'
      : s.base === 'walk1' || s.base === 'walk2'
        ? s.aimUp
          ? s.runContact === 1
            ? 'runShootUp1'
            : 'runShootUp2'
          : s.runContact === 1
            ? 'runShoot1'
            : 'runShoot2'
        : s.aimUp
          ? 'shootUp'
          : 'shoot';
    facing = s.attackFacing;
  } else if (s.meleeT > 0 && s.grounded) pose = 'sideIdle';
  return { pose, flip: pose !== 'idle' && facing < 0 };
}

export function platformerBlasterFacing(facing: number, grounded: boolean, wall: number): number {
  return !grounded && wall ? -wall : facing;
}

export interface PlatformerPoseBounds {
  left: number;
  right: number;
}

/** Cache once at load; transparent gutters must not determine wall alignment. */
export function platformerPoseBounds(image: CanvasImageSource): PlatformerPoseBounds {
  const { left, right } = platformerSpriteBounds(image);
  return { left, right };
}

export interface PlatformerSpriteBounds extends PlatformerPoseBounds {
  top: number;
  bottom: number;
}

/** Normalized opaque bounds, shared by wall alignment and projectile targets. */
export function platformerSpriteBounds(image: CanvasImageSource): PlatformerSpriteBounds {
  const full = { left: 0, right: 1, top: 0, bottom: 1 };
  if (typeof document === 'undefined') return full;
  const source = image as { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width,
    right = 0,
    top = canvas.height,
    bottom = 0;
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3]! < 32) continue;
      left = Math.min(left, x);
      right = Math.max(right, x + 1);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
    }
  return right
    ? {
        left: left / canvas.width,
        right: right / canvas.width,
        top: top / canvas.height,
        bottom: bottom / canvas.height,
      }
    : full;
}

/** Keep the visible sprite outside the physical wall, including its jump departure. */
export function platformerWallDrawX(
  x: number,
  width: number,
  bounds: PlatformerPoseBounds,
  flip: boolean,
  leftWall: number,
  rightWall: number,
): number {
  const left = flip ? 1 - bounds.right : bounds.left;
  const right = flip ? 1 - bounds.left : bounds.right;
  return Math.max(leftWall - width * left, Math.min(x, rightWall - width * right));
}
