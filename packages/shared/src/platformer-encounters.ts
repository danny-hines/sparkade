import type { PlatformerPlayStyle } from './play-styles';

export const PLATFORMER_ENCOUNTER_IDS = [
  'bounce-run',
  'stepped-route',
  'high-low',
  'cover-advance',
  'overhead-targets',
  'patrol-duel',
  'jump-in',
  'crossfire-break',
  'wall-ascent',
  'switchback-climb',
  'sheltered-climb',
  'armed-ascent',
] as const;
export type PlatformerEncounterId = (typeof PLATFORMER_ENCOUNTER_IDS)[number];
export type EncounterEnemy = 'none' | 'walker' | 'flyer' | 'shooter' | 'chaser';
export type EncounterReward = 'coins' | 'heart' | 'doubleJump' | 'projectile' | 'shield';
export const PLATFORMER_ENCOUNTER_MODIFIERS = [
  'none',
  'spring',
  'moving-platform',
  'ice',
  'conveyor-forward',
  'conveyor-backward',
] as const;
export type PlatformerEncounterModifier = (typeof PLATFORMER_ENCOUNTER_MODIFIERS)[number];
export interface PlatformerEncounterSection {
  pattern: PlatformerEncounterId;
  variant: 0 | 1 | 2;
  challenge: 'introduce' | 'develop' | 'test';
  enemy: EncounterEnemy;
  reward: EncounterReward;
  /** Omission preserves the exact geometry of saved version-one compositions. */
  modifier?: PlatformerEncounterModifier;
}
export interface PlatformerEncounterRoute {
  orientation: 'horizontal' | 'tower';
  direction: 'left' | 'right';
  sections: PlatformerEncounterSection[];
}
export interface PlatformerEncounterPlan extends PlatformerEncounterRoute {
  version: 1;
}

const horizontal: PlatformerPlayStyle[] = ['acrobat', 'runAndGun', 'meleeAction', 'armedClimber'];
const ranged: PlatformerPlayStyle[] = ['runAndGun', 'armedClimber'];
const climbing: PlatformerPlayStyle[] = ['towerClimber', 'armedClimber'];
const allEnemies: EncounterEnemy[] = ['none', 'walker', 'flyer', 'shooter', 'chaser'];
export const PLATFORMER_ENCOUNTERS: Record<
  PlatformerEncounterId,
  {
    orientation: 'horizontal' | 'tower';
    styles: readonly PlatformerPlayStyle[];
    enemies: readonly EncounterEnemy[];
    description: string;
  }
> = {
  'bounce-run': {
    orientation: 'horizontal',
    styles: ['acrobat'],
    enemies: ['none', 'walker', 'chaser'],
    description: 'A short mandatory gap, staggered patrols, and an optional bounce shortcut.',
  },
  'stepped-route': {
    orientation: 'horizontal',
    styles: horizontal,
    enemies: allEnemies,
    description: 'A stepped hill changes jump heights and firing angles.',
  },
  'high-low': {
    orientation: 'horizontal',
    styles: horizontal,
    enemies: allEnemies,
    description: 'A reachable upper reward route over an open lower route.',
  },
  'cover-advance': {
    orientation: 'horizontal',
    styles: ranged,
    enemies: ['none', 'shooter'],
    description: 'Two low barriers break a turret lane into advances between volleys.',
  },
  'overhead-targets': {
    orientation: 'horizontal',
    styles: ranged,
    enemies: ['none', 'flyer', 'shooter'],
    description: 'Elevated threats invite upward fire or a raised approach.',
  },
  'patrol-duel': {
    orientation: 'horizontal',
    styles: ['acrobat', 'meleeAction'],
    enemies: ['none', 'walker', 'chaser'],
    description: 'A spaced patrol with a clear windup, retreat, and jumping approach.',
  },
  'jump-in': {
    orientation: 'horizontal',
    styles: ['acrobat', 'meleeAction'],
    enemies: allEnemies,
    description: 'A perch above an enemy enables a timed landing strike or bounce.',
  },
  'crossfire-break': {
    orientation: 'horizontal',
    styles: ranged,
    enemies: ['none', 'shooter'],
    description: 'Separated high/low turrets with cover and staggered firing intervals.',
  },
  'wall-ascent': {
    orientation: 'tower',
    styles: climbing,
    enemies: allEnemies,
    description: 'A continuous climb face ending in an open rest bridge.',
  },
  'switchback-climb': {
    orientation: 'tower',
    styles: climbing,
    enemies: allEnemies,
    description: 'The next face switches sides, reached across a supported bridge.',
  },
  'sheltered-climb': {
    orientation: 'tower',
    styles: climbing,
    enemies: allEnemies,
    description: 'A halfway rest shelf and a shielded landing break up a long climb.',
  },
  'armed-ascent': {
    orientation: 'tower',
    styles: ['armedClimber'],
    enemies: ['none', 'shooter', 'flyer'],
    description: 'An exposed climb with a reachable elevated ranged threat and firing perch.',
  },
};

export function encounterModifiers(
  pattern: PlatformerEncounterId,
): readonly PlatformerEncounterModifier[] {
  if (PLATFORMER_ENCOUNTERS[pattern].orientation === 'tower') return ['none'];
  return [
    'none',
    'ice',
    'conveyor-forward',
    'conveyor-backward',
    ...(['bounce-run', 'high-low', 'jump-in'].includes(pattern) ? ['spring' as const] : []),
    ...(['high-low', 'overhead-targets', 'jump-in'].includes(pattern)
      ? ['moving-platform' as const]
      : []),
  ];
}

function encounterSectionSchema(patterns: readonly PlatformerEncounterId[]) {
  // Each decoder alternative is a complete, compatible section. Independent
  // enums allowed impossible combinations such as bounce-run + flyer through.
  return {
    anyOf: patterns.map((pattern) => ({
      type: 'object',
      properties: {
        pattern: { enum: [pattern] },
        variant: { type: 'integer', minimum: 0, maximum: 2 },
        challenge: { enum: ['introduce', 'develop', 'test'] },
        enemy: { enum: [...PLATFORMER_ENCOUNTERS[pattern].enemies] },
        reward: { enum: ['coins', 'heart', 'doubleJump', 'projectile', 'shield'] },
        modifier: { enum: [...encounterModifiers(pattern)] },
      },
      required: ['pattern', 'variant', 'challenge', 'enemy', 'reward'],
      additionalProperties: false,
    })),
  };
}

export const ENCOUNTER_SECTION_SCHEMA = encounterSectionSchema(PLATFORMER_ENCOUNTER_IDS);
export const ENCOUNTER_ROUTE_SCHEMA = {
  anyOf: (['horizontal', 'tower'] as const).map((orientation) => ({
    type: 'object',
    properties: {
      orientation: { enum: [orientation] },
      direction: { enum: ['left', 'right'] },
      sections: {
        type: 'array',
        minItems: 5,
        maxItems: 6,
        items: encounterSectionSchema(
          PLATFORMER_ENCOUNTER_IDS.filter(
            (pattern) => PLATFORMER_ENCOUNTERS[pattern].orientation === orientation,
          ),
        ),
      },
    },
    required: ['orientation', 'direction', 'sections'],
    additionalProperties: false,
  })),
} as const;

/** Only actual compiled encounter labels participate; legacy entity labels stay useful. */
export function encounterPreference(
  style: PlatformerPlayStyle,
  recent: readonly { encounters: string[] }[],
): PlatformerEncounterId[] {
  return PLATFORMER_ENCOUNTER_IDS.filter((id) =>
    PLATFORMER_ENCOUNTERS[id].styles.includes(style),
  ).sort((a, b) => {
    const score = (id: string) =>
      recent.reduce(
        (sum, game, index) =>
          sum + (game.encounters.includes(`pattern:${id}`) ? 1 / (index + 1) : 0),
        0,
      );
    return score(a) - score(b);
  });
}

export function platformerBossPacing(combat: 'stomp' | 'blaster' | 'melee') {
  return combat === 'melee'
    ? { telegraph: 0.7, recovery: 1.4, maxTempo: 1.2, spreadCount: 3 }
    : combat === 'stomp'
      ? { telegraph: 0.65, recovery: 1.2, maxTempo: 1.35, spreadCount: 4 }
      : { telegraph: 0.6, recovery: 1.0, maxTempo: 1.5, spreadCount: 5 };
}
