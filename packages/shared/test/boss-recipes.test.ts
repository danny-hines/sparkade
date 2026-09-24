import { describe, expect, it } from 'vitest';
import {
  ARCHETYPE_SCHEMAS,
  BOSS_RECIPES,
  bossRecipePlan,
  bossSequence,
  mechanicalFingerprint,
  selectGenerationHistory,
  type BossRecipeArchetype,
  type GameSpec,
} from '../src';
import { loadGolden } from '../../generation/src';

const recipeArchetypes = Object.keys(BOSS_RECIPES) as BossRecipeArchetype[];

describe('boss recipes', () => {
  it.each(recipeArchetypes)('%s recipes are distinct, schema-valid phase orders', (archetype) => {
    type BossSchema = { $ref?: string; properties?: { phases: unknown } };
    const schema = ARCHETYPE_SCHEMAS[archetype] as {
      properties: { boss: BossSchema };
      $defs: Record<string, BossSchema>;
    };
    const ref = schema.properties.boss.$ref;
    const boss = ref ? schema.$defs[ref.split('/').pop()!]! : schema.properties.boss;
    const phases = boss.properties!.phases as {
      minItems: number;
      maxItems: number;
      items: { properties: { pattern: { enum: string[] } } };
    };
    const recipes = BOSS_RECIPES[archetype];
    expect(new Set(recipes.map((r) => r.join('>'))).size).toBe(recipes.length);
    for (const recipe of recipes) {
      expect(recipe.length).toBeGreaterThanOrEqual(phases.minItems);
      expect(recipe.length).toBeLessThanOrEqual(phases.maxItems);
      expect(new Set(recipe).size).toBe(recipe.length);
      for (const pattern of recipe) expect(phases.items.properties.pattern.enum).toContain(pattern);
    }
  });

  it.each(recipeArchetypes)('%s golden boss is only one of several recipes', (archetype) => {
    const golden = bossSequence(loadGolden(archetype) as GameSpec);
    expect(BOSS_RECIPES[archetype].map((r) => r.join('>'))).toContain(golden);
    expect(BOSS_RECIPES[archetype].length).toBeGreaterThan(3);
  });

  it('records ordered boss phases in the mechanical fingerprint', () => {
    expect(mechanicalFingerprint(loadGolden('shooter') as GameSpec).boss).toBe('fan>spiral>walls');
    expect(mechanicalFingerprint(loadGolden('adventure') as GameSpec).boss).toBe(
      'spiral>summon>teleport',
    );
    expect(mechanicalFingerprint(loadGolden('racing') as GameSpec).boss).toBeUndefined();
  });

  it('avoids the most recent same-archetype order and opening', () => {
    const recent = [{ archetype: 'shooter', boss: 'fan>spiral>walls' }];
    for (let seed = 0; seed < 20; seed++) {
      const plan = bossRecipePlan('shooter', recent, seed);
      expect(plan[0]).not.toBe('fan');
    }
  });

  it('ignores other archetypes and still varies by seed on a fresh cabinet', () => {
    const recent = [{ archetype: 'hshooter', boss: 'aimed>fan>spiral' }];
    const plans = new Set(
      Array.from({ length: 20 }, (_, seed) => bossRecipePlan('shooter', recent, seed).join('>')),
    );
    expect(plans.size).toBe(BOSS_RECIPES.shooter.length);
  });

  it('rotates through every recipe before repeating one', () => {
    const recent: { archetype: string; boss: string }[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < BOSS_RECIPES.adventure.length; i++) {
      const plan = bossRecipePlan('adventure', recent, 7).join('>');
      expect(seen.has(plan)).toBe(false);
      seen.add(plan);
      recent.unshift({ archetype: 'adventure', boss: plan });
    }
  });
});

describe('generation history selection', () => {
  it('keeps the broad window as a prefix and adds same-archetype depth', () => {
    const games = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, archetype: 'platformer' })),
      { id: 's0', archetype: 'shooter' },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, archetype: 'platformer' })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `s${i + 1}`, archetype: 'shooter' })),
    ];
    const selected = selectGenerationHistory(games, (g) => g.archetype, 10, 5).map((g) => g.id);
    expect(selected.slice(0, 10)).toEqual(games.slice(0, 10).map((g) => g.id));
    expect(selected.filter((id) => id.startsWith('s'))).toEqual(['s0', 's1', 's2', 's3', 's4']);
    expect(selected.filter((id) => id.startsWith('q'))).toEqual([]);
  });
});
