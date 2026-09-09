import type { GameSpec, SfxBlock } from './types';

export const PRESENTATION_FAMILIES = ['storybook', 'tech', 'arcade'] as const;
export type PresentationFamily = (typeof PRESENTATION_FAMILIES)[number];

/** Presentation never selects a weapon, traversal rule, objective or scoring rule. */
export const PRESENTATION_CATALOG = {
  storybook: {
    name: 'Storybook adventure',
    description: 'Warm paper, heart icons, illustrated chapters and a journey journal.',
    stage: 'CHAPTER',
    intro: 'THE ADVENTURE BEGINS',
    boss: 'THE FINAL CHAPTER',
    pause: 'TAKE A BREATHER',
    won: 'JOURNEY COMPLETE',
    lost: 'JOURNEY ENDED',
    results: 'YOUR JOURNEY',
    board: 'HALL OF HEROES',
    music: 'A short lyrical chapter motif and soft triangle-wave menu chimes.',
  },
  tech: {
    name: 'Tech mission',
    description: 'Instrument panels, segmented energy, mission briefs and a debrief console.',
    stage: 'MISSION',
    intro: 'MISSION BRIEFING',
    boss: 'PRIORITY TARGET',
    pause: 'MISSION SUSPENDED',
    won: 'MISSION COMPLETE',
    lost: 'MISSION FAILED',
    results: 'DEBRIEF',
    board: 'MISSION RECORDS',
    music: 'A restrained electronic mission motif and short sine-wave interface signals.',
  },
  arcade: {
    name: 'Arcade action',
    description: 'Bold score and time, punchy stage banners and a high-score marquee.',
    stage: 'STAGE',
    intro: 'READY FOR ACTION',
    boss: 'BOSS BATTLE',
    pause: 'TIME OUT',
    won: 'ALL CLEAR!',
    lost: 'GAME OVER',
    results: 'FINAL SCORE',
    board: 'HIGH SCORES',
    music: 'A punchy stage fanfare and bright square-wave arcade blips.',
  },
} as const;

export function gamePresentationFamily(spec: GameSpec): PresentationFamily | undefined {
  return spec.archetype === 'platformer' ? spec.presentationFamily : undefined;
}

export function presentationPreference(
  recent: readonly { archetype: string; presentationFamily?: string }[],
): PresentationFamily[] {
  const score = (family: string) =>
    recent.reduce(
      (n, game, i) =>
        n +
        (game.archetype === 'platformer' && game.presentationFamily === family ? 1 / (i + 1) : 0),
      0,
    );
  return [...PRESENTATION_FAMILIES].sort((a, b) => score(a) - score(b));
}

/** Only menu events change timbre; gameplay effects remain authored by the game. */
export function presentationSfx(family?: PresentationFamily): SfxBlock {
  if (!family) return {};
  const wave = family === 'storybook' ? 'triangle' : family === 'tech' ? 'sine' : 'square';
  const freq = family === 'storybook' ? 660 : family === 'tech' ? 1040 : 880;
  return {
    uiMove: { wave, freq, decay: 0.045, vol: 0.16 },
    uiSelect: {
      wave,
      freq,
      decay: 0.12,
      arpSemitones: family === 'storybook' ? 7 : 12,
      arpTime: 0.045,
      vol: 0.22,
    },
    uiBack: { wave, freq: freq * 0.75, decay: 0.09, freqSlide: -12, vol: 0.18 },
  };
}
