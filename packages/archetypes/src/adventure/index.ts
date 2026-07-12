import { ARCHETYPE_SCHEMAS, type AdventureSpec, type GameSpec } from '@sparkade/shared';
import type { Archetype } from '../types';
import { estimateAdventureDurationS, lintAdventure } from './lint';
import { createAdventureGame } from './game';

export const adventure: Archetype = {
  id: 'adventure',
  version: '1.0.0',
  schema: ARCHETYPE_SCHEMAS.adventure,
  lint: (spec: GameSpec) => lintAdventure(spec as AdventureSpec),
  estimateDurationS: (spec: GameSpec) => estimateAdventureDurationS(spec as AdventureSpec),
  create: (engine, spec) => createAdventureGame(engine, spec as AdventureSpec),
  controlHelp: [
    { button: 'UP', label: 'Move' },
    { button: 'DOWN', label: 'Move' },
    { button: 'LEFT', label: 'Move' },
    { button: 'RIGHT', label: 'Move' },
    { button: 'B', label: 'Sword' },
    { button: 'Y', label: 'Item' },
    { button: 'A', label: 'Interact / talk' },
    { button: 'SELECT', label: 'Map' },
  ],
  contentFloors: {
    levels: 1,
    enemyTypes: 4,
    bossPhases: 2,
    extras: ['at least 8 rooms', 'at least 2 locked gates with keys', 'at least 1 NPC with dialog'],
  },
};
