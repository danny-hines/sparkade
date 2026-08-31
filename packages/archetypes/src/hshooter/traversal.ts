import {
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  TILE_SIZE,
  type HShooterLevel,
  type HShooterTileType,
} from '@sparkade/shared';

/** Runtime control and collision constants. The temporal lint imports these
 * same values so generation can never prove a route for a different ship. */
export const HSHOOTER_PLAYER_SPEED_LOW = 120;
export const HSHOOTER_PLAYER_SPEED_HIGH = 190;
export const HSHOOTER_PLAYER_MIN_SCREEN_X = 8;
export const HSHOOTER_PLAYER_MAX_SCREEN_X = INTERNAL_WIDTH - 12;
export const HSHOOTER_PLAYER_START_SCREEN_X = 50;
export const HSHOOTER_PLAYER_HITBOX = { w: 12, h: 10 } as const;

/** Route samples are finer than one tile so the proof respects the real ship
 * clearance instead of treating a whole open tile as one abstract node. */
export const HSHOOTER_ROUTE_SAMPLE_PX = 2;
export const HSHOOTER_ROUTE_STEP_S = 1 / 30;
export const HSHOOTER_ROUTE_REACTION_S = 0.25;

export type HShooterRouteFailureReason = 'spawn-blocked' | 'clearance' | 'movement';

export interface HShooterRouteAnalysis {
  reachable: boolean;
  failureReason?: HShooterRouteFailureReason;
  failureTimeS?: number;
  failureCameraX?: number;
  failureWorldX?: number;
  failureTileColumn?: number;
  reactionDistancePx: number;
  simulatedSteps: number;
}

function tileKindAt(level: HShooterLevel, tx: number, ty: number): HShooterTileType | 'empty' {
  if (tx < 0 || tx >= (level.tiles[0]?.length ?? 0)) return 'solid';
  if (ty < 0 || ty >= level.tiles.length) return 'empty';
  const character = level.tiles[ty]?.[tx] ?? '.';
  return character === '.' ? 'empty' : (level.legend[character] ?? 'empty');
}

function isRouteBlocker(kind: HShooterTileType | 'empty'): boolean {
  return kind === 'solid' || kind === 'hazard';
}

function runtimeSpawnY(level: HShooterLevel): number {
  const tx = Math.floor(HSHOOTER_PLAYER_START_SCREEN_X / TILE_SIZE);
  const preferredTy = Math.max(
    0,
    Math.min(level.tiles.length - 1, Math.floor(INTERNAL_HEIGHT / 2 / TILE_SIZE)),
  );
  if (tileKindAt(level, tx, preferredTy) !== 'solid') {
    return preferredTy * TILE_SIZE + TILE_SIZE / 2;
  }
  for (let distance = 1; distance < level.tiles.length; distance++) {
    const above = preferredTy - distance;
    if (above >= 0 && tileKindAt(level, tx, above) !== 'solid') {
      return above * TILE_SIZE + TILE_SIZE / 2;
    }
    const below = preferredTy + distance;
    if (below < level.tiles.length && tileKindAt(level, tx, below) !== 'solid') {
      return below * TILE_SIZE + TILE_SIZE / 2;
    }
  }
  return INTERNAL_HEIGHT / 2;
}

function verticalDilate(bits: bigint, steps: number, allowedMask: bigint): bigint {
  let expanded = bits;
  for (let shift = 1; shift <= steps; shift++) {
    const amount = BigInt(shift);
    expanded |= (bits << amount) | (bits >> amount);
  }
  return expanded & allowedMask;
}

function failure(
  reason: HShooterRouteFailureReason,
  timeS: number,
  level: HShooterLevel,
  reactionDistancePx: number,
  simulatedSteps: number,
  blockedWorldX?: number,
): HShooterRouteAnalysis {
  const cameraX = level.scroll * timeS;
  const worldX = blockedWorldX ?? cameraX + HSHOOTER_PLAYER_START_SCREEN_X;
  return {
    reachable: false,
    failureReason: reason,
    failureTimeS: timeS,
    failureCameraX: cameraX,
    failureWorldX: worldX,
    failureTileColumn: Math.floor(worldX / TILE_SIZE),
    reactionDistancePx,
    simulatedSteps,
  };
}

/**
 * Prove that at least one player route survives the complete authored
 * autoscroll. State is sampled in screen space and advanced in real time. Each
 * transition is bounded by the runtime's fast movement speed; each destination
 * must fit the actual 12x10 ship box outside both solids and hazards.
 *
 * The collision window extends ahead by scroll*reaction time. This rejects
 * sharp blind corners that are technically solvable only by steering before a
 * human can read the obstruction. Horizontal samples are also kept far enough
 * from the front edge for that reserved sightline to remain on screen.
 */
export function analyzeHShooterRoute(level: HShooterLevel): HShooterRouteAnalysis {
  const cols = level.tiles[0]?.length ?? 0;
  const validTiming =
    Number.isFinite(level.scroll) &&
    level.scroll > 0 &&
    Number.isFinite(level.durationS) &&
    level.durationS > 0;
  const reactionDistancePx = validTiming
    ? Math.max(0, level.scroll * HSHOOTER_ROUTE_REACTION_S)
    : 0;
  if (!cols || !level.tiles.length || !validTiming) {
    return failure('spawn-blocked', 0, level, reactionDistancePx, 0);
  }

  const halfWidth = HSHOOTER_PLAYER_HITBOX.w / 2;
  const halfHeight = HSHOOTER_PLAYER_HITBOX.h / 2;
  const minY = halfHeight + 1;
  const maxY = INTERNAL_HEIGHT - halfHeight - 1;
  const maxScreenX = Math.min(
    HSHOOTER_PLAYER_MAX_SCREEN_X,
    INTERNAL_WIDTH - halfWidth - reactionDistancePx,
  );
  if (maxScreenX < HSHOOTER_PLAYER_START_SCREEN_X) {
    return failure('spawn-blocked', 0, level, reactionDistancePx, 0);
  }

  const screenXs = Array.from(
    {
      length:
        Math.floor((maxScreenX - HSHOOTER_PLAYER_MIN_SCREEN_X) / HSHOOTER_ROUTE_SAMPLE_PX) + 1,
    },
    (_, index) => HSHOOTER_PLAYER_MIN_SCREEN_X + index * HSHOOTER_ROUTE_SAMPLE_PX,
  );
  const ys = Array.from(
    { length: Math.floor((maxY - minY) / HSHOOTER_ROUTE_SAMPLE_PX) + 1 },
    (_, index) => minY + index * HSHOOTER_ROUTE_SAMPLE_PX,
  );
  const allowedYMask = (1n << BigInt(ys.length)) - 1n;
  const rowMasks = Array.from({ length: level.tiles.length }, (_, ty) => {
    const tileTop = ty * TILE_SIZE;
    const tileBottom = tileTop + TILE_SIZE;
    let mask = 0n;
    for (let index = 0; index < ys.length; index++) {
      const y = ys[index]!;
      if (y + halfHeight > tileTop && y - halfHeight < tileBottom) {
        mask |= 1n << BigInt(index);
      }
    }
    return mask;
  });
  const blockedRangeMasks = new Map<string, bigint>();
  const openMaskAt = (cameraX: number, screenX: number): bigint => {
    const worldX = cameraX + screenX;
    const left = worldX - halfWidth;
    const right = worldX + halfWidth + reactionDistancePx;
    const minTx = Math.floor(left / TILE_SIZE);
    const maxTx = Math.floor((right - 0.001) / TILE_SIZE);
    if (minTx < 0 || maxTx >= cols) return 0n;
    const key = `${minTx}:${maxTx}`;
    let blocked = blockedRangeMasks.get(key);
    if (blocked === undefined) {
      blocked = 0n;
      for (let tx = minTx; tx <= maxTx; tx++) {
        for (let ty = 0; ty < level.tiles.length; ty++) {
          if (isRouteBlocker(tileKindAt(level, tx, ty))) blocked |= rowMasks[ty]!;
        }
      }
      blockedRangeMasks.set(key, blocked);
    }
    return allowedYMask & ~blocked;
  };

  const startXIndex = Math.round(
    (HSHOOTER_PLAYER_START_SCREEN_X - HSHOOTER_PLAYER_MIN_SCREEN_X) / HSHOOTER_ROUTE_SAMPLE_PX,
  );
  const startY = runtimeSpawnY(level);
  const startYIndex = Math.round((startY - minY) / HSHOOTER_ROUTE_SAMPLE_PX);
  let reachable = Array<bigint>(screenXs.length).fill(0n);
  const startBit = startYIndex >= 0 && startYIndex < ys.length ? 1n << BigInt(startYIndex) : 0n;
  if ((openMaskAt(0, screenXs[startXIndex]!) & startBit) === 0n) {
    return failure('spawn-blocked', 0, level, reactionDistancePx, 0);
  }
  reachable[startXIndex] = startBit;

  let timeS = 0;
  let simulatedSteps = 0;
  while (timeS < level.durationS - 1e-9) {
    const dt = Math.min(HSHOOTER_ROUTE_STEP_S, level.durationS - timeS);
    const movementPx = HSHOOTER_PLAYER_SPEED_HIGH * dt;
    const maxDxSteps = Math.floor(movementPx / HSHOOTER_ROUTE_SAMPLE_PX + 1e-9);
    const next = Array<bigint>(screenXs.length).fill(0n);
    for (let sourceX = 0; sourceX < reachable.length; sourceX++) {
      const sourceBits = reachable[sourceX]!;
      if (sourceBits === 0n) continue;
      for (let dxSteps = -maxDxSteps; dxSteps <= maxDxSteps; dxSteps++) {
        const destinationX = sourceX + dxSteps;
        if (destinationX < 0 || destinationX >= next.length) continue;
        const dx = Math.abs(dxSteps) * HSHOOTER_ROUTE_SAMPLE_PX;
        const remainingY = Math.sqrt(Math.max(0, movementPx * movementPx - dx * dx));
        const maxDySteps = Math.floor(remainingY / HSHOOTER_ROUTE_SAMPLE_PX + 1e-9);
        next[destinationX] =
          next[destinationX]! | verticalDilate(sourceBits, maxDySteps, allowedYMask);
      }
    }

    timeS += dt;
    simulatedSteps++;
    const cameraX = level.scroll * timeS;
    let anySafeScreenState = false;
    let anyReachable = false;
    let firstBlockedWorldX: number | undefined;
    for (let xIndex = 0; xIndex < next.length; xIndex++) {
      const open = openMaskAt(cameraX, screenXs[xIndex]!);
      if (open !== 0n) anySafeScreenState = true;
      else firstBlockedWorldX ??= cameraX + screenXs[xIndex]!;
      next[xIndex] = next[xIndex]! & open;
      if (next[xIndex] !== 0n) anyReachable = true;
    }
    if (!anyReachable) {
      return failure(
        anySafeScreenState && firstBlockedWorldX === undefined ? 'movement' : 'clearance',
        timeS,
        level,
        reactionDistancePx,
        simulatedSteps,
        firstBlockedWorldX,
      );
    }
    reachable = next;
  }

  return { reachable: true, reactionDistancePx, simulatedSteps };
}
