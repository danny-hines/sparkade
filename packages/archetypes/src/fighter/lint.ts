// Fighter semantic lints: the two fighters must be tellable apart (distinct
// palette slots), the ladder meets its floor, and the match is a sane length.
import { type FighterSpec, type LintError } from '@sparkade/shared';
import { err, lintDuration, lintMusic, lintSongRef, lintSpriteRefs } from '../common';

export function lintFighter(spec: FighterSpec): LintError[] {
  const out: LintError[] = [];
  out.push(...lintMusic(spec), ...lintSpriteRefs(spec));

  const player = spec.player;
  const pSlot = player?.colorSlot ?? 5;
  const seenColors = new Map<number, string>([[pSlot, player?.name ?? 'the player']]);
  const seenStyles = new Map<string, string>();
  if (player?.outfit) seenStyles.set(`${player.build}:${player.outfit}`, player.name);
  const authoredOutfits = player?.outfit ? [player.outfit] : [];

  spec.levels.forEach((lv, i) => {
    const path = `/levels/${i}`;
    out.push(...lintSongRef(lv.musicSong, `${path}/musicSong`, spec));
    const priorColor = seenColors.get(lv.opponent.colorSlot);
    if (priorColor) {
      out.push(err('FIGHT_COLOR_CLASH', `${path}/opponent/colorSlot`, `${lv.opponent.name} shares colorSlot ${lv.opponent.colorSlot} with ${priorColor}; the player and ladder opponents need different slots 5-10`));
    } else {
      seenColors.set(lv.opponent.colorSlot, lv.opponent.name);
    }

    if (lv.opponent.outfit) {
      authoredOutfits.push(lv.opponent.outfit);
      const style = `${lv.opponent.build}:${lv.opponent.outfit}`;
      const priorStyle = seenStyles.get(style);
      if (priorStyle) {
        out.push(err('FIGHT_STYLE_CLASH', `${path}/opponent/outfit`, `${lv.opponent.name} repeats ${priorStyle}'s ${lv.opponent.build} + ${lv.opponent.outfit} silhouette; vary the build or outfit`));
      } else {
        seenStyles.set(style, lv.opponent.name);
      }
    }
  });

  if (authoredOutfits.length === spec.levels.length + (player ? 1 : 0) && authoredOutfits.length >= 3 && new Set(authoredOutfits).size < 3) {
    out.push(err('FIGHT_OUTFIT_VARIETY', '/levels', `the player and ladder use only ${new Set(authoredOutfits).size} outfit silhouette(s); use at least 3`));
  }

  const bossColorOwner = seenColors.get(spec.boss.colorSlot);
  if (bossColorOwner) {
    out.push(err('FIGHT_BOSS_COLOR', '/boss/colorSlot', `boss shares colorSlot ${spec.boss.colorSlot} with ${bossColorOwner}; use the reserved boss slot 11`));
  }
  if (player?.outfit && spec.boss.outfit && player.build === spec.boss.build && player.outfit === spec.boss.outfit) {
    out.push(err('FIGHT_BOSS_STYLE', '/boss/outfit', `boss repeats the player's ${player.build} + ${player.outfit} silhouette; vary the build or outfit`));
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
