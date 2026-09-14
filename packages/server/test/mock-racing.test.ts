import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DesignDoc, RacingSpec } from '@sparkade/shared';
import { archetypes } from '@sparkade/archetypes';
import {
  buildDesignPrompt,
  buildEntitiesPrompt,
  buildLevelsPrompt,
  buildMusicPrompt,
} from '../src/pipeline/prompts';
import { MockProvider } from '../src/providers/mock';
import { validateAgainst } from '../src/pipeline/validate';
import { resolveCupRaces } from '../../archetypes/src/racing/game';
import { aiInputFor, createRaceFor, stepRace } from '../../archetypes/src/racing/simulation';
import { BARRIER_X } from '../../archetypes/src/racing/track';

const previousFast = process.env.SPARKADE_MOCK_FAST;

beforeAll(() => {
  process.env.SPARKADE_MOCK_FAST = '1';
});

afterAll(() => {
  if (previousFast === undefined) delete process.env.SPARKADE_MOCK_FAST;
  else process.env.SPARKADE_MOCK_FAST = previousFast;
});

const design = { title: 'Cup Test', archetype: 'racing' } as DesignDoc;

const goldenDir = join(__dirname, '..', '..', 'generation', 'golden');

async function runStage(prompt: {
  system: string;
  user: string;
  maxTokens: number;
  jsonSchema: Record<string, unknown>;
}) {
  const response = await new MockProvider('test').complete({
    system: prompt.system,
    user: prompt.user,
    maxTokens: prompt.maxTokens,
    jsonSchema: prompt.jsonSchema,
  });
  return { payload: JSON.parse(response.text) as Record<string, unknown>, prompt };
}

describe('mock racing cup stages', () => {
  it('routes a kart premise to a racing design with a driver cast', async () => {
    const prompt = buildDesignPrompt({
      promptText: 'a hover kart grand prix across crystal dunes',
      hasPhoto: false,
      describeInStory: false,
      antiCollision: [],
    });
    const { payload } = await runStage(prompt);
    const doc = payload as unknown as DesignDoc & { cast: { role: string }[] };
    expect(doc.archetype).toBe('racing');
    expect(doc.cast.map((c) => c.role)).toEqual(['rival1', 'rival2', 'rival3', 'rival4']);
  });

  it('returns a design that validates against its own schema', async () => {
    const prompt = buildDesignPrompt({
      promptText: 'a hover kart grand prix across crystal dunes',
      hasPhoto: false,
      describeInStory: false,
      antiCollision: [],
    });
    const { payload } = await runStage(prompt);
    expect(validateAgainst('test:racing-design', prompt.jsonSchema, payload)).toEqual([]);
    const doc = payload as unknown as { levelPlan: unknown[]; archetype: string };
    expect(doc.archetype).toBe('racing');
    expect(doc.levelPlan).toHaveLength(3);
  });

  it('bounds levelPlan at 3 for racing, 4 for everyone else', async () => {
    const prompt = buildDesignPrompt({
      promptText: 'a hover kart grand prix across crystal dunes',
      hasPhoto: false,
      describeInStory: false,
      antiCollision: [],
    });
    const { payload } = await runStage(prompt);
    const doc = payload as unknown as { levelPlan: { name: string; summary: string }[] };
    const short = { ...doc, levelPlan: doc.levelPlan.slice(0, 2) };
    expect(validateAgainst('test:racing-plan-2', prompt.jsonSchema, short)).not.toEqual([]);
    const long = {
      ...doc,
      levelPlan: [...doc.levelPlan, { name: 'Extra', summary: 'A fake fourth race' }],
    };
    expect(validateAgainst('test:racing-plan-4', prompt.jsonSchema, long)).not.toEqual([]);
  });

  it('detects racing keywords before the shooter fallback', async () => {
    const prompt = buildLevelsPrompt('racing', design);
    const { payload } = await runStage({
      ...prompt,
      user: 'a hover kart grand prix, F-Zero style showdown',
    });
    const levels = payload['levels'] as RacingSpec['levels'];
    expect(levels).toHaveLength(3);
    expect(levels.map((l) => l.template).sort()).toEqual(['coral', 'ember', 'ratchet']);
    expect(validateAgainst('test:racing-levels', prompt.jsonSchema, payload)).toEqual([]);
  });

  it('prefers the exact stage schema over hover/race story words', async () => {
    const prompt = buildLevelsPrompt('shooter', design);
    const { payload } = await runStage({
      ...prompt,
      user: 'a hover enemy that races across the sky, dodging asteroids',
    });
    const levels = payload['levels'] as { waves?: unknown[] }[];
    expect(levels).toHaveLength(3);
    expect(levels[0]).toHaveProperty('waves');
  });

  it('prefers the design document over premise keywords', async () => {
    const { payload } = await runStage({
      system: '',
      user: 'DESIGN DOCUMENT:\n{"archetype": "adventure", "title": "X"}\nPlease make a hover race',
      maxTokens: 4000,
      jsonSchema: {},
    });
    expect((payload as { archetype?: string }).archetype).toBe('adventure');
  });

  it('ignores racing games in the anti-collision catalog', async () => {
    const prompt = buildDesignPrompt({
      promptText: 'a brave platformer jump quest over mountains',
      hasPhoto: false,
      describeInStory: false,
      antiCollision: [{ title: 'Ember Cup', tagline: 'hover racing cup finale' }],
    });
    const { payload } = await runStage(prompt);
    expect((payload as { archetype?: string }).archetype).toBe('platformer');
  });

  it('lets an explicit requested type win over racing keywords', async () => {
    const prompt = buildLevelsPrompt('shooter', design);
    const { payload } = await runStage({
      ...prompt,
      user: 'REQUIRED ARCHETYPE: shooter. Design every level for shooter; a hover kart race in space',
    });
    const levels = payload['levels'] as { waves?: unknown[] }[];
    expect(levels).toHaveLength(3);
    expect(levels[0]).toHaveProperty('waves');
  });

  it('assembles entities with the finale rival copied from levels', async () => {
    const prompt = buildEntitiesPrompt('racing', design, false);
    const { payload } = await runStage(prompt);
    expect(validateAgainst('test:racing-entities', prompt.jsonSchema, payload)).toEqual([]);
    const boss = payload['boss'] as { name: string; topScale: number };
    expect(boss.name).toBe('VEX');
    expect(boss.topScale).toBe(0.985);
  });

  it('hands non-golden circuits to entities so the boss copies them', async () => {
    const custom = [
      { name: 'Nebula Ring', template: 'ember', rivals: ['ZED', 'YARA', 'MILO', 'TESS'] },
      { name: 'Glass Drift', template: 'coral', rivals: ['ZED', 'YARA', 'MILO', 'TESS'] },
      {
        name: 'Iron Chicane',
        template: 'ratchet',
        rivals: [
          { name: 'ZED', topScale: 0.9 },
          { name: 'YARA', topScale: 0.97 },
          { name: 'MILO', topScale: 0.8 },
          { name: 'TESS', topScale: 0.75 },
        ],
      },
    ];
    const prompt = buildEntitiesPrompt('racing', design, false, undefined, [], custom);
    // The canonical block travels verbatim — no re-derivation, no golden names.
    expect(prompt.user).toContain('CANONICAL CUP CIRCUITS');
    expect(prompt.user).toContain('Iron Chicane');
    expect(prompt.user).toContain('YARA');
    expect(prompt.user).not.toContain('VEX');
    // A boss copied from those circuits (nondefault index 2, pace 0.97)
    // validates clean against the entities schema.
    const boss = { name: 'YARA', title: 'YARA PRIME', rivalIndex: 2, topScale: 0.97 };
    expect(
      validateAgainst('test:racing-custom-boss', prompt.jsonSchema, {
        sprites: { custom: {}, assign: { hero: 'lib:hero_squire', boss: 'lib:boss_titan' } },
        boss,
      }),
    ).toEqual([]);
  });

  it('serves golden music and a lint-clean assembled cup', async () => {
    const musicPrompt = buildMusicPrompt('racing', design);
    const music = await runStage(musicPrompt);
    expect(validateAgainst('test:racing-music', musicPrompt.jsonSchema, music.payload)).toEqual([]);

    const levelsPrompt = buildLevelsPrompt('racing', design);
    const levels = await runStage(levelsPrompt);
    const entitiesPrompt = buildEntitiesPrompt('racing', design, false);
    const entities = await runStage(entitiesPrompt);
    const golden = JSON.parse(
      readFileSync(join(goldenDir, 'golden-racing.json'), 'utf8'),
    ) as RacingSpec;
    const spec: RacingSpec = {
      specVersion: 1,
      archetype: 'racing',
      seed: 7,
      meta: { title: 'Mock Cup', tagline: 'Assembled from mock stages' },
      palette: golden.palette,
      story: golden.story,
      ...(levels.payload as Pick<RacingSpec, 'levels'>),
      ...(entities.payload as Pick<RacingSpec, 'boss' | 'sprites'>),
      ...(music.payload as Pick<RacingSpec, 'music'>),
      scoring: golden.scoring,
    };
    expect(archetypes.racing.lint(spec)).toEqual([]);
    expect(archetypes.racing.estimateDurationS(spec)).toBeGreaterThanOrEqual(300);
  });

  it('keeps an authored-order cup (mirrored opening, non-ratchet finale) from stages to runtime', async () => {
    // Aurora shape: mirrored coastal opening, finale hosted by ember. One of
    // each template, same cast in the same slots, boss copied from the LAST
    // circuit — never ratchet-by-position.
    const cast = (lead: number) => [
      { name: 'VEX', topScale: lead },
      { name: 'JUNO', topScale: 0.91 },
      { name: 'PIP', topScale: 0.88 },
      { name: 'KAZ', topScale: 0.85 },
    ];
    const reordered = [
      {
        name: 'Mirror Coast Sweep',
        template: 'coral',
        laps: 3,
        musicSong: 'theme',
        mirror: true,
        rivals: cast(0.94),
      },
      {
        name: 'Snowfall Chicane',
        template: 'ratchet',
        laps: 3,
        musicSong: 'theme',
        rivals: cast(0.94),
      },
      {
        name: 'Ember Finale',
        template: 'ember',
        laps: 3,
        musicSong: 'boss',
        length: 2800,
        rivals: cast(0.985),
      },
    ] as unknown as RacingSpec['levels'];
    // The reordered payload validates against the real levels stage schema.
    const levelsPrompt = buildLevelsPrompt('racing', design);
    expect(
      validateAgainst('test:racing-reordered-levels', levelsPrompt.jsonSchema, {
        levels: reordered,
      }),
    ).toEqual([]);
    // The entities boundary carries the authored order verbatim for the boss copy.
    const entitiesPrompt = buildEntitiesPrompt('racing', design, false, undefined, [], reordered);
    const user = entitiesPrompt.user;
    expect(user.indexOf('Mirror Coast Sweep')).toBeLessThan(user.indexOf('Snowfall Chicane'));
    expect(user.indexOf('Snowfall Chicane')).toBeLessThan(user.indexOf('Ember Finale'));
    const boss = { name: 'VEX', title: 'VEX PRIME', rivalIndex: 1, topScale: 0.985 };
    expect(
      validateAgainst('test:racing-reordered-boss', entitiesPrompt.jsonSchema, {
        sprites: { custom: {}, assign: { hero: 'lib:hero_squire', boss: 'lib:boss_titan' } },
        boss,
      }),
    ).toEqual([]);
    // Assembled through the same boundary as the mock stages, the cup lints clean.
    const golden = JSON.parse(
      readFileSync(join(goldenDir, 'golden-racing.json'), 'utf8'),
    ) as RacingSpec;
    const spec: RacingSpec = {
      specVersion: 1,
      archetype: 'racing',
      seed: 7,
      meta: { title: 'Reordered Cup', tagline: 'Authored order, kept' },
      palette: golden.palette,
      story: {
        ...golden.story,
        levelIntros: [
          'Mirror Coast Sweep: mirrored coastal sweepers open the cup.',
          'Snowfall Chicane: a tight stadium middle under the lights.',
          'Ember Finale: VEX PRIME defends the cup on the ember hairpin.',
        ],
      },
      levels: reordered,
      boss,
      sprites: { custom: {}, assign: { hero: 'lib:hero_squire', boss: 'lib:boss_titan' } },
      music: golden.music,
      scoring: golden.scoring,
    };
    expect(archetypes.racing.lint(spec)).toEqual([]);
    // Runtime resolution preserves authored order, finale music, and narrative alignment.
    const resolved = resolveCupRaces(spec);
    expect(resolved.map((r) => r.circuit.id)).toEqual(['coral', 'ratchet', 'ember']);
    expect(resolved.map((r) => r.musicSong)).toEqual(['theme', 'theme', 'boss']);
    reordered.forEach((level, i) => {
      expect(resolved[i]!.circuit.name).toBe(level.name);
      expect(spec.story.levelIntros[i]).toMatch(new RegExp(`^${level.name}`));
      // Compiled arc length carries float dust (2799.9999… for authored 2800).
      expect(resolved[i]!.circuit.track.length).toBeGreaterThanOrEqual(2799);
      expect(resolved[i]!.circuit.track.length).toBeLessThanOrEqual(3601);
    });
    // Every resolved circuit (incl. the mirrored/length variants) simulates clean.
    for (const { circuit } of resolved) {
      const race = createRaceFor({ ...circuit, timeout: 30 }, 0);
      for (let k = 0; k < 300; k++) {
        stepRace(
          race,
          race.racers.map((_, i) => aiInputFor(race, i)),
          1 / 60,
        );
        for (const r of race.racers) {
          expect(Number.isFinite(r.s) && Number.isFinite(r.x)).toBe(true);
          expect(Math.abs(r.x)).toBeLessThanOrEqual(BARRIER_X);
        }
      }
    }
  });
});
