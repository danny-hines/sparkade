import { ARCHETYPE_SCHEMAS, type FighterSpec, type GameSpec } from '@sparkade/shared';
import type { Archetype } from '../types';
import { estimateFighterDurationS, lintFighter } from './lint';
import { createFighterGame } from './game';

export const fighter: Archetype = {
  id: 'fighter',
  version: '1.0.0',
  schema: ARCHETYPE_SCHEMAS.fighter,
  lint: (spec: GameSpec) => lintFighter(spec as FighterSpec),
  estimateDurationS: (spec: GameSpec) => estimateFighterDurationS(spec as FighterSpec),
  create: (engine, spec) => createFighterGame(engine, spec as FighterSpec),
  controlHelp: [
    { button: 'LEFT', label: 'Move' },
    { button: 'RIGHT', label: 'Move' },
    { button: 'UP', label: 'Jump' },
    { button: 'DOWN', label: 'Crouch' },
    { button: 'Y', label: 'High punch' },
    { button: 'B', label: 'Low punch' },
    { button: 'X', label: 'High kick' },
    { button: 'A', label: 'Low kick' },
    { button: 'L', label: 'Block' },
    { button: 'R', label: 'Block' },
  ],
  contentFloors: {
    levels: 3,
    enemyTypes: 4,
    bossPhases: 2,
    extras: ['a 4-bout ladder (3 rungs + boss)', 'best-of-3 rounds', 'the boss fighter is visually distinct'],
  },
};
