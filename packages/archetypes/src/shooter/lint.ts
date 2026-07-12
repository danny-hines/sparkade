// Shooter semantic lints: wave timing, on-screen and bullet-density budgets,
// finite boss fights, content floors.
import { BUDGET, type LintError, type ShooterSpec } from '@sparkade/shared';
import { err, lintDuration, lintMusic, lintSongRef, lintSpriteRefs } from '../common';

/** How long a spawned wave typically stays on screen (seconds). */
const WAVE_LIFETIME_S = 8;
const MAX_BULLETS_PER_SECOND = 14;

export function lintShooter(spec: ShooterSpec): LintError[] {
  const out: LintError[] = [];
  out.push(...lintMusic(spec), ...lintSpriteRefs(spec));

  const enemyTypes = new Set<string>();
  const pickupTypes = new Set<string>();
  let waveTotal = 0;

  spec.levels.forEach((level, li) => {
    const path = `/levels/${li}`;
    out.push(...lintSongRef(level.musicSong, `${path}/musicSong`, spec));

    // Sorted timestamps, all within the level's duration.
    for (let i = 0; i < level.waves.length; i++) {
      const w = level.waves[i]!;
      waveTotal++;
      enemyTypes.add(w.enemyType);
      if (i > 0 && w.t < level.waves[i - 1]!.t) {
        out.push(err('SHOOT_WAVES_UNSORTED', `${path}/waves/${i}/t`, `wave timestamps must be sorted ascending (t=${w.t} after t=${level.waves[i - 1]!.t})`));
      }
      if (w.t > level.durationS - 4) {
        out.push(err('SHOOT_WAVE_AFTER_END', `${path}/waves/${i}/t`, `wave at t=${w.t}s spawns too close to the level end (durationS=${level.durationS}; keep waves ≤ durationS - 4)`));
      }
    }
    for (const [pi, p] of level.pickups.entries()) {
      pickupTypes.add(p.type);
      if (p.t > level.durationS - 2) {
        out.push(err('SHOOT_PICKUP_AFTER_END', `${path}/pickups/${pi}/t`, `pickup at t=${p.t}s is after the level effectively ends`));
      }
    }

    // Simultaneous on-screen estimate: overlapping wave lifetimes.
    for (const w of level.waves) {
      let concurrent = 0;
      for (const other of level.waves) {
        if (other.t <= w.t + 0.01 && other.t + WAVE_LIFETIME_S > w.t) concurrent += other.count;
      }
      if (concurrent > BUDGET.maxActiveEntities - 6) {
        out.push(err('SHOOT_ONSCREEN_BUDGET', `${path}/waves`, `~${concurrent} enemies on screen around t=${w.t}s; keep it under ${BUDGET.maxActiveEntities - 6} (space the waves out)`));
        break;
      }
    }

    // Bullet density sanity cap.
    for (const w of level.waves) {
      let bps = 0;
      for (const other of level.waves) {
        if (other.t <= w.t + 0.01 && other.t + WAVE_LIFETIME_S > w.t) bps += other.count * other.fireRate;
      }
      if (bps > MAX_BULLETS_PER_SECOND) {
        out.push(err('SHOOT_BULLET_DENSITY', `${path}/waves`, `~${bps.toFixed(1)} enemy bullets/sec around t=${w.t}s; cap is ${MAX_BULLETS_PER_SECOND} (lower fireRate or counts)`));
        break;
      }
    }
  });

  // Boss: finite fight.
  const bossEffortHp = spec.boss.hp + spec.boss.pods * spec.boss.podHp;
  if (bossEffortHp > 320) {
    out.push(err('SHOOT_BOSS_TOO_LONG', '/boss', `hp + pods*podHp = ${bossEffortHp}; keep it ≤ 320 so the fight stays under ~3 minutes`));
  }

  // Content floors
  if (waveTotal < 15) {
    out.push(err('SHOOT_FLOOR_WAVES', '/levels', `${waveTotal} waves total; the floor is 15`));
  }
  if (enemyTypes.size < 4) {
    out.push(err('SHOOT_FLOOR_ENEMY_TYPES', '/levels', `uses ${enemyTypes.size} enemy types; the floor is 4`));
  }
  if (pickupTypes.size < 2) {
    out.push(err('SHOOT_FLOOR_POWERUPS', '/levels', `uses ${pickupTypes.size} pickup types; the floor is 2`));
  }

  out.push(...lintDuration(estimateShooterDurationS(spec)));
  return out;
}

/** Levels play in real time; the boss adds phase time. */
export function estimateShooterDurationS(spec: ShooterSpec): number {
  let total = 0;
  for (const level of spec.levels) total += level.durationS;
  total += spec.boss.phases.length * 30 + Math.min(60, spec.boss.hp / 2);
  return total;
}
