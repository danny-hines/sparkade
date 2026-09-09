import {
  ARCHETYPE_SCHEMAS,
  platformerMechanics,
  platformerChargeShot,
  type GameSpec,
  type PlatformerSpec,
} from '@sparkade/shared';
import type { Archetype } from '../types';
import { estimatePlatformerDurationS, lintPlatformer } from './lint';
import { createPlatformerGame } from './game';

const BASE_CONTROL_HELP = [
  { button: 'LEFT', label: 'Move' },
  { button: 'RIGHT', label: 'Move' },
  { button: 'DOWN', label: 'Duck / drop' },
  { button: 'A', label: 'Jump' },
  { button: 'B', label: 'Spin jump' },
  { button: 'Y', label: 'Run / throw' },
  { button: 'X', label: 'Run / throw' },
] as const;

function platformerControlHelp(spec: PlatformerSpec) {
  const kit = platformerMechanics(spec);
  if (kit.combat !== 'stomp')
    return [
      ...BASE_CONTROL_HELP.slice(0, 2),
      ...(kit.combat === 'blaster' ? [{ button: 'UP' as const, label: 'Aim upward' }] : []),
      BASE_CONTROL_HELP[2],
      { button: 'A' as const, label: kit.traversal === 'wallJump' ? 'Jump / wall jump' : 'Jump' },
      { button: 'B' as const, label: 'Run' },
      {
        button: 'Y' as const,
        label: kit.combat === 'blaster' ? 'Fire (hold)' : 'Strike / air strike',
      },
      ...(kit.combat === 'blaster'
        ? [
            {
              button: 'X' as const,
              label:
                platformerChargeShot(spec) === 'none' ? 'Fire (hold)' : 'Hold / release charge',
            },
          ]
        : []),
    ];
  if (kit.traversal === 'wallJump')
    return [
      ...BASE_CONTROL_HELP.slice(0, 3),
      { button: 'A' as const, label: 'Jump / wall jump' },
      { button: 'B' as const, label: 'Jump / wall jump' },
      { button: 'Y' as const, label: 'Run' },
      { button: 'X' as const, label: 'Run' },
    ];
  const doubleJump = spec.abilityLoadout?.find(({ kind }) => kind === 'doubleJump');
  const projectile = spec.abilityLoadout?.find(({ kind }) => kind === 'projectile');
  return [
    ...BASE_CONTROL_HELP.slice(0, 3),
    {
      button: 'A' as const,
      label: doubleJump ? `Jump / ${doubleJump.name.slice(0, 10)}` : 'Jump',
    },
    BASE_CONTROL_HELP[4],
    {
      button: 'Y' as const,
      label: projectile ? `Run / ${projectile.name.slice(0, 10)}` : 'Run',
    },
    {
      button: 'X' as const,
      label: projectile ? `Run / ${projectile.name.slice(0, 10)}` : 'Run',
    },
  ];
}

export const platformer: Archetype = {
  id: 'platformer',
  version: '1.0.0',
  schema: ARCHETYPE_SCHEMAS.platformer,
  lint: (spec: GameSpec) => lintPlatformer(spec as PlatformerSpec),
  estimateDurationS: (spec: GameSpec) => estimatePlatformerDurationS(spec as PlatformerSpec),
  create: (engine, spec) => createPlatformerGame(engine, spec as PlatformerSpec),
  controlHelp: [...BASE_CONTROL_HELP],
  controlHelpFor: (spec) => platformerControlHelp(spec as PlatformerSpec),
  contentFloors: {
    levels: 3,
    enemyTypes: 4,
    bossPhases: 2,
    extras: ['at least 1 powerup', 'at least 12 pickups total', 'a checkpoint in every level'],
  },
};
