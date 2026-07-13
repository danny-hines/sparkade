// Fighter semantic lints: the two fighters must be tellable apart (distinct
// palette slots), the ladder meets its floor, and the match is a sane length.
import { type FighterSpec, type LintError } from '@sparkade/shared';
import { err, lintDuration, lintMusic, lintSongRef, lintSpriteRefs } from '../common';

export function lintFighter(spec: FighterSpec): LintError[] {
  const out: LintError[] = [];
  out.push(...lintMusic(spec), ...lintSpriteRefs(spec));

  const pSlot = spec.player?.colorSlot ?? 5;
  spec.levels.forEach((lv, i) => {
    const path = `/levels/${i}`;
    out.push(...lintSongRef(lv.musicSong, `${path}/musicSong`, spec));
    if (lv.opponent.colorSlot === pSlot) {
      out.push(err('FIGHT_COLOR_CLASH', `${path}/opponent/colorSlot`, `opponent shares the player's colorSlot (${pSlot}); pick a different slot 5-10 so the two fighters read apart`));
    }
  });
  if (spec.boss.colorSlot === pSlot) {
    out.push(err('FIGHT_BOSS_COLOR', '/boss/colorSlot', `boss shares the player's colorSlot (${pSlot}); pick a different one`));
  }
  if (spec.levels.length < 3) {
    out.push(err('FIGHT_FLOOR_LADDER', '/levels', `${spec.levels.length} ladder opponents; the floor is 3 (plus the boss)`));
  }

  out.push(...lintDuration(estimateFighterDurationS(spec)));
  return out;
}

/** A ladder of (levels + boss) bouts, each ~best-of-3 at ~40s of real play. */
export function estimateFighterDurationS(spec: FighterSpec): number {
  const bouts = spec.levels.length + 1;
  return Math.round(bouts * 2.5 * 40);
}
