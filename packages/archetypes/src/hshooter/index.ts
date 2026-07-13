import { ARCHETYPE_SCHEMAS, type GameSpec, type HShooterSpec } from '@sparkade/shared';
import type { Archetype } from '../types';
import { estimateHShooterDurationS, lintHShooter } from './lint';
import { createHShooterGame } from './game';

export const hshooter: Archetype = {
  id: 'hshooter',
  version: '1.0.0',
  schema: ARCHETYPE_SCHEMAS.hshooter,
  lint: (spec: GameSpec) => lintHShooter(spec as HShooterSpec),
  estimateDurationS: (spec: GameSpec) => estimateHShooterDurationS(spec as HShooterSpec),
  create: (engine, spec) => createHShooterGame(engine, spec as HShooterSpec),
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
    extras: ['at least 15 waves total', 'at least 2 powerup types', 'a terrain corridor per level'],
  },
};
