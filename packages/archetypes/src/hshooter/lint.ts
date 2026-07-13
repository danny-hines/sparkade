// Horizontal-shooter semantic lints: wave timing, on-screen + bullet budgets,
// terrain corridor sanity (never seals the passage shut), finite boss, floors.
import { BUDGET, INTERNAL_HEIGHT, TILE_SIZE, type HShooterSpec, type LintError } from '@sparkade/shared';
import { err, lintDuration, lintMusic, lintSongRef, lintSpriteRefs } from '../common';

const WAVE_LIFETIME_S = 8;
const MAX_BULLETS_PER_SECOND = 14;
const ROWS = INTERNAL_HEIGHT / TILE_SIZE; // 300/16 ≈ 18.75 tiles tall
/** Minimum open corridor (tiles) so the ship can always thread through. */
const MIN_GAP_TILES = 4;

export function lintHShooter(spec: HShooterSpec): LintError[] {
  const out: LintError[] = [];
  out.push(...lintMusic(spec), ...lintSpriteRefs(spec));

  const enemyTypes = new Set<string>();
  const pickupTypes = new Set<string>();
  let waveTotal = 0;

  spec.levels.forEach((level, li) => {
    const path = `/levels/${li}`;
    out.push(...lintSongRef(level.musicSong, `${path}/musicSong`, spec));

    // Terrain corridor: control points sorted, and the gap never closes.
    for (let i = 0; i < level.terrain.length; i++) {
      const p = level.terrain[i]!;
      if (i > 0 && p.x < level.terrain[i - 1]!.x) {
        out.push(err('HSHOOT_TERRAIN_UNSORTED', `${path}/terrain/${i}/x`, `terrain control points must be sorted by x (x=${p.x} after x=${level.terrain[i - 1]!.x})`));
      }
      const gap = ROWS - p.ceil - p.floor;
      if (gap < MIN_GAP_TILES) {
        out.push(err('HSHOOT_TERRAIN_SEALED', `${path}/terrain/${i}`, `corridor gap is ~${gap.toFixed(1)} tiles at x=${p.x}; keep ceil+floor ≤ ${(ROWS - MIN_GAP_TILES).toFixed(0)} so the ship can pass (${MIN_GAP_TILES}-tile minimum)`));
      }
    }
    // Turrets must sit on authored terrain (need a corridor to mount to).
    if (level.turrets.length > 0 && level.terrain.length === 0) {
      out.push(err('HSHOOT_TURRET_NO_TERRAIN', `${path}/turrets`, `turrets need terrain to mount on, but /levels/${li}/terrain is empty`));
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
      for (const other of level.waves) {
        if (other.t <= w.t + 0.01 && other.t + WAVE_LIFETIME_S > w.t) concurrent += other.count;
      }
      if (concurrent > BUDGET.maxActiveEntities - 6) {
        out.push(err('HSHOOT_ONSCREEN_BUDGET', `${path}/waves`, `~${concurrent} enemies on screen around t=${w.t}s; keep it under ${BUDGET.maxActiveEntities - 6} (space the waves out)`));
        break;
      }
    }
    for (const w of level.waves) {
      let bps = 0;
      for (const other of level.waves) {
        if (other.t <= w.t + 0.01 && other.t + WAVE_LIFETIME_S > w.t) bps += other.count * other.fireRate;
      }
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

  if (waveTotal < 15) {
    out.push(err('HSHOOT_FLOOR_WAVES', '/levels', `${waveTotal} waves total; the floor is 15`));
  }
  if (enemyTypes.size < 4) {
    out.push(err('HSHOOT_FLOOR_ENEMY_TYPES', '/levels', `uses ${enemyTypes.size} enemy types; the floor is 4`));
  }
  if (pickupTypes.size < 2) {
    out.push(err('HSHOOT_FLOOR_POWERUPS', '/levels', `uses ${pickupTypes.size} pickup types; the floor is 2`));
  }

  out.push(...lintDuration(estimateHShooterDurationS(spec)));
  return out;
}

export function estimateHShooterDurationS(spec: HShooterSpec): number {
  let total = 0;
  for (const level of spec.levels) total += level.durationS;
  total += spec.boss.phases.length * 30 + Math.min(60, spec.boss.hp / 2);
  return total;
}
