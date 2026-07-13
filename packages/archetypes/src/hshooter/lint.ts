// Horizontal-shooter semantic lints: the tile stage must be well-formed and
// navigable (a continuous open lane left→right, wide enough to scroll the whole
// level), waves timed sanely within the budget, finite boss, content floors.
import { BUDGET, INTERNAL_HEIGHT, TILE_SIZE, type HShooterSpec, type LintError } from '@sparkade/shared';
import { err, lintDuration, lintLegendCoverage, lintMusic, lintRowLengths, lintSongRef, lintSpriteRefs } from '../common';
import { INTERNAL_WIDTH } from '@sparkade/shared';

const WAVE_LIFETIME_S = 8;
const MAX_BULLETS_PER_SECOND = 14;
const ROWS_EXPECT = Math.round(INTERNAL_HEIGHT / TILE_SIZE); // ~19

/** Is there a continuous open (non-solid) path from the left edge to the right
 *  edge, 4-connected? The flying ship can move any direction, so this proves the
 *  stage is threadable. `solid` = a char whose legend kind is 'solid'. */
function pathExists(tiles: string[], legend: Record<string, string>): boolean {
  const rows = tiles.length;
  const cols = tiles[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return true;
  const solid = (x: number, y: number): boolean => {
    const ch = tiles[y]?.[x] ?? '.';
    return ch !== '.' && legend[ch] === 'solid';
  };
  const seen = new Uint8Array(rows * cols);
  const stack: number[] = [];
  for (let y = 0; y < rows; y++) if (!solid(0, y)) { seen[y * cols] = 1; stack.push(y * cols); }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % cols;
    const y = (i - x) / cols;
    if (x === cols - 1) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const j = ny * cols + nx;
      if (!seen[j] && !solid(nx, ny)) { seen[j] = 1; stack.push(j); }
    }
  }
  return false;
}

export function lintHShooter(spec: HShooterSpec): LintError[] {
  const out: LintError[] = [];
  out.push(...lintMusic(spec), ...lintSpriteRefs(spec));

  const enemyTypes = new Set<string>();
  const pickupTypes = new Set<string>();
  let waveTotal = 0;

  spec.levels.forEach((level, li) => {
    const path = `/levels/${li}`;
    out.push(...lintSongRef(level.musicSong, `${path}/musicSong`, spec));

    // Tile stage
    out.push(...lintRowLengths(level.tiles, path, 'HSHOOT_ROW_LEN'));
    out.push(...lintLegendCoverage(level.tiles, level.legend, path, 'HSHOOT_LEGEND'));
    const rows = level.tiles.length;
    const cols = level.tiles[0]?.length ?? 0;
    if (rows < 12 || rows > 20) {
      out.push(err('HSHOOT_STAGE_HEIGHT', `${path}/tiles`, `stage is ${rows} tiles tall; use ${ROWS_EXPECT} (it should fill the ~${ROWS_EXPECT}-tile-high screen)`));
    }
    if (!pathExists(level.tiles, level.legend)) {
      out.push(err('HSHOOT_STAGE_SEALED', `${path}/tiles`, 'no open lane from left to right — the ship cannot get through; leave a continuous non-solid path'));
    }
    const need = level.scroll * level.durationS + INTERNAL_WIDTH * 0.6;
    if (cols * TILE_SIZE < need) {
      out.push(err('HSHOOT_STAGE_SHORT', `${path}/tiles`, `stage is ${cols} tiles wide (${cols * TILE_SIZE}px) but the level scrolls ~${Math.round(need)}px; widen it to ≥ ${Math.ceil(need / TILE_SIZE)} tiles or lower scroll/durationS`));
    }

    for (let i = 0; i < level.waves.length; i++) {
      const w = level.waves[i]!;
      waveTotal++;
      enemyTypes.add(w.enemyType);
      if (i > 0 && w.t < level.waves[i - 1]!.t) {
        out.push(err('HSHOOT_WAVES_UNSORTED', `${path}/waves/${i}/t`, `wave timestamps must be sorted ascending (t=${w.t} after t=${level.waves[i - 1]!.t})`));
      }
      if (w.t > level.durationS - 4) {
        out.push(err('HSHOOT_WAVE_AFTER_END', `${path}/waves/${i}/t`, `wave at t=${w.t}s spawns too close to the level end (durationS=${level.durationS}; keep waves ≤ durationS - 4)`));
      }
    }
    for (const [pi, p] of level.pickups.entries()) {
      pickupTypes.add(p.type);
      if (p.t > level.durationS - 2) {
        out.push(err('HSHOOT_PICKUP_AFTER_END', `${path}/pickups/${pi}/t`, `pickup at t=${p.t}s is after the level effectively ends`));
      }
    }

    for (const w of level.waves) {
      let concurrent = 0;
      for (const other of level.waves) if (other.t <= w.t + 0.01 && other.t + WAVE_LIFETIME_S > w.t) concurrent += other.count;
      if (concurrent > BUDGET.maxActiveEntities - 6) {
        out.push(err('HSHOOT_ONSCREEN_BUDGET', `${path}/waves`, `~${concurrent} enemies on screen around t=${w.t}s; keep it under ${BUDGET.maxActiveEntities - 6} (space the waves out)`));
        break;
      }
    }
    for (const w of level.waves) {
      let bps = 0;
      for (const other of level.waves) if (other.t <= w.t + 0.01 && other.t + WAVE_LIFETIME_S > w.t) bps += other.count * other.fireRate;
      if (bps > MAX_BULLETS_PER_SECOND) {
        out.push(err('HSHOOT_BULLET_DENSITY', `${path}/waves`, `~${bps.toFixed(1)} enemy bullets/sec around t=${w.t}s; cap is ${MAX_BULLETS_PER_SECOND} (lower fireRate or counts)`));
        break;
      }
    }
  });

  const bossEffortHp = spec.boss.hp + spec.boss.pods * spec.boss.podHp;
  if (bossEffortHp > 320) {
    out.push(err('HSHOOT_BOSS_TOO_LONG', '/boss', `hp + pods*podHp = ${bossEffortHp}; keep it ≤ 320 so the fight stays under ~3 minutes`));
  }
  if (waveTotal < 15) out.push(err('HSHOOT_FLOOR_WAVES', '/levels', `${waveTotal} waves total; the floor is 15`));
  if (enemyTypes.size < 4) out.push(err('HSHOOT_FLOOR_ENEMY_TYPES', '/levels', `uses ${enemyTypes.size} enemy types; the floor is 4`));
  if (pickupTypes.size < 2) out.push(err('HSHOOT_FLOOR_POWERUPS', '/levels', `uses ${pickupTypes.size} pickup types; the floor is 2`));

  out.push(...lintDuration(estimateHShooterDurationS(spec)));
  return out;
}

export function estimateHShooterDurationS(spec: HShooterSpec): number {
  let total = 0;
  for (const level of spec.levels) total += level.durationS;
  total += spec.boss.phases.length * 30 + Math.min(60, spec.boss.hp / 2);
  return total;
}
