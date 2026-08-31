import type { AdventureEntity, AdventureRoom } from '@sparkade/shared';

export interface AdventureCell {
  x: number;
  y: number;
}

export type AdventureBossPattern = 'charge' | 'teleport' | 'spiral' | 'summon';

export const ADVENTURE_SHOOTER_MIN_LANE_CELLS = 6;
export const ADVENTURE_ENCOUNTER_MIN_SPREAD_CELLS = 10;

const ENEMY_TYPES = new Set(['walker', 'flyer', 'shooter', 'chaser', 'bruiser']);

function key(cell: AdventureCell): string {
  return `${cell.x},${cell.y}`;
}

function uniqueCells(cells: readonly AdventureCell[]): AdventureCell[] {
  const seen = new Set<string>();
  return cells.filter((cell) => {
    const cellKey = key(cell);
    if (seen.has(cellKey)) return false;
    seen.add(cellKey);
    return true;
  });
}

export function adventureRoomTileKind(room: AdventureRoom, x: number, y: number): string {
  const ch = room.tiles[y]?.[x];
  return ch === undefined || ch === '.' ? 'floor' : (room.legend[ch] ?? 'floor');
}

export function adventureCellIsSafe(room: AdventureRoom, x: number, y: number): boolean {
  if (x < 1 || y < 1 || x >= (room.tiles[0]?.length ?? 0) - 1 || y >= room.tiles.length - 1) {
    return false;
  }
  const kind = adventureRoomTileKind(room, x, y);
  return kind !== 'wall' && kind !== 'pit' && kind !== 'hazard' && kind !== 'block';
}

export function adventureCellIsCalmFloor(room: AdventureRoom, x: number, y: number): boolean {
  return adventureCellIsSafe(room, x, y) && adventureRoomTileKind(room, x, y) === 'floor';
}

/** Three cells of approach depth plus one shoulder cell on each side of a
 * two-cell door. Runtime carves the doorway itself; generation owns this
 * interior reaction area. */
export function adventureDoorReactionCells(room: AdventureRoom): AdventureCell[] {
  const height = room.tiles.length;
  const width = room.tiles[0]?.length ?? 0;
  if (width < 8 || height < 8) return [];
  const middleX = Math.floor(width / 2);
  const middleY = Math.floor(height / 2);
  const cells: AdventureCell[] = [];
  if (room.doors.n !== 'none') {
    for (let y = 1; y <= 3; y++) {
      for (let x = middleX - 2; x <= middleX + 1; x++) cells.push({ x, y });
    }
  }
  if (room.doors.s !== 'none') {
    for (let y = height - 4; y <= height - 2; y++) {
      for (let x = middleX - 2; x <= middleX + 1; x++) cells.push({ x, y });
    }
  }
  if (room.doors.w !== 'none') {
    for (let x = 1; x <= 3; x++) {
      for (let y = middleY - 2; y <= middleY + 1; y++) cells.push({ x, y });
    }
  }
  if (room.doors.e !== 'none') {
    for (let x = width - 4; x <= width - 2; x++) {
      for (let y = middleY - 2; y <= middleY + 1; y++) cells.push({ x, y });
    }
  }
  return uniqueCells(cells);
}

/** The pickup/interaction cell and its four approach sides. */
export function adventureInteractionCells(x: number, y: number): AdventureCell[] {
  return [
    { x, y },
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
}

export function adventureInteractionSpaceClear(room: AdventureRoom, x: number, y: number): boolean {
  if (!adventureCellIsCalmFloor(room, x, y)) return false;
  const approaches = adventureInteractionCells(x, y).slice(1);
  return approaches.filter((cell) => adventureCellIsCalmFloor(room, cell.x, cell.y)).length >= 3;
}

function projectileBlocked(room: AdventureRoom, x: number, y: number): boolean {
  const kind = adventureRoomTileKind(room, x, y);
  return kind === 'wall' || kind === 'block';
}

/** Sample a cell-center ray densely enough to include diagonal corner
 * crossings. This mirrors the runtime rule that walls and blocks stop shots,
 * while pits and hazards do not. */
export function adventureProjectileLineClear(
  room: AdventureRoom,
  from: AdventureCell,
  to: AdventureCell,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 4;
  if (steps <= 0) return false;
  for (let step = 1; step < steps; step++) {
    const t = step / steps;
    const x = Math.floor(from.x + 0.5 + dx * t);
    const y = Math.floor(from.y + 0.5 + dy * t);
    if (projectileBlocked(room, x, y)) return false;
  }
  return true;
}

function targetHasLateralDodge(
  room: AdventureRoom,
  shooter: AdventureCell,
  target: AdventureCell,
  safelyReachable: ReadonlySet<string>,
): boolean {
  const horizontalShot = Math.abs(target.x - shooter.x) >= Math.abs(target.y - shooter.y);
  const candidates = horizontalShot
    ? [
        { x: target.x, y: target.y - 1 },
        { x: target.x, y: target.y + 1 },
      ]
    : [
        { x: target.x - 1, y: target.y },
        { x: target.x + 1, y: target.y },
      ];
  return candidates.some(
    (cell) => safelyReachable.has(key(cell)) && adventureCellIsSafe(room, cell.x, cell.y),
  );
}

/** Prove that a shooter can engage a safely reachable player position at a
 * readable distance, with an unobstructed projectile and a lateral dodge cell. */
export function adventureShooterHasClearLane(
  room: AdventureRoom,
  shooter: AdventureCell,
  safelyReachable: ReadonlySet<string>,
): boolean {
  if (!adventureCellIsSafe(room, shooter.x, shooter.y)) return false;
  for (const targetKey of safelyReachable) {
    const [xText, yText] = targetKey.split(',');
    const target = { x: Number(xText), y: Number(yText) };
    if (!Number.isInteger(target.x) || !Number.isInteger(target.y)) continue;
    const distance = Math.hypot(target.x - shooter.x, target.y - shooter.y);
    if (distance < ADVENTURE_SHOOTER_MIN_LANE_CELLS) continue;
    if (!adventureCellIsSafe(room, target.x, target.y)) continue;
    if (!targetHasLateralDodge(room, shooter, target, safelyReachable)) continue;
    if (adventureProjectileLineClear(room, shooter, target)) return true;
  }
  return false;
}

export function adventureEnemyEncounterSpread(entities: readonly AdventureEntity[]): number {
  const enemies = entities.filter((entity) => ENEMY_TYPES.has(entity.type));
  let spread = 0;
  for (let first = 0; first < enemies.length; first++) {
    for (let second = first + 1; second < enemies.length; second++) {
      spread = Math.max(
        spread,
        Math.abs(enemies[first]!.x - enemies[second]!.x) +
          Math.abs(enemies[first]!.y - enemies[second]!.y),
      );
    }
  }
  return spread;
}

export interface AdventureBossArenaRequirements {
  dodgeRoute: AdventureCell[];
  chargeLanes: AdventureCell[];
  teleportPads: AdventureCell[][];
  summonPads: AdventureCell[][];
  all: AdventureCell[];
}

function rect(x: number, y: number, width: number, height: number): AdventureCell[] {
  const cells: AdventureCell[] = [];
  for (let ty = y; ty < y + height; ty++) {
    for (let tx = x; tx < x + width; tx++) cells.push({ x: tx, y: ty });
  }
  return cells;
}

/** Stable arena vocabulary: a large outer dodge loop joined to a two-cell
 * central cross, with four well-separated landing pads. Quadrants remain free
 * for authored fixtures, so rooms retain variety instead of becoming empty
 * rectangles. */
export function adventureBossArenaRequirements(
  room: AdventureRoom,
  patterns: readonly AdventureBossPattern[],
): AdventureBossArenaRequirements {
  const height = room.tiles.length;
  const width = room.tiles[0]?.length ?? 0;
  if (width < 16 || height < 12) {
    return { dodgeRoute: [], chargeLanes: [], teleportPads: [], summonPads: [], all: [] };
  }
  const left = 4;
  const right = width - 5;
  const top = 3;
  const bottom = height - 4;
  const centerLeft = Math.floor(width / 2) - 1;
  const centerTop = Math.floor(height / 2) - 1;

  const dodgeRoute: AdventureCell[] = [];
  for (let x = left; x <= right; x++) {
    dodgeRoute.push({ x, y: top }, { x, y: bottom });
  }
  for (let y = top; y <= bottom; y++) {
    dodgeRoute.push({ x: left, y }, { x: right, y });
  }
  for (let x = left; x <= right; x++) {
    dodgeRoute.push({ x, y: centerTop }, { x, y: centerTop + 1 });
  }
  for (let y = top; y <= bottom; y++) {
    dodgeRoute.push({ x: centerLeft, y }, { x: centerLeft + 1, y });
  }

  const chargeLanes = patterns.includes('charge')
    ? uniqueCells([
        ...rect(left, centerTop, right - left + 1, 2),
        ...rect(centerLeft, top, 2, bottom - top + 1),
      ])
    : [];
  const teleportPads = patterns.includes('teleport')
    ? [
        rect(left + 2, top + 2, 2, 2),
        rect(right - 3, top + 2, 2, 2),
        rect(left + 2, bottom - 3, 2, 2),
        rect(right - 3, bottom - 3, 2, 2),
      ]
    : [];
  const summonPads = patterns.includes('summon')
    ? [rect(left + 2, centerTop, 2, 2), rect(right - 3, centerTop, 2, 2)]
    : [];
  const all = uniqueCells([
    ...dodgeRoute,
    ...chargeLanes,
    ...teleportPads.flat(),
    ...summonPads.flat(),
  ]);
  return {
    dodgeRoute: uniqueCells(dodgeRoute),
    chargeLanes,
    teleportPads,
    summonPads,
    all,
  };
}

export interface AdventureBossArenaAnalysis {
  dodgeRouteClear: boolean;
  chargeLanesClear: boolean;
  openTeleportPads: number;
  requiredTeleportPads: number;
  openSummonPads: number;
  requiredSummonPads: number;
}

export function analyzeAdventureBossArena(
  room: AdventureRoom,
  patterns: readonly AdventureBossPattern[],
): AdventureBossArenaAnalysis {
  const requirements = adventureBossArenaRequirements(room, patterns);
  const clear = (cells: readonly AdventureCell[]): boolean =>
    cells.length > 0 && cells.every((cell) => adventureCellIsCalmFloor(room, cell.x, cell.y));
  return {
    dodgeRouteClear: clear(requirements.dodgeRoute),
    chargeLanesClear: requirements.chargeLanes.length === 0 || clear(requirements.chargeLanes),
    openTeleportPads: requirements.teleportPads.filter(clear).length,
    requiredTeleportPads: requirements.teleportPads.length,
    openSummonPads: requirements.summonPads.filter(clear).length,
    requiredSummonPads: requirements.summonPads.length,
  };
}
