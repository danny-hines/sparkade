import {
  ARCHETYPE_SCHEMAS,
  fighterProjectile,
  type FighterSpec,
  type GameSpec,
} from '@sparkade/shared';
import type { Archetype } from '../types';
import { estimateFighterDurationS, lintFighter } from './lint';
import { createFighterGame } from './game';

export const fighter: Archetype = {
  id: 'fighter',
  version: '1.2.0',
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
  controlHelpFor: (spec) => {
    const style = (spec as FighterSpec).fighterStyle;
    if (!style) return fighter.controlHelp;
    return [
      { button: 'LEFT', label: 'Move / jump / crouch' },
      { button: 'RIGHT', label: 'Move / jump / crouch' },
      { button: 'UP', label: 'Move / jump / crouch' },
      { button: 'DOWN', label: 'Move / jump / crouch' },
      { button: 'B', label: 'Low punch - chain opener' },
      {
        button: 'Y',
        label:
          style === 'rangedControl'
            ? `High punch / guard+Y: ${fighterProjectile((spec as FighterSpec).player).name}`
            : 'High punch - chain follow-up',
      },
      { button: 'X', label: style === 'rushdown' ? 'High kick - chain finisher' : 'High kick' },
      { button: 'A', label: 'Low kick / sweep' },
      { button: 'L', label: style === 'counter' ? 'L/R timed guard, then strike' : 'L/R guard' },
    ];
  },
  contentFloors: {
    levels: 3,
    enemyTypes: 4,
    bossPhases: 2,
    extras: [
      'a 4-bout ladder (3 rungs + boss)',
      'best-of-3 rounds',
      'the boss fighter is visually distinct',
    ],
  },
};
