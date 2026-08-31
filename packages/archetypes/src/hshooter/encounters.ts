import {
  INTERNAL_HEIGHT,
  INTERNAL_WIDTH,
  TILE_SIZE,
  type HShooterLevel,
  type ShooterWave,
} from '@sparkade/shared';

export const HSHOOTER_WAVE_SPAWN_MARGIN_PX = 16;
export const HSHOOTER_TURRET_DODGE_CLEARANCE_PX = 48;
export const HSHOOTER_TURRET_FIRE_WINDOW_PX = 48;
export const HSHOOTER_PICKUP_SPAWN_MARGIN_PX = 10;
export const HSHOOTER_PICKUP_SCREEN_SPEED_PX = 70;
export const HSHOOTER_PICKUP_VERTICAL_SPEED_PX = 120;
export const HSHOOTER_PICKUP_COLLECTION_SCREEN_X = Math.round(INTERNAL_WIDTH * 0.68);

const PICKUP_HALF_SIZE = 6;
const PICKUP_ROUTE_STEP_S = 1 / 30;
const PICKUP_ROUTE_SAMPLE_PX = 2;
const PICKUP_DESPAWN_SCREEN_X = -16;
const PICKUP_EXTRA_CLEARANCE_PX = 4;

const ENEMY_HALF_WIDTH = 6;
const ENEMY_HALF_HEIGHT = 6;
const TURRET_HALF_WIDTH = 7;
const TURRET_HALF_HEIGHT = 7;

export type HShooterTurretMount = 'ceiling' | 'floor';

export interface HShooterWavePlacement {
  index: number;
  x: number;
  y: number;
  mount: HShooterTurretMount | null;
}

export interface HShooterWavePlacementPlan {
  placements: HShooterWavePlacement[];
  rejectedIndices: number[];
  complete: boolean;
}

export interface HShooterPickupTrajectoryPoint {
  elapsedS: number;
  x: number;
  y: number;
}

export interface HShooterPickupTrajectoryPlan {
  complete: boolean;
  points: HShooterPickupTrajectoryPoint[];
  interceptElapsedS: number;
  failureElapsedS?: number;
  failureWorldX?: number;
  failureTileColumn?: number;
  failureReason?: 'late' | 'clearance' | 'movement';
}

interface FormationOffset {
  index: number;
  x: number;
  y: number;
}

interface TurretSurface {
  y: number;
  mount: HShooterTurretMount;
}

function levelDimensions(level: HShooterLevel): { cols: number; rows: number; height: number } {
  const rows = level.tiles.length;
  const cols = level.tiles[0]?.length ?? 0;
  return { cols, rows, height: Math.min(INTERNAL_HEIGHT, rows * TILE_SIZE) };
}

function solidAt(level: HShooterLevel, tx: number, ty: number): boolean {
  const { cols, rows } = levelDimensions(level);
  if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return true;
  const character = level.tiles[ty]?.[tx] ?? '.';
  return character !== '.' && level.legend[character] === 'solid';
}

function pickupBlockerAt(level: HShooterLevel, tx: number, ty: number): boolean {
  const { cols, rows } = levelDimensions(level);
  if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return true;
  const character = level.tiles[ty]?.[tx] ?? '.';
  const kind = character === '.' ? 'empty' : level.legend[character];
  return kind === 'solid' || kind === 'hazard';
}

function boxIsOpen(
  level: HShooterLevel,
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
): boolean {
  const { cols, height } = levelDimensions(level);
  const left = x - halfWidth;
  const right = x + halfWidth;
  const top = y - halfHeight;
  const bottom = y + halfHeight;
  if (left < 0 || right > cols * TILE_SIZE || top < 0 || bottom > height) return false;

  const minTx = Math.floor(left / TILE_SIZE);
  const maxTx = Math.floor((right - 0.001) / TILE_SIZE);
  const minTy = Math.floor(top / TILE_SIZE);
  const maxTy = Math.floor((bottom - 0.001) / TILE_SIZE);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (solidAt(level, tx, ty)) return false;
    }
  }
  return true;
}

function pickupBoxIsSafe(level: HShooterLevel, x: number, y: number, extraClearance = 0): boolean {
  const { cols, height } = levelDimensions(level);
  const halfSize = PICKUP_HALF_SIZE + extraClearance;
  const left = x - halfSize;
  const right = x + halfSize;
  const top = y - halfSize;
  const bottom = y + halfSize;
  if (left < 0 || right > cols * TILE_SIZE || top < 0 || bottom > height) return false;

  const minTx = Math.floor(left / TILE_SIZE);
  const maxTx = Math.floor((right - 0.001) / TILE_SIZE);
  const minTy = Math.floor(top / TILE_SIZE);
  const maxTy = Math.floor((bottom - 0.001) / TILE_SIZE);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (pickupBlockerAt(level, tx, ty)) return false;
    }
  }
  return true;
}

function pickupFailure(
  reason: HShooterPickupTrajectoryPlan['failureReason'],
  elapsedS: number,
  worldX: number,
  interceptElapsedS: number,
): HShooterPickupTrajectoryPlan {
  return {
    complete: false,
    points: [],
    interceptElapsedS,
    failureElapsedS: elapsedS,
    failureWorldX: worldX,
    failureTileColumn: Math.floor(worldX / TILE_SIZE),
    failureReason: reason,
  };
}

/**
 * Plan the complete authored drift of one pickup. The pickup enters from the
 * right at a fixed 70px/s screen speed, follows a hazard-free route through
 * the real terrain columns, and changes altitude no faster than the player's
 * normal 120px/s movement. Following the same bounded path is therefore a
 * reachable collection opportunity rather than a decorative open spawn cell.
 */
export function planHShooterPickupTrajectory(
  level: HShooterLevel,
  pickupTimeS: number,
  preferredY = INTERNAL_HEIGHT / 2,
): HShooterPickupTrajectoryPlan {
  const spawnScreenX = INTERNAL_WIDTH + HSHOOTER_PICKUP_SPAWN_MARGIN_PX;
  const interceptElapsedS =
    (spawnScreenX - HSHOOTER_PICKUP_COLLECTION_SCREEN_X) / HSHOOTER_PICKUP_SCREEN_SPEED_PX;
  const availableS = level.durationS - pickupTimeS;
  const fullDriftS = (spawnScreenX - PICKUP_DESPAWN_SCREEN_X) / HSHOOTER_PICKUP_SCREEN_SPEED_PX;
  const durationS = Math.min(fullDriftS, availableS);
  const spawnX = pickupTimeS * level.scroll + spawnScreenX;
  const worldVx = level.scroll - HSHOOTER_PICKUP_SCREEN_SPEED_PX;
  const worldXAt = (elapsedS: number) => spawnX + worldVx * elapsedS;

  if (
    !Number.isFinite(pickupTimeS) ||
    pickupTimeS < 0 ||
    !Number.isFinite(level.scroll) ||
    level.scroll <= 0 ||
    !Number.isFinite(durationS) ||
    durationS + 1e-6 < interceptElapsedS
  ) {
    return pickupFailure('late', 0, spawnX, interceptElapsedS);
  }

  const { height } = levelDimensions(level);
  const minY = PICKUP_HALF_SIZE + 1;
  const maxY = height - PICKUP_HALF_SIZE - 1;
  if (maxY < minY) return pickupFailure('clearance', 0, spawnX, interceptElapsedS);
  const ys = Array.from(
    { length: Math.floor((maxY - minY) / PICKUP_ROUTE_SAMPLE_PX) + 1 },
    (_, index) => minY + index * PICKUP_ROUTE_SAMPLE_PX,
  );
  const stepCount = Math.ceil(durationS / PICKUP_ROUTE_STEP_S);
  const times = Array.from({ length: stepCount + 1 }, (_, index) =>
    Math.min(durationS, index * PICKUP_ROUTE_STEP_S),
  );
  const parents: Int16Array[] = [];
  let costs = new Float64Array(ys.length);
  costs.fill(Number.POSITIVE_INFINITY);
  const startParents = new Int16Array(ys.length);
  startParents.fill(-1);
  const centerY = Math.max(minY, Math.min(maxY, preferredY));
  for (let yIndex = 0; yIndex < ys.length; yIndex++) {
    const y = ys[yIndex]!;
    if (!pickupBoxIsSafe(level, spawnX, y)) continue;
    const clearancePenalty = pickupBoxIsSafe(level, spawnX, y, PICKUP_EXTRA_CLEARANCE_PX) ? 0 : 8;
    costs[yIndex] = Math.abs(y - centerY) * 0.08 + clearancePenalty;
  }
  parents.push(startParents);
  if (!costs.some(Number.isFinite)) {
    return pickupFailure('clearance', 0, spawnX, interceptElapsedS);
  }

  for (let step = 1; step < times.length; step++) {
    const elapsedS = times[step]!;
    const previousElapsedS = times[step - 1]!;
    const dt = elapsedS - previousElapsedS;
    const x = worldXAt(elapsedS);
    const previousX = worldXAt(previousElapsedS);
    const maxYSteps = Math.floor(
      (HSHOOTER_PICKUP_VERTICAL_SPEED_PX * dt + 1e-6) / PICKUP_ROUTE_SAMPLE_PX,
    );
    const nextCosts = new Float64Array(ys.length);
    nextCosts.fill(Number.POSITIVE_INFINITY);
    const stepParents = new Int16Array(ys.length);
    stepParents.fill(-1);

    for (let yIndex = 0; yIndex < ys.length; yIndex++) {
      const y = ys[yIndex]!;
      if (!pickupBoxIsSafe(level, x, y)) continue;
      const clearancePenalty = pickupBoxIsSafe(level, x, y, PICKUP_EXTRA_CLEARANCE_PX) ? 0 : 8;
      const fromStart = Math.max(0, yIndex - maxYSteps);
      const fromEnd = Math.min(ys.length - 1, yIndex + maxYSteps);
      for (let previousIndex = fromStart; previousIndex <= fromEnd; previousIndex++) {
        const previousCost = costs[previousIndex]!;
        if (!Number.isFinite(previousCost)) continue;
        const previousY = ys[previousIndex]!;
        if (!pickupBoxIsSafe(level, (previousX + x) / 2, (previousY + y) / 2)) continue;
        const cost =
          previousCost +
          Math.abs(y - previousY) * 0.35 +
          Math.abs(y - centerY) * 0.002 +
          clearancePenalty;
        if (cost < nextCosts[yIndex]!) {
          nextCosts[yIndex] = cost;
          stepParents[yIndex] = previousIndex;
        }
      }
    }

    parents.push(stepParents);
    if (!nextCosts.some(Number.isFinite)) {
      const anyOpen = ys.some((y) => pickupBoxIsSafe(level, x, y));
      return pickupFailure(anyOpen ? 'movement' : 'clearance', elapsedS, x, interceptElapsedS);
    }
    costs = nextCosts;
  }

  let finalYIndex = 0;
  for (let index = 1; index < costs.length; index++) {
    if (costs[index]! < costs[finalYIndex]!) finalYIndex = index;
  }
  const pathIndices = new Int16Array(times.length);
  pathIndices[pathIndices.length - 1] = finalYIndex;
  for (let step = times.length - 1; step > 0; step--) {
    const previous = parents[step]![pathIndices[step]!]!;
    if (previous < 0) {
      return pickupFailure('movement', times[step]!, worldXAt(times[step]!), interceptElapsedS);
    }
    pathIndices[step - 1] = previous;
  }

  return {
    complete: true,
    interceptElapsedS,
    points: times.map((elapsedS, index) => ({
      elapsedS,
      x: worldXAt(elapsedS),
      y: ys[pathIndices[index]!]!,
    })),
  };
}

export function sampleHShooterPickupTrajectoryY(
  plan: HShooterPickupTrajectoryPlan,
  elapsedS: number,
): number | null {
  if (!plan.complete || plan.points.length === 0) return null;
  if (elapsedS <= 0) return plan.points[0]!.y;
  const final = plan.points[plan.points.length - 1]!;
  if (elapsedS >= final.elapsedS) return final.y;
  const approximateIndex = Math.min(
    plan.points.length - 2,
    Math.floor(elapsedS / PICKUP_ROUTE_STEP_S),
  );
  let index = Math.max(0, approximateIndex);
  while (index + 1 < plan.points.length && plan.points[index + 1]!.elapsedS < elapsedS) index++;
  while (index > 0 && plan.points[index]!.elapsedS > elapsedS) index--;
  const before = plan.points[index]!;
  const after = plan.points[index + 1]!;
  const span = Math.max(1e-6, after.elapsedS - before.elapsedS);
  const progress = (elapsedS - before.elapsedS) / span;
  return before.y + (after.y - before.y) * progress;
}

export function hshooterFormationOffsets(
  wave: Pick<ShooterWave, 'count' | 'formation'>,
): FormationOffset[] {
  const count = Math.max(0, Math.floor(wave.count));
  const height = Math.max(64, (count - 1) * 28);
  return Array.from({ length: count }, (_, index) => {
    let x = 0;
    let y = 0;
    switch (wave.formation) {
      case 'line':
        y = (index - (count - 1) / 2) * 30;
        break;
      case 'vee': {
        const rank = Math.ceil(index / 2);
        const side = index === 0 ? 0 : index % 2 === 1 ? -1 : 1;
        y = side * rank * 24;
        x = rank * 22;
        break;
      }
      case 'column':
        x = index * 34;
        break;
      case 'arc': {
        const progress = count > 1 ? index / (count - 1) : 0.5;
        y = (progress - 0.5) * height;
        x = Math.sin(progress * Math.PI) * 26;
        break;
      }
    }
    return { index, x, y };
  });
}

function anchorCandidates(level: HShooterLevel, preferredY: number): number[] {
  const { height } = levelDimensions(level);
  const result = new Set<number>([
    Math.max(ENEMY_HALF_HEIGHT, Math.min(height - ENEMY_HALF_HEIGHT, preferredY)),
  ]);
  for (let y = TILE_SIZE / 2; y < height; y += TILE_SIZE) result.add(y);
  return [...result].sort((a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY) || a - b);
}

function openSegment(
  level: HShooterLevel,
  tx: number,
  ty: number,
): { top: number; bottom: number } {
  const { rows } = levelDimensions(level);
  let top = ty;
  let bottom = ty;
  while (top > 0 && !solidAt(level, tx, top - 1)) top--;
  while (bottom + 1 < rows && !solidAt(level, tx, bottom + 1)) bottom++;
  return { top: top * TILE_SIZE, bottom: (bottom + 1) * TILE_SIZE };
}

function supportedAtSurface(
  level: HShooterLevel,
  x: number,
  y: number,
  mount: HShooterTurretMount,
): boolean {
  const supportY = mount === 'ceiling' ? y - TURRET_HALF_HEIGHT - 1 : y + TURRET_HALF_HEIGHT + 1;
  return [-TURRET_HALF_WIDTH + 1, 0, TURRET_HALF_WIDTH - 1].every((offsetX) =>
    solidAt(level, Math.floor((x + offsetX) / TILE_SIZE), Math.floor(supportY / TILE_SIZE)),
  );
}

function hasFiringWindow(level: HShooterLevel, x: number, y: number): boolean {
  for (let distance = 0; distance <= HSHOOTER_TURRET_FIRE_WINDOW_PX; distance += 4) {
    if (!boxIsOpen(level, x - distance, y, 2, 2)) return false;
  }
  return true;
}

function turretSurfacesAt(level: HShooterLevel, x: number, preferredY: number): TurretSurface[] {
  const { rows } = levelDimensions(level);
  const tx = Math.floor(x / TILE_SIZE);
  const candidates: TurretSurface[] = [];

  for (let ty = 0; ty < rows; ty++) {
    if (solidAt(level, tx, ty)) continue;
    const segment = openSegment(level, tx, ty);
    if (solidAt(level, tx, ty - 1)) {
      const y = ty * TILE_SIZE + TURRET_HALF_HEIGHT;
      const dodgeSpace = segment.bottom - (y + TURRET_HALF_HEIGHT);
      if (
        dodgeSpace >= HSHOOTER_TURRET_DODGE_CLEARANCE_PX &&
        boxIsOpen(level, x, y, TURRET_HALF_WIDTH, TURRET_HALF_HEIGHT) &&
        supportedAtSurface(level, x, y, 'ceiling') &&
        hasFiringWindow(level, x, y)
      ) {
        candidates.push({ y, mount: 'ceiling' });
      }
    }
    if (solidAt(level, tx, ty + 1)) {
      const y = (ty + 1) * TILE_SIZE - TURRET_HALF_HEIGHT;
      const dodgeSpace = y - TURRET_HALF_HEIGHT - segment.top;
      if (
        dodgeSpace >= HSHOOTER_TURRET_DODGE_CLEARANCE_PX &&
        boxIsOpen(level, x, y, TURRET_HALF_WIDTH, TURRET_HALF_HEIGHT) &&
        supportedAtSurface(level, x, y, 'floor') &&
        hasFiringWindow(level, x, y)
      ) {
        candidates.push({ y, mount: 'floor' });
      }
    }
  }

  return candidates.sort(
    (a, b) =>
      Math.abs(a.y - preferredY) - Math.abs(b.y - preferredY) || (a.mount === 'floor' ? -1 : 1),
  );
}

function planTurretWave(
  level: HShooterLevel,
  offsets: readonly FormationOffset[],
  baseX: number,
  preferredY: number,
): HShooterWavePlacement[] {
  const placements: HShooterWavePlacement[] = [];
  const occupied = new Set<string>();
  for (const offset of offsets) {
    const x = baseX + offset.x;
    const surface = turretSurfacesAt(level, x, preferredY + offset.y).find(
      (candidate) => !occupied.has(`${Math.round(x)}:${candidate.y}:${candidate.mount}`),
    );
    if (!surface) continue;
    occupied.add(`${Math.round(x)}:${surface.y}:${surface.mount}`);
    placements.push({ index: offset.index, x, y: surface.y, mount: surface.mount });
  }
  return placements;
}

function planFlyingWave(
  level: HShooterLevel,
  offsets: readonly FormationOffset[],
  baseX: number,
  preferredY: number,
): HShooterWavePlacement[] {
  let best: HShooterWavePlacement[] = [];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const anchorY of anchorCandidates(level, preferredY)) {
    const placements = offsets.flatMap((offset): HShooterWavePlacement[] => {
      const x = baseX + offset.x;
      const y = anchorY + offset.y;
      return boxIsOpen(level, x, y, ENEMY_HALF_WIDTH, ENEMY_HALF_HEIGHT)
        ? [{ index: offset.index, x, y, mount: null }]
        : [];
    });
    const distance = Math.abs(anchorY - preferredY);
    if (
      placements.length > best.length ||
      (placements.length === best.length && distance < bestDistance)
    ) {
      best = placements;
      bestDistance = distance;
    }
    if (best.length === offsets.length) break;
  }
  return best;
}

/**
 * Reconcile one authored wave against terrain at every member's actual world-x
 * spawn column. A coherent vertical shift is preferred for flying formations;
 * members that still intersect terrain are rejected instead of materializing
 * inside a wall. Turrets must mount to an exposed surface with an open firing
 * window and a full dodge lane on the inward side.
 */
export function planHShooterWavePlacement(
  level: HShooterLevel,
  wave: ShooterWave,
  baseX: number,
  preferredY = INTERNAL_HEIGHT / 2,
): HShooterWavePlacementPlan {
  const offsets = hshooterFormationOffsets(wave);
  if (!Number.isFinite(baseX) || !Number.isFinite(preferredY)) {
    return {
      placements: [],
      rejectedIndices: offsets.map(({ index }) => index),
      complete: offsets.length === 0,
    };
  }
  const placements =
    wave.enemyType === 'turret'
      ? planTurretWave(level, offsets, baseX, preferredY)
      : planFlyingWave(level, offsets, baseX, preferredY);
  const placed = new Set(placements.map(({ index }) => index));
  const rejectedIndices = offsets.flatMap(({ index }) => (placed.has(index) ? [] : [index]));
  return {
    placements,
    rejectedIndices,
    complete: rejectedIndices.length === 0,
  };
}

/** Static generation/lint projection of the runtime spawn column. */
export function analyzeAuthoredHShooterWavePlacement(
  level: HShooterLevel,
  wave: ShooterWave,
): HShooterWavePlacementPlan {
  const baseX = wave.t * level.scroll + INTERNAL_WIDTH + HSHOOTER_WAVE_SPAWN_MARGIN_PX;
  return planHShooterWavePlacement(level, wave, baseX);
}
