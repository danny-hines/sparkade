import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { archetypes } from '@sparkade/archetypes';
import {
  LIB_BOSSES_PLATFORMER,
  PRESENTATION_FAMILIES,
  type DesignDoc,
  type GameSpec,
  type HShooterSpec,
  type JobStage,
  type PlatformerSpec,
  type StageName,
} from '@sparkade/shared';
import { designOutputDiagnostics, GenerationRunner } from '../src/pipeline/runner';
import type { BuiltPrompt, RecentUse } from '../src/pipeline/prompts';
import {
  applySpriteFallbacks,
  applySpriteFallbacksForRepair,
  customBossSpriteDiagnostics,
  ensureLikenessHeroBody,
  platformerBossFallback,
  ensurePlatformerImageCharacterFallbacks,
  repairPlatformerExitRoutes,
  securityScan,
  spriteProblem,
  titleSimilarity,
  tooSimilar,
  validateGameSchema,
  validateDesignSchema,
} from '../src/pipeline/validate';
import { repoRoot } from '../src/util';

function golden(archetype: string): GameSpec {
  return JSON.parse(
    readFileSync(
      join(repoRoot(), 'packages/generation/golden', `golden-${archetype}.json`),
      'utf8',
    ),
  );
}

function validPlatformerDesign(): DesignDoc {
  const source = golden('platformer');
  return {
    title: 'Safe Design',
    tagline: 'A clean test design',
    archetype: 'platformer',
    palette: source.palette,
    heroConcept: 'A careful arcade explorer',
    story: source.story,
    levelPlan: new Array(4).fill(null).map((_, index) => ({
      name: `Stage ${index + 1}`,
      summary: 'Cross a compact obstacle course.',
    })),
    cast: ['walker', 'flyer', 'shooter', 'chaser'].map((role) => ({
      role,
      concept: `A themed ${role}`,
    })),
    musicBrief: { key: 'C minor', bpm: 120, themeMood: 'bold', bossMood: 'tense' },
    scoring: source.scoring,
    difficulty: 'standard',
    abilityLoadout: [
      {
        kind: 'doubleJump',
        name: 'Sky Step',
        visualConcept: 'A bright mechanical feather that kicks upward in midair',
      },
    ],
  };
}

function compactLevelStage(levels: readonly unknown[]): { levels: unknown[] } {
  return {
    levels: levels.map((value) => {
      const level = structuredClone(value) as Record<string, unknown>;
      const tiles = level['tiles'] as string[];
      level['tileRuns'] = tiles.map((row) => {
        const runs: [string, number][] = [];
        for (const tile of row) {
          const previous = runs.at(-1);
          if (previous?.[0] === tile) previous[1]++;
          else runs.push([tile, 1]);
        }
        return runs;
      });
      delete level['tiles'];
      return level;
    }),
  };
}

function compactSingleLevel(level: PlatformerSpec['levels'][number]): unknown {
  return compactLevelStage([level]).levels[0];
}

function carveChasm(level: PlatformerSpec['levels'][number], start: number, width = 8): void {
  level.tiles = level.tiles.map(
    (row) => row.slice(0, start) + '.'.repeat(width) + row.slice(start + width),
  );
  level.entities = level.entities.filter(
    (entity) =>
      !(
        entity.x >= start - 5 &&
        entity.x <= start + width + 5 &&
        (entity.type === 'spring' || entity.type === 'movingPlatform')
      ),
  );
}

function addOneWaySafePit(level: PlatformerSpec['levels'][number]): void {
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
}

type RepairCall = (
  stage: StageName,
  prompt: BuiltPrompt,
  opts: {
    temperature?: number;
    repair?: boolean;
    label: string;
    stage: JobStage;
  },
) => Promise<unknown>;

async function validateAndRepairForTest(
  spec: GameSpec,
  callLlm: RepairCall,
  recentUse?: RecentUse,
  repairCostUsd?: number,
): Promise<GameSpec> {
  const runner = Object.create(GenerationRunner.prototype) as GenerationRunner;
  if (repairCostUsd !== undefined) {
    Object.assign(runner, { db: { gameCost: () => repairCostUsd } });
  }
  const validateAndRepair = (
    runner as unknown as {
      validateAndRepair(
        input: GameSpec,
        archetype: 'platformer',
        design: DesignDoc,
        call: RepairCall,
        emit: (stage: JobStage, detail: string) => void,
        hasPhoto: boolean,
        recent?: RecentUse,
        repairContext?: { jobId: string; gameId: string; attempt: number },
      ): Promise<GameSpec>;
    }
  ).validateAndRepair.bind(runner);
  return validateAndRepair(
    spec,
    'platformer',
    spec as unknown as DesignDoc,
    callLlm,
    () => undefined,
    false,
    recentUse,
    repairCostUsd === undefined
      ? undefined
      : { jobId: 'j-route-budget', gameId: 'g-route-budget', attempt: 1 },
  );
}

describe('security scan', () => {
  it('rejects unsafe display strings during design instead of after dependent stages run', () => {
    const design = validPlatformerDesign();

    expect(designOutputDiagnostics(design)).toEqual([]);
    expect(designOutputDiagnostics({ ...design, abilityLoadout: null })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SCHEMA', path: '/abilityLoadout' }),
      ]),
    );
    const missingAbility = { ...design } as Partial<DesignDoc>;
    delete missingAbility.abilityLoadout;
    expect(designOutputDiagnostics(missingAbility)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SCHEMA', path: '/abilityLoadout' }),
      ]),
    );
    expect(designOutputDiagnostics({ ...design, movementProfile: 'floaty' })).toEqual([]);
    expect(
      designOutputDiagnostics({
        ...design,
        abilityLoadout: [
          ...design.abilityLoadout!,
          {
            kind: 'doubleJump',
            name: 'Cloud Kick',
            visualConcept: 'A second bright mechanical feather with a different finish',
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PLAT_ABILITY_DUPLICATE' })]),
    );
    expect(
      designOutputDiagnostics({ ...design, movementProfile: 'slippery' as 'balanced' }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SCHEMA' })]));
    const missingCraft = designOutputDiagnostics({
      ...design,
      archetype: 'hshooter',
      abilityLoadout: [],
    });
    expect(missingCraft).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SCHEMA', path: '/vehicleConcept' }),
      ]),
    );
    expect(missingCraft.every(({ code }) => code === 'SCHEMA')).toBe(true);
    expect(
      designOutputDiagnostics({
        ...design,
        archetype: 'hshooter',
        abilityLoadout: [],
        vehicleConcept:
          'A cobalt trench skiff with swept fins, a dark canopy, and twin amber drives',
      }),
    ).toEqual([]);
    const missingCombatKit = designOutputDiagnostics({
      ...design,
      archetype: 'adventure',
      abilityLoadout: [],
    });
    expect(missingCombatKit).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SCHEMA', path: '/combatKit' })]),
    );
    expect(
      designOutputDiagnostics({
        ...design,
        archetype: 'adventure',
        abilityLoadout: [],
        combatKit: {
          primary: {
            profile: 'close',
            name: 'Knuckle Wraps',
            visualConcept: 'red canvas hand wraps with brass signal studs',
            unarmed: true,
          },
          secondary: {
            behavior: 'shot',
            name: 'Signal Flare',
            visualConcept: 'a stubby orange marine flare launcher',
          },
        },
      }),
    ).toEqual([]);
    expect(
      designOutputDiagnostics({ ...design, archetype: 'fighter', abilityLoadout: [] }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SCHEMA', path: '/fighterArtDirection' }),
      ]),
    );
    expect(
      designOutputDiagnostics({
        ...design,
        archetype: 'fighter',
        abilityLoadout: [],
        fighterArtDirection: {
          aesthetic: 'stylized',
          proportions:
            'Six-head athletic adult proportions with consistently sized expressive faces',
          rendering:
            'Crisp dark outlines, compact pixel clusters, and restrained three-step cel shading',
        },
      }),
    ).toEqual([]);
    expect(designOutputDiagnostics({ ...design, title: 'Visit www.bad.example' })).toEqual([
      expect.objectContaining({ code: 'SCAN_REJECTED', path: '/title' }),
    ]);
  });

  it('fills a missing platformer ability without redrafting the full design', async () => {
    const draft = validPlatformerDesign() as Partial<DesignDoc>;
    delete draft.abilityLoadout;
    const calls: { label: string; maxTokens: number }[] = [];
    const responses: unknown[] = [
      draft,
      {
        abilityLoadout: [
          {
            kind: 'shield',
            name: 'Signal Ward',
            visualConcept: 'A warm amber lighthouse ring that absorbs one incoming hit',
          },
        ],
      },
    ];
    const runner = Object.create(GenerationRunner.prototype) as GenerationRunner;
    const designPass = (
      runner as unknown as {
        designPass(
          call: (
            stage: StageName,
            prompt: BuiltPrompt,
            opts: {
              temperature?: number;
              repair?: boolean;
              image?: Buffer;
              reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
              checkpoint?: 'design' | 'levels' | 'entities' | 'music';
              label: string;
              stage: JobStage;
            },
          ) => Promise<unknown>,
          opts: {
            promptText: string;
            hasPhoto: boolean;
            describeInStory: boolean;
            antiCollision: { title: string; tagline: string }[];
          },
        ): Promise<DesignDoc>;
      }
    ).designPass.bind(runner);
    const result = await designPass(
      async (_stage, prompt, opts) => {
        calls.push({ label: opts.label, maxTokens: prompt.maxTokens });
        return responses.shift();
      },
      {
        promptText: 'A lighthouse platformer',
        hasPhoto: false,
        describeInStory: false,
        antiCollision: [],
      },
    );

    expect(calls).toEqual([
      { label: 'Design drafted', maxTokens: 4000 },
      { label: 'Abilities selected', maxTokens: 500 },
    ]);
    expect(result).toMatchObject({
      title: 'Safe Design',
      abilityLoadout: [{ kind: 'shield', name: 'Signal Ward' }],
    });
  });

  it('injection strings in display fields are rejected and stay inert', () => {
    const attacks = [
      '<script>alert(1)</script>',
      'visit https://evil.example now',
      'see www.evil.example',
      'run eval(document.cookie)',
      'x => fetch(secrets)',
      'read /etc/passwd please',
      'open ..\\..\\secrets.txt',
      'hello {{template}} world',
      'money ${process.env.KEY}',
      '<img src=x onerror=alert(1)>',
    ];
    for (const attack of attacks) {
      const spec = golden('shooter');
      spec.story.bossIntro = attack;
      const findings = securityScan(spec); // must not throw — inert handling
      expect(findings.length, attack).toBeGreaterThan(0);
      expect(findings[0]!.code).toBe('SCAN_REJECTED');
      expect(findings[0]!.path).toContain('/story/bossIntro');
    }
  });

  it('unknown sprite ids are flagged', () => {
    const spec = golden('platformer');
    spec.sprites.assign['walker'] = 'lib:totally_fake_sprite';
    const findings = securityScan(spec);
    expect(findings.some((f) => f.code === 'SCAN_UNKNOWN_ID')).toBe(true);
  });

  it('clean golden games scan clean', () => {
    for (const a of ['platformer', 'shooter', 'adventure']) {
      expect(securityScan(golden(a))).toEqual([]);
    }
  });
});

describe('platformer geometry schema migration', () => {
  it('accepts both new two-tile specs and legacy specs without the marker', () => {
    const current = golden('platformer') as PlatformerSpec;
    expect(validateGameSchema('platformer', current)).toEqual([]);

    const legacy = structuredClone(current);
    delete legacy.playerHeightTiles;
    expect(validateGameSchema('platformer', legacy)).toEqual([]);

    const invalid = { ...current, playerHeightTiles: 1 } as unknown as PlatformerSpec;
    expect(validateGameSchema('platformer', invalid)).not.toEqual([]);
  });

  it('accepts bounded scale modes while old saves remain valid', () => {
    const current = golden('platformer') as PlatformerSpec;
    expect(current.platformerScale).toBe('heroic');
    expect(validateGameSchema('platformer', current)).toEqual([]);

    const compact = { ...current, platformerScale: 'compact' };
    expect(validateGameSchema('platformer', compact)).toEqual([]);

    const legacy = structuredClone(current);
    delete legacy.platformerScale;
    expect(validateGameSchema('platformer', legacy)).toEqual([]);

    const invalid = { ...current, platformerScale: 'cinematic' };
    expect(validateGameSchema('platformer', invalid)).not.toEqual([]);
  });

  it('accepts bounded art-density modes while old saves remain valid', () => {
    const current = golden('platformer') as PlatformerSpec;
    expect(current.platformerArtDensity).toBe('detailed');
    expect(validateGameSchema('platformer', current)).toEqual([]);

    const detailed = { ...current, platformerArtDensity: 'detailed' };
    expect(validateGameSchema('platformer', detailed)).toEqual([]);

    const legacy = structuredClone(current);
    delete legacy.platformerArtDensity;
    expect(validateGameSchema('platformer', legacy)).toEqual([]);

    const invalid = { ...current, platformerArtDensity: 'smooth' };
    expect(validateGameSchema('platformer', invalid)).not.toEqual([]);
  });

  it('accepts bounded movement profiles while old saves remain valid', () => {
    const current = golden('platformer') as PlatformerSpec;
    for (const movementProfile of [
      'balanced',
      'precision',
      'momentum',
      'floaty',
      'heavy',
    ] as const) {
      expect(validateGameSchema('platformer', { ...current, movementProfile })).toEqual([]);
    }

    const legacy = structuredClone(current);
    delete legacy.movementProfile;
    expect(validateGameSchema('platformer', legacy)).toEqual([]);

    const invalid = { ...current, movementProfile: 'slippery' };
    expect(validateGameSchema('platformer', invalid)).not.toEqual([]);
  });

  it('accepts one or two themed platformer abilities while old saves remain valid', () => {
    const current = golden('platformer') as PlatformerSpec;
    expect(validateGameSchema('platformer', current)).toEqual([]);

    const legacy = structuredClone(current);
    delete legacy.abilityLoadout;
    expect(validateGameSchema('platformer', legacy)).toEqual([]);

    const tooMany = {
      ...current,
      abilityLoadout: [
        ...current.abilityLoadout!,
        {
          kind: 'projectile',
          name: 'Beacon Bolt',
          visualConcept: 'A bright lighthouse spark fired straight ahead',
        },
      ],
    };
    expect(validateGameSchema('platformer', tooMany)).not.toEqual([]);
  });
});

describe('H-scroll presentation schema migration', () => {
  it('opts current games into detailed terrain and requires generated craft identity', () => {
    const current = golden('hshooter') as HShooterSpec;
    expect(current.hshooterArtDensity).toBe('detailed');
    expect(validateGameSchema('hshooter', current)).toEqual([]);
    expect(current.playerCraft?.visualConcept).toMatch(/diagnostic skiff/i);

    const chunky = { ...current, hshooterArtDensity: 'chunky' };
    expect(validateGameSchema('hshooter', chunky)).toEqual([]);

    expect(validateGameSchema('hshooter', { ...current, hshooterEnemyArtVersion: 1 })).toEqual([]);

    const legacy = structuredClone(current);
    delete legacy.hshooterArtDensity;
    const missingCraft = structuredClone(current) as Partial<HShooterSpec>;
    delete missingCraft.playerCraft;
    expect(validateGameSchema('hshooter', missingCraft)).not.toEqual([]);

    const invalid = { ...current, hshooterArtDensity: 'smooth' };
    expect(validateGameSchema('hshooter', invalid)).not.toEqual([]);
    expect(validateGameSchema('hshooter', { ...current, hshooterEnemyArtVersion: 2 })).not.toEqual(
      [],
    );

    expect(
      validateGameSchema('hshooter', {
        ...current,
        playerCraft: { visualConcept: 'tiny' },
      }),
    ).not.toEqual([]);
  });
});

describe('custom sprite checks + repair-aware fallback', () => {
  it('guarantees a compatible tall-likeness body only for photo platformers', () => {
    const spec = golden('platformer');
    spec.sprites.assign['hero'] = 'custom:signature_hero';
    const fixed = ensureLikenessHeroBody(spec, true);
    expect(fixed).not.toBe(spec);
    expect(fixed.sprites.assign['hero']).toMatch(/^lib:hero_/);
    expect(spec.sprites.assign['hero']).toBe('custom:signature_hero');
    expect(ensureLikenessHeroBody(fixed, true)).toBe(fixed);
    expect(ensureLikenessHeroBody(spec, false)).toBe(spec);

    const malformed = { ...spec, sprites: {} } as unknown as GameSpec;
    expect(ensureLikenessHeroBody(malformed, true)).toBe(malformed);

    const adventure = golden('adventure');
    expect(ensureLikenessHeroBody(adventure, true)).toBe(adventure);
  });

  it('flags dimension, charset and coverage problems', () => {
    expect(spriteProblem({ w: 8, h: 8, rows: new Array(7).fill('11111111') })).toMatch(
      /rows.length/,
    );
    expect(spriteProblem({ w: 8, h: 2, rows: ['1111111', '11111111'] })).toMatch(/row 0 length/);
    expect(spriteProblem({ w: 8, h: 2, rows: ['1111111Z', '11111111'] })).toMatch(
      /invalid characters/,
    );
    expect(spriteProblem({ w: 8, h: 8, rows: new Array(8).fill('........') })).toMatch(/opaque/);
    expect(spriteProblem({ w: 8, h: 8, rows: new Array(8).fill('ffffffff') })).toMatch(/opaque/);
    expect(spriteProblem({ w: 4, h: 4, rows: ['.ff.', 'f11f', 'f11f', '.ff.'] })).toBeNull();
  });

  it('falls back silently to the assigned library sprite (a downgrade, not an error)', () => {
    const spec = golden('platformer');
    spec.sprites.custom['broken'] = { w: 8, h: 8, rows: ['........'] }; // wrong row count
    spec.sprites.assign['hero'] = 'custom:broken';
    const { spec: fixed, downgraded } = applySpriteFallbacks(spec);
    expect(downgraded.length).toBeGreaterThan(0);
    expect(fixed.sprites.custom['broken']).toBeUndefined();
    expect(fixed.sprites.assign['hero']).toBe('lib:hero_squire');
    // the sanitized spec still passes schema
    expect(validateGameSchema('platformer', fixed)).toEqual([]);
  });

  it('preserves a malformed authored platformer boss for repair, but sanitizes shared roles', () => {
    const spec = golden('platformer');
    spec.sprites.custom['broken_boss'] = {
      w: 8,
      h: 8,
      rows: ['11111111'],
    };
    spec.sprites.assign['boss'] = 'custom:broken_boss';
    spec.sprites.assign['walker'] = 'custom:broken_boss';

    const repairable = applySpriteFallbacksForRepair(spec);
    expect(repairable.sprites.assign['boss']).toBe('custom:broken_boss');
    expect(repairable.sprites.custom['broken_boss']).toEqual(spec.sprites.custom['broken_boss']);
    expect(repairable.sprites.assign['walker']).toBe('lib:enemy_walker');
    expect(customBossSpriteDiagnostics(repairable)).toEqual([
      expect.objectContaining({
        code: 'SPRITE_INVALID',
        path: '/sprites/custom/broken_boss',
      }),
    ]);

    const ordinary = applySpriteFallbacks(spec);
    expect(ordinary.spec.sprites.custom['broken_boss']).toBeUndefined();
    expect(ordinary.spec.sprites.assign['boss']).toMatch(/^lib:boss_/);
  });

  it('does not spend boss repair on valid, missing, or non-platformer custom sprites', () => {
    const valid = golden('platformer');
    valid.sprites.custom['good_boss'] = {
      w: 4,
      h: 4,
      rows: ['.11.', '1111', '1111', '.11.'],
    };
    valid.sprites.assign['boss'] = 'custom:good_boss';
    const kept = applySpriteFallbacksForRepair(valid);
    expect(kept.sprites.assign['boss']).toBe('custom:good_boss');
    expect(customBossSpriteDiagnostics(kept)).toEqual([]);

    const missing = golden('platformer');
    missing.sprites.assign['boss'] = 'custom:missing_boss';
    expect(applySpriteFallbacksForRepair(missing).sprites.assign['boss']).toMatch(/^lib:boss_/);

    const adventure = golden('adventure');
    adventure.sprites.custom['broken_boss'] = { w: 8, h: 8, rows: ['11111111'] };
    adventure.sprites.assign['boss'] = 'custom:broken_boss';
    const sanitizedAdventure = applySpriteFallbacksForRepair(adventure);
    expect(sanitizedAdventure.sprites.custom['broken_boss']).toBeUndefined();
    expect(sanitizedAdventure.sprites.assign['boss']).toBe('lib:boss_warden');
    expect(customBossSpriteDiagnostics(sanitizedAdventure)).toEqual([]);
  });

  it('uses a deterministic, varied, recent-aware fallback for malformed platformer bosses', () => {
    const choices = LIB_BOSSES_PLATFORMER.map((_, seed) => platformerBossFallback(seed));
    expect(new Set(choices).size).toBe(LIB_BOSSES_PLATFORMER.length);
    expect(platformerBossFallback(7)).toBe(platformerBossFallback(7));

    const onlyUnused = LIB_BOSSES_PLATFORMER[3]!;
    const recent = LIB_BOSSES_PLATFORMER.filter((id) => id !== onlyUnused).map((id) => `lib:${id}`);
    expect(platformerBossFallback(999, recent)).toBe(`lib:${onlyUnused}`);

    const allRecent = LIB_BOSSES_PLATFORMER.map((id) => `lib:${id}`);
    expect(platformerBossFallback(5, allRecent)).toBe(platformerBossFallback(5));

    const spec = golden('platformer');
    spec.seed = 4;
    spec.sprites.custom['broken_boss'] = { w: 8, h: 8, rows: ['11111111'] };
    spec.sprites.assign['boss'] = 'custom:broken_boss';
    const result = applySpriteFallbacks(spec, { recentBosses: recent });
    expect(result.spec.sprites.assign['boss']).toBe(`lib:${onlyUnused}`);
    expect(result.downgraded).toContain(
      `assign.boss fell back from "custom:broken_boss" to "lib:${onlyUnused}"`,
    );
  });

  it('reduces newly image-generated platformer characters to lightweight library fallbacks', () => {
    const spec = golden('platformer');
    const sprite = { w: 4, h: 4, rows: ['.11.', '1111', '1111', '.11.'] };
    spec.sprites.custom['old_boss'] = structuredClone(sprite);
    spec.sprites.custom['old_walker'] = structuredClone(sprite);
    spec.sprites.custom['visible_object'] = structuredClone(sprite);
    spec.sprites.assign['boss'] = 'custom:old_boss';
    spec.sprites.assign['walker'] = 'custom:old_walker';
    spec.sprites.assign['obj_spring'] = 'custom:visible_object';

    const normalized = ensurePlatformerImageCharacterFallbacks(spec, ['lib:boss_knight']);

    expect(normalized.sprites.assign['boss']).toMatch(/^lib:boss_/);
    expect(normalized.sprites.assign['boss']).not.toBe('lib:boss_knight');
    expect(normalized.sprites.assign).toMatchObject({
      walker: 'lib:enemy_walker',
      flyer: expect.stringMatching(/^lib:/),
      shooter: expect.stringMatching(/^lib:/),
      chaser: expect.stringMatching(/^lib:/),
      obj_spring: 'custom:visible_object',
    });
    expect(normalized.sprites.custom['old_boss']).toBeUndefined();
    expect(normalized.sprites.custom['old_walker']).toBeUndefined();
    expect(normalized.sprites.custom['visible_object']).toEqual(sprite);
    expect(spec.sprites.assign['boss']).toBe('custom:old_boss');
  });

  it('repairs malformed boss pixels before considering a library fallback', async () => {
    const spec = golden('platformer');
    spec.sprites.custom['repair_me'] = { w: 8, h: 8, rows: ['..1111..'] };
    spec.sprites.assign['boss'] = 'custom:repair_me';
    const stages: StageName[] = [];
    const fixed = await validateAndRepairForTest(spec, async (stage) => {
      stages.push(stage);
      return [
        {
          op: 'replace',
          path: '/sprites/custom/repair_me/rows',
          value: new Array(8).fill('..1111..'),
        },
      ];
    });

    expect(stages).toEqual(['repair']);
    expect(fixed.sprites.assign['boss']).toBe('custom:repair_me');
    expect(fixed.sprites.custom['repair_me']?.rows).toHaveLength(8);
    expect(customBossSpriteDiagnostics(fixed)).toEqual([]);
  });

  it('falls back after a stalled repair without needlessly retrying or regenerating entities', async () => {
    const spec = golden('platformer');
    spec.seed = 2;
    spec.sprites.custom['unrepairable'] = { w: 8, h: 8, rows: ['..1111..'] };
    spec.sprites.assign['boss'] = 'custom:unrepairable';
    const stages: StageName[] = [];
    const recentUse: RecentUse = {
      heroes: [],
      bosses: ['lib:boss_knight', 'lib:boss_drake'],
      backdrops: [],
    };
    const fixed = await validateAndRepairForTest(
      spec,
      async (stage) => {
        stages.push(stage);
        return [];
      },
      recentUse,
    );

    expect(stages).toEqual(['repair']);
    expect(fixed.sprites.assign['boss']).toBe(platformerBossFallback(spec.seed, recentUse.bosses));
    expect(fixed.sprites.assign['boss']).not.toBe('lib:boss_knight');
    expect(fixed.sprites.assign['boss']).not.toBe('lib:boss_drake');
    expect(fixed.sprites.custom['unrepairable']).toBeUndefined();
  });

  it('routes structurally malformed output to owner regeneration without crashing cleanup', async () => {
    const valid = golden('platformer') as PlatformerSpec;
    const malformed = structuredClone(valid) as PlatformerSpec;
    delete (malformed as unknown as { levels?: unknown }).levels;
    const stages: StageName[] = [];

    const fixed = await validateAndRepairForTest(malformed, async (stage) => {
      stages.push(stage);
      if (stage === 'repair') return [];
      if (stage === 'levels') return compactLevelStage(valid.levels);
      throw new Error(`unexpected ${stage} call`);
    });

    expect(stages).toEqual(['repair', 'levels']);
    expect(fixed.levels).toEqual(valid.levels);
    expect(validateGameSchema('platformer', fixed)).toEqual([]);
  });

  it('accepts canonical tile rows only after the compact regeneration retry is exhausted', async () => {
    const valid = golden('platformer') as PlatformerSpec;
    const malformed = structuredClone(valid) as PlatformerSpec;
    delete (malformed as unknown as { levels?: unknown }).levels;
    const stages: StageName[] = [];

    const fixed = await validateAndRepairForTest(malformed, async (stage) => {
      stages.push(stage);
      if (stage === 'repair') return [];
      if (stage === 'levels') return { levels: valid.levels };
      throw new Error(`unexpected ${stage} call`);
    });

    expect(stages).toEqual(['repair', 'levels', 'levels']);
    expect(fixed.levels).toEqual(valid.levels);
    expect(validateGameSchema('platformer', fixed)).toEqual([]);
  });

  it('dynamically regenerates an owner revealed after another owner becomes schema-valid', async () => {
    const valid = golden('platformer') as PlatformerSpec;
    const malformed = structuredClone(valid) as PlatformerSpec;
    delete (malformed as unknown as { levels?: unknown }).levels;
    malformed.sprites.custom['invisible_boss'] = {
      w: 8,
      h: 8,
      rows: new Array(8).fill('........'),
    };
    malformed.sprites.assign['boss'] = 'custom:invisible_boss';
    const stages: StageName[] = [];

    const fixed = await validateAndRepairForTest(malformed, async (stage) => {
      stages.push(stage);
      if (stage === 'repair') return [];
      if (stage === 'levels') return compactLevelStage(valid.levels);
      if (stage === 'entities') {
        return {
          sprites: valid.sprites,
          boss: valid.boss,
          sfx: valid.sfx,
          backdrop: valid.backdrop,
          weather: valid.weather,
          lighting: valid.lighting,
          juice: valid.juice,
        };
      }
      throw new Error(`unexpected ${stage} call`);
    });

    expect(stages).toEqual(['repair', 'levels', 'entities']);
    expect(fixed.sprites.assign['boss']).toBe(valid.sprites.assign['boss']);
    expect(validateGameSchema('platformer', fixed)).toEqual([]);
  });

  it('keeps well-formed animation frames and drops malformed ones', () => {
    const spec = golden('platformer');
    const good = ['.ff.', 'f11f', 'f11f', '.ff.'];
    const alt = ['.ff.', '1ff1', '1ff1', '.ff.'];
    spec.sprites.custom['anim'] = { w: 4, h: 4, rows: good, frames: [alt, ['too', 'short']] };
    spec.sprites.assign['walker'] = 'custom:anim';
    const { spec: fixed } = applySpriteFallbacks(spec);
    // the sprite survives; only the valid extra frame is kept
    expect(fixed.sprites.custom['anim']).toBeDefined();
    expect(fixed.sprites.custom['anim']!.frames).toEqual([alt]);
    expect(fixed.sprites.assign['walker']).toBe('custom:anim');
  });

  it('drops malformed or incompatible inner terrain so the cap family can be inferred', () => {
    const malformed = golden('platformer');
    malformed.sprites.assign['tile_solid'] = 'lib:ice_solid';
    malformed.sprites.custom['broken_inner'] = {
      w: 16,
      h: 16,
      rows: new Array(16).fill('1..............1'),
    };
    malformed.sprites.assign['tile_solid_inner'] = 'custom:broken_inner';
    const malformedResult = applySpriteFallbacks(malformed);
    expect(malformedResult.spec.sprites.custom['broken_inner']).toBeUndefined();
    expect(malformedResult.spec.sprites.assign['tile_solid_inner']).toBeUndefined();

    const wrongLibrary = golden('platformer');
    wrongLibrary.sprites.assign['tile_solid'] = 'lib:ice_solid';
    wrongLibrary.sprites.assign['tile_solid_inner'] = 'lib:hero_squire';
    const wrongLibraryResult = applySpriteFallbacks(wrongLibrary);
    expect(wrongLibraryResult.spec.sprites.assign['tile_solid_inner']).toBeUndefined();
    expect(wrongLibraryResult.downgraded).toContain(
      'assign.tile_solid_inner pointed at incompatible "lib:hero_squire"',
    );
  });

  it('requires custom solid cap/body tiles to be fully opaque', () => {
    const spec = golden('platformer');
    spec.sprites.custom['holey_solid'] = {
      w: 16,
      h: 16,
      rows: ['.111111111111111', ...new Array(15).fill('1111111111111111')],
    };
    spec.sprites.assign['tile_solid'] = 'custom:holey_solid';
    const { spec: fixed, downgraded } = applySpriteFallbacks(spec);
    expect(fixed.sprites.custom['holey_solid']).toBeUndefined();
    expect(fixed.sprites.assign['tile_solid']).toBe('lib:tile_solid');
    expect(downgraded.some((message) => message.includes('solid terrain must be 100%'))).toBe(true);
  });

  it('drops transparent animation frames from custom solid terrain', () => {
    const spec = golden('platformer');
    const opaque = new Array(16).fill('1111111111111111');
    spec.sprites.custom['animated_solid'] = {
      w: 16,
      h: 16,
      rows: opaque,
      frames: [['.111111111111111', ...opaque.slice(1)]],
    };
    spec.sprites.assign['tile_solid'] = 'custom:animated_solid';
    const { spec: fixed } = applySpriteFallbacks(spec);
    expect(fixed.sprites.custom['animated_solid']).toBeDefined();
    expect(fixed.sprites.custom['animated_solid']!.frames).toBeUndefined();
    expect(fixed.sprites.assign['tile_solid']).toBe('custom:animated_solid');
  });
});

describe('platformer route recovery', () => {
  it('builds a deterministic final route only through affected levels', () => {
    const spec = golden('platformer') as PlatformerSpec;
    const untouched = structuredClone(spec.levels[1]);
    carveChasm(spec.levels[0]!, 40);
    expect(archetypes.platformer.lint(spec).map((error) => error.code)).toContain(
      'PLAT_EXIT_UNREACHABLE',
    );

    const repaired = repairPlatformerExitRoutes(spec, [0]);
    expect(repaired.fixes).toEqual([
      expect.objectContaining({ code: 'PLATFORMER_ROUTE_FALLBACK', path: '/levels/0/tiles' }),
    ]);
    expect(
      archetypes.platformer.lint(repaired.spec as PlatformerSpec).map((error) => error.code),
    ).not.toContain('PLAT_EXIT_UNREACHABLE');
    expect((repaired.spec as PlatformerSpec).levels[1]).toEqual(untouched);
  });

  it('regenerates every failing level independently even when all levels fail', async () => {
    const valid = golden('platformer') as PlatformerSpec;
    const broken = structuredClone(valid);
    broken.levels.forEach((level, index) => {
      carveChasm(level, 35 + index * 8);
      // Moving platforms are now part of the traversal graph and may
      // legitimately bridge a carved gap. Remove them so this fixture still
      // guarantees that all three levels independently fail route validation.
      level.entities = level.entities.filter((entity) => entity.type !== 'movingPlatform');
    });
    const stages: StageName[] = [];
    const regeneratedIndexes: number[] = [];

    const fixed = await validateAndRepairForTest(broken, async (stage, prompt) => {
      stages.push(stage);
      if (stage === 'repair') return [];
      if (stage === 'levels') {
        const match = /zero-based level (\d+)/.exec(prompt.system);
        expect(match).not.toBeNull();
        const index = Number(match![1]);
        regeneratedIndexes.push(index);
        return { level: compactSingleLevel(valid.levels[index]!) };
      }
      throw new Error(`unexpected ${stage} call`);
    });

    expect(stages).toEqual(['repair', 'levels', 'levels', 'levels']);
    expect(regeneratedIndexes.sort((left, right) => left - right)).toEqual([0, 1, 2]);
    expect(fixed.levels).toEqual(valid.levels);
  });

  it('keeps applying post-regeneration repairs while each patch advances the frontier', async () => {
    const valid = golden('platformer') as PlatformerSpec;
    const twoGaps = structuredClone(valid.levels[0]!);
    carveChasm(twoGaps, 40);
    carveChasm(twoGaps, 72);
    const oneGap = structuredClone(valid.levels[0]!);
    carveChasm(oneGap, 72);
    const broken = structuredClone(valid);
    broken.levels[0] = twoGaps;
    const stages: StageName[] = [];
    let repairCalls = 0;

    const fixed = await validateAndRepairForTest(broken, async (stage) => {
      stages.push(stage);
      if (stage === 'levels') return { level: compactSingleLevel(twoGaps) };
      if (stage === 'repair') {
        repairCalls++;
        if (repairCalls === 1) return [];
        if (repairCalls === 2) {
          return [{ op: 'replace', path: '/levels/0', value: oneGap }];
        }
        return [{ op: 'replace', path: '/levels/0', value: valid.levels[0] }];
      }
      throw new Error(`unexpected ${stage} call`);
    });

    expect(stages).toEqual(['repair', 'levels', 'repair', 'repair']);
    expect(repairCalls).toBe(3);
    expect(fixed.levels[0]).toEqual(valid.levels[0]);
  });

  it('stops paid repair and regeneration calls at the cost ceiling, then uses route fallback', async () => {
    const broken = golden('platformer') as PlatformerSpec;
    carveChasm(broken.levels[0]!, 40);
    let modelCalls = 0;

    const fixed = await validateAndRepairForTest(
      broken,
      async () => {
        modelCalls++;
        throw new Error('model should not be called after the repair budget is exhausted');
      },
      undefined,
      0.25,
    );

    expect(modelCalls).toBe(0);
    expect(archetypes.platformer.lint(fixed as PlatformerSpec)).toEqual([]);
  });

  it('uses the route fallback for a reachable safe pit with no physical escape', async () => {
    const broken = golden('platformer') as PlatformerSpec;
    addOneWaySafePit(broken.levels[0]!);
    expect(archetypes.platformer.lint(broken).map((error) => error.code)).toContain(
      'PLAT_SOFTLOCK_REGION',
    );
    expect(archetypes.platformer.lint(broken).map((error) => error.code)).not.toContain(
      'PLAT_EXIT_UNREACHABLE',
    );
    let modelCalls = 0;

    const fixed = await validateAndRepairForTest(
      broken,
      async () => {
        modelCalls++;
        throw new Error('model should not be called after the repair budget is exhausted');
      },
      undefined,
      0.25,
    );

    expect(modelCalls).toBe(0);
    expect(archetypes.platformer.lint(fixed as PlatformerSpec)).toEqual([]);
  });
});

describe('title similarity (anti-duplicate)', () => {
  it('scores identical/contained/near titles high, distinct ones low', () => {
    expect(titleSimilarity('Emberwick Ascent', 'Emberwick Ascent')).toBe(1);
    expect(titleSimilarity('Emberwick Ascent', 'emberwick ascent!')).toBeGreaterThan(0.9);
    expect(titleSimilarity('Emberwick Ascent', 'Emberwick Ascent II')).toBeGreaterThanOrEqual(0.9);
    expect(titleSimilarity('Emberwick Ascent', 'Void Petal')).toBeLessThan(0.5);
    expect(tooSimilar('The Hollow Bell', ['Void Petal', 'The Hollow Bell'])).toBe(
      'The Hollow Bell',
    );
    expect(tooSimilar('Garden Defense Orbit', ['Void Petal'])).toBeNull();
  });
});

describe('tile-grid normalization (LLMs miscount fixed-width rows)', () => {
  it('pads short rows with empty sky and trims all-empty overhang', async () => {
    const { normalizeTileGrids } = await import('../src/pipeline/validate');
    const spec = golden('platformer');
    const level = (spec as { levels: { tiles: string[] }[] }).levels[0]!;
    const w = level.tiles[0]!.length;
    level.tiles[3] = level.tiles[3]!.slice(0, w - 4); // 4 chars short
    level.tiles[5] = level.tiles[5]! + '...'; // trailing-empty overhang
    const fixed = normalizeTileGrids(spec) as typeof spec & { levels: { tiles: string[] }[] };
    for (const row of fixed.levels[0]!.tiles) expect(row.length).toBe(w);
    // padded with '.' (empty), never with terrain
    expect(fixed.levels[0]!.tiles[3]!.slice(w - 4)).toBe('....');
  });

  it('leaves non-empty overhang alone for the lint to catch honestly', async () => {
    const { normalizeTileGrids } = await import('../src/pipeline/validate');
    const spec = golden('platformer');
    const level = (spec as { levels: { tiles: string[] }[] }).levels[0]!;
    level.tiles[3] = level.tiles[3]! + '##'; // real terrain overhang — ambiguous, do not guess
    const fixed = normalizeTileGrids(spec) as typeof spec & { levels: { tiles: string[] }[] };
    expect(fixed.levels[0]!.tiles[3]!.endsWith('##')).toBe(true);
  });
});

describe('platformer presentation schema compatibility', () => {
  it('accepts released families in both design and saved specs, including legacy omission', () => {
    for (const presentationFamily of [...PRESENTATION_FAMILIES, undefined]) {
      expect(validateDesignSchema({ ...validPlatformerDesign(), presentationFamily })).toEqual([]);
      expect(
        validateGameSchema('platformer', { ...golden('platformer'), presentationFamily }),
      ).toEqual([]);
    }
    expect(
      validateDesignSchema({ ...validPlatformerDesign(), presentationFamily: 'neon' }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/presentationFamily' })]));
    expect(
      validateGameSchema('platformer', { ...golden('platformer'), presentationFamily: 'neon' }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/presentationFamily' })]));
  });

  it('does not allow presentation families to leak into other archetypes', () => {
    const { abilityLoadout: _abilities, ...design } = validPlatformerDesign();
    for (const presentationFamily of PRESENTATION_FAMILIES) {
      expect(
        validateDesignSchema({ ...design, archetype: 'shooter', presentationFamily }).length,
      ).toBeGreaterThan(0);
      expect(validateGameSchema('shooter', { ...golden('shooter'), presentationFamily })).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: '/presentationFamily' })]),
      );
    }
  });
});
