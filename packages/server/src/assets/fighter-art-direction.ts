import type { FighterArtDirection } from '@sparkade/shared';

function clean(value: string, limit: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

/** Render the persisted structured contract into one prompt fragment. Keeping
 * this centralized prevents presentation, roster, pose, and arena prompts from
 * quietly emphasizing different interpretations of the same art direction. */
export function fighterArtDirectionPrompt(direction: FighterArtDirection): string {
  return [
    `Aesthetic: ${direction.aesthetic}.`,
    `Shared character proportions: ${clean(direction.proportions, 140)}.`,
    `Shared rendering treatment: ${clean(direction.rendering, 160)}.`,
  ].join(' ');
}
