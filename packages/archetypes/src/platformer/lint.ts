// Platformer semantic lints: grounded spawn/exit/checkpoints, jump-kernel
// reachability along the primary route, entity budgets, content floors.
import { BUDGET, type LintError, type PlatformerLevel, type PlatformerSpec } from '@sparkade/shared';
import {
  err,
  lintDuration,
  lintLegendCoverage,
  lintMusic,
  lintRowLengths,
  lintSongRef,
  lintSpriteRefs,
} from '../common';

const ENEMY_TYPES = ['walker', 'flyer', 'shooter', 'chaser'] as const;

/** Max jump reach in tiles: ~4 across, ~3 up (matches engine physics + coyote). */
const JUMP_DX = 4;
const JUMP_DY_UP = 3;
const SPRING_DY_UP = 7;
const FALL_DX = 5;

type CellKind = 'empty' | 'solid' | 'platform' | 'hazard' | 'checkpoint' | 'exit' | 'decoration';

export function parseLevelGrid(level: PlatformerLevel): {
  w: number;
  h: number;
  kind(x: number, y: number): CellKind;
  standable(x: number, y: number): boolean;
} {
  const h = level.tiles.length;
  const w = level.tiles[0]?.length ?? 0;
  const kind = (x: number, y: number): CellKind => {
    if (x < 0 || x >= w || y < 0 || y >= h) return 'empty';
    const ch = level.tiles[y]![x]!;
    if (ch === '.') return 'empty';
    return (level.legend[ch] as CellKind | undefined) ?? 'empty';
  };
  const solidLike = (k: CellKind) => k === 'solid' || k === 'platform';
  const standable = (x: number, y: number): boolean => {
    const here = kind(x, y);
    if (here === 'solid' || here === 'platform' || here === 'hazard') return false;
    if (y + 1 >= h) return false;
    return solidLike(kind(x, y + 1));
  };
  return { w, h, kind, standable };
}

/**
 * Coarse flood-fill with a jump kernel over "standing cells" (empty cell with
 * solid/platform directly beneath). From each standing cell you can reach any
 * standing cell within the jump kernel (|dx| ≤ 4, rise ≤ 3) or fall to cells
 * below (|dx| ≤ 5, any depth). Springs boost the rise to 7. Intentionally
 * coarse — it catches impossible gaps, not pixel-perfect jumps.
 */
export function reachableCells(level: PlatformerLevel): Set<string> {
  const grid = parseLevelGrid(level);
  const springs = new Set(
    level.entities.filter((e) => e.type === 'spring').map((e) => `${e.x},${e.y}`),
  );
  const key = (x: number, y: number) => `${x},${y}`;
  const start = { x: level.playerSpawn.x, y: level.playerSpawn.y };
  // Drop the spawn to its standing row.
  while (start.y + 1 < grid.h && !grid.standable(start.x, start.y)) start.y++;
  const seen = new Set<string>([key(start.x, start.y)]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    const rise = springs.has(key(cur.x, cur.y)) || springs.has(key(cur.x, cur.y + 1)) ? SPRING_DY_UP : JUMP_DY_UP;
    for (let dx = -Math.max(JUMP_DX, FALL_DX); dx <= Math.max(JUMP_DX, FALL_DX); dx++) {
      for (let dy = -rise; dy <= grid.h; dy++) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (nx < 0 || nx >= grid.w || ny < 0 || ny >= grid.h) continue;
        const up = dy < 0;
        if (up && Math.abs(dx) > JUMP_DX) continue;
        if (!up && dy <= 1 && Math.abs(dx) > JUMP_DX) continue;
        if (!up && dy > 1 && Math.abs(dx) > FALL_DX) continue;
        if (!grid.standable(nx, ny)) continue;
        const k = key(nx, ny);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return seen;
}

function nearestStanding(level: PlatformerLevel, x: number, y: number): string | null {
  const grid = parseLevelGrid(level);
  for (let dy = 0; dy <= 3; dy++) {
    if (grid.standable(x, y + dy)) return `${x},${y + dy}`;
  }
  return null;
}

export function lintPlatformer(spec: PlatformerSpec): LintError[] {
  const out: LintError[] = [];
  out.push(...lintMusic(spec), ...lintSpriteRefs(spec));

  const enemyTypesUsed = new Set<string>();
  let pickupCount = 0;
  let powerupCount = 0;
  let checkpointTotal = 0;

  spec.levels.forEach((level, li) => {
    const path = `/levels/${li}`;
    out.push(...lintRowLengths(level.tiles, path, 'PLAT_ROWS_UNEQUAL'));
    // Bail on further geometry checks if the grid is ragged.
    if (out.some((e) => e.code === 'PLAT_ROWS_UNEQUAL' && e.path.startsWith(path))) return;
    out.push(...lintLegendCoverage(level.tiles, level.legend, path, 'PLAT_LEGEND_UNKNOWN_CHAR'));
    out.push(...lintSongRef(level.musicSong, `${path}/musicSong`, spec));

    const grid = parseLevelGrid(level);
    if (grid.w > BUDGET.maxLevelWidthTiles) {
      out.push(err('PLAT_TOO_WIDE', `${path}/tiles`, `level is ${grid.w} tiles wide; max ${BUDGET.maxLevelWidthTiles}`));
    }

    // Spawn / exit in-bounds, grounded, and never embedded in a solid tile.
    // (The engine also lifts these out of solid at load as a safety net, but a
    // correct spec must not rely on it — a spawn in solid starts the player
    // stuck; an exit in solid can't be touched.)
    const spawn = level.playerSpawn;
    const spawnCell = nearestStanding(level, spawn.x, spawn.y);
    if (spawn.x < grid.w && spawn.y < grid.h && grid.kind(spawn.x, spawn.y) === 'solid') {
      out.push(err('PLAT_SPAWN_IN_SOLID', `${path}/playerSpawn`, `playerSpawn (${spawn.x},${spawn.y}) is inside a solid tile — the player would spawn stuck; place it in an open cell on or just above the ground`));
    } else if (spawn.x >= grid.w || spawn.y >= grid.h || !spawnCell) {
      out.push(err('PLAT_SPAWN_NOT_GROUNDED', `${path}/playerSpawn`, 'playerSpawn must sit on or just above solid ground'));
    }
    const exit = level.exit;
    const exitCell = nearestStanding(level, exit.x, exit.y);
    if (exit.x < grid.w && exit.y < grid.h && grid.kind(exit.x, exit.y) === 'solid') {
      out.push(err('PLAT_EXIT_IN_SOLID', `${path}/exit`, `exit (${exit.x},${exit.y}) is inside a solid tile and can't be reached; place it in an open cell on or just above the ground`));
    } else if (exit.x >= grid.w || exit.y >= grid.h || !exitCell) {
      out.push(err('PLAT_EXIT_NOT_GROUNDED', `${path}/exit`, 'exit must sit on or just above solid ground'));
    }

    // Checkpoints: exist mid-level, grounded.
    let checkpoints = 0;
    level.tiles.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if ((level.legend[row[x]!] ?? '') === 'checkpoint') {
          checkpoints++;
          checkpointTotal++;
          const below = grid.kind(x, y + 1);
          if (below !== 'solid' && below !== 'platform') {
            out.push(err('PLAT_CHECKPOINT_FLOATING', `${path}/tiles/${y}`, `checkpoint at (${x},${y}) is not on solid ground`));
          }
        }
      }
    });
    if (checkpoints === 0) {
      out.push(err('PLAT_NO_CHECKPOINT', `${path}/tiles`, 'each level needs at least one mid-level checkpoint tile'));
    }

    // Reachability: exit must be reachable from spawn with the jump kernel.
    if (spawnCell && exitCell) {
      const reach = reachableCells(level);
      if (!reach.has(exitCell)) {
        out.push(
          err('PLAT_EXIT_UNREACHABLE', `${path}/exit`, 'exit is not reachable from spawn (a gap or wall exceeds the max jump: 4 tiles across, 3 up) — reshape terrain along the main route'),
        );
      }
    }

    // Entity budget: max simultaneous active within any one-screen (32-tile) window.
    const active = level.entities.filter((e) => e.type !== 'coin' && e.type !== 'heart');
    const xs = active.map((e) => e.x).sort((a, b) => a - b);
    let maxWindow = 0;
    for (let i = 0; i < xs.length; i++) {
      let j = i;
      while (j < xs.length && xs[j]! - xs[i]! <= 40) j++;
      maxWindow = Math.max(maxWindow, j - i);
    }
    if (maxWindow > BUDGET.maxActiveEntities - 4) {
      out.push(err('PLAT_ENTITY_BUDGET', `${path}/entities`, `up to ${maxWindow} concurrent entities in one screen region; keep it under ${BUDGET.maxActiveEntities - 4}`));
    }

    for (const e of level.entities) {
      if ((ENEMY_TYPES as readonly string[]).includes(e.type)) enemyTypesUsed.add(e.type);
      if (e.type === 'coin' || e.type === 'heart' || e.type === 'powerup') pickupCount++;
      if (e.type === 'powerup') powerupCount++;
      if (e.x >= grid.w || e.y >= grid.h) {
        out.push(err('PLAT_ENTITY_OOB', `${path}/entities`, `${e.type} at (${e.x},${e.y}) is outside the ${grid.w}x${grid.h} level`));
      } else if (grid.kind(e.x, e.y) === 'solid') {
        out.push(err('PLAT_ENTITY_IN_SOLID', `${path}/entities`, `${e.type} at (${e.x},${e.y}) is embedded in a solid tile and can't be reached — move it to an open cell on or just above the ground`));
      }
    }
  });

  // Optional custom boss arena: must be a valid, playable fight room so the
  // engine's fixed player/boss spawns land on ground (the engine also lifts the
  // spawn out of solid as a backstop).
  const arena = spec.boss.arena;
  if (arena) {
    const ap = '/boss/arena';
    out.push(...lintRowLengths(arena.tiles, ap, 'PLAT_ARENA_ROWS_UNEQUAL'));
    if (!out.some((e) => e.code === 'PLAT_ARENA_ROWS_UNEQUAL')) {
      const h = arena.tiles.length;
      const w = arena.tiles[0]?.length ?? 0;
      const kindAt = (x: number, y: number): string => {
        const ch = arena.tiles[y]?.[x];
        return ch === undefined || ch === '.' ? 'empty' : (arena.legend[ch] ?? 'empty');
      };
      let wallsOk = true;
      for (let y = 0; y < h; y++) if (kindAt(0, y) !== 'solid' || kindAt(w - 1, y) !== 'solid') wallsOk = false;
      if (!wallsOk) out.push(err('PLAT_ARENA_NO_WALLS', ap, 'boss arena needs solid wall columns on the far left and far right'));
      let floorOk = h >= 2;
      for (let x = 1; x < w - 1; x++) if (kindAt(x, h - 1) !== 'solid' || kindAt(x, h - 2) !== 'solid') floorOk = false;
      if (!floorOk) out.push(err('PLAT_ARENA_NO_FLOOR', ap, 'boss arena needs a solid floor across the bottom two rows'));
      let filled = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (kindAt(x, y) === 'solid' || kindAt(x, y) === 'platform') filled++;
      if (w * h > 0 && filled / (w * h) > 0.7) out.push(err('PLAT_ARENA_TOO_DENSE', ap, 'boss arena is too filled-in; leave open space to fight'));
    }
  }

  // Content floors
  if (enemyTypesUsed.size < 4) {
    out.push(err('PLAT_FLOOR_ENEMY_TYPES', '/levels', `uses ${enemyTypesUsed.size} distinct enemy types (walker/flyer/shooter/chaser); the floor is 4`));
  }
  if (powerupCount < 1) {
    out.push(err('PLAT_FLOOR_POWERUP', '/levels', 'at least one powerup entity is required'));
  }
  if (pickupCount < 12) {
    out.push(err('PLAT_FLOOR_PICKUPS', '/levels', `only ${pickupCount} pickups placed; the floor is 12`));
  }
  if (checkpointTotal < spec.levels.length) {
    // per-level errors already emitted; this is belt-and-braces for floors reporting
  }

  out.push(...lintDuration(estimatePlatformerDurationS(spec)));
  return out;
}

/** Traversal distance ÷ speed + encounters × engagement time + boss fight. */
export function estimatePlatformerDurationS(spec: PlatformerSpec): number {
  let total = 0;
  for (const level of spec.levels) {
    const w = (level.tiles[0]?.length ?? 0) * 16;
    total += (w / 70) * 1.9; // avg horizontal speed with vertical detours/backtrack
    for (const e of level.entities) {
      if (e.type === 'walker' || e.type === 'flyer' || e.type === 'shooter' || e.type === 'chaser') total += 4;
      if (e.type === 'coin') total += 1;
      if (e.type === 'heart' || e.type === 'powerup') total += 2;
    }
  }
  total += spec.boss.phases.length * 35 + Math.min(60, spec.boss.hp * 1.5);
  return total;
}
