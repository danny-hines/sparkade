// Archetype lints: every golden game passes; a corpus of deliberately broken
// specs each fails with the right diagnostic code; content floors; duration
// estimator; platformer reachability; adventure key/lock topology.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  AdventureSpec,
  FighterSpec,
  GameSpec,
  HShooterSpec,
  PlatformerSpec,
  ShooterSpec,
} from '@sparkade/shared';
import { MIN_DURATION_S } from '@sparkade/shared';
import { archetypes } from '@sparkade/archetypes';
import {
  checkKeyTopology,
  buildGraph,
  reconcileDoors,
  safelyReachableRoomCells,
} from '../src/adventure/lint';
import {
  analyzePlatformerTraversal,
  parseLevelGrid,
  platformerReachabilityBlockage,
  reachableCells,
} from '../src/platformer/lint';

/** First solid cell in a level, for placing deliberately-embedded fixtures. */
function firstSolid(level: PlatformerSpec['levels'][number]): { x: number; y: number } {
  const grid = parseLevelGrid(level);
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (grid.kind(x, y) === 'solid') return { x, y };
    }
  }
  throw new Error('golden level has no solid tile');
}

function firstKind(
  level: PlatformerSpec['levels'][number],
  expected: 'solid' | 'platform',
): { x: number; y: number } {
  const grid = parseLevelGrid(level);
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (grid.kind(x, y) === expected) return { x, y };
    }
  }
  throw new Error(`golden level has no ${expected} tile`);
}

function setLevelCell(
  level: PlatformerSpec['levels'][number],
  x: number,
  y: number,
  ch: string,
): void {
  const row = level.tiles[y]!;
  level.tiles[y] = row.slice(0, x) + ch + row.slice(x + 1);
}

function setAdventureCell(
  room: AdventureSpec['levels'][number]['rooms'][number],
  x: number,
  y: number,
  ch: string,
): void {
  const row = room.tiles[y]!;
  room.tiles[y] = row.slice(0, x) + ch + row.slice(x + 1);
}

function golden<T extends GameSpec>(archetype: string): T {
  const path = join(__dirname, '..', '..', 'generation', 'golden', `golden-${archetype}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const codes = (errors: { code: string }[]) => errors.map((e) => e.code);

describe('golden games are golden', () => {
  for (const a of ['platformer', 'shooter', 'adventure', 'hshooter'] as const) {
    it(`golden-${a} passes lint with zero errors and meets the five-minute rule`, () => {
      const spec = golden(a);
      expect(archetypes[a].lint(spec)).toEqual([]);
      expect(archetypes[a].estimateDurationS(spec)).toBeGreaterThanOrEqual(MIN_DURATION_S);
    });
  }
});

describe('horizontal-shooter encounter lints', () => {
  it('reports the first impossible temporal corridor column with actionable guidance', () => {
    const spec = golden<HShooterSpec>('hshooter');
    const level = spec.levels[0]!;
    const wallColumn = 70;
    level.tiles = level.tiles.map(
      (row) => row.slice(0, wallColumn) + '#' + row.slice(wallColumn + 1),
    );

    const issue = archetypes.hshooter
      .lint(spec)
      .find(
        (error) => error.code === 'HSHOOT_ROUTE_SPEED' || error.code === 'HSHOOT_ROUTE_CLEARANCE',
      );
    expect(issue?.path).toBe('/levels/0/tiles');
    expect(issue?.message).toContain('temporal route fails at t=');
    expect(issue?.message).toContain('tile column');
    expect(issue?.message).toContain('forward reaction clearance');
  });

  it('rejects formations that cannot fit at their actual terrain spawn columns', () => {
    const spec = golden<HShooterSpec>('hshooter');
    const level = spec.levels[0]!;
    const solid = '#'.repeat(level.tiles[0]!.length);
    const open = '.'.repeat(level.tiles[0]!.length);
    level.tiles = [
      ...Array.from({ length: 7 }, () => solid),
      ...Array.from({ length: 5 }, () => open),
      ...Array.from({ length: 7 }, () => solid),
    ];
    level.waves[0] = {
      ...level.waves[0]!,
      enemyType: 'popcorn',
      count: 5,
      formation: 'line',
    };

    expect(codes(archetypes.hshooter.lint(spec))).toContain('HSHOOT_WAVE_SPAWN_TERRAIN');
  });

  it('requires mounted turrets to retain a firing window and dodge lane', () => {
    const spec = golden<HShooterSpec>('hshooter');
    const wave = spec.levels[0]!.waves[0]!;
    spec.levels[0]!.waves[0] = {
      ...wave,
      enemyType: 'turret',
      count: 8,
      formation: 'line',
      path: 'hold',
    };

    expect(codes(archetypes.hshooter.lint(spec))).toContain('HSHOOT_TURRET_NO_SURFACE');
  });

  it('rejects a pickup that enters too late to reach a collection lane', () => {
    const spec = golden<HShooterSpec>('hshooter');
    const level = spec.levels[0]!;
    level.pickups[0] = { ...level.pickups[0]!, t: level.durationS - 1 };

    const issue = archetypes.hshooter
      .lint(spec)
      .find((error) => error.code === 'HSHOOT_PICKUP_UNREACHABLE');
    expect(issue?.path).toBe('/levels/0/pickups/0');
    expect(issue?.message).toContain('safe reachable trajectory');
    expect(issue?.message).toContain('schedule it earlier');
  });
});

describe('platformer lints', () => {
  it('unequal rows → PLAT_ROWS_UNEQUAL', () => {
    const spec = golden<PlatformerSpec>('platformer');
    spec.levels[0]!.tiles[3] = spec.levels[0]!.tiles[3]!.slice(0, -4);
    expect(codes(archetypes.platformer.lint(spec))).toContain('PLAT_ROWS_UNEQUAL');
  });

  it('unknown legend char → PLAT_LEGEND_UNKNOWN_CHAR', () => {
    const spec = golden<PlatformerSpec>('platformer');
    const row = spec.levels[0]!.tiles[2]!;
    spec.levels[0]!.tiles[2] = '@' + row.slice(1);
    delete spec.levels[0]!.legend['@'];
    expect(codes(archetypes.platformer.lint(spec))).toContain('PLAT_LEGEND_UNKNOWN_CHAR');
  });

  it('floating spawn → PLAT_SPAWN_NOT_GROUNDED', () => {
    const spec = golden<PlatformerSpec>('platformer');
    spec.levels[0]!.playerSpawn = { x: 2, y: 0 };
    // ensure sky above: blank the column
    spec.levels[0]!.tiles = spec.levels[0]!.tiles.map((r, y) => (y < 6 ? '.'.repeat(r.length) : r));
    expect(codes(archetypes.platformer.lint(spec))).toContain('PLAT_SPAWN_NOT_GROUNDED');
  });

  it('spawn embedded in a solid tile → PLAT_SPAWN_IN_SOLID', () => {
    const spec = golden<PlatformerSpec>('platformer');
    spec.levels[0]!.playerSpawn = firstSolid(spec.levels[0]!);
    expect(codes(archetypes.platformer.lint(spec))).toContain('PLAT_SPAWN_IN_SOLID');
  });

  it('exit embedded in a solid tile → PLAT_EXIT_IN_SOLID', () => {
    const spec = golden<PlatformerSpec>('platformer');
    spec.levels[0]!.exit = firstSolid(spec.levels[0]!);
    expect(codes(archetypes.platformer.lint(spec))).toContain('PLAT_EXIT_IN_SOLID');
  });

  it('requires two-tile headroom at spawn, exit, and checkpoints in new games', () => {
    const spawnSpec = golden<PlatformerSpec>('platformer');
    const spawn = spawnSpec.levels[0]!.playerSpawn;
    setLevelCell(spawnSpec.levels[0]!, spawn.x, spawn.y - 1, '#');
    expect(codes(archetypes.platformer.lint(spawnSpec))).toContain('PLAT_SPAWN_NO_HEADROOM');

    const exitSpec = golden<PlatformerSpec>('platformer');
    const exit = exitSpec.levels[0]!.exit;
    setLevelCell(exitSpec.levels[0]!, exit.x, exit.y - 1, '#');
    expect(codes(archetypes.platformer.lint(exitSpec))).toContain('PLAT_EXIT_NO_HEADROOM');

    const checkpointSpec = golden<PlatformerSpec>('platformer');
    const level = checkpointSpec.levels[0]!;
    const checkpointChar = Object.entries(level.legend).find(
      ([, kind]) => kind === 'checkpoint',
    )![0];
    const checkpointY = level.tiles.findIndex((row) => row.includes(checkpointChar));
    const checkpointX = level.tiles[checkpointY]!.indexOf(checkpointChar);
    setLevelCell(level, checkpointX, checkpointY - 1, '#');
    expect(codes(archetypes.platformer.lint(checkpointSpec))).toContain(
      'PLAT_CHECKPOINT_NO_HEADROOM',
    );
  });

  it('keeps low-ceiling saved games on legacy lint geometry when the marker is absent', () => {
    const spec = golden<PlatformerSpec>('platformer');
    delete spec.playerHeightTiles;
    const spawn = spec.levels[0]!.playerSpawn;
    setLevelCell(spec.levels[0]!, spawn.x, spawn.y - 1, '#');
    expect(codes(archetypes.platformer.lint(spec))).not.toContain('PLAT_SPAWN_NO_HEADROOM');
  });

  it('requires full-height clearance along moving-platform travel', () => {
    const spec = golden<PlatformerSpec>('platformer');
    const level = spec.levels.flatMap((candidate) =>
      candidate.entities.some((entity) => entity.type === 'movingPlatform') ? [candidate] : [],
    )[0]!;
    const platform = level.entities.find((entity) => entity.type === 'movingPlatform')!;
    setLevelCell(level, platform.x, platform.y - 1, '#');
    expect(codes(archetypes.platformer.lint(spec))).toContain('PLAT_MOVING_PLATFORM_NO_CLEARANCE');

    const surfaceSpec = golden<PlatformerSpec>('platformer');
    const surfaceLevel = surfaceSpec.levels[2]!;
    const horizontal = surfaceLevel.entities.find((entity) => entity.type === 'movingPlatform')!;
    const platformChar = Object.entries(surfaceLevel.legend).find(
      ([, kind]) => kind === 'platform',
    )![0];
    setLevelCell(
      surfaceLevel,
      horizontal.x + Math.floor((horizontal.props?.dx ?? 0) / 2),
      horizontal.y,
      platformChar,
    );
    expect(codes(archetypes.platformer.lint(surfaceSpec))).toContain(
      'PLAT_MOVING_PLATFORM_NO_CLEARANCE',
    );
  });

  it('collectible embedded in a solid tile → PLAT_ENTITY_IN_SOLID', () => {
    const spec = golden<PlatformerSpec>('platformer');
    const { x, y } = firstSolid(spec.levels[0]!);
    spec.levels[0]!.entities.push({ type: 'coin', x, y });
    expect(codes(archetypes.platformer.lint(spec))).toContain('PLAT_ENTITY_IN_SOLID');

    const platformSpec = golden<PlatformerSpec>('platformer');
    const platform = firstKind(platformSpec.levels[0]!, 'platform');
    platformSpec.levels[0]!.entities.push({ type: 'coin', ...platform });
    expect(codes(archetypes.platformer.lint(platformSpec))).toContain('PLAT_ENTITY_IN_SOLID');
  });

  it('a gap wider than the jump kernel makes the exit unreachable', () => {
    const spec = golden<PlatformerSpec>('platformer');
    const level = spec.levels[0]!;
    const w = level.tiles[0]!.length;
    // carve an uncrossable 8-tile-wide bottomless chasm through every row
    const gapStart = Math.floor(w / 2);
    level.tiles = level.tiles.map(
      (r) => r.slice(0, gapStart) + '.'.repeat(8) + r.slice(gapStart + 8),
    );
    // remove any helpers that might bridge it
    level.entities = level.entities.filter(
      (e) =>
        !(
          e.x >= gapStart - 5 &&
          e.x <= gapStart + 13 &&
          (e.type === 'spring' || e.type === 'movingPlatform')
        ),
    );
    const diagnostics = archetypes.platformer.lint(spec);
    const errs = codes(diagnostics);
    expect(errs).toContain('PLAT_EXIT_UNREACHABLE');
    const blockage = platformerReachabilityBlockage(level);
    expect(blockage).not.toBeNull();
    const reach = reachableCells(level);
    expect(reach.has(`${blockage!.frontier.x},${blockage!.frontier.y}`)).toBe(true);
    expect(reach.has(`${blockage!.landing.x},${blockage!.landing.y}`)).toBe(false);
    expect(
      diagnostics.find((diagnostic) => diagnostic.code === 'PLAT_EXIT_UNREACHABLE')?.message,
    ).toContain(`reachable standing cell (${blockage!.frontier.x},${blockage!.frontier.y})`);
  });

  it('reachability flood fill covers the spawn area', () => {
    const level = golden<PlatformerSpec>('platformer').levels[0]!;
    const cells = reachableCells(level);
    expect(cells.size).toBeGreaterThan(10);
  });

  it('walks through a two-tile-high corridor without treating every step as a jump', () => {
    const spec = golden<PlatformerSpec>('platformer');
    const level = spec.levels[0]!;
    const solid = Object.entries(level.legend).find(([, kind]) => kind === 'solid')![0];
    const width = level.tiles[0]!.length;
    const footY = level.tiles.length - 2;
    level.tiles = level.tiles.map((row) => '.'.repeat(row.length));
    level.tiles[footY + 1] = solid.repeat(width);
    level.tiles[footY - 2] = solid.repeat(width);
    level.playerSpawn = { x: 2, y: footY };
    level.exit = { x: width - 3, y: footY };
    const checkpoint = Object.entries(level.legend).find(([, kind]) => kind === 'checkpoint')![0];
    setLevelCell(level, Math.floor(width / 2), footY, checkpoint);

    expect(reachableCells(level).has(`${level.exit.x},${level.exit.y}`)).toBe(true);
    expect(codes(archetypes.platformer.lint(spec))).not.toContain('PLAT_EXIT_UNREACHABLE');
  });

  it('rejects pickups and grounded enemies stranded in a sealed but open pocket', () => {
    const spec = golden<PlatformerSpec>('platformer');
    const level = spec.levels[0]!;
    const width = 30;
    const rows = Array.from({ length: 10 }, () => '.'.repeat(width));
    for (let y = 0; y < rows.length - 1; y++) {
      rows[y] = `${rows[y]!.slice(0, 15)}#${rows[y]!.slice(16)}`;
    }
    rows[8] = `${rows[8]!.slice(0, 7)}C${rows[8]!.slice(8)}`;
    rows[9] = '#'.repeat(width);
    level.tiles = rows;
    level.legend = { '#': 'solid', C: 'checkpoint' };
    level.playerSpawn = { x: 2, y: 8 };
    level.exit = { x: 12, y: 8 };
    level.entities = [
      { type: 'coin', x: 20, y: 8 },
      { type: 'heart', x: 21, y: 8 },
      { type: 'powerup', x: 22, y: 8, props: { kind: 'shield' } },
      { type: 'walker', x: 23, y: 8, props: { range: 3 } },
      { type: 'flyer', x: 24, y: 5, props: { amplitude: 1 } },
      { type: 'spring', x: 26, y: 8 },
    ];

    const unreachable = archetypes.platformer
      .lint(spec)
      .filter((error) => error.code === 'PLAT_ENTITY_UNREACHABLE');
    expect(unreachable.map((error) => error.path)).toEqual([
      '/levels/0/entities/0',
      '/levels/0/entities/1',
      '/levels/0/entities/2',
      '/levels/0/entities/3',
      '/levels/0/entities/4',
      '/levels/0/entities/5',
    ]);
    expect(unreachable[0]!.message).toContain('no reachable collection position');
    expect(unreachable[3]!.message).toContain('no reachable encounter space');
    expect(unreachable[4]!.message).toContain('interaction envelope');
    expect(unreachable[5]!.message).toContain('reachable standing cell');
  });

  it('includes moving-platform travel in the reachable traversal graph', () => {
    const level = golden<PlatformerSpec>('platformer').levels[0]!;
    const width = 24;
    const rows = Array.from({ length: 10 }, () => '.'.repeat(width));
    rows[8] = `${'.'.repeat(4)}C${'.'.repeat(width - 5)}`;
    rows[9] = `${'#'.repeat(8)}${'.'.repeat(8)}${'#'.repeat(8)}`;
    level.tiles = rows;
    level.legend = { '#': 'solid', C: 'checkpoint' };
    level.playerSpawn = { x: 2, y: 8 };
    level.exit = { x: 21, y: 8 };
    level.entities = [
      { type: 'movingPlatform', x: 7, y: 8, props: { dx: 8, dy: 0, periodMs: 2400 } },
    ];

    const withoutPlatform = structuredClone(level);
    withoutPlatform.entities = [];
    expect(reachableCells(withoutPlatform).has('21,8')).toBe(false);
    expect(reachableCells(level).has('21,8')).toBe(true);
  });

  it('rejects a reachable non-lethal pit that cannot return to the exit route', () => {
    const spec = golden<PlatformerSpec>('platformer');
    const level = spec.levels[0]!;
    const width = 40;
    const sideWall = `${'#'.repeat(8)}${'.'.repeat(6)}${'#'.repeat(26)}`;
    level.tiles = [
      ...Array.from({ length: 4 }, () => '.'.repeat(width)),
      `${'.'.repeat(11)}C${'.'.repeat(28)}`,
      `${'#'.repeat(8)}${'='.repeat(6)}${'#'.repeat(26)}`,
      sideWall,
      sideWall,
      sideWall,
      '#'.repeat(width),
    ];
    level.legend = { '#': 'solid', '=': 'platform', C: 'checkpoint' };
    level.playerSpawn = { x: 2, y: 4 };
    level.exit = { x: 30, y: 4 };
    level.entities = [];

    const traversal = analyzePlatformerTraversal(level);
    expect(traversal.reachable.has('30,4')).toBe(true);
    expect([...traversal.trapCells].sort()).toEqual(['10,8', '11,8', '12,8', '13,8', '8,8', '9,8']);
    expect(codes(archetypes.platformer.lint(spec))).toContain('PLAT_SOFTLOCK_REGION');
    expect(
      archetypes.platformer
        .lint(spec)
        .find((diagnostic) => diagnostic.code === 'PLAT_SOFTLOCK_REGION')?.message,
    ).toContain('player can enter but cannot physically reach the exit');
  });

  it('missing checkpoint → PLAT_NO_CHECKPOINT; content floors enforced', () => {
    const spec = golden<PlatformerSpec>('platformer');
    const ckChar = Object.entries(spec.levels[0]!.legend).find(([, v]) => v === 'checkpoint')?.[0];
    expect(ckChar).toBeDefined();
    spec.levels[0]!.tiles = spec.levels[0]!.tiles.map((r) => r.replaceAll(ckChar!, '.'));
    expect(codes(archetypes.platformer.lint(spec))).toContain('PLAT_NO_CHECKPOINT');

    const noPickups = golden<PlatformerSpec>('platformer');
    for (const l of noPickups.levels)
      l.entities = l.entities.filter(
        (e) => e.type !== 'coin' && e.type !== 'heart' && e.type !== 'powerup',
      );
    const errs = codes(archetypes.platformer.lint(noPickups));
    expect(errs).toContain('PLAT_FLOOR_PICKUPS');
    expect(errs).toContain('PLAT_FLOOR_POWERUP');

    const fewEnemies = golden<PlatformerSpec>('platformer');
    for (const l of fewEnemies.levels)
      l.entities = l.entities.filter(
        (e) => e.type !== 'flyer' && e.type !== 'shooter' && e.type !== 'chaser',
      );
    expect(codes(archetypes.platformer.lint(fewEnemies))).toContain('PLAT_FLOOR_ENEMY_TYPES');
  });

  it('unknown music song reference → MUSIC_UNKNOWN_SONG', () => {
    const spec = golden<PlatformerSpec>('platformer');
    spec.levels[1]!.musicSong = 'ghost';
    expect(codes(archetypes.platformer.lint(spec))).toContain('MUSIC_UNKNOWN_SONG');
  });

  it('unknown sprite ref → SPRITE_UNKNOWN_REF', () => {
    const spec = golden<PlatformerSpec>('platformer');
    spec.sprites.assign['walker'] = 'custom:never_defined';
    expect(codes(archetypes.platformer.lint(spec))).toContain('SPRITE_UNKNOWN_REF');
  });

  it('a valid custom boss arena passes; a floorless one → PLAT_ARENA_NO_FLOOR', () => {
    const arena = (withFloor: boolean) => {
      const w = 30;
      const h = 16;
      const tiles: string[] = [];
      for (let y = 0; y < h; y++) {
        let row = '';
        for (let x = 0; x < w; x++) {
          const wall = x === 0 || x === w - 1;
          const floor = withFloor && y >= h - 2;
          row += wall || floor ? '#' : '.';
        }
        tiles.push(row);
      }
      return { tiles, legend: { '#': 'solid' as const } };
    };
    const ok = golden<PlatformerSpec>('platformer');
    ok.boss.arena = arena(true);
    expect(codes(archetypes.platformer.lint(ok)).filter((c) => c.startsWith('PLAT_ARENA'))).toEqual(
      [],
    );

    const cramped = golden<PlatformerSpec>('platformer');
    cramped.boss.arena = arena(true);
    const headRow = cramped.boss.arena.tiles.length - 4;
    const row = cramped.boss.arena.tiles[headRow]!;
    cramped.boss.arena.tiles[headRow] = row.slice(0, 4) + '#' + row.slice(5);
    expect(codes(archetypes.platformer.lint(cramped))).toContain('PLAT_ARENA_NO_HEADROOM');

    const bad = golden<PlatformerSpec>('platformer');
    bad.boss.arena = arena(false);
    expect(codes(archetypes.platformer.lint(bad))).toContain('PLAT_ARENA_NO_FLOOR');
  });
});

describe('shooter lints', () => {
  it('unsorted waves → SHOOT_WAVES_UNSORTED', () => {
    const spec = golden<ShooterSpec>('shooter');
    const waves = spec.levels[0]!.waves;
    [waves[0]!.t, waves[1]!.t] = [waves[1]!.t, waves[0]!.t];
    expect(codes(archetypes.shooter.lint(spec))).toContain('SHOOT_WAVES_UNSORTED');
  });

  it('wave after level end → SHOOT_WAVE_AFTER_END', () => {
    const spec = golden<ShooterSpec>('shooter');
    const level = spec.levels[0]!;
    level.waves[level.waves.length - 1]!.t = level.durationS - 1;
    expect(codes(archetypes.shooter.lint(spec))).toContain('SHOOT_WAVE_AFTER_END');
  });

  it('bullet-density cap → SHOOT_BULLET_DENSITY', () => {
    const spec = golden<ShooterSpec>('shooter');
    for (const w of spec.levels[0]!.waves) w.fireRate = 2;
    expect(codes(archetypes.shooter.lint(spec))).toContain('SHOOT_BULLET_DENSITY');
  });

  it('wave-count floor → SHOOT_FLOOR_WAVES; duration floor → DURATION_TOO_SHORT', () => {
    const spec = golden<ShooterSpec>('shooter');
    for (const l of spec.levels) {
      l.waves = l.waves.slice(0, 4);
      l.durationS = 45;
    }
    const errs = codes(archetypes.shooter.lint(spec));
    expect(errs).toContain('SHOOT_FLOOR_WAVES');
    expect(errs).toContain('DURATION_TOO_SHORT');
  });

  it('endless boss → SHOOT_BOSS_TOO_LONG', () => {
    const spec = golden<ShooterSpec>('shooter');
    spec.boss.hp = 200;
    spec.boss.pods = 4;
    spec.boss.podHp = 40;
    expect(codes(archetypes.shooter.lint(spec))).toContain('SHOOT_BOSS_TOO_LONG');
  });
});

describe('fighter roster lints', () => {
  it('the personalized golden roster passes', () => {
    const spec = golden<FighterSpec>('fighter');
    expect(archetypes.fighter.lint(spec)).toEqual([]);
  });

  it('rejects repeated ladder colors and build/outfit silhouettes', () => {
    const spec = golden<FighterSpec>('fighter');
    spec.levels[1]!.opponent.colorSlot = spec.levels[0]!.opponent.colorSlot;
    spec.levels[1]!.opponent.build = spec.levels[0]!.opponent.build;
    spec.levels[1]!.opponent.outfit = spec.levels[0]!.opponent.outfit;
    const errs = codes(archetypes.fighter.lint(spec));
    expect(errs).toContain('FIGHT_COLOR_CLASH');
    expect(errs).toContain('FIGHT_STYLE_CLASH');
  });

  it('requires at least three authored outfit silhouettes across player + ladder', () => {
    const spec = golden<FighterSpec>('fighter');
    spec.player.outfit = 'gi';
    spec.levels[0]!.opponent.outfit = 'gi';
    spec.levels[1]!.opponent.outfit = 'boxer';
    spec.levels[2]!.opponent.outfit = 'boxer';
    expect(codes(archetypes.fighter.lint(spec))).toContain('FIGHT_OUTFIT_VARIETY');
  });
});

describe('adventure lints (key/lock topology)', () => {
  it('door mismatch → ADV_DOOR_MISMATCH', () => {
    const spec = golden<AdventureSpec>('adventure');
    const dungeon = spec.levels[0]!;
    const roomWithEast = dungeon.rooms.find((r) => r.doors.e !== 'none')!;
    roomWithEast.doors.e = 'none';
    expect(codes(archetypes.adventure.lint(spec))).toContain('ADV_DOOR_MISMATCH');
  });

  it('key sealed behind its own lock → unreachable topology', () => {
    const spec = golden<AdventureSpec>('adventure');
    const dungeon = spec.levels[0]!;
    // Remove every key: locked doors become unopenable.
    for (const room of dungeon.rooms) room.entities = room.entities.filter((e) => e.type !== 'key');
    const errs = codes(archetypes.adventure.lint(spec));
    expect(errs.includes('ADV_UNREACHABLE_ROOM') || errs.includes('ADV_BOSS_UNREACHABLE')).toBe(
      true,
    );
    expect(errs).toContain('ADV_KEYS_SHORT');
  });

  it('reconcileDoors mirrors a one-sided door so ADV_DOOR_MISMATCH clears', () => {
    const spec = golden<AdventureSpec>('adventure');
    const dungeon = spec.levels[0]!;
    const room = dungeon.rooms.find((r) => r.doors.e !== 'none')!;
    const neighbor = dungeon.rooms.find(
      (r) => r.gridPos.x === room.gridPos.x + 1 && r.gridPos.y === room.gridPos.y,
    )!;
    neighbor.doors.w = 'none'; // drop one side → mismatch
    expect(codes(archetypes.adventure.lint(spec))).toContain('ADV_DOOR_MISMATCH');
    reconcileDoors(dungeon);
    expect(neighbor.doors.w).toBe(room.doors.e);
    expect(codes(archetypes.adventure.lint(spec))).not.toContain('ADV_DOOR_MISMATCH');
  });

  it('reconcileDoors resolves a kind conflict to the stronger gate', () => {
    const spec = golden<AdventureSpec>('adventure');
    const dungeon = spec.levels[0]!;
    const room = dungeon.rooms.find((r) => r.doors.e !== 'none')!;
    const neighbor = dungeon.rooms.find(
      (r) => r.gridPos.x === room.gridPos.x + 1 && r.gridPos.y === room.gridPos.y,
    )!;
    room.doors.e = 'open';
    neighbor.doors.w = 'locked';
    reconcileDoors(dungeon);
    expect(room.doors.e).toBe('locked');
    expect(neighbor.doors.w).toBe('locked');
  });

  it('reconcileDoors leaves a consistent dungeon unchanged', () => {
    const dungeon = golden<AdventureSpec>('adventure').levels[0]!;
    const before = JSON.stringify(dungeon.rooms.map((r) => r.doors));
    reconcileDoors(dungeon);
    expect(JSON.stringify(dungeon.rooms.map((r) => r.doors))).toBe(before);
  });

  it('topology checker walks keys-before-locks correctly', () => {
    const dungeon = golden<AdventureSpec>('adventure').levels[0]!;
    const { edges, errors } = buildGraph(dungeon);
    expect(errors).toEqual([]);
    expect(checkKeyTopology(dungeon, edges)).toEqual([]);
  });

  it('missing NPC / item pedestal floors', () => {
    const spec = golden<AdventureSpec>('adventure');
    for (const room of spec.levels[0]!.rooms)
      room.entities = room.entities.filter((e) => e.type !== 'npc' && e.type !== 'item');
    const errs = codes(archetypes.adventure.lint(spec));
    expect(errs).toContain('ADV_FLOOR_NPC');
    expect(errs).toContain('ADV_NO_ITEM_PEDESTAL');
  });

  it('keeps the dungeon item behavior aligned with the authored combat kit', () => {
    const spec = golden<AdventureSpec>('adventure');
    spec.levels[0]!.items.secondary = 'blast';
    expect(codes(archetypes.adventure.lint(spec))).toContain('ADV_COMBAT_KIT_MISMATCH');
  });

  it('boss room must not be crowded with regular enemies', () => {
    const spec = golden<AdventureSpec>('adventure');
    const dungeon = spec.levels[0]!;
    const bossRoom = dungeon.rooms.find((r) => r.id === dungeon.bossRoom)!;
    bossRoom.entities.push({ type: 'walker', x: 5, y: 5 });
    expect(codes(archetypes.adventure.lint(spec))).toContain('ADV_BOSS_ROOM_CROWDED');
  });

  it('requires the secondary item to be collectable before the boss gate', () => {
    const spec = golden<AdventureSpec>('adventure');
    const dungeon = spec.levels[0]!;
    let pedestal: AdventureSpec['levels'][number]['rooms'][number]['entities'][number] | undefined;
    for (const room of dungeon.rooms) {
      const index = room.entities.findIndex((entity) => entity.type === 'item');
      if (index < 0) continue;
      pedestal = room.entities.splice(index, 1)[0];
      break;
    }
    expect(pedestal).toBeDefined();
    dungeon.rooms.find((room) => room.id === dungeon.bossRoom)!.entities.push(pedestal!);
    expect(codes(archetypes.adventure.lint(spec))).toContain('ADV_ITEM_AFTER_BOSS');
  });

  it('requires every boss-room entrance to use a boss gate', () => {
    const spec = golden<AdventureSpec>('adventure');
    const dungeon = spec.levels[0]!;
    const bossRoom = dungeon.rooms.find((room) => room.id === dungeon.bossRoom)!;
    const directions = [
      ['n', 0, -1, 's'],
      ['s', 0, 1, 'n'],
      ['e', 1, 0, 'w'],
      ['w', -1, 0, 'e'],
    ] as const;
    const [direction, dx, dy, opposite] = directions.find(
      ([direction]) => bossRoom.doors[direction] !== 'none',
    )!;
    const neighbor = dungeon.rooms.find(
      (room) =>
        room.gridPos.x === bossRoom.gridPos.x + dx && room.gridPos.y === bossRoom.gridPos.y + dy,
    )!;
    bossRoom.doors[direction] = 'open';
    neighbor.doors[opposite] = 'open';
    expect(codes(archetypes.adventure.lint(spec))).toContain('ADV_BOSS_GATE_REQUIRED');
  });

  it('requires hazard-free access to keys and the secondary item', () => {
    const spec = golden<AdventureSpec>('adventure');
    const room = spec.levels[0]!.rooms.find((candidate) => candidate.id === 'mosshall')!;
    const key = room.entities.find((entity) => entity.type === 'key')!;
    key.x = 15;
    key.y = 7;

    expect(codes(archetypes.adventure.lint(spec))).toContain('ADV_REQUIRED_PICKUP_UNSAFE');
  });

  it('models the two-tile doorway landing that runtime carves into thick walls', () => {
    const room = golden<AdventureSpec>('adventure').levels[0]!.rooms.find(
      (candidate) => candidate.id === 'belfry',
    )!;
    const height = room.tiles.length;
    const middleX = Math.floor(room.tiles[0]!.length / 2);
    setAdventureCell(room, middleX - 1, height - 3, '#');
    setAdventureCell(room, middleX, height - 3, '#');

    const reachable = safelyReachableRoomCells(room);
    expect(reachable.has(`${middleX},${height - 3}`)).toBe(true);
    expect(reachable.has(`${middleX},${height - 4}`)).toBe(true);
  });

  it('rejects decorative or mechanically impossible pressure plates', () => {
    const noHazards = golden<AdventureSpec>('adventure');
    const noHazardRoom = noHazards.levels[0]!.rooms.find(
      (candidate) => candidate.id === 'mosshall',
    )!;
    noHazardRoom.tiles = noHazardRoom.tiles.map((row) => row.replaceAll('~', '.'));
    expect(codes(archetypes.adventure.lint(noHazards))).toContain('ADV_SWITCH_NO_HAZARDS');

    const tooFewBlocks = golden<AdventureSpec>('adventure');
    const shortRoom = tooFewBlocks.levels[0]!.rooms.find(
      (candidate) => candidate.id === 'mosshall',
    )!;
    let removed = false;
    shortRoom.tiles = shortRoom.tiles.map((row) =>
      row.replace(/B/g, (cell) => {
        if (removed) return cell;
        removed = true;
        return '.';
      }),
    );
    expect(codes(archetypes.adventure.lint(tooFewBlocks))).toContain('ADV_SWITCH_BLOCK_SHORT');
  });

  it('proves the pressure-plate puzzle has a legal block-push solution', () => {
    const spec = golden<AdventureSpec>('adventure');
    const room = spec.levels[0]!.rooms.find((candidate) => candidate.id === 'mosshall')!;
    for (const [x, y] of [
      [6, 4],
      [8, 4],
      [7, 3],
      [7, 5],
    ] as const) {
      setAdventureCell(room, x, y, '#');
    }

    expect(codes(archetypes.adventure.lint(spec))).toContain('ADV_SWITCH_UNSOLVABLE');
  });

  it('protects door reaction zones and interaction spaces from immediate threats', () => {
    const spec = golden<AdventureSpec>('adventure');
    const room = spec.levels[0]!.rooms.find((candidate) => candidate.id === 'gallery')!;
    const key = room.entities.find((entity) => entity.type === 'key')!;
    const walker = room.entities.find((entity) => entity.type === 'chaser')!;
    walker.x = key.x + 1;
    walker.y = key.y;
    setAdventureCell(room, 15, 2, '#');
    room.entities.find((entity) => entity.type === 'shooter')!.x = 15;
    room.entities.find((entity) => entity.type === 'shooter')!.y = 2;

    const errs = codes(archetypes.adventure.lint(spec));
    expect(errs).toContain('ADV_DOOR_REACTION_BLOCKED');
    expect(errs).toContain('ADV_DOOR_SPAWN_CAMP');
    expect(errs).toContain('ADV_INTERACTION_THREAT');
  });

  it('requires shooters to have a real firing lane and lateral dodge space', () => {
    const spec = golden<AdventureSpec>('adventure');
    const room = spec.levels[0]!.rooms.find((candidate) => candidate.id === 'cistern')!;
    const shooter = room.entities.find((entity) => entity.type === 'shooter')!;
    room.tiles = room.tiles.map((row, y) =>
      y === 0 || y === room.tiles.length - 1
        ? '#'.repeat(row.length)
        : `#${'#'.repeat(row.length - 2)}#`,
    );
    setAdventureCell(room, shooter.x, shooter.y, '.');

    expect(codes(archetypes.adventure.lint(spec))).toContain('ADV_SHOOTER_NO_LANE');
  });

  it('rejects encounters clustered into a small part of the expanded room', () => {
    const spec = golden<AdventureSpec>('adventure');
    const room = spec.levels[0]!.rooms.find((candidate) => candidate.id === 'ossuary')!;
    room.entities.forEach((entity, index) => {
      entity.x = 14 + (index % 2);
      entity.y = 7 + Math.floor(index / 2);
    });

    expect(codes(archetypes.adventure.lint(spec))).toContain('ADV_ENCOUNTER_CLUSTERED');
  });

  it('reserves pattern-specific boss lanes, pads, and a connected dodge loop', () => {
    const spec = golden<AdventureSpec>('adventure');
    const dungeon = spec.levels[0]!;
    const room = dungeon.rooms.find((candidate) => candidate.id === dungeon.bossRoom)!;
    spec.boss.phases = [
      { pattern: 'charge', tempo: 1 },
      { pattern: 'teleport', tempo: 1 },
      { pattern: 'summon', tempo: 1 },
    ];
    room.tiles = room.tiles.map((row, y) =>
      y === 0 || y === room.tiles.length - 1
        ? '#'.repeat(row.length)
        : `#${'#'.repeat(row.length - 2)}#`,
    );

    const errs = codes(archetypes.adventure.lint(spec));
    expect(errs).toContain('ADV_BOSS_DODGE_ROUTE');
    expect(errs).toContain('ADV_BOSS_CHARGE_LANE');
    expect(errs).toContain('ADV_BOSS_TELEPORT_SPACE');
    expect(errs).toContain('ADV_BOSS_SUMMON_SPACE');
  });
});

describe('duration estimators', () => {
  it('scale with content', () => {
    const spec = golden<PlatformerSpec>('platformer');
    const base = archetypes.platformer.estimateDurationS(spec);
    const emptier = golden<PlatformerSpec>('platformer');
    for (const l of emptier.levels) l.entities = [];
    expect(archetypes.platformer.estimateDurationS(emptier)).toBeLessThan(base);

    const shooter = golden<ShooterSpec>('shooter');
    const shooterBase = archetypes.shooter.estimateDurationS(shooter);
    shooter.levels[0]!.durationS = 150;
    expect(archetypes.shooter.estimateDurationS(shooter)).toBeGreaterThan(shooterBase);
  });
});
