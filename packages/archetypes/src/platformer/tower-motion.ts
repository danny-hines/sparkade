import { cellsUnder, moveAABB, type TileGrid, type AABB } from '@sparkade/engine';
import { TILE_SIZE, type PlatformerLevel } from '@sparkade/shared';

export const TOWER_MOTION = {
  platformSideHeight: 8,
  gravity: 860,
  jump: -302,
  walk: 88,
  run: 142,
  acceleration: 1472.5,
  airAcceleration: 855,
  maxFall: 330,
  slideFall: 65,
  wallPush: 90,
  wallLock: 0.09,
} as const;

export interface TowerMotion {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  grounded: boolean;
  wall: number;
  lock: number;
  coyote: number;
  buffer: number;
}

export interface TowerInput {
  direction: number;
  run: boolean;
  jump: boolean;
  release: boolean;
  drop: boolean;
}

/** The runtime and tower route validator execute this exact controller and tile collision. */
export function stepTowerMotion(
  grid: TileGrid,
  state: TowerMotion,
  input: TowerInput,
  dt: number,
  movingPlatforms: readonly AABB[] = [],
): TowerMotion {
  const s = { ...state };
  const k = TOWER_MOTION;
  const touches = (direction: number) => {
    const x = Math.floor((direction < 0 ? s.x - 0.1 : s.x + s.w + 0.1) / TILE_SIZE);
    if (
      !input.drop &&
      movingPlatforms.some(
        (platform) =>
          Math.abs(
            (direction < 0 ? s.x : s.x + s.w) -
              (direction < 0 ? platform.x + platform.w : platform.x),
          ) < 0.2 &&
          Math.min(s.y + s.h - 2, platform.y + platform.h) - Math.max(s.y + 2, platform.y) >= 2,
      )
    )
      return true;
    if (x < 0 || x >= grid.cols) return false;
    // A short exposed ledge is a usable contact, too. One-way slabs retain
    // jump-through undersides and drop-through behavior.
    for (
      let y = Math.floor((s.y + 2) / TILE_SIZE);
      y <= Math.floor((s.y + s.h - 2) / TILE_SIZE);
      y++
    ) {
      if (y < 0 || y >= grid.rows) continue;
      const kind = grid.solidityAt(x, y);
      const height =
        kind === 'solid'
          ? TILE_SIZE
          : kind === 'platform' && !input.drop
            ? k.platformSideHeight
            : 0;
      if (
        height &&
        Math.min(s.y + s.h - 2, y * TILE_SIZE + height) - Math.max(s.y + 2, y * TILE_SIZE) >= 2
      )
        return true;
    }
    return false;
  };
  s.wall = touches(-1) ? -1 : touches(1) ? 1 : 0;
  s.lock = Math.max(0, s.lock - dt);
  s.coyote = s.grounded ? 0.1 : Math.max(0, s.coyote - dt);
  s.buffer = input.jump ? 0.12 : Math.max(0, s.buffer - dt);
  if (s.lock === 0) {
    const target = input.direction * (input.run ? k.run : k.walk);
    const acceleration = s.grounded ? k.acceleration : k.airAcceleration;
    s.vx += Math.max(-acceleration * dt, Math.min(acceleration * dt, target - s.vx));
  }
  if (s.buffer > 0 && (s.grounded || s.coyote > 0 || s.wall !== 0)) {
    s.vy = k.jump;
    if (!s.grounded && s.coyote === 0 && s.wall !== 0) {
      s.vx = -s.wall * k.wallPush;
      s.lock = k.wallLock;
    }
    s.buffer = 0;
    s.coyote = 0;
    s.grounded = false;
  }
  if (input.release && s.vy < -80) s.vy = -80;
  s.vy = Math.min(k.maxFall, s.vy + k.gravity * dt);
  if (s.wall !== 0 && input.direction === s.wall && s.vy > 0 && s.lock === 0)
    s.vy = Math.min(k.slideFall, s.vy);
  const moved = moveAABB(grid, s, s.vx * dt, s.vy * dt, {
    dropThrough: input.drop,
    platformSideHeight: k.platformSideHeight,
  });
  if (!input.drop)
    for (const platform of movingPlatforms) {
      if (s.y + s.h <= platform.y || s.y >= platform.y + platform.h) continue;
      if (s.vx > 0 && s.x + s.w <= platform.x + 0.01 && moved.x + s.w >= platform.x) {
        moved.x = platform.x - s.w - 0.001;
        moved.hitX = true;
      } else if (
        s.vx < 0 &&
        s.x >= platform.x + platform.w - 0.01 &&
        moved.x <= platform.x + platform.w
      ) {
        moved.x = platform.x + platform.w + 0.001;
        moved.hitX = true;
      }
    }
  s.x = moved.x;
  s.y = moved.y;
  if (moved.hitX) s.vx = 0;
  if (moved.hitY) s.vy = 0;
  s.grounded = moved.onGround;
  s.wall = touches(-1) ? -1 : touches(1) ? 1 : 0;
  return s;
}

/** Conservative additional edges between rest ledges. Every edge has a replayable input policy;
 * no airborne contact is treated as a safe standing cell or a teleport up a wall. */
export function towerClimbDestinations(
  level: PlatformerLevel,
  from: { x: number; y: number },
  playerHeight: 1 | 2,
): Set<string> {
  const rows = level.tiles.length;
  const cols = level.tiles[0]?.length ?? 0;
  const kind = (x: number, y: number) => level.legend[level.tiles[y]?.[x] ?? '.'] ?? 'empty';
  const solid = (x: number, y: number) =>
    ['solid', 'ice', 'conveyorLeft', 'conveyorRight'].includes(kind(x, y));
  const grid: TileGrid = {
    rows,
    cols,
    tileSize: TILE_SIZE,
    solidityAt: (x, y) =>
      solid(x, y) ? 'solid' : kind(x, y) === 'platform' ? 'platform' : 'empty',
  };
  const destinations = new Set<string>();
  for (const direction of [-1, 1]) {
    // Only inspect approaches that actually have a nearby wall at jumping height.
    let nearbyWall = false;
    for (let dx = 1; dx <= 4; dx++)
      for (let dy = 0; dy <= 4; dy++) {
        if (solid(from.x + direction * dx, from.y - dy)) nearbyWall = true;
      }
    if (!nearbyWall) continue;
    let s: TowerMotion = {
      x: from.x * TILE_SIZE,
      y: (from.y + 1 - playerHeight) * TILE_SIZE - 0.001,
      w: TILE_SIZE,
      h: playerHeight * TILE_SIZE,
      vx: 0,
      vy: 0,
      grounded: true,
      wall: 0,
      lock: 0,
      coyote: 0,
      buffer: 0,
    };
    let lastJump = -1;
    let highest = s.y;
    let stalled = 0;
    for (let frame = 0; frame < 1800; frame++) {
      const jump = frame === 0 || (s.wall !== 0 && s.lock === 0 && frame - lastJump > 16);
      if (jump) lastJump = frame;
      s = stepTowerMotion(
        grid,
        s,
        { direction, run: true, jump, release: false, drop: false },
        1 / 60,
      );
      if (
        s.y < 0 ||
        s.y > (from.y + 3) * TILE_SIZE ||
        cellsUnder(s, TILE_SIZE).some((c) => kind(c.tx, c.ty) === 'hazard')
      )
        break;
      if (s.y < highest - 1) {
        highest = s.y;
        stalled = 0;
      } else stalled++;
      if (stalled > 120) break;
      if (s.grounded && frame > 4) {
        const x = Math.round(s.x / TILE_SIZE);
        const y = Math.round((s.y + s.h) / TILE_SIZE) - 1;
        // Require a whole supported tile so the normal graph can restart safely.
        if (Math.abs(s.x / TILE_SIZE - x) < 0.35 && ['solid', 'platform'].includes(kind(x, y + 1)))
          destinations.add(`${x},${y}`);
      }
    }
  }
  return destinations;
}
