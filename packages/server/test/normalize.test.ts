import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lintAdventure, lintHShooter, lintPlatformer, lintShooter } from '@sparkade/archetypes';
import type {
  AdventureSpec,
  ArchetypeId,
  GameSpec,
  HShooterSpec,
  PlatformerSpec,
  ShooterSpec,
} from '@sparkade/shared';
import { normalizeGeneratedSpec } from '../src/pipeline/validate';

function golden<T extends GameSpec>(archetype: ArchetypeId): T {
  return JSON.parse(
    readFileSync(
      join(process.cwd(), 'packages', 'generation', 'golden', `golden-${archetype}.json`),
      'utf8',
    ),
  ) as T;
}

describe('deterministic generated-spec normalization', () => {
  it('pads and trims sprite rows/frames, expanding only to preserve real pixels', () => {
    const input = golden<PlatformerSpec>('platformer');
    input.sprites.custom['flex'] = {
      w: 8,
      h: 4,
      rows: ['..11....', '..1111....', '..1111..a.', '..11..'],
      frames: [['..AA....', '..1111...', '..1111..b.', '..11....', '....1....']],
    };
    input.sprites.assign['walker'] = 'custom:flex';

    const result = normalizeGeneratedSpec(input);
    const sprite = result.spec.sprites.custom['flex']!;
    expect(sprite.w).toBe(9);
    expect(sprite.h).toBe(5);
    expect(sprite.rows).toHaveLength(5);
    expect(sprite.rows.every((row) => row.length === 9)).toBe(true);
    expect(sprite.rows[1]).toBe('..1111...'); // transparent overhang trimmed
    expect(sprite.frames?.[0]).toHaveLength(5);
    expect(sprite.frames?.[0]?.every((row) => row.length === 9)).toBe(true);
    expect(sprite.frames?.[0]?.[0]).toContain('aa'); // safe hex case normalization
    expect(result.fixes).toContainEqual(
      expect.objectContaining({ code: 'SPRITE_DIMENSIONS', path: '/sprites/custom/flex' }),
    );
    expect(input.sprites.custom['flex']!.w).toBe(8); // input is never mutated
  });

  it('does not clip irrecoverable sprite content or resize fixed-grid tiles', () => {
    const input = golden<PlatformerSpec>('platformer');
    const oversized = {
      w: 48,
      h: 4,
      rows: ['.'.repeat(48) + '1', ...new Array(3).fill('.'.repeat(48))],
    };
    input.sprites.custom['oversized'] = structuredClone(oversized);
    input.sprites.custom['tile_overhang'] = {
      w: 16,
      h: 16,
      rows: ['1'.repeat(17), ...new Array(15).fill('1'.repeat(16))],
    };
    input.sprites.assign['tile_solid'] = 'custom:tile_overhang';

    const result = normalizeGeneratedSpec(input);
    expect(result.spec.sprites.custom['oversized']).toEqual(oversized);
    expect(result.spec.sprites.custom['tile_overhang']!.rows[0]).toHaveLength(17);
    expect(
      result.fixes.filter(
        (fix) =>
          fix.code === 'SPRITE_DIMENSIONS' &&
          (fix.path.endsWith('/oversized') || fix.path.endsWith('/tile_overhang')),
      ),
    ).toEqual([]);
  });

  it('normalizes known role/ref aliases and removes roles the archetype cannot consume', () => {
    const input = golden<PlatformerSpec>('platformer');
    input.sprites.assign['tile_solid'] = 'lib:circuit_solid';
    input.sprites.assign['tile_wall'] = 'lib:circuit_wall';
    input.sprites.assign['enemyShot'] = 'lib:proj_pellet';

    const result = normalizeGeneratedSpec(input);
    expect(result.spec.sprites.assign['obj_spring']).toBe('lib:obj_spring');
    expect(result.spec.sprites.assign['spring']).toBeUndefined();
    expect(result.spec.sprites.assign['tile_solid']).toBe('lib:clockwork_solid');
    expect(result.spec.sprites.assign['tile_wall']).toBeUndefined();
    expect(result.spec.sprites.assign['enemy_projectile']).toBe('lib:proj_pellet');

    const shooter = golden<ShooterSpec>('shooter');
    shooter.sprites.assign['enemyShot'] = 'lib:proj_pellet';
    (shooter as unknown as { backdrop: string }).backdrop = 'starfield';
    const shooterResult = normalizeGeneratedSpec(shooter);
    const normalizedShooter = shooterResult.spec;
    expect(normalizedShooter.sprites.assign['enemyShot']).toBeUndefined();
    expect(normalizedShooter.sprites.assign['enemy_shot']).toBe('lib:proj_pellet');
    expect(normalizedShooter.sprites.assign['pickup_spread']).toBe(
      shooter.sprites.assign['spread'],
    );
    expect(normalizedShooter.backdrop).toBe('deepspace');
    expect(shooterResult.fixes).toContainEqual(
      expect.objectContaining({ code: 'BACKDROP_ALIAS', path: '/backdrop' }),
    );
  });

  it('repairs whitespace and ragged platformer/hshooter grids without dropping terrain', () => {
    const platformer = golden<PlatformerSpec>('platformer');
    const level = platformer.levels[0]!;
    const originalWidth = level.tiles[0]!.length;
    level.tiles[0] += '##';
    level.tiles[1] = level.tiles[1]!.slice(0, -3);
    level.tiles[2] = `${level.tiles[2]!.slice(0, 12)} ${level.tiles[2]!.slice(13)}`;

    const platformerResult = normalizeGeneratedSpec(platformer);
    const fixedLevel = (platformerResult.spec as PlatformerSpec).levels[0]!;
    expect(fixedLevel.tiles.every((row) => row.length === originalWidth + 2)).toBe(true);
    expect(fixedLevel.tiles[0]!.endsWith('##')).toBe(true);
    expect(fixedLevel.tiles[2]![12]).toBe('.');
    expect(platformerResult.fixes.map((fix) => fix.code)).toEqual(
      expect.arrayContaining(['TILE_ROWS', 'TILE_WHITESPACE']),
    );

    const hshooter = golden<HShooterSpec>('hshooter');
    const stage = hshooter.levels[0]!;
    stage.tiles[0] += '#';
    stage.tiles[1] = stage.tiles[1]!.slice(0, -5);
    const hResult = normalizeGeneratedSpec(hshooter);
    const fixedStage = (hResult.spec as HShooterSpec).levels[0]!;
    expect(fixedStage.tiles.every((row) => row.length === stage.tiles[0]!.length)).toBe(true);
    expect(fixedStage.tiles[0]!.endsWith('#')).toBe(true);
    expect(
      lintHShooter(hResult.spec as HShooterSpec).some((error) => error.code === 'HSHOOT_ROW_LEN'),
    ).toBe(false);
  });

  it('grounds platformer markers and moves embedded/out-of-bounds entities mechanically', () => {
    const input = golden<PlatformerSpec>('platformer');
    const level = input.levels[0]!;
    level.playerSpawn = { x: 0, y: 13 }; // solid floor cell
    level.exit = { x: 999, y: 999 };
    level.entities[0]!.x = 0;
    level.entities[0]!.y = 13; // solid floor cell
    level.entities[1]!.x = -4;
    level.entities[1]!.y = -2;

    const result = normalizeGeneratedSpec(input);
    const fixed = result.spec as PlatformerSpec;
    expect(fixed.levels[0]!.playerSpawn).toEqual({ x: 0, y: 12 });
    expect(fixed.levels[0]!.entities[0]).toMatchObject({ x: 0, y: 12 });
    expect(fixed.levels[0]!.entities[1]).toMatchObject({ x: 0, y: 0 });
    const geometryErrors = lintPlatformer(fixed).filter((error) =>
      [
        'PLAT_SPAWN_IN_SOLID',
        'PLAT_SPAWN_NOT_GROUNDED',
        'PLAT_SPAWN_NO_HEADROOM',
        'PLAT_EXIT_IN_SOLID',
        'PLAT_EXIT_NOT_GROUNDED',
        'PLAT_EXIT_NO_HEADROOM',
        'PLAT_ENTITY_IN_SOLID',
        'PLAT_ENTITY_OOB',
      ].includes(error.code),
    );
    expect(geometryErrors).toEqual([]);
  });

  it('lifts entities above one-way tiles and keeps moving-platform paths out of terrain', () => {
    const input = golden<PlatformerSpec>('platformer');
    const level = input.levels[0]!;
    const width = 24;
    const rows = Array.from({ length: 8 }, () => '.'.repeat(width));
    const withTile = (row: string, x: number, ch: string) =>
      row.slice(0, x) + ch + row.slice(x + 1);
    for (const x of [4, 8, 12, 16]) rows[5] = withTile(rows[5]!, x, '=');
    // This authored platform intersects the moving platform midway through
    // its horizontal trip, even though the origin itself is clear.
    rows[3] = withTile(rows[3]!, 5, '=');
    rows[7] = '#'.repeat(width);
    level.tiles = rows;
    level.legend = { '#': 'solid', '=': 'platform', C: 'checkpoint' };
    level.playerSpawn = { x: 1, y: 6 };
    level.exit = { x: 22, y: 6 };
    level.entities = [
      { type: 'walker', x: 4, y: 5 },
      { type: 'coin', x: 8, y: 5 },
      { type: 'flyer', x: 12, y: 5 },
      { type: 'spring', x: 16, y: 5 },
      { type: 'movingPlatform', x: 2, y: 3, props: { dx: 4, dy: 0, periodMs: 1800 } },
    ];
    input.levels = [level];

    const result = normalizeGeneratedSpec(input);
    const entities = (result.spec as PlatformerSpec).levels[0]!.entities;
    expect(entities.slice(0, 4)).toMatchObject([
      { type: 'walker', x: 4, y: 4 },
      { type: 'coin', x: 8, y: 4 },
      { type: 'flyer', x: 12, y: 4 },
      { type: 'spring', x: 16, y: 4 },
    ]);
    expect(entities[4]).toMatchObject({
      type: 'movingPlatform',
      x: 2,
      y: 2,
      props: { dx: 4, dy: 0 },
    });
    expect(
      lintPlatformer(result.spec as PlatformerSpec).filter((error) =>
        ['PLAT_ENTITY_IN_SOLID', 'PLAT_MOVING_PLATFORM_NO_CLEARANCE'].includes(error.code),
      ),
    ).toEqual([]);
    expect(result.fixes.filter((fix) => fix.code === 'PLATFORMER_COORD')).toHaveLength(4);
    expect(result.fixes).toContainEqual(
      expect.objectContaining({
        code: 'PLATFORMER_MOVING_PLATFORM_COORD',
        path: '/levels/0/entities/4',
      }),
    );

    const again = normalizeGeneratedSpec(result.spec);
    expect(again.spec).toEqual(result.spec);
    expect(
      again.fixes.filter(
        (fix) =>
          fix.code === 'PLATFORMER_COORD' ||
          fix.code.startsWith('PLATFORMER_MOVING_PLATFORM'),
      ),
    ).toEqual([]);
  });

  it('relocates floating and cramped checkpoints without changing marker count or characters', () => {
    const input = golden<PlatformerSpec>('platformer');
    const level = input.levels[0]!;
    const empty = '.'.repeat(32);
    level.tiles = [
      empty,
      empty,
      empty,
      `${'.'.repeat(5)}C${'.'.repeat(26)}`,
      empty,
      `${'.'.repeat(20)}#${'.'.repeat(11)}`,
      `${'.'.repeat(20)}K${'.'.repeat(11)}`,
      '#'.repeat(32),
    ];
    level.legend = { '#': 'solid', C: 'checkpoint', K: 'checkpoint' };
    level.playerSpawn = { x: 2, y: 6 };
    level.exit = { x: 29, y: 6 };
    level.entities = [];
    input.levels = [level];

    const result = normalizeGeneratedSpec(input);
    const fixed = (result.spec as PlatformerSpec).levels[0]!;
    const checkpointChars = fixed.tiles
      .join('')
      .split('')
      .filter((ch) => fixed.legend[ch] === 'checkpoint');
    expect(checkpointChars.sort()).toEqual(['C', 'K']);
    expect(fixed.tiles[3]![5]).toBe('.');
    expect(fixed.tiles[6]![5]).toBe('C');
    expect(fixed.tiles[6]![20]).toBe('.');
    expect(fixed.tiles[6]![19]).toBe('K');
    expect(
      lintPlatformer(result.spec as PlatformerSpec).filter((error) =>
        ['PLAT_CHECKPOINT_FLOATING', 'PLAT_CHECKPOINT_NO_HEADROOM'].includes(error.code),
      ),
    ).toEqual([]);
    expect(result.fixes.filter((fix) => fix.code === 'PLATFORMER_CHECKPOINT_COORD')).toEqual([
      {
        code: 'PLATFORMER_CHECKPOINT_COORD',
        path: '/levels/0/tiles/3',
        message: 'moved checkpoint "C" from (5,3) to supported cell (5,6) with required headroom',
      },
      {
        code: 'PLATFORMER_CHECKPOINT_COORD',
        path: '/levels/0/tiles/6',
        message: 'moved checkpoint "K" from (20,6) to supported cell (19,6) with required headroom',
      },
    ]);

    const again = normalizeGeneratedSpec(result.spec);
    expect(again.spec).toEqual(result.spec);
    expect(again.fixes.filter((fix) => fix.code === 'PLATFORMER_CHECKPOINT_COORD')).toEqual([]);
  });

  it('moves moving platforms to the nearest fully clear path and falls back to stationary', () => {
    const input = golden<PlatformerSpec>('platformer');
    const level = input.levels[0]!;
    const empty = '.'.repeat(32);
    level.tiles = [
      empty,
      empty,
      empty,
      empty,
      empty,
      empty,
      `${'.'.repeat(10)}#${'.'.repeat(21)}`,
      empty,
      empty,
      '#'.repeat(32),
    ];
    level.legend = { '#': 'solid', C: 'checkpoint' };
    level.playerSpawn = { x: 2, y: 8 };
    level.exit = { x: 29, y: 8 };
    level.entities = [
      { type: 'movingPlatform', x: 10, y: 7, props: { dx: 4, dy: 0, periodMs: 1800 } },
    ];
    input.levels = [level];

    const result = normalizeGeneratedSpec(input);
    const fixed = (result.spec as PlatformerSpec).levels[0]!;
    expect(fixed.entities[0]).toMatchObject({
      type: 'movingPlatform',
      x: 11,
      y: 7,
      props: { dx: 4, dy: 0 },
    });
    expect(result.fixes).toContainEqual({
      code: 'PLATFORMER_MOVING_PLATFORM_COORD',
      path: '/levels/0/entities/0',
      message:
        'moved movingPlatform from (10,7) to (11,7) while retaining travel vector (4,0) and two clear player rows',
    });
    expect(
      lintPlatformer(result.spec as PlatformerSpec).filter(
        (error) => error.code === 'PLAT_MOVING_PLATFORM_NO_CLEARANCE',
      ),
    ).toEqual([]);
    const again = normalizeGeneratedSpec(result.spec);
    expect(again.spec).toEqual(result.spec);
    expect(again.fixes.filter((fix) => fix.code.startsWith('PLATFORMER_MOVING_PLATFORM'))).toEqual(
      [],
    );

    const fallbackInput = golden<PlatformerSpec>('platformer');
    const fallbackLevel = fallbackInput.levels[0]!;
    fallbackLevel.tiles = [
      '.'.repeat(8),
      '.'.repeat(8),
      '.'.repeat(8),
      '.'.repeat(8),
      '.'.repeat(8),
      '.'.repeat(8),
      '.'.repeat(8),
      '#'.repeat(8),
    ];
    fallbackLevel.legend = { '#': 'solid', C: 'checkpoint' };
    fallbackLevel.playerSpawn = { x: 1, y: 6 };
    fallbackLevel.exit = { x: 6, y: 6 };
    fallbackLevel.entities = [
      { type: 'movingPlatform', x: 3, y: 5, props: { dx: 8, dy: 0, periodMs: 1800 } },
    ];
    fallbackInput.levels = [fallbackLevel];

    const fallback = normalizeGeneratedSpec(fallbackInput);
    const fallbackPlatform = (fallback.spec as PlatformerSpec).levels[0]!.entities[0]!;
    expect(fallbackPlatform).toMatchObject({ x: 3, y: 5, props: { dx: 0, dy: 0 } });
    expect(fallback.fixes).toContainEqual({
      code: 'PLATFORMER_MOVING_PLATFORM_STATIONARY',
      path: '/levels/0/entities/0',
      message:
        'made movingPlatform stationary at (3,5) because travel vector (8,0) had no in-bounds path with two clear player rows (previous origin (3,5))',
    });
    const fallbackAgain = normalizeGeneratedSpec(fallback.spec);
    expect(fallbackAgain.spec).toEqual(fallback.spec);
    expect(
      fallbackAgain.fixes.filter((fix) => fix.code.startsWith('PLATFORMER_MOVING_PLATFORM')),
    ).toEqual([]);
  });

  it('clears only blocking boss-arena headroom cells and preserves side walls', () => {
    const input = golden<PlatformerSpec>('platformer');
    const w = 32;
    const h = 10;
    const openRow = `#${'.'.repeat(w - 2)}#`;
    const tiles = Array.from({ length: h }, () => openRow);
    tiles[h - 4] = `#${'.'.repeat(3)}#${'.'.repeat(w - 6)}#`;
    tiles[h - 3] = `#${'.'.repeat(6)}^${'.'.repeat(w - 9)}#`;
    tiles[h - 2] = '#'.repeat(w);
    tiles[h - 1] = '#'.repeat(w);
    input.boss.arena = {
      tiles,
      legend: { '#': 'solid', '^': 'hazard' },
    };

    const result = normalizeGeneratedSpec(input);
    const arena = (result.spec as PlatformerSpec).boss.arena!;
    expect(arena.tiles[h - 4]).toBe(openRow);
    expect(arena.tiles[h - 3]).toBe(openRow);
    expect(arena.tiles[h - 4]![0]).toBe('#');
    expect(arena.tiles[h - 4]![w - 1]).toBe('#');
    expect(result.fixes).toContainEqual({
      code: 'PLATFORMER_ARENA_HEADROOM',
      path: '/boss/arena/tiles',
      message:
        'cleared 2 blocking interior cell(s) from boss-arena headroom rows 6-7 while preserving both side walls',
    });
    expect(
      lintPlatformer(result.spec as PlatformerSpec).filter(
        (error) => error.code === 'PLAT_ARENA_NO_HEADROOM',
      ),
    ).toEqual([]);

    const again = normalizeGeneratedSpec(result.spec);
    expect(again.spec).toEqual(result.spec);
    expect(again.fixes.filter((fix) => fix.code === 'PLATFORMER_ARENA_HEADROOM')).toEqual([]);
  });

  it('moves adventure entities to walkable cells and applies prescribed boss/item cleanup', () => {
    const input = golden<AdventureSpec>('adventure');
    const dungeon = input.levels[0]!;
    const room = dungeon.rooms[0]!;
    room.entities[0]!.x = 0;
    room.entities[0]!.y = 0;
    room.entities.push({ type: 'item', x: 0, y: 0, props: { item: 'bombs' } });
    const bossRoom = dungeon.rooms.find((candidate) => candidate.id === dungeon.bossRoom)!;
    bossRoom.entities.push({ type: 'walker', x: 1, y: 1 });

    const result = normalizeGeneratedSpec(input);
    const fixed = result.spec as AdventureSpec;
    const fixedRoom = fixed.levels[0]!.rooms[0]!;
    expect(fixedRoom.entities[0]).toMatchObject({ x: 1, y: 1 });
    expect(fixedRoom.entities.find((entity) => entity.type === 'item')?.props?.item).toBe(
      fixed.levels[0]!.items.secondary,
    );
    expect(
      fixed.levels[0]!.rooms.find(
        (candidate) => candidate.id === fixed.levels[0]!.bossRoom,
      )!.entities.some((entity) => entity.type === 'walker'),
    ).toBe(false);
    const contentErrors = lintAdventure(fixed).filter((error) =>
      ['ADV_ENTITY_IN_WALL', 'ADV_ITEM_MISMATCH', 'ADV_BOSS_ROOM_CROWDED'].includes(error.code),
    );
    expect(contentErrors).toEqual([]);
  });

  it('sorts/clamps shooter events and enforces active-entity/bullet budgets', () => {
    const input = golden<ShooterSpec>('shooter');
    const level = input.levels[0]!;
    level.waves = [
      { ...level.waves[0]!, t: 100, count: 8, fireRate: 2 },
      { ...level.waves[1]!, t: 1, count: 8, fireRate: 2 },
      { ...level.waves[2]!, t: 1, count: 8, fireRate: 2 },
      { ...level.waves[3]!, t: 1, count: 8, fireRate: 2 },
      ...level.waves.slice(4),
    ];
    level.pickups = [
      { ...level.pickups[0]!, t: 100 },
      { ...level.pickups[1]!, t: -4 },
    ];

    const result = normalizeGeneratedSpec(input);
    const fixed = result.spec as ShooterSpec;
    const relevantErrors = lintShooter(fixed).filter((error) =>
      [
        'SHOOT_WAVES_UNSORTED',
        'SHOOT_WAVE_AFTER_END',
        'SHOOT_PICKUP_AFTER_END',
        'SHOOT_ONSCREEN_BUDGET',
        'SHOOT_BULLET_DENSITY',
      ].includes(error.code),
    );
    expect(relevantErrors).toEqual([]);
    expect(fixed.levels[0]!.pickups.map((pickup) => pickup.t)).toEqual([0, 78]);
    expect(result.fixes).toContainEqual(
      expect.objectContaining({ code: 'SHOOTER_TIMING', path: '/levels/0' }),
    );
  });

  it('retimes even a maximum-size late wave pile without deleting waves', () => {
    const input = golden<ShooterSpec>('shooter');
    const level = input.levels[0]!;
    const templates = level.waves;
    level.waves = Array.from({ length: 30 }, (_, i) => ({
      ...templates[i % templates.length]!,
      t: level.durationS,
      count: 8,
      fireRate: 2,
    }));

    const result = normalizeGeneratedSpec(input);
    const fixed = result.spec as ShooterSpec;
    expect(fixed.levels[0]!.waves).toHaveLength(30);
    expect(
      lintShooter(fixed).filter((error) =>
        ['SHOOT_ONSCREEN_BUDGET', 'SHOOT_BULLET_DENSITY', 'SHOOT_WAVE_AFTER_END'].includes(
          error.code,
        ),
      ),
    ).toEqual([]);
  });

  it('is idempotent after the first normalization pass', () => {
    for (const archetype of [
      'platformer',
      'shooter',
      'adventure',
      'hshooter',
      'fighter',
    ] as const) {
      const first = normalizeGeneratedSpec(golden(archetype));
      const second = normalizeGeneratedSpec(first.spec);
      expect(second.spec, archetype).toEqual(first.spec);
      expect(second.fixes, archetype).toEqual([]);
    }
  });
});
