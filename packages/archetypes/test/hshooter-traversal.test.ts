import { describe, expect, it } from 'vitest';
import type { HShooterLevel } from '@sparkade/shared';
import {
  HSHOOTER_PLAYER_HITBOX,
  HSHOOTER_PLAYER_MAX_SCREEN_X,
  HSHOOTER_PLAYER_MIN_SCREEN_X,
  HSHOOTER_PLAYER_START_SCREEN_X,
  HSHOOTER_PLAYER_SPEED_HIGH,
  HSHOOTER_ROUTE_REACTION_S,
  analyzeHShooterRoute,
} from '../src/hshooter/traversal';

const ROWS = 19;

function corridorLevel(options: {
  width?: number;
  scroll?: number;
  durationS?: number;
  tileAt: (x: number, y: number) => '.' | '#' | '^';
}): HShooterLevel {
  const width = options.width ?? 90;
  return {
    name: 'Temporal Corridor Fixture',
    musicSong: 'theme',
    scroll: options.scroll ?? 60,
    durationS: options.durationS ?? 8,
    tiles: Array.from({ length: ROWS }, (_, y) =>
      Array.from({ length: width }, (_, x) => options.tileAt(x, y)).join(''),
    ),
    legend: { '#': 'solid', '^': 'hazard' },
    waves: [],
    pickups: [],
  };
}

function staticCellPathExists(level: HShooterLevel): boolean {
  const width = level.tiles[0]!.length;
  const seen = new Set<string>();
  const pending: Array<[number, number]> = [];
  const open = (x: number, y: number) => {
    const tile = level.tiles[y]?.[x] ?? '#';
    return tile === '.' || level.legend[tile] !== 'solid';
  };
  for (let y = 0; y < level.tiles.length; y++) {
    if (open(0, y)) pending.push([0, y]);
  }
  while (pending.length) {
    const [x, y] = pending.pop()!;
    const key = `${x}:${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (x === width - 1) return true;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < level.tiles.length && open(nx, ny)) {
        pending.push([nx, ny]);
      }
    }
  }
  return false;
}

describe('H-scroll temporal corridor proof', () => {
  it('shares the real runtime ship envelope and preserves a gradual winding route', () => {
    const level = corridorLevel({
      tileAt: (x, y) => {
        const center = 9 + Math.round(Math.sin(x / 13) * 3);
        return Math.abs(y - center) <= 3 ? '.' : '#';
      },
    });
    const result = analyzeHShooterRoute(level);

    expect(HSHOOTER_PLAYER_HITBOX).toEqual({ w: 12, h: 10 });
    expect(HSHOOTER_PLAYER_SPEED_HIGH).toBe(190);
    expect(HSHOOTER_PLAYER_MIN_SCREEN_X).toBe(8);
    expect(HSHOOTER_PLAYER_MAX_SCREEN_X).toBe(500);
    expect(HSHOOTER_PLAYER_START_SCREEN_X).toBe(50);
    expect(HSHOOTER_ROUTE_REACTION_S).toBeGreaterThan(0);
    expect(result).toMatchObject({ reachable: true, reactionDistancePx: 15 });
    expect(result.simulatedSteps).toBeGreaterThan(200);
  });

  it('accepts a one-tile lane only when the real ship box has enough clearance', () => {
    const level = corridorLevel({ tileAt: (_x, y) => (y === 9 ? '.' : '#') });
    expect(analyzeHShooterRoute(level).reachable).toBe(true);

    level.tiles[9] = level.tiles[9]!.slice(0, 20) + '^' + level.tiles[9]!.slice(21);
    expect(analyzeHShooterRoute(level)).toMatchObject({
      reachable: false,
      failureReason: 'clearance',
    });
  });

  it('rejects an abrupt connected zigzag that cannot be flown at authored scroll speed', () => {
    const level = corridorLevel({
      width: 130,
      scroll: 120,
      durationS: 8,
      tileAt: (x, y) => {
        if (x < 24) return Math.abs(y - 9) <= 2 ? '.' : '#';
        if ((x - 24) % 4 === 0) return '.';
        const center = Math.floor((x - 24) / 4) % 2 === 0 ? 4 : 14;
        return Math.abs(y - center) <= 2 ? '.' : '#';
      },
    });

    expect(staticCellPathExists(level)).toBe(true);
    const result = analyzeHShooterRoute(level);
    expect(result.reachable).toBe(false);
    expect(result.failureTimeS).toBeGreaterThan(0);
    expect(result.failureTileColumn).toBeGreaterThan(0);
  });

  it('reports the first temporal failure before a crushing full-height wall', () => {
    const wallColumn = 28;
    const level = corridorLevel({
      width: 100,
      tileAt: (x, y) => (x === wallColumn || y < 2 || y > 16 ? '#' : '.'),
    });
    const result = analyzeHShooterRoute(level);

    expect(result).toMatchObject({ reachable: false });
    expect(result.failureTimeS).toBeGreaterThan(0);
    expect(result.failureTimeS).toBeLessThan(level.durationS);
    expect(result.failureWorldX).toBeGreaterThan(0);
    expect(result.failureTileColumn).toBeLessThanOrEqual(wallColumn);
  });
});
