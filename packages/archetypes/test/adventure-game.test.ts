import { describe, expect, it } from 'vitest';
import {
  ADVENTURE_ROOM_COLUMNS,
  ADVENTURE_ROOM_HEIGHT,
  ADVENTURE_ROOM_ROWS,
  ADVENTURE_ROOM_WIDTH,
} from '@sparkade/shared';
import {
  adventureDecorationFrameIndex,
  adventureFixtureVariantIndex,
  adventurePlayerPoseName,
  adventureRoomPlateIndex,
  adventureTerrainFrameIndex,
  compareAdventureDepth,
} from '../src/adventure/game';

describe('Adventure high-density terrain selection', () => {
  it('uses the expanded single-screen room footprint', () => {
    expect({ columns: ADVENTURE_ROOM_COLUMNS, rows: ADVENTURE_ROOM_ROWS }).toEqual({
      columns: 28,
      rows: 14,
    });
    expect({ width: ADVENTURE_ROOM_WIDTH, height: ADVENTURE_ROOM_HEIGHT }).toEqual({
      width: 448,
      height: 224,
    });
  });

  it('walks a 4×4 material atlas spatially instead of animating it', () => {
    expect([0, 1, 2, 3, 4].map((tx) => adventureTerrainFrameIndex(tx, 0, 16, 1))).toEqual([
      0, 1, 2, 3, 0,
    ]);
    expect(adventureTerrainFrameIndex(2, 1, 16, 0)).toBe(6);
    expect(adventureTerrainFrameIndex(2, 1, 16, 99)).toBe(6);
  });

  it('offsets the material field between dungeon rooms', () => {
    expect(adventureTerrainFrameIndex(0, 0, 16, 0, 0, 0)).toBe(0);
    expect(adventureTerrainFrameIndex(0, 0, 16, 0, 1, 0)).toBe(1);
    expect(adventureTerrainFrameIndex(0, 0, 16, 0, 0, 1)).toBe(4);
  });

  it('preserves compact authored animation and wraps safely', () => {
    expect(adventureTerrainFrameIndex(7, 4, 2, 3)).toBe(1);
    expect(adventureTerrainFrameIndex(7, 4, 2, -1)).toBe(1);
    expect(adventureTerrainFrameIndex(7, 4, 0, 9)).toBe(0);
  });
});

describe('Adventure fixture and actor depth selection', () => {
  it('selects fixture variants spatially and independently from animation time', () => {
    const first = adventureFixtureVariantIndex(4, 7, 8, 1, -2, 17);
    expect(adventureFixtureVariantIndex(4, 7, 8, 1, -2, 17)).toBe(first);
    expect(adventureFixtureVariantIndex(4, 7, 0, 1, -2, 17)).toBe(0);

    const used = new Set(
      Array.from({ length: 64 }, (_, index) =>
        adventureFixtureVariantIndex(index % 8, Math.floor(index / 8), 8, 0, 0, 17),
      ),
    );
    expect(used.size).toBe(8);
  });

  it('keeps tall decoration variants sparse inside dense authored clusters', () => {
    const frames = Array.from({ length: 100 }, (_, index) =>
      adventureDecorationFrameIndex(index % 10, Math.floor(index / 10), 8),
    );
    const tall = frames.filter((frame) => frame >= 4);
    expect(tall.length).toBeGreaterThanOrEqual(12);
    expect(tall.length).toBeLessThanOrEqual(28);
    expect(new Set(frames.filter((frame) => frame < 4)).size).toBe(4);
  });

  it('sorts by ground contact before category and preserves deterministic ties', () => {
    const items = [
      { id: 'player', groundY: 40, depthOrder: 5, stableOrder: 3 },
      { id: 'upper-enemy', groundY: 24, depthOrder: 3, stableOrder: 2 },
      { id: 'fixture', groundY: 40, depthOrder: 0, stableOrder: 1 },
      { id: 'first-enemy', groundY: 40, depthOrder: 3, stableOrder: 0 },
      { id: 'second-enemy', groundY: 40, depthOrder: 3, stableOrder: 4 },
    ];

    expect(items.sort(compareAdventureDepth).map((item) => item.id)).toEqual([
      'upper-enemy',
      'fixture',
      'first-enemy',
      'second-enemy',
      'player',
    ]);
  });
});

describe('Adventure generated room-surface progression', () => {
  it('reserves stable atlas panels for entrance and finale rooms', () => {
    expect(adventureRoomPlateIndex(2, 2, 8, 0, 6)).toBe(0);
    expect(adventureRoomPlateIndex(8, 2, 8, 6, 6)).toBe(3);
  });

  it('moves ordinary rooms into the deep treatment by graph distance', () => {
    expect(adventureRoomPlateIndex(3, 0, 9, 1, 6)).toBe(1);
    expect(adventureRoomPlateIndex(6, 0, 9, 4, 6)).toBe(2);
    expect(adventureRoomPlateIndex(4, 0, 9, 1, 2)).toBe(1);
  });
});

describe('Adventure generated player pose selection', () => {
  it('alternates idle and contact frames while moving and mirrors one shared side identity', () => {
    expect(adventurePlayerPoseName('down', false)).toBe('downIdle');
    expect(adventurePlayerPoseName('down', true, 0)).toBe('downIdle');
    expect(adventurePlayerPoseName('down', true, 1 / 6)).toBe('downWalk');
    expect(adventurePlayerPoseName('down', true, 2 / 6)).toBe('downIdle');
    expect(adventurePlayerPoseName('up', false)).toBe('upIdle');
    expect(adventurePlayerPoseName('up', true, 1 / 6)).toBe('upWalk');
    expect(adventurePlayerPoseName('right', false)).toBe('sideIdle');
    expect(adventurePlayerPoseName('left', true, 1 / 6)).toBe('sideWalk');
  });
});
