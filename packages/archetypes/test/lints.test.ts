// Archetype lints: every golden game passes; a corpus of deliberately broken
// specs each fails with the right diagnostic code; content floors; duration
// estimator; platformer reachability; adventure key/lock topology.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AdventureSpec, GameSpec, PlatformerSpec, ShooterSpec } from '@sparkade/shared';
import { MIN_DURATION_S } from '@sparkade/shared';
import { archetypes } from '@sparkade/archetypes';
import { checkKeyTopology, buildGraph } from '../src/adventure/lint';
import { parseLevelGrid, reachableCells } from '../src/platformer/lint';

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

function golden<T extends GameSpec>(archetype: string): T {
  const path = join(__dirname, '..', '..', 'generation', 'golden', `golden-${archetype}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const codes = (errors: { code: string }[]) => errors.map((e) => e.code);

describe('golden games are golden', () => {
  for (const a of ['platformer', 'shooter', 'adventure'] as const) {
    it(`golden-${a} passes lint with zero errors and meets the five-minute rule`, () => {
      const spec = golden(a);
      expect(archetypes[a].lint(spec)).toEqual([]);
      expect(archetypes[a].estimateDurationS(spec)).toBeGreaterThanOrEqual(MIN_DURATION_S);
    });
  }
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
    spec.levels[0]!.tiles = spec.levels[0]!.tiles.map((r, y) =>
      y < 6 ? '.'.repeat(r.length) : r,
    );
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

  it('collectible embedded in a solid tile → PLAT_ENTITY_IN_SOLID', () => {
    const spec = golden<PlatformerSpec>('platformer');
    const { x, y } = firstSolid(spec.levels[0]!);
    spec.levels[0]!.entities.push({ type: 'coin', x, y });
    expect(codes(archetypes.platformer.lint(spec))).toContain('PLAT_ENTITY_IN_SOLID');
  });

  it('a gap wider than the jump kernel makes the exit unreachable', () => {
    const spec = golden<PlatformerSpec>('platformer');
    const level = spec.levels[0]!;
    const w = level.tiles[0]!.length;
    // carve an uncrossable 8-tile-wide bottomless chasm through every row
    const gapStart = Math.floor(w / 2);
    level.tiles = level.tiles.map((r) => r.slice(0, gapStart) + '.'.repeat(8) + r.slice(gapStart + 8));
    // remove any helpers that might bridge it
    level.entities = level.entities.filter(
      (e) => !(e.x >= gapStart - 5 && e.x <= gapStart + 13 && (e.type === 'spring' || e.type === 'movingPlatform')),
    );
    const errs = codes(archetypes.platformer.lint(spec));
    expect(errs).toContain('PLAT_EXIT_UNREACHABLE');
  });

  it('reachability flood fill covers the spawn area', () => {
    const level = golden<PlatformerSpec>('platformer').levels[0]!;
    const cells = reachableCells(level);
    expect(cells.size).toBeGreaterThan(10);
  });

  it('missing checkpoint → PLAT_NO_CHECKPOINT; content floors enforced', () => {
    const spec = golden<PlatformerSpec>('platformer');
    const ckChar = Object.entries(spec.levels[0]!.legend).find(([, v]) => v === 'checkpoint')?.[0];
    expect(ckChar).toBeDefined();
    spec.levels[0]!.tiles = spec.levels[0]!.tiles.map((r) => r.replaceAll(ckChar!, '.'));
    expect(codes(archetypes.platformer.lint(spec))).toContain('PLAT_NO_CHECKPOINT');

    const noPickups = golden<PlatformerSpec>('platformer');
    for (const l of noPickups.levels)
      l.entities = l.entities.filter((e) => e.type !== 'coin' && e.type !== 'heart' && e.type !== 'powerup');
    const errs = codes(archetypes.platformer.lint(noPickups));
    expect(errs).toContain('PLAT_FLOOR_PICKUPS');
    expect(errs).toContain('PLAT_FLOOR_POWERUP');

    const fewEnemies = golden<PlatformerSpec>('platformer');
    for (const l of fewEnemies.levels)
      l.entities = l.entities.filter((e) => e.type !== 'flyer' && e.type !== 'shooter' && e.type !== 'chaser');
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
    expect(
      errs.includes('ADV_UNREACHABLE_ROOM') || errs.includes('ADV_BOSS_UNREACHABLE'),
    ).toBe(true);
    expect(errs).toContain('ADV_KEYS_SHORT');
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

  it('boss room must not be crowded with regular enemies', () => {
    const spec = golden<AdventureSpec>('adventure');
    const dungeon = spec.levels[0]!;
    const bossRoom = dungeon.rooms.find((r) => r.id === dungeon.bossRoom)!;
    bossRoom.entities.push({ type: 'walker', x: 5, y: 5 });
    expect(codes(archetypes.adventure.lint(spec))).toContain('ADV_BOSS_ROOM_CROWDED');
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
