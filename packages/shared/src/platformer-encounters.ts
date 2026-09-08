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
export interface PlatformerEncounterSection {
  pattern: PlatformerEncounterId;
  variant: 0 | 1 | 2;
  challenge: 'introduce' | 'develop' | 'test';
  enemy: EncounterEnemy;
  reward: EncounterReward;
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

export const ENCOUNTER_SECTION_SCHEMA = {
  type: 'object',
  properties: {
    pattern: { enum: [...PLATFORMER_ENCOUNTER_IDS] },
    variant: { type: 'integer', minimum: 0, maximum: 2 },
    challenge: { enum: ['introduce', 'develop', 'test'] },
    enemy: { enum: allEnemies },
    reward: { enum: ['coins', 'heart', 'doubleJump', 'projectile', 'shield'] },
  },
  required: ['pattern', 'variant', 'challenge', 'enemy', 'reward'],
  additionalProperties: false,
} as const;
export const ENCOUNTER_ROUTE_SCHEMA = {
  type: 'object',
  properties: {
    orientation: { enum: ['horizontal', 'tower'] },
    direction: { enum: ['left', 'right'] },
    sections: { type: 'array', minItems: 5, maxItems: 6, items: ENCOUNTER_SECTION_SCHEMA },
  },
  required: ['orientation', 'direction', 'sections'],
  additionalProperties: false,
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
