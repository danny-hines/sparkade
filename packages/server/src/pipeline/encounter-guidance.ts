import {
  PLATFORMER_ENCOUNTERS,
  encounterPreference,
  encounterModifiers,
  platformerMechanics,
  type DesignDoc,
  type MechanicalFingerprint,
} from '@sparkade/shared';

export function encounterGuidance(
  design: DesignDoc,
  recent: readonly MechanicalFingerprint[] = [],
): string {
  const style = design.playStyle ?? 'acrobat';
  const kit = platformerMechanics(design);
  const patterns = encounterPreference(style, recent);
  return [
    `ENCOUNTER COMPOSITION: Use encounterRoute for every level. Structure: ${kit.structure}. Each level has only name, musicSong:"theme", encounterRoute:{orientation,direction,sections}. No authored tileRuns, towerRoute, tiles, entities, legend or anchors. The engine compiles them.`,
    'Choose 5–6 sections per level. Each section is {pattern,variant:0|1|2,challenge:"introduce"|"develop"|"test",enemy,reward,modifier}. First section introduces, last tests. Use at least THREE different patterns per level, with no identical adjacent patterns. Vary sequence, variants, direction, enemies and reward rhythm between levels. Start with easy encounters and place hearts before harder ones.',
    'Available catalog, least recently used first:\n' +
      patterns
        .map((id) => {
          const p = PLATFORMER_ENCOUNTERS[id];
          return `${id} (${p.orientation}; enemies ${p.enemies.join('/')}; modifiers ${encounterModifiers(id).join('/')}): ${p.description}`;
        })
        .join('\n'),
    'For tower structure every level is tower; horizontal structure every level is horizontal. Mixed structure requires at least one of each. Never mix horizontal and tower patterns inside one level. Tower direction selects the first climb face; switchback-climb flips the next face.',
    'Use 1–3 modified sections per horizontal level when appropriate to the requested fiction; other sections use none. Spring adds a launch to an optional high reward ledge. Moving-platform adds a horizontal ride above the safe lower route. Ice reduces traction; conveyor-forward assists progress and conveyor-backward resists it, relative to the level direction. Teach a modifier before its harder use. Tower sections use none so required wall climbs cannot be bypassed. Choose only each pattern’s listed modifiers and vary recent choices.',
    `Reward is coins, heart, or one of the SELECTED behaviors: ${(design.abilityLoadout ?? []).map((a) => a.kind).join(', ')}. Place every selected behavior in the game. Cover all four enemies (walker, flyer, shooter, chaser) across the three levels, using patterns that support them. Blasters need elevated and ground targets; melee needs supported jump-in approaches.`,
    ...(recent.length
      ? [
          `RECENT DELIVERED ENCOUNTERS: ${JSON.stringify(recent.map((g) => g.encounters.filter((s) => /^(pattern|variant|modifier):/.test(s))))}. Prefer less-used variants and different ordered sequences; explicit player requests still take precedence.`,
        ]
      : []),
  ].join('\n\n');
}
