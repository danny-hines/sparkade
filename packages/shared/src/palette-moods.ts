// Curated palette-mood library — the hand-crafted quality floor for game color.
//
// Each mood is a legibility-passing 16-color palette following PALETTE_SLOTS
// (0 transparent · 1 outline · 2-4 bg dark->light · 5-7 hero · 8-a enemy ·
// b hazard · c warm · d gold · e light · f near-white). Moods are the design
// pass's cookbook (copy or adapt), the pipeline's fallback when a generated
// palette fails legibility (nearestMood), and reviewable in the dev gallery.
//
// INVARIANT: every entry must pass paletteProblems() — enforced by a unit test.
// Families live in their own palette-moods-<family>.ts files (spread across
// distinct hue families so back-to-back games differ) and merge here.
import { redmean, type PaletteMood } from './palette';
import { CLASSIC } from './palette-moods-classic';
import { WARM } from './palette-moods-warm';
import { COOL } from './palette-moods-cool';
import { VERDANT } from './palette-moods-verdant';
import { VIVID } from './palette-moods-vivid';
import { REGAL } from './palette-moods-regal';

export const PALETTE_MOODS: PaletteMood[] = [
  ...CLASSIC,
  ...WARM,
  ...COOL,
  ...VERDANT,
  ...VIVID,
  ...REGAL,
];

/**
 * Pick the curated mood whose overall character is closest to a candidate
 * palette — the pipeline's fallback so a rejected generated palette is replaced
 * by the nearest professional one (honoring the model's hue intent) rather than
 * a fixed default. Compares only the identity-carrying slots.
 */
export function nearestMood(palette: readonly string[]): PaletteMood {
  let best = PALETTE_MOODS[0]!;
  let bestD = Infinity;
  for (const mood of PALETTE_MOODS) {
    let d = 0;
    for (const i of [2, 3, 4, 5, 6, 8, 9, 11]) d += redmean(palette[i] ?? '#000000', mood.colors[i]!);
    if (d < bestD) {
      bestD = d;
      best = mood;
    }
  }
  return best;
}
