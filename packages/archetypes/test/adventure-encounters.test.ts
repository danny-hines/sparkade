import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AdventureRoom, AdventureSpec } from '@sparkade/shared';
import {
  adventureBossArenaRequirements,
  adventureDoorReactionCells,
  adventureProjectileLineClear,
  adventureShooterHasClearLane,
  analyzeAdventureBossArena,
} from '../src/adventure/encounters';

function goldenRoom(kind: 'entrance' | 'boss'): AdventureRoom {
  const path = join(__dirname, '..', '..', 'generation', 'golden', 'golden-adventure.json');
  const spec = JSON.parse(readFileSync(path, 'utf8')) as AdventureSpec;
  const dungeon = spec.levels[0]!;
  const id = kind === 'entrance' ? dungeon.startRoom : dungeon.bossRoom;
  return structuredClone(dungeon.rooms.find((room) => room.id === id)!);
}

function setCell(room: AdventureRoom, x: number, y: number, value: string): void {
  const row = room.tiles[y]!;
  room.tiles[y] = row.slice(0, x) + value + row.slice(x + 1);
}

describe('Adventure encounter-space geometry', () => {
  it('reserves a three-cell-deep, four-cell-wide reaction area for each door', () => {
    const room = goldenRoom('boss');
    room.doors = { n: 'open', e: 'none', s: 'none', w: 'none' };
    const cells = adventureDoorReactionCells(room);

    expect(cells).toHaveLength(12);
    expect(cells).toContainEqual({ x: 14, y: 1 });
    expect(cells).toContainEqual({ x: 17, y: 3 });
  });

  it('matches runtime projectile blocking and proves a lateral player dodge cell', () => {
    const room = goldenRoom('entrance');
    room.tiles = room.tiles.map((row, y) =>
      y === 0 || y === room.tiles.length - 1
        ? '#'.repeat(row.length)
        : `#${'.'.repeat(row.length - 2)}#`,
    );
    const shooter = { x: 4, y: 7 };
    const target = { x: 12, y: 7 };
    const reachable = new Set(['12,7', '12,6']);

    expect(adventureProjectileLineClear(room, shooter, target)).toBe(true);
    expect(adventureShooterHasClearLane(room, shooter, reachable)).toBe(true);

    room.legend['~'] = 'hazard';
    setCell(room, 8, 7, '~');
    expect(adventureProjectileLineClear(room, shooter, target)).toBe(true);

    setCell(room, 8, 7, '#');
    expect(adventureProjectileLineClear(room, shooter, target)).toBe(false);
    expect(adventureShooterHasClearLane(room, shooter, reachable)).toBe(false);
  });

  it('proves the boss dodge loop, charge cross, and separated arrival pads', () => {
    const room = goldenRoom('boss');
    room.tiles = room.tiles.map((row, y) =>
      y === 0 || y === room.tiles.length - 1
        ? '#'.repeat(row.length)
        : `#${'.'.repeat(row.length - 2)}#`,
    );
    const patterns = ['charge', 'teleport', 'summon'] as const;
    const healthy = analyzeAdventureBossArena(room, patterns);

    expect(healthy).toEqual({
      dodgeRouteClear: true,
      chargeLanesClear: true,
      openTeleportPads: 4,
      requiredTeleportPads: 4,
      openSummonPads: 2,
      requiredSummonPads: 2,
    });

    const requirements = adventureBossArenaRequirements(room, patterns);
    const center = requirements.chargeLanes[Math.floor(requirements.chargeLanes.length / 2)]!;
    const teleport = requirements.teleportPads[0]![0]!;
    const summon = requirements.summonPads[1]![0]!;
    setCell(room, center.x, center.y, '#');
    setCell(room, teleport.x, teleport.y, '#');
    setCell(room, summon.x, summon.y, '#');

    const broken = analyzeAdventureBossArena(room, patterns);
    expect(broken.dodgeRouteClear).toBe(false);
    expect(broken.chargeLanesClear).toBe(false);
    expect(broken.openTeleportPads).toBeLessThan(4);
    expect(broken.openSummonPads).toBeLessThan(2);
  });
});
