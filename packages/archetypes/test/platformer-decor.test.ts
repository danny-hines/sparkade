import { describe, expect, it, vi } from 'vitest';
import type { PlatformerLevel, PlatformerTileType } from '@sparkade/shared';
import { surfaceDecorations } from '../src/platformer/decor';

const LEGEND: Record<string, PlatformerTileType> = {
  '#': 'solid',
  '=': 'platform',
  '^': 'hazard',
  C: 'checkpoint',
  '*': 'decoration',
  X: 'exit',
};

function flatLevel(width = 64): PlatformerLevel {
  return {
    name: 'Test Terrace',
    musicSong: 'theme',
    tiles: [
      ...Array.from({ length: 6 }, () => '.'.repeat(width)),
      '#'.repeat(width),
      '#'.repeat(width),
    ],
    legend: { ...LEGEND },
    entities: [],
    playerSpawn: { x: 2, y: 5 },
    exit: { x: width - 3, y: 5 },
  };
}

function kindAt(level: PlatformerLevel, x: number, y: number): PlatformerTileType {
  const ch = level.tiles[y]?.[x];
  if (ch === undefined || ch === '.') return 'empty';
  const kind = level.legend[ch] ?? 'empty';
  return kind === 'decoration' || kind === 'exit' ? 'empty' : kind;
}

describe('surfaceDecorations', () => {
  it('is deterministic, sparse, supported, clear above, and horizontally spaced', () => {
    const level = flatLevel();
    const first = surfaceDecorations(level, 0x12345678);
    const second = surfaceDecorations(level, 0x12345678);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(8);
    for (const cell of first) {
      expect(kindAt(level, cell.x, cell.y)).toBe('empty');
      expect(kindAt(level, cell.x, cell.y - 1)).toBe('empty');
      expect(['solid', 'platform']).toContain(kindAt(level, cell.x, cell.y + 1));
    }
    for (let i = 1; i < first.length; i++) {
      expect(first[i]!.x - first[i - 1]!.x).toBeGreaterThanOrEqual(6);
    }
  });

  it('varies placement by seed without using ambient randomness', () => {
    const level = flatLevel(96);
    const random = vi.spyOn(Math, 'random');

    expect(surfaceDecorations(level, 11)).not.toEqual(surfaceDecorations(level, 12));
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('treats authored decoration and exit cells as empty candidate space', () => {
    const level: PlatformerLevel = {
      ...flatLevel(9),
      tiles: [
        '.........',
        '.........',
        '.........',
        '....X....',
        '....*....',
        '....#....',
        '.........',
      ],
      playerSpawn: { x: 0, y: 0 },
      exit: { x: 8, y: 0 },
    };

    expect(surfaceDecorations(level, 4)).toEqual([{ x: 4, y: 4 }]);
  });

  it('requires two-cell clearance above a supported surface', () => {
    const level: PlatformerLevel = {
      ...flatLevel(9),
      tiles: [
        '....#....',
        '....#....',
        '....#....',
        '....#....',
        '.........',
        '....#....',
        '.........',
      ],
      playerSpawn: { x: 0, y: 0 },
      exit: { x: 8, y: 0 },
    };

    expect(surfaceDecorations(level, 4)).toEqual([]);
  });

  it('keeps clear of fixtures, hazards, every entity, and moving-platform travel', () => {
    const width = 56;
    const level = flatLevel(width);
    const fixtureRow = level.tiles[5]!.split('');
    fixtureRow[11] = 'C';
    fixtureRow[18] = '^';
    level.tiles[5] = fixtureRow.join('');
    level.playerSpawn = { x: 4, y: 5 };
    level.exit = { x: 51, y: 5 };
    level.entities = [
      { type: 'walker', x: 24, y: 5 },
      { type: 'coin', x: 31, y: 3 },
      { type: 'spring', x: 37, y: 5 },
      { type: 'movingPlatform', x: 42, y: 4, props: { dx: 5, dy: 0, periodMs: 1800 } },
    ];

    const cells = surfaceDecorations(level, 99);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(Math.abs(cell.x - level.playerSpawn.x)).toBeGreaterThan(3);
      expect(Math.abs(cell.x - level.exit.x)).toBeGreaterThan(3);
      for (const x of [11, 18, 24, 31, 37]) expect(Math.abs(cell.x - x)).toBeGreaterThan(2);
      for (let x = 42; x <= 47; x++) expect(Math.abs(cell.x - x)).toBeGreaterThan(2);
    }
  });

  it('can decorate both full ground and one-way platform surfaces', () => {
    const width = 72;
    const level = flatLevel(width);
    level.tiles[4] = '.'.repeat(28) + '='.repeat(20) + '.'.repeat(24);

    const cells = Array.from({ length: 40 }, (_, seed) => surfaceDecorations(level, seed)).flat();
    expect(cells.some((cell) => kindAt(level, cell.x, cell.y + 1) === 'solid')).toBe(true);
    expect(cells.some((cell) => kindAt(level, cell.x, cell.y + 1) === 'platform')).toBe(true);
  });
});
