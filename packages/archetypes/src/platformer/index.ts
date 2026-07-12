import { ARCHETYPE_SCHEMAS, type GameSpec, type PlatformerSpec } from '@sparkade/shared';
import type { Archetype } from '../types';
import { estimatePlatformerDurationS, lintPlatformer } from './lint';
import { createPlatformerGame } from './game';

export const platformer: Archetype = {
  id: 'platformer',
  version: '1.0.0',
  schema: ARCHETYPE_SCHEMAS.platformer,
  lint: (spec: GameSpec) => lintPlatformer(spec as PlatformerSpec),
  estimateDurationS: (spec: GameSpec) => estimatePlatformerDurationS(spec as PlatformerSpec),
  create: (engine, spec) => createPlatformerGame(engine, spec as PlatformerSpec),
  controlHelp: [
    { button: 'LEFT', label: 'Move' },
    { button: 'RIGHT', label: 'Move' },
    { button: 'DOWN', label: 'Duck / drop' },
    { button: 'B', label: 'Jump' },
    { button: 'A', label: 'Spin jump' },
    { button: 'Y', label: 'Run / throw' },
    { button: 'X', label: 'Run / throw' },
  ],
  contentFloors: {
    levels: 3,
    enemyTypes: 4,
    bossPhases: 2,
    extras: ['at least 1 powerup', 'at least 12 pickups total', 'a checkpoint in every level'],
  },
};
