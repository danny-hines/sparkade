import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FighterSpec, GameSpec } from '@sparkade/shared';
import {
  patchFighterAppearance,
  registerDevFighterRoutes,
} from '../src/api/dev-fighter';
import type { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';
import { ensureDir, repoRoot } from '../src/util';

function fighterSpec(): FighterSpec {
  return JSON.parse(
    readFileSync(
      join(repoRoot(), 'packages', 'generation', 'golden', 'golden-fighter.json'),
      'utf8',
    ),
  ) as FighterSpec;
}

describe('pure fighter appearance patch', () => {
  it('patches one opponent immutably and preserves every gameplay field', () => {
    const original = fighterSpec();
    const before = JSON.stringify(original);
    const prior = original.levels[1]!.opponent;
    const result = patchFighterAppearance(original, {
      target: { kind: 'opponent', index: 1 },
      appearance: {
        name: 'NEW BRASS',
        build: 'nimble',
        outfit: 'boxer',
        colorSlot: 10,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(original)).toBe(before);
    expect(result.spec).not.toBe(original);
    expect(result.spec.levels[0]).toBe(original.levels[0]);
    expect(result.spec.levels[1]!.opponent).toMatchObject({
      name: 'NEW BRASS',
      build: 'nimble',
      outfit: 'boxer',
      colorSlot: 10,
      hp: prior.hp,
      powerScale: prior.powerScale,
    });
  });

  it('creates an omitted player with the engine-default HP', () => {
    const original = fighterSpec();
    delete original.player;
    const result = patchFighterAppearance(original, {
      target: { kind: 'player' },
      appearance: { name: 'HERO', build: 'heavy', outfit: 'armor', colorSlot: 5 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.player).toMatchObject({ hp: 100, outfit: 'armor' });
  });

  it('strictly rejects extra fields, bad targets, and target-specific color slots', () => {
    const spec = fighterSpec();
    const cases: unknown[] = [
      {
        target: { kind: 'player' },
        appearance: {
          name: 'HERO', build: 'balanced', outfit: 'gi', colorSlot: 5, hp: 999,
        },
      },
      {
        target: { kind: 'opponent', index: 99 },
        appearance: { name: 'RIVAL', build: 'balanced', outfit: 'gi', colorSlot: 8 },
      },
      {
        target: { kind: 'player' },
        appearance: { name: 'HERO', build: 'balanced', outfit: 'gi', colorSlot: 11 },
      },
      {
        target: { kind: 'boss', index: 0 },
        appearance: { name: 'BOSS', build: 'heavy', outfit: 'armor', colorSlot: 11 },
      },
    ];

    for (const body of cases) expect(patchFighterAppearance(spec, body).ok).toBe(false);
  });
});

describe('dev fighter edit API', () => {
  let dir: string;
  let goldenDir: string;
  let files: GameFiles;
  let app: ReturnType<typeof Fastify>;
  let rows: Map<string, { golden: boolean }>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sparkade-fighter-editor-'));
    goldenDir = ensureDir(join(dir, 'golden-source'));
    files = new GameFiles(dir);
    rows = new Map();
    app = Fastify();
    const db = {
      getGame(id: string) {
        const row = rows.get(id);
        return row ? { ...row } : null;
      },
    } as unknown as Pick<Db, 'getGame'>;
    registerDevFighterRoutes(app, files, db, { goldenDir });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function addGame(id: string, spec: GameSpec, golden = false): void {
    rows.set(id, { golden });
    files.writeSpec(id, spec);
  }

  it('atomically saves a valid appearance and returns non-blocking lint warnings', async () => {
    const id = 'user-fighter';
    const original = fighterSpec();
    addGame(id, original);
    const response = await app.inject({
      method: 'PUT',
      url: `/api/dev/fighter/games/${id}/character`,
      payload: {
        target: { kind: 'player' },
        appearance: {
          name: 'COLOR TWIN',
          build: 'nimble',
          outfit: 'boxer',
          colorSlot: 8,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      ok: true,
      file: `games/${id}/game.json`,
      spec: { player: { name: 'COLOR TWIN', outfit: 'boxer', hp: 100 } },
    });
    expect(body.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'FIGHT_COLOR_CLASH' })]),
    );
    expect(files.readSpec(id)).toMatchObject({
      player: { name: 'COLOR TWIN', colorSlot: 8, hp: 100 },
    });
    expect(
      readdirSync(files.gameDir(id)).filter((name) => name.includes('.tmp-')),
    ).toEqual([]);
  });

  it('rejects a full-spec schema failure before replacing game.json', async () => {
    const id = 'invalid-fighter';
    const invalid = fighterSpec();
    invalid.palette = invalid.palette.slice(0, 15);
    addGame(id, invalid);
    const path = join(files.gameDir(id), 'game.json');
    const before = readFileSync(path, 'utf8');
    const response = await app.inject({
      method: 'PUT',
      url: `/api/dev/fighter/games/${id}/character`,
      payload: {
        target: { kind: 'boss' },
        appearance: {
          name: 'VALID BOSS',
          build: 'heavy',
          outfit: 'armor',
          colorSlot: 11,
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: 'edited fighter spec failed validation',
      details: expect.any(Array),
    });
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('persists golden edits to both the live game and its source JSON', async () => {
    const id = 'golden-fighter';
    addGame(id, fighterSpec(), true);
    const response = await app.inject({
      method: 'PUT',
      url: `/api/dev/fighter/games/${id}/character`,
      payload: {
        target: { kind: 'opponent', index: 0 },
        appearance: {
          name: 'SOURCE RIVAL',
          build: 'heavy',
          outfit: 'robe',
          colorSlot: 10,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      file: 'packages/generation/golden/golden-fighter.json',
    });
    const live = files.readSpec(id) as FighterSpec;
    const source = JSON.parse(
      readFileSync(join(goldenDir, 'golden-fighter.json'), 'utf8'),
    ) as FighterSpec;
    expect(live.levels[0]!.opponent.name).toBe('SOURCE RIVAL');
    expect(source).toEqual(live);
  });

  it('rejects malformed appearance data without touching the stored spec', async () => {
    const id = 'strict-fighter';
    addGame(id, fighterSpec());
    const path = join(files.gameDir(id), 'game.json');
    const before = readFileSync(path, 'utf8');
    const response = await app.inject({
      method: 'PUT',
      url: `/api/dev/fighter/games/${id}/character`,
      payload: {
        target: { kind: 'player' },
        appearance: {
          name: 'HERO',
          build: 'balanced',
          outfit: 'gi',
          colorSlot: 5,
          powerScale: 1.15,
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});
