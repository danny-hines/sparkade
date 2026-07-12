import { ARCHETYPE_SCHEMAS, type GameSpec, type ShooterSpec } from '@sparkade/shared';
import type { Archetype } from '../types';
import { estimateShooterDurationS, lintShooter } from './lint';
import { createShooterGame } from './game';

export const shooter: Archetype = {
  id: 'shooter',
  version: '1.0.0',
  schema: ARCHETYPE_SCHEMAS.shooter,
  lint: (spec: GameSpec) => lintShooter(spec as ShooterSpec),
  estimateDurationS: (spec: GameSpec) => estimateShooterDurationS(spec as ShooterSpec),
  create: (engine, spec) => createShooterGame(engine, spec as ShooterSpec),
  controlHelp: [
    { button: 'UP', label: 'Move' },
    { button: 'DOWN', label: 'Move' },
    { button: 'LEFT', label: 'Move' },
    { button: 'RIGHT', label: 'Move' },
    { button: 'Y', label: 'Fire (hold)' },
    { button: 'X', label: 'Charge shot' },
    { button: 'B', label: 'Bomb' },
    { button: 'A', label: 'Speed toggle' },
  ],
  contentFloors: {
    levels: 3,
    enemyTypes: 4,
    bossPhases: 2,
    extras: ['at least 15 waves total', 'at least 2 powerup types'],
  },
};
