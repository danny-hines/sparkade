import type { FighterCharacter, FighterSpec } from './types';

export const FIGHTER_COMBAT_PROFILES = ['rushdown', 'counter', 'rangedControl'] as const;
export type FighterCombatProfile = (typeof FIGHTER_COMBAT_PROFILES)[number];
export const FIGHTER_PROJECTILE_KINDS = [
  'energyBlast',
  'fireball',
  'frostShard',
  'arcBolt',
  'spiritOrb',
] as const;
export type FighterProjectileKind = (typeof FIGHTER_PROJECTILE_KINDS)[number];
export interface FighterProjectile {
  kind: FighterProjectileKind;
  /** Short in-world move name, shown in the HUD and matchup introduction. */
  name: string;
}
export const FIGHTER_PROJECTILE_CATALOG = {
  energyBlast: {
    name: 'Energy blast',
    fiction: 'Focused chi, plasma gauntlets or futuristic energy weapons',
  },
  fireball: { name: 'Fireball', fiction: 'Fire magic, furnace champions or volcanic power' },
  frostShard: {
    name: 'Frost shard',
    fiction: 'Ice magic, winter guardians or cryogenic technology',
  },
  arcBolt: { name: 'Arc bolt', fiction: 'Electric coils, storm power or an arcane engineer' },
  spiritOrb: { name: 'Spirit orb', fiction: 'Ghosts, ancestral magic or a mystic guardian' },
} as const;
export function fighterProjectile(
  character: Pick<FighterCharacter, 'projectile'>,
): FighterProjectile {
  return character.projectile ?? { kind: 'energyBlast', name: 'Energy blast' };
}
export const FIGHTER_STYLE_CATALOG = {
  rushdown: {
    name: 'Rushdown',
    signature: 'Confirm a low punch, then high punch, then high kick for a three-hit chain.',
    counterplay: 'Guard the chain, then punish the missed kick.',
  },
  counter: {
    name: 'Counter fighter',
    signature: 'Tap guard just before contact, then strike during the counter opening.',
    counterplay: 'Bait the guard, wait for it to fade, then attack.',
  },
  rangedControl: {
    name: 'Ranged control',
    signature: 'Hold guard and press high punch to release a pulse. Jump or duck incoming pulses.',
    counterplay: 'Jump or duck the pulse, then close in during recovery.',
  },
} as const;
export function fighterStylePreference(
  recent: readonly { archetype: string; playStyle: string }[],
): FighterCombatProfile[] {
  const score = (style: string) =>
    recent.reduce(
      (n, g, i) => n + (g.archetype === 'fighter' && g.playStyle === style ? 1 / (i + 1) : 0),
      0,
    );
  return [...FIGHTER_COMBAT_PROFILES].sort((a, b) => score(a) - score(b));
}
export function fighterProfile(
  character: Pick<FighterCharacter, 'combatProfile'>,
): FighterCombatProfile | null {
  return character.combatProfile ?? null;
}
/** Authored kit comparison; all portraits and thirteen-pose atlases remain reusable. */
export function fighterStyleExample(base: FighterSpec, style: FighterCombatProfile): FighterSpec {
  const spec = structuredClone(base);
  spec.fighterStyle = style;
  spec.player.combatProfile = style;
  const offset = FIGHTER_COMBAT_PROFILES.indexOf(style);
  spec.levels.forEach((level, i) => {
    level.opponent.combatProfile = FIGHTER_COMBAT_PROFILES[(offset + i) % 3]!;
  });
  spec.boss.combatProfile = FIGHTER_COMBAT_PROFILES[(offset + 1) % 3]!;
  for (const character of [spec.player, ...spec.levels.map((l) => l.opponent), spec.boss]) {
    if (character.combatProfile === 'rangedControl')
      character.projectile ??= { kind: 'energyBlast', name: 'Energy blast' };
    else delete character.projectile;
  }
  return spec;
}
