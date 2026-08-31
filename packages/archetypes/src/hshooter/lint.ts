// Horizontal-shooter semantic lints: the tile stage must be well-formed and
// navigable by the runtime ship over authored time, waves timed sanely within
// the budget, finite boss, content floors.
import {
  BUDGET,
  INTERNAL_HEIGHT,
  TILE_SIZE,
  type HShooterSpec,
  type LintError,
} from '@sparkade/shared';
import {
  err,
  lintDuration,
  lintLegendCoverage,
  lintMusic,
  lintRowLengths,
  lintSongRef,
  lintSpriteRefs,
} from '../common';
import { INTERNAL_WIDTH } from '@sparkade/shared';
import {
  HSHOOTER_PICKUP_COLLECTION_SCREEN_X,
  HSHOOTER_TURRET_DODGE_CLEARANCE_PX,
  analyzeAuthoredHShooterWavePlacement,
  planHShooterPickupTrajectory,
} from './encounters';
import {
  HSHOOTER_PLAYER_HITBOX,
  HSHOOTER_PLAYER_SPEED_HIGH,
  HSHOOTER_ROUTE_REACTION_S,
  analyzeHShooterRoute,
} from './traversal';

const WAVE_LIFETIME_S = 8;
const MAX_BULLETS_PER_SECOND = 14;
const ROWS_EXPECT = Math.round(INTERNAL_HEIGHT / TILE_SIZE); // ~19

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
      out.push(
        err(
          'HSHOOT_STAGE_HEIGHT',
          `${path}/tiles`,
          `stage is ${rows} tiles tall; use ${ROWS_EXPECT} (it should fill the ~${ROWS_EXPECT}-tile-high screen)`,
        ),
      );
    }
    const need = level.scroll * level.durationS + INTERNAL_WIDTH + 16;
    const stageIsRectangular = cols > 0 && level.tiles.every((row) => row.length === cols);
    const stageIsLongEnough = cols * TILE_SIZE >= need;
    if (!stageIsLongEnough) {
      out.push(
        err(
          'HSHOOT_STAGE_SHORT',
          `${path}/tiles`,
          `stage is ${cols} tiles wide (${cols * TILE_SIZE}px) but the level needs ~${Math.round(need)}px to scroll (so the ship can reach the front edge without hitting the level's end); widen it to ≥ ${Math.ceil(need / TILE_SIZE)} tiles or lower scroll/durationS`,
        ),
      );
    }
    if (stageIsRectangular && stageIsLongEnough) {
      const route = analyzeHShooterRoute(level);
      if (!route.reachable) {
        const time = route.failureTimeS?.toFixed(1) ?? '0.0';
        const worldX = Math.round(route.failureWorldX ?? 0);
        const tileColumn = route.failureTileColumn ?? 0;
        const reactionPx = Math.round(route.reactionDistancePx);
        const guidance =
          route.failureReason === 'movement'
            ? `safe space still exists, but it shifts faster than the ${HSHOOTER_PLAYER_SPEED_HIGH}px/s ship can reach; widen the transition, spread the turn across more columns, or lower scroll`
            : route.failureReason === 'spawn-blocked'
              ? 'the runtime spawn and its forward sightline overlap solid or hazard terrain; clear the center-left opening'
              : `no ${HSHOOTER_PLAYER_HITBOX.w}x${HSHOOTER_PLAYER_HITBOX.h} solid/hazard-free ship position remains; widen or reconnect the corridor`;
        out.push(
          err(
            route.failureReason === 'movement' ? 'HSHOOT_ROUTE_SPEED' : 'HSHOOT_ROUTE_CLEARANCE',
            `${path}/tiles`,
            `temporal route fails at t=${time}s near world x=${worldX}px (tile column ${tileColumn}): ${guidance}. The proof reserves ${HSHOOTER_ROUTE_REACTION_S}s/${reactionPx}px of forward reaction clearance`,
          ),
        );
      }
    }

    for (let i = 0; i < level.waves.length; i++) {
      const w = level.waves[i]!;
      waveTotal++;
      enemyTypes.add(w.enemyType);
      if (i > 0 && w.t < level.waves[i - 1]!.t) {
        out.push(
          err(
            'HSHOOT_WAVES_UNSORTED',
            `${path}/waves/${i}/t`,
            `wave timestamps must be sorted ascending (t=${w.t} after t=${level.waves[i - 1]!.t})`,
          ),
        );
      }
      if (w.t > level.durationS - 4) {
        out.push(
          err(
            'HSHOOT_WAVE_AFTER_END',
            `${path}/waves/${i}/t`,
            `wave at t=${w.t}s spawns too close to the level end (durationS=${level.durationS}; keep waves ≤ durationS - 4)`,
          ),
        );
      }
      const placement = analyzeAuthoredHShooterWavePlacement(level, w);
      if (!placement.complete) {
        const mounted = w.enemyType === 'turret';
        out.push(
          err(
            mounted ? 'HSHOOT_TURRET_NO_SURFACE' : 'HSHOOT_WAVE_SPAWN_TERRAIN',
            `${path}/waves/${i}`,
            mounted
              ? `${placement.placements.length}/${w.count} turrets have an exposed surface, clear firing window, and ${HSHOOTER_TURRET_DODGE_CLEARANCE_PX}px dodge lane at their actual spawn columns; adjust t, count, or formation`
              : `${placement.placements.length}/${w.count} enemies fit outside solid terrain at their actual spawn columns; adjust t, count, or formation`,
          ),
        );
      }
    }
    for (const [pi, p] of level.pickups.entries()) {
      pickupTypes.add(p.type);
      if (p.t > level.durationS - 2) {
        out.push(
          err(
            'HSHOOT_PICKUP_AFTER_END',
            `${path}/pickups/${pi}/t`,
            `pickup at t=${p.t}s is after the level effectively ends`,
          ),
        );
      }
      if (stageIsRectangular && stageIsLongEnough) {
        const trajectory = planHShooterPickupTrajectory(level, p.t);
        if (!trajectory.complete) {
          const worldX = Math.round(trajectory.failureWorldX ?? 0);
          const tileColumn = trajectory.failureTileColumn ?? 0;
          const reason =
            trajectory.failureReason === 'late'
              ? `it does not reach the visible collection lane at screen x=${HSHOOTER_PICKUP_COLLECTION_SCREEN_X}px before the level ends; schedule it earlier`
              : trajectory.failureReason === 'movement'
                ? 'open space exists, but it changes altitude faster than the pickup and normal-speed player can follow; smooth or widen the corridor'
                : 'its 12x12 flight envelope intersects solid or hazard terrain; move its timestamp to a clearer stretch or widen the corridor';
          out.push(
            err(
              'HSHOOT_PICKUP_UNREACHABLE',
              `${path}/pickups/${pi}`,
              `pickup has no safe reachable trajectory near world x=${worldX}px (tile column ${tileColumn}): ${reason}`,
            ),
          );
        }
      }
    }

    for (const w of level.waves) {
      let concurrent = 0;
      for (const other of level.waves)
        if (other.t <= w.t + 0.01 && other.t + WAVE_LIFETIME_S > w.t) concurrent += other.count;
      if (concurrent > BUDGET.maxActiveEntities - 6) {
        out.push(
          err(
            'HSHOOT_ONSCREEN_BUDGET',
            `${path}/waves`,
            `~${concurrent} enemies on screen around t=${w.t}s; keep it under ${BUDGET.maxActiveEntities - 6} (space the waves out)`,
          ),
        );
        break;
      }
    }
    for (const w of level.waves) {
      let bps = 0;
      for (const other of level.waves)
        if (other.t <= w.t + 0.01 && other.t + WAVE_LIFETIME_S > w.t)
          bps += other.count * other.fireRate;
      if (bps > MAX_BULLETS_PER_SECOND) {
        out.push(
          err(
            'HSHOOT_BULLET_DENSITY',
            `${path}/waves`,
            `~${bps.toFixed(1)} enemy bullets/sec around t=${w.t}s; cap is ${MAX_BULLETS_PER_SECOND} (lower fireRate or counts)`,
          ),
        );
        break;
      }
    }
  });

  const bossEffortHp = spec.boss.hp + spec.boss.pods * spec.boss.podHp;
  if (bossEffortHp > 320) {
    out.push(
      err(
        'HSHOOT_BOSS_TOO_LONG',
        '/boss',
        `hp + pods*podHp = ${bossEffortHp}; keep it ≤ 320 so the fight stays under ~3 minutes`,
      ),
    );
  }
  if (waveTotal < 15)
    out.push(err('HSHOOT_FLOOR_WAVES', '/levels', `${waveTotal} waves total; the floor is 15`));
  if (enemyTypes.size < 4)
    out.push(
      err(
        'HSHOOT_FLOOR_ENEMY_TYPES',
        '/levels',
        `uses ${enemyTypes.size} enemy types; the floor is 4`,
      ),
    );
  if (pickupTypes.size < 2)
    out.push(
      err(
        'HSHOOT_FLOOR_POWERUPS',
        '/levels',
        `uses ${pickupTypes.size} pickup types; the floor is 2`,
      ),
    );

  out.push(...lintDuration(estimateHShooterDurationS(spec)));
  return out;
}

export function estimateHShooterDurationS(spec: HShooterSpec): number {
  let total = 0;
  for (const level of spec.levels) total += level.durationS;
  total += spec.boss.phases.length * 30 + Math.min(60, spec.boss.hp / 2);
  return total;
}
