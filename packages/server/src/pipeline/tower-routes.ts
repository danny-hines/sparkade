import type { PlatformerLevel } from '@sparkade/shared';

export const TOWER_ROUTE_SCHEMA = {
  type: 'object',
  properties: {
    direction: { enum: ['left', 'right'] },
    sections: {
      type: 'array',
      minItems: 5,
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          rise: { type: 'integer', minimum: 6, maximum: 12 },
          width: { type: 'integer', minimum: 3, maximum: 5 },
          enemy: { enum: ['none', 'walker', 'flyer', 'shooter', 'chaser'] },
          reward: { enum: ['coins', 'heart', 'shield', 'projectile'] },
        },
        required: ['rise', 'width', 'enemy', 'reward'],
        additionalProperties: false,
      },
    },
  },
  required: ['direction', 'sections'],
  additionalProperties: false,
} as const;

interface Section {
  rise: number;
  width: number;
  enemy: 'none' | 'walker' | 'flyer' | 'shooter' | 'chaser';
  reward: 'coins' | 'heart' | 'shield' | 'projectile';
}

/** A compact authoring representation, compiled before the ordinary geometry
 * validator. Every wall rises from its previous landing, without a ceiling
 * lip. This avoids the disconnected shelves produced by raw-grid tower repair. */
export function compileTowerRoute(value: unknown): Omit<PlatformerLevel, 'name' | 'musicSong'> {
  if (!value || typeof value !== 'object') throw new Error('towerRoute must be an object');
  const route = value as { direction: string; sections: Section[] };
  if (
    !['left', 'right'].includes(route.direction) ||
    !Array.isArray(route.sections) ||
    route.sections.length < 5 ||
    route.sections.length > 8
  )
    throw new Error('towerRoute needs a direction and 5-8 sections');
  if (Object.keys(value).some((key) => !['direction', 'sections'].includes(key)))
    throw new Error('unknown towerRoute field');
  for (const section of route.sections) {
    if (
      !section ||
      !Number.isInteger(section.rise) ||
      section.rise < 6 ||
      section.rise > 12 ||
      !Number.isInteger(section.width) ||
      section.width < 3 ||
      section.width > 5 ||
      !['none', 'walker', 'flyer', 'shooter', 'chaser'].includes(section.enemy) ||
      !['coins', 'heart', 'shield', 'projectile'].includes(section.reward) ||
      Object.keys(section).some((key) => !['rise', 'width', 'enemy', 'reward'].includes(key))
    )
      throw new Error('invalid tower section');
  }
  const width = Math.max(32, 8 + route.sections.reduce((sum, s) => sum + s.width, 0));
  const height = Math.max(48, 8 + route.sections.reduce((sum, s) => sum + s.rise, 0));
  const cells = Array.from({ length: height }, (_, y) =>
    Array<string>(width).fill(y === height - 1 ? '#' : '.'),
  );
  const entities: PlatformerLevel['entities'] = [];
  let x = 4,
    surface = height - 1;
  route.sections.forEach((section, index) => {
    surface -= section.rise;
    for (let y = surface; y < height; y++)
      for (let col = x; col < x + section.width; col++) cells[y]![col] = '#';
    if (index === 1 || index === route.sections.length - 2) cells[surface - 1]![x + 1] = 'C';
    entities.push({ type: 'coin', x, y: surface - 3 }, { type: 'coin', x: x + 1, y: surface - 3 });
    if (section.enemy !== 'none')
      entities.push({
        type: section.enemy,
        x: x + section.width - 2,
        y: surface - 1,
        props: { range: 1, amplitude: 0.5, fireIntervalMs: 2800 },
      });
    if (section.reward === 'coins') entities.push({ type: 'coin', x: x + 1, y: surface - 2 });
    else if (section.reward === 'heart') entities.push({ type: 'heart', x: x + 1, y: surface - 2 });
    else
      entities.push({ type: 'powerup', x: x + 1, y: surface - 2, props: { kind: section.reward } });
    x += section.width;
  });
  const playerSpawn = { x: 1, y: height - 2 };
  const exit = { x: x - 2, y: surface - 1 };
  if (route.direction === 'left') {
    cells.forEach((row) => row.reverse());
    playerSpawn.x = width - 1 - playerSpawn.x;
    exit.x = width - 1 - exit.x;
    entities.forEach((entity) => {
      entity.x = width - 1 - entity.x;
    });
  }
  return {
    tiles: cells.map((row) => row.join('')),
    legend: { '#': 'solid', C: 'checkpoint' },
    entities,
    playerSpawn,
    exit,
  };
}

export const TOWER_ROUTE_GUIDANCE = `TOWER AUTHORING: For every tower stage emit {name, musicSong, towerRoute} instead of tileRuns, legend, entities, playerSpawn or exit. towerRoute is {direction:"left"|"right",sections:[{rise:6..12,width:3..5,enemy:"none"|"walker"|"flyer"|"shooter"|"chaser",reward:"coins"|"heart"|"shield"|"projectile"}]}, with 5-8 sections in bottom-to-top order. The compiler builds exposed wall faces with open approaches, supported rest ledges, two checkpoints at different heights, a bottom spawn and a summit exit. Each section has two route coins plus its reward and optional enemy. Choose different directions, rise sequences, ledge widths and encounters across the three stages; teach, twist, test. Use all four enemy types across the run. Place rewards for every selected abilityLoadout kind (towerClimber shield only; armedClimber projectile and optional shield). Do not add doubleJump. This representation avoids disconnected ledges and head-blocking overhangs. Horizontal stages still use tileRuns normally. Example towerRoute: {"direction":"right","sections":[{"rise":6,"width":4,"enemy":"none","reward":"coins"},{"rise":8,"width":5,"enemy":"walker","reward":"shield"},{"rise":10,"width":3,"enemy":"flyer","reward":"coins"},{"rise":7,"width":4,"enemy":"shooter","reward":"heart"},{"rise":9,"width":5,"enemy":"chaser","reward":"coins"},{"rise":8,"width":4,"enemy":"none","reward":"coins"}]}.`;
