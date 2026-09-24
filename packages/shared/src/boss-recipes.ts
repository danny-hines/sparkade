import type { AdventureBossPattern, GameSpec, ShooterBossPattern } from './types';

/** Archetypes whose bosses are an ordered list of single-pattern phases. */
export type BossRecipeArchetype = 'shooter' | 'hshooter' | 'adventure';

/**
 * Curated phase orders. Each opens with a readable pattern and escalates, so
 * a recipe is a deliberate fight shape rather than an arbitrary shuffle. The
 * golden example's order is only one entry, which keeps generated bosses from
 * copying it by default.
 */
const SHOOTER_RECIPES: readonly (readonly ShooterBossPattern[])[] = [
  ['fan', 'spiral', 'walls'],
  ['aimed', 'fan', 'spiral'],
  ['aimed', 'walls', 'spiral'],
  ['fan', 'aimed', 'walls'],
  ['walls', 'aimed', 'spiral'],
  ['aimed', 'spiral', 'walls'],
  ['fan', 'walls', 'aimed'],
];

export const BOSS_RECIPES: Record<BossRecipeArchetype, readonly (readonly string[])[]> = {
  shooter: SHOOTER_RECIPES,
  hshooter: SHOOTER_RECIPES,
  adventure: [
    ['spiral', 'summon', 'teleport'],
    ['charge', 'spiral', 'teleport'],
    ['summon', 'charge', 'spiral'],
    ['charge', 'teleport', 'summon'],
    ['teleport', 'spiral', 'charge'],
    ['summon', 'teleport', 'spiral'],
  ] satisfies (readonly AdventureBossPattern[])[],
};

export function isBossRecipeArchetype(archetype: string): archetype is BossRecipeArchetype {
  return archetype in BOSS_RECIPES;
}

/** Ordered boss phase summary recorded in history, e.g. `fan>spiral>walls`. */
export function bossSequence(spec: GameSpec): string | undefined {
  switch (spec.archetype) {
    case 'shooter':
    case 'hshooter':
    case 'adventure':
      return spec.boss?.phases?.map((phase) => phase.pattern).join('>') || undefined;
    case 'platformer':
      return spec.boss?.phases?.map((phase) => phase.attacks.join('+')).join('>') || undefined;
    default:
      return undefined;
  }
}

/**
 * Pick the recipe least like this cabinet's recent bosses of the same
 * archetype. An identical order costs most, a shared opening costs less, and
 * newer games weigh more. `seed` breaks ties so fresh cabinets still vary.
 */
export function bossRecipePlan(
  archetype: BossRecipeArchetype,
  recent: readonly { archetype: string; boss?: string }[],
  seed: number,
): readonly string[] {
  const recipes = BOSS_RECIPES[archetype];
  const history = recent
    .filter((entry) => entry.archetype === archetype && entry.boss)
    .map((entry) => entry.boss!.split('>'));
  const penalty = (recipe: readonly string[]) =>
    history.reduce((sum, sequence, i) => {
      const weight = 1 / (i + 1);
      if (sequence.join('>') === recipe.join('>')) return sum + 3 * weight;
      return sequence[0] === recipe[0] ? sum + weight : sum;
    }, 0);
  const scores = recipes.map(penalty);
  const best = Math.min(...scores);
  const candidates = recipes.filter((_, i) => scores[i] === best);
  return candidates[Math.abs(Math.trunc(seed)) % candidates.length]!;
}
