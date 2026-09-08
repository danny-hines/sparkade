import {
  PLATFORMER_STYLE_CATALOG,
  platformerMechanics,
  type PlatformerPlayStyle,
  type PlatformerSpec,
  type PlatformerLevel,
} from '@sparkade/shared';

/** Authored reference courses for development and the mock provider. Real generation still
 * authors its own levels; these examples establish playable package contracts at zero image cost. */
export function platformerStyleExample(
  base: PlatformerSpec,
  style: PlatformerPlayStyle,
): PlatformerSpec {
  const spec = structuredClone(base);
  spec.playStyle = style;
  delete spec.mechanics;
  spec.mechanics = platformerMechanics(spec);
  spec.playerHeightTiles = 2;
  spec.platformerScale = 'heroic';
  spec.platformerArtDensity = 'detailed';
  spec.movementProfile = style === 'acrobat' ? 'momentum' : 'precision';
  delete spec.feel;
  spec.meta.title = PLATFORMER_STYLE_CATALOG[style].name;
  spec.meta.tagline = PLATFORMER_STYLE_CATALOG[style].objective;
  if (style !== 'acrobat')
    spec.abilityLoadout =
      style === 'runAndGun' || style === 'armedClimber'
        ? [
            {
              kind: 'projectile',
              name: 'Arc Blaster',
              visualConcept: 'A bright blue-white energy bolt with a warm brass core',
            },
          ]
        : [
            {
              kind: 'shield',
              name: 'Guard Spark',
              visualConcept: 'A small brass crest wrapped in a blue-white protective aura',
            },
          ];
  spec.story.intro = [
    `${PLATFORMER_STYLE_CATALOG[style].name}: ${PLATFORMER_STYLE_CATALOG[style].objective}.`,
  ];
  spec.story.levelIntros =
    style === 'towerClimber'
      ? [
          'Press toward a wall and jump again to climb. Rest on the ledges.',
          'Jump up the walls. Watch for foes on the next landing.',
          'The summit is above. Checkpoints remember your height.',
        ]
      : style === 'runAndGun' || style === 'armedClimber'
        ? [
            'Hold Y to fire. Hold X, then release for a charged shot.',
            'Hold UP to fire at overhead targets. A jumps and B runs.',
            'Find a clear firing lane. Touching enemies hurts, even from above.',
          ]
        : style === 'meleeAction'
          ? [
              'Y strikes with an energy arc. Step in, strike, then retreat.',
              'A jumps. B runs. Your strike has a short windup and recovery.',
              'Use reach to defeat foes before they touch you.',
            ]
          : [
              'Jump, bounce and keep your momentum.',
              'Follow the coins and read each landing.',
              'Bring your best jumps to the final course.',
            ];
  for (const level of spec.levels)
    for (const e of level.entities) {
      if (e.type === 'powerup' && style !== 'acrobat')
        e.props = { kind: spec.abilityLoadout![0]!.kind };
    }
  if (style === 'armedClimber') {
    spec.levels[1] = towerExampleLevel(1);
    for (const e of spec.levels[1]!.entities)
      if (e.type === 'powerup') e.props = { kind: 'projectile' };
    spec.story.levelIntros = [
      'A jumps, B runs, Y fires. Hold X to charge and UP to aim upward.',
      'Hold toward a wall and tap A to climb. Fire away from the wall; keep charging through jumps.',
      'Combine charged shots and wall jumps. Enemy contact hurts from every direction.',
    ];
    delete spec.boss.arena;
  }
  if (style === 'towerClimber') {
    spec.levels = [0, 1, 2].map(towerExampleLevel);
    // The finale's solid side walls support the same wall-jump dodge action.
    delete spec.boss.arena;
  }
  return spec;
}

export function towerExampleLevel(index: number): PlatformerLevel {
  const width = 32,
    height = 64;
  const cells: string[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, () => (y >= height - 1 ? '#' : '.')),
  );
  const entities: PlatformerLevel['entities'] = [];
  for (let step = 0; step < 7; step++) {
    const x = 4 + step * 4;
    const surface = 56 - step * 8;
    for (let row = surface; row < height; row++)
      for (let col = x; col < x + 4; col++) cells[row]![col] = '#';
    if (step === 2 || step === 4) cells[surface - 1]![x + 1] = 'C';
    entities.push(
      { type: 'coin', x: x + 1, y: surface - 3 },
      { type: 'coin', x: x + 2, y: surface - 3 },
    );
    if (step > 0 && step < 6) {
      entities.push({
        type: (['walker', 'shooter', 'flyer', 'chaser'] as const)[(step + index) % 4]!,
        x: x + 2,
        y: surface - 1,
        props: { range: 1, amplitude: 0.5, fireIntervalMs: 3000 },
      });
    }
    if (step === 1)
      entities.push({ type: 'powerup', x: x + 1, y: surface - 1, props: { kind: 'shield' } });
    if (step === 5) entities.push({ type: 'heart', x: x + 1, y: surface - 1 });
  }
  return {
    name: ['Wallworks', 'High Watch', 'The Summit'][index] ?? 'Tower',
    musicSong: 'theme',
    tiles: cells.map((row) => row.join('')),
    legend: { '#': 'solid', C: 'checkpoint' },
    entities,
    playerSpawn: { x: 1, y: 62 },
    exit: { x: 29, y: 7 },
  };
}
