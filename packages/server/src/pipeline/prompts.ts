import {
  FIGHTER_STYLE_CATALOG,
  FIGHTER_PROJECTILE_CATALOG,
  fighterStylePreference,
} from '@sparkade/shared';
// Server-side prompt assembly: loads the .md templates from
// packages/generation and fills their placeholders (schemas verbatim from
// @sparkade/shared, golden few-shot excerpts, anti-collision block).
import {
  SHOOTER_STYLE_CATALOG,
  shooterStylePreference,
  PRESENTATION_CATALOG,
  presentationPreference,
  PLATFORMER_STYLE_CATALOG,
  platformerStylePreference,
  type MechanicalFingerprint,
  ARCHETYPE_SCHEMAS,
  DESIGN_SCHEMA,
  LIB_BOSSES_ADVENTURE,
  LIB_BOSSES_PLATFORMER,
  LIB_BOSSES_SHOOTER,
  LIB_ENEMIES_GROUND,
  LIB_FOES_SHOOTER,
  LIB_HEROES_ADVENTURE,
  LIB_HEROES_PLATFORMER,
  LIB_HD_TILE_THEMES,
  LIB_ITEMS,
  LIB_NPCS,
  LIB_OBJECTS,
  LIB_PICKUPS,
  LIB_PROJECTILES,
  LIB_SHIPS,
  PALETTE_MOODS,
  stageSchema,
  type ArchetypeId,
  type CreationBrief,
  type DesignDoc,
} from '@sparkade/shared';
import { goldenExcerpt, loadGolden, loadTemplate, renderTemplate } from '@sparkade/generation';
import type { LintError } from '@sparkade/shared';
import { compactLevelsStageSchema } from './tile-runs';
import { encounterGuidance } from './encounter-guidance';

export interface BuiltPrompt {
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  /** Per-call timeout override (ms) for stages measured to run long. */
  timeoutMs?: number;
}

export type RepairOwner = 'levels' | 'entities' | 'music' | 'document';

// NOTE ON STRUCTURE: every builder keeps the SYSTEM prompt byte-identical
// across calls and games (rules + schema + golden excerpt) and puts all
// variable content in the USER message. Meta's automatic prefix caching then
// bills the big static prefix at the cached rate ($0.15/M vs $1.25/M).

/** Static palette cookbook for the design system prompt (kept byte-identical for caching). */
const PALETTE_COOKBOOK = PALETTE_MOODS.map(
  (m) => `- ${m.name} — ${m.hint}\n  [${m.colors.join(', ')}]`,
).join('\n');

export function buildDesignPrompt(opts: {
  promptText: string;
  hasPhoto: boolean;
  describeInStory: boolean;
  antiCollision: { title: string; tagline: string; key?: string }[];
  recentMoods?: string[];
  recentMechanics?: MechanicalFingerprint[];
  creationBrief?: CreationBrief;
  extraNote?: string;
}): BuiltPrompt {
  const anti = opts.antiCollision.length
    ? opts.antiCollision
        .map((g) => `- "${g.title}" — ${g.tagline}${g.key ? ` (music: ${g.key})` : ''}`)
        .join('\n')
    : '- (none yet — this is the first generated game)';
  const likenessNotes = opts.hasPhoto
    ? opts.describeInStory
      ? 'The photo is attached. You MAY reference only directly observable visual features (hair, glasses, clothing colors) in story text. NEVER identify the person or infer ethnicity, age, health, or any sensitive attribute.'
      : 'The photo stays on the device and is NOT attached; write the hero as "you" without describing appearance.'
    : 'No photo; invent the hero look freely.';
  const system = renderTemplate(loadTemplate('design'), {
    GOLDEN_EXCERPT: safeExcerpt('platformer', 'design'),
    PALETTE_COOKBOOK,
    SCHEMA: JSON.stringify(DESIGN_SCHEMA, null, 1),
  });
  const moodNote = opts.recentMoods?.length
    ? `RECENT PALETTE MOODS on this cabinet (choose a clearly different hue family): ${[...new Set(opts.recentMoods)].join(', ')}.`
    : '';
  const creationBrief = opts.creationBrief
    ? [
        'APPROVED CREATION BRIEF (authoritative):',
        `HERO NAME: ${opts.creationBrief.heroName ?? '(Spark decides)'}`,
        `GAME TYPE: ${opts.creationBrief.archetype ?? '(Spark decides)'}`,
        `ADDITIONAL DETAILS: ${opts.creationBrief.details ?? '(Spark decides)'}`,
        ...(opts.creationBrief.heroName
          ? ['Preserve the supplied hero name exactly in story text.']
          : ['Invent a fitting hero name.']),
        ...(opts.creationBrief.archetype
          ? [
              `Design every level, control implication, character, and story beat for the required ${opts.creationBrief.archetype} archetype.`,
            ]
          : ['Choose the archetype that best fits the approved player input.']),
        ...(opts.creationBrief.details
          ? ['Honor the supplied story, enemy, setting, and aesthetic details.']
          : ['Invent an original story, enemies, setting, and aesthetic.']),
      ].join('\n')
    : '';
  const user = [
    `PLAYER REQUEST:\n${opts.promptText.slice(0, 1200)}`,
    ...(creationBrief ? [creationBrief] : []),
    `PHOTO FOR LIKENESS: ${opts.hasPhoto ? 'yes' : 'no'}. ${likenessNotes}`,
    `GAMES ALREADY ON THIS CABINET (be clearly different):\n${anti}`,
    ...(opts.recentMechanics?.length
      ? [
          `RECENT GAME MECHANICS (newest first; prioritize different decisions, objectives and topology over cosmetic differences):\n${JSON.stringify(opts.recentMechanics)}`,
          `PLATFORMER STYLE PREFERENCE (least recently used first): ${platformerStylePreference(opts.recentMechanics).join(', ')}. This is a preference only: explicit requested mechanics take precedence.`,
        ]
      : []),
    `PLATFORMER PRESENTATION PREFERENCE (least recently used first): ${presentationPreference(opts.recentMechanics ?? []).join(', ')}. Choose independently of playStyle; explicit aesthetic requests take precedence. Only platformer supports presentationFamily.`,
    `VERTICAL SHOOTER STYLE PREFERENCE (least recently used first): ${shooterStylePreference(opts.recentMechanics ?? []).join(', ')}. Explicit requested mechanics take precedence.`,
    `SHOOTER STYLE CATALOG: ${JSON.stringify(SHOOTER_STYLE_CATALOG)}`,
    `ADVENTURE STYLE PREFERENCE (least recently used first): ${adventureStylePreference(opts.recentMechanics ?? []).join(', ')}. Explicit objective requests take precedence.`,
    `FIGHTER STYLE PREFERENCE (least recently used first): ${fighterStylePreference(opts.recentMechanics ?? []).join(', ')}. Explicit requests take precedence. Choose fighterStyle for Fighter only. CATALOG: ${JSON.stringify(FIGHTER_STYLE_CATALOG)}`,
    `ADVENTURE STYLE CATALOG: ${JSON.stringify(ADVENTURE_STYLE_CATALOG)}. Select adventureStyle for Adventure only.`,
    `PRESENTATION CATALOG: ${JSON.stringify(PRESENTATION_CATALOG)}`,
    ...(moodNote ? [moodNote] : []),
    ...(opts.extraNote ? [`IMPORTANT: ${opts.extraNote}`] : []),
    'Design the game now.',
  ].join('\n\n');
  return { system, user, jsonSchema: DESIGN_SCHEMA, maxTokens: 4000 };
}

const designAbilityLoadoutSchema = (
  DESIGN_SCHEMA as {
    properties: { abilityLoadout: Record<string, unknown> };
  }
).properties.abilityLoadout;

const PLATFORMER_ABILITY_LOADOUT_COMPLETION_SCHEMA = {
  type: 'object',
  properties: {
    abilityLoadout: {
      ...designAbilityLoadoutSchema,
      type: 'array',
      minItems: 1,
      maxItems: 2,
    },
  },
  required: ['abilityLoadout'],
  additionalProperties: false,
};

/** Focused recovery for an otherwise usable platformer design that omitted the
 * required ability selection. Keeping this response tiny is cheaper and less
 * destructive than asking the model to rewrite the full design document. */
export function buildPlatformerAbilityLoadoutPrompt(design: unknown): BuiltPrompt {
  const source =
    design !== null && typeof design === 'object'
      ? (design as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const context = {
    playStyle: source['playStyle'],
    mechanics: source['mechanics'],
    title: source['title'],
    tagline: source['tagline'],
    heroConcept: source['heroConcept'],
    story: source['story'],
    levelPlan: source['levelPlan'],
  };
  const system = [
    'You are completing one missing field in an already-authored Sparkade platformer design.',
    'Choose one or two DISTINCT supported engine behaviors that best fit the premise: doubleJump, projectile, or shield.',
    'Respect playStyle: runAndGun and armedClimber must include projectile; armedClimber excludes doubleJump; meleeAction must exclude projectile; towerClimber selects shield only. An absent playStyle means acrobat.',
    'Give each a short premise-specific name and a concrete visualConcept. Do not invent new behavior kinds or redesign any other part of the game.',
    'Return raw JSON matching this schema, with no prose or markdown:',
    JSON.stringify(PLATFORMER_ABILITY_LOADOUT_COMPLETION_SCHEMA, null, 1),
  ].join('\n');
  const user = `EXISTING DESIGN CONTEXT:\n${JSON.stringify(context)}\n\nComplete abilityLoadout now.`;
  return {
    system,
    user,
    jsonSchema: PLATFORMER_ABILITY_LOADOUT_COMPLETION_SCHEMA,
    maxTokens: 500,
  };
}

export function buildLevelsPrompt(
  archetype: ArchetypeId,
  design: DesignDoc,
  diagnostics: readonly LintError[] = [],
  recentMechanics: readonly MechanicalFingerprint[] = [],
): BuiltPrompt {
  const compact = archetype === 'platformer' || archetype === 'hshooter';
  const schema = compact
    ? compactLevelsStageSchema(archetype, archetype === 'platformer')
    : stageSchema(archetype, 'levels');
  const renderedSystem = renderTemplate(loadTemplate(`levels-${archetype}`), {
    GOLDEN_EXCERPT: compact
      ? safeCompactLevelsExcerpt(archetype)
      : safeExcerpt(archetype, 'levels'),
    SCHEMA: JSON.stringify(schema, null, 1),
  });
  const system =
    archetype === 'platformer'
      ? renderedSystem
      : compact
        ? `${renderedSystem}\n\n## Compact tile rows\n\nThe output schema deliberately replaces each level's literal \`tiles\` strings with \`tileRuns\`. For every visual row, emit a left-to-right array of two-item \`[tile,count]\` tuples, for example \`[[".",72],["#",8]]\`. Adjacent tuples reconstruct the row; all expanded rows in a level must have the same total width. This compact form is compiled to ordinary tile strings by the engine.`
        : renderedSystem;
  return {
    system,
    user: [
      `DESIGN DOCUMENT:\n${JSON.stringify(design, null, 1)}`,
      ...(archetype === 'shooter' ? [shooterStyleBrief(design)] : []),
      ...(archetype === 'adventure' ? [adventureStyleBrief(design)] : []),
      ...(archetype === 'fighter' ? [fighterStyleBrief(design)] : []),
      ...(archetype === 'platformer'
        ? [platformerStyleBrief(design), encounterGuidance(design, recentMechanics)]
        : []),
      diagnostics.length
        ? `THE PREVIOUS LEVEL OUTPUT FAILED THESE CHECKS. Build a fresh set that specifically avoids them:\n${formatDiagnostics(diagnostics)}`
        : '',
      'Write the levels JSON now.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    jsonSchema: schema,
    // Live Muse runs showed compact platformer levels completing at 8,839
    // tokens after two replies hit the previous 9,000-token wire ceiling
    // (7,500 output + 1,500 minimal-reasoning headroom). Give this stage a
    // measured margin so a healthy three-level document does not pay for a
    // full retry; Meta adds its reasoning headroom in the provider adapter.
    maxTokens: archetype === 'hshooter' ? 9000 : archetype === 'platformer' ? 9000 : 14000,
    // Levels are the heaviest artifact (measured live: Muse Spark regularly
    // needs >90s for platformer tile grids). 150s here deviates from the 90s
    // default deliberately — without it, platformer generation cannot complete.
    timeoutMs: 150_000,
  };
}

export function shooterStyleBrief(design: Pick<DesignDoc, 'shooterStyle'>): string {
  const style = design.shooterStyle ?? 'chargeSpecialist';
  return `COMMITTED SHOOTER KIT: ${style}. ${SHOOTER_STYLE_CATALOG[style].summary} Preserve shooterStyle through every repair. Every level needs two signature waves including one by 20s: weaponSwitch needs BOTH wideSwarm (line/vee/arc, count>=4, hp<=2) AND armorColumn (column, count>=2, hp>=3, dive); chargeSpecialist needs armorColumn; lockOnStriker needs lockScreen (non-column formation, count>=3, hold). Author centerX lanes. Switching and lock-on bosses require at least two pods. weaponSwitch rewards use rapid/shield/bomb, never spread. The engine owns weapon balance and the 4.8s attack / 2.4s boss opening cycle; do not invent numeric weapon fields or additional abilities.`;
}

export function fighterStyleBrief(design: Pick<DesignDoc, 'fighterStyle'>): string {
  return `COMMITTED FIGHTER STYLE: ${design.fighterStyle ?? 'rushdown'}. Preserve this fighterStyle and player.combatProfile through repair. All five characters need combatProfile: rushdown, counter, or rangedControl. The three ladder opponents must use all three profiles; the boss gets one profile. Rushdown confirms low punch > high punch > high kick. Counter uses a fresh timed guard then retaliation. Ranged control uses guard + high punch for a limited, telegraphed energy pulse which can be jumped or ducked. All profiles have a short low-punch > high-punch chain. Frame data, damage scaling, guard windows, cooldowns, and escape rules belong to the engine; do not invent moves. Keep the signature plausible in each character's theme. Each rangedControl character MUST author projectile {kind, name}: choose from ${JSON.stringify(FIGHTER_PROJECTILE_CATALOG)}. Give it a short in-world name (18 ASCII characters maximum) and explain its power source in visualConcept and the story. A furnace champion should cast fireball, an electric engineer arcBolt, an ice guardian frostShard, a mystic spiritOrb; choose energyBlast for chi or plasma. Never assign a generic pellet or an arbitrary element disconnected from the plot. Non-ranged characters omit projectile. These are distinct animated pixel effects, not new damage/speed values. Existing punch, kick, and block poses animate these mechanics; pulse energy is drawn by the runtime, never baked into the hero atlas. Teach the current opponent's counterplay in stage introductions. Do not change the chosen player style during repairs.`;
}

export function adventureStyleBrief(design: Pick<DesignDoc, 'adventureStyle'>): string {
  const style = design.adventureStyle ?? 'dungeonExpedition';
  return (
    `COMMITTED ADVENTURE OBJECTIVE: ${style}. ${ADVENTURE_STYLE_CATALOG[style].objective} Preserve adventureStyle through every repair. ` +
    (style === 'puzzleQuest'
      ? 'Author at least four puzzle rooms including bossRoom as the final chamber. Use all three puzzle patterns: pushLane, cornerTurn, splitPlates; each has variant 0, 1, or 2 for mirrored approaches. In puzzle rooms provide puzzle:{pattern,variant} instead of tiles/legend; the engine compiles safe complete 32x16 geometry. Put no enemies there; pickups/NPCs must be outside x6..25,y4..11 and clear of doorway reaction zones. Non-puzzle rooms have at most two enemies; at least two enemy types overall. A teaching puzzle must be reachable before the first locked gate. All preliminary puzzles must be reachable without entering bossRoom. The final chamber is a puzzle, with no boss combat; describe its generated guardian as the seal keeper. At least two keyed gates and the secondary tool remain required, but final entry also requires every preliminary seal solved. X resets only the current unsolved room without restoring health or score.'
      : style === 'rescueRaid'
        ? 'Set levels[0].rescueTarget to 3..8. Place at least target+1 NPCs with props.rescue:true and short rescue dialog across at least three rooms reachable before bossRoom. Extras are optional score opportunities. Teach rescue in the entrance or an openly connected room before any locked gate. The boss gate requires the quota, secondary tool, and a key. Defeating the guardian does not end play: the player must return to the entrance center and press A to extract. Keep x15..17,y7..9 in startRoom connected calm floor and keep entities outside x14..18,y6..10. There is no escort pathfinding: rescued NPCs leave immediately and stay rescued after death/re-entry. Give the room graph a branch for optional rescues. Use the existing NPC atlas role for captives; no extra image roles.'
        : 'Keep the tool-and-key dungeon progression, four enemy types, two keyed gates, readable combat encounters, and the guardian duel. Do not add captive markers, rescueTarget, or puzzle-pattern metadata. Ordinary switch puzzles remain available.')
  );
}

export function platformerStyleBrief(
  design: Pick<DesignDoc, 'playStyle' | 'mechanics' | 'chargeShot'>,
): string {
  const style = design.playStyle ?? 'acrobat';
  const recipe = PLATFORMER_STYLE_CATALOG[style];
  return (
    `GAMEPLAY PACKAGE: ${style} (${recipe.name}). ${recipe.summary} Objective: ${recipe.objective}. ` +
    (design.chargeShot === 'none'
      ? 'WEAPON OVERRIDE: No charging. X and Y both fire; do not describe charge attacks or energy buildup. '
      : '') +
    (style === 'armedClimber'
      ? `Combine the permanent blaster and wall jump. Structure: ${design.mechanics?.structure ?? 'mixed'}. Mixed means at least one horizontal encounter route and at least one tower encounter route, with the summit at least 24 rows above spawn. For tower structure use three towers; for horizontal structure use three horizontal stages with exposed walls for dodges. Tower climbs must require wall jumping with continuous solid wall faces, two clear body rows, supported approaches within four tiles and safe rest ledges; ordinary jumps cannot bypass the climb. Include checkpoints at different heights. Put ranged enemies on ledges and across open shafts, leave room to land, and teach shooting away from a wall and keeping charge through wall jumps. Use precision movement and projectile plus optional shield, never doubleJump. Contact hurts from all directions. A jumps/wall jumps, B runs, Y fires, X charges, UP aims upward. Runtime generates ground, running, airborne, and wall-shoot poses.`
      : style === 'towerClimber'
        ? 'Use 32-40 columns and 48-96 rows. Spawn near the bottom, exit at least 24 rows above it. Build continuous exposed solid walls with clear approach space and rest ledges. A hero can hold toward one wall and repeatedly jump up it; no alternating-wall trick is required. Place each wall within four tiles of a supported approach and provide a wide landing at its top. Vary climb height, approach direction and threats between ledges. Wall jumping is permanent and may be REQUIRED. Use several short climb encounters, two safe checkpoints at different heights, and at least one climb that ordinary jumps cannot bypass. No required double jumps, springs or moving platforms. Keep the upward sightline clear. Alternate safe teaching, threats on ledges, and recovery.'
        : style === 'runAndGun'
          ? 'Build readable shooting lanes, overhead targets reachable with UP+Y, and cover/approach choices. Introduce the permanent blaster immediately. Select projectile in abilityLoadout; its pickup replenishes health because the blaster is already equipped. Ordinary enemies must be defeated with ranged attacks; stomping causes damage. Avoid unavoidable contact at spawns or landings.'
          : style === 'meleeAction'
            ? 'Build close encounters on broad supported ledges with space to approach, strike and retreat. The permanent Y-button energy strike has a windup and recovery, and checks for hits throughout its active window. An active descending strike damages the enemy or boss and bounces the player safely; landing without an active strike causes damage. Include jump-in approaches and room to dodge shooter projectiles. Use close enemy placement that allows an attack before contact. Do not promise held swords or whips; the signature strike is a subtle pixel energy wave. Select shield and/or doubleJump pickups, never projectile.'
            : 'Emphasize jump sequences, enemy bounces, momentum, secrets and different terrain silhouettes. Selected powerups enrich an ordinary-jump route.')
  );
}

/**
 * One-line SHAPE descriptors for every library body (color always comes from
 * the game palette, so descriptors never mention color). These are static —
 * they live in the system prompt, which must stay byte-identical for caching.
 */
const SPRITE_DESC: Record<string, string> = {
  hero_squire: 'rounded knight — steel helm, tabard, sword grip on back',
  hero_gadget: 'wind-up robot kid — bright face plate, wind-up key on back',
  hero_ranger: 'hooded scout — hood and light trailing scarf',
  hero_miner: 'hard-hat miner — head lamp, rucksack, pick over shoulder',
  hero_astro: 'puffy spacesuit — chest panel, tank backpack, antenna',
  hero_ninja: 'wrapped tunic — long trailing scarf, arm wraps',
  hero_wander: 'traveler — tunic, shoulder strap, hip satchel',
  hero_scout: 'feathered cap — laced tunic, quiver on the back',
  hero_sage: 'robed apprentice — goggle eyes, rope belt, swaying hem',
  hero_paladin: 'heavy pauldrons, tabard, kite shield on the back',
  hero_druid: 'leafy shoulder cloak, gnarled staff across the back',
  hero_tinker: 'tool-harness straps, hip wrench, goggles band',
  ship_dart: 'sleek arrow interceptor — swept delta wings, single engine',
  ship_falcon: 'broad winged fighter — big canopy, twin engines',
  ship_bloom: 'round garden pod — petal fins, sprout on top',
  ship_saucer: 'flying saucer — dome canopy, rim lights',
  ship_manta: 'wide manta-ray wing — twin tail fins',
  ship_hammer: 'hammerhead — broad forward prongs, heavy hull',
  enemy_walker: 'round grumpy critter with stubby feet',
  enemy_flyer: 'bat — wings flap between frames',
  enemy_shooter: 'bunkered turtle-cannon',
  enemy_chaser: 'spiky darting ball',
  enemy_bruiser: 'heavy blocky brute',
  enemy_slime: 'squashy blob with a glossy highlight',
  enemy_beetle: 'dome-armored crawler with a row of little legs',
  enemy_wisp: 'hovering spirit-flame — clearly airborne (great flyer skin)',
  foe_popcorn: 'small round drone with one big eye',
  foe_weaver: 'slim dart with swept fins',
  foe_tank: 'armored slab with a pulsing core',
  foe_turret: 'round pod with a rotating barrel',
  foe_kamikaze: 'missile with an angry eye',
  foe_drone: 'quad-rotor drone — X-shaped arms, center eye',
  foe_ray: 'crescent manta craft — lit wingtips',
  foe_orbiter: 'ringed orb mine — tilting orbital ring',
  boss_titan: 'armored golem-king with a glowing core',
  boss_drake: 'wingless drake — horned head low, furnace chest',
  boss_knight: 'giant fallen knight — tower shield, greatsword',
  boss_thorn: 'snapping carnivorous plant — fanged bulb, thorned vines',
  boss_leviathan: 'segmented sky-serpent gunship',
  boss_fortress: 'broad flying fortress — wing turrets, reactor core',
  boss_hive: 'chitin swarm queen — egg pods along the wings',
  boss_prism: 'faceted crystal dreadnought — central beam emitter',
  boss_warden: 'cloaked specter-warden with a staff',
  boss_minotaur: 'bull-horned brute dragging a great axe',
  boss_lich: 'crowned skeletal sorcerer — orbiting soul-flames',
  boss_spider: 'eight-legged broodmother — marked abdomen',
  boss_kraken: 'cephalopod horror — bulbous mantle, six splaying tentacles, hard beak',
  boss_wraith: 'hooded reaper — black cowl over a void face with burning eyes',
  boss_ooze: 'crowned slime king — gelatinous dome, drippy underside, glowing core',
  boss_automaton: 'clockwork colossus — boxy iron body, great gear in the chest, piston arms',
  boss_cyclops: 'one-eyed brute — broad body, thick fists, single huge eye',
  boss_toad: 'giant toad — squat wide body, bulging eyes, cavernous tongued maw',
  boss_treant: 'walking tree — leafy crown, knotted trunk face, branch arms, roots',
  boss_beholder: 'floating eye-horror — central sphere, giant eye + fanged maw, eye-stalks',
  boss_demon: 'winged devil — horned head, strutted bat wings, hooved legs',
  boss_hydra: 'three-headed serpent — bulbous body, serpentine necks, snapping heads',
  boss_pharaoh: 'mummy king — striped nemes headdress, bandaged body, crook & flail',
  boss_yeti: 'shaggy snow-beast — furry mass, horned head, fanged roar, claws',
  boss_scorpion: 'armored scorpion — forward pincers, segmented tail with a glowing sting',
  boss_gorgon: 'medusa — bust with a nest of snake-hair and a coiled serpent tail',
  boss_saucer: 'flying saucer — glass dome on a wide lit disc, tractor beam',
  boss_core: 'battle-station core — a vast reactor eye ringed by turrets',
  boss_dreadnought: 'heavy warship — long armored hull, stern engines, side gun decks',
  boss_mecha: 'war-mech — round core cockpit with four clawed limbs',
  boss_wasp: 'bio-mech wasp — striped abdomen, glassy wings, barbed sting',
  boss_bomber: 'swept-wing gunship — broad delta wings, engine pods, bomb-bay glow',
  npc_keeper: 'robed keeper',
  npc_elder: 'bent elder — cane and long beard',
  npc_merchant: 'trader under a towering backpack of wares',
  npc_ghost: 'hovering lantern ghost — wisp tail, no legs',
  npc_tinker: 'round robot vendor — antenna, tray of parts',
  obj_spring: 'launch pad',
  obj_platform: 'rideable platform slab',
};

function annotated(ids: readonly string[]): string {
  return ids.map((id) => `  ${id} — ${SPRITE_DESC[id] ?? '(self-describing)'}`).join('\n');
}

/** Static backdrop guidance shared by all three archetypes (system prompt). */
const BACKDROP_NOTE = `BACKDROP — set the top-level "backdrop" field to the parallax scene behind gameplay (procedurally drawn in your palette's background colors): starfield (deep space + planet), hills (rolling countryside), clouds (open sky), caves (cavern silhouette), mountains (snow-capped peaks), candy (lollipop hills + sprinkles), city (futuristic lit skyline + monorail), ruins (shattered towers + rubble), pyramids (dunes + stepped monuments), circuit (inside a computer — grid + traces), factory (smokestacks, gantries, pipes). Pick the scene that matches the premise; omit only if none fit.

WEATHER (optional) — set the top-level "weather" field for a subtle ambient particle overlay in your palette colors: rain, storm (heavy driving rain), snow, embers (rising sparks — fire/volcano), ash (falling grey flecks — ruins/aftermath), leaves (autumn/forest), petals (blossom/candy), fog (drifting mist), bubbles (undersea), fireflies (glowing night motes), dust (drifting desert/dungeon motes). Choose one that reinforces the mood, or "none"/omit for clear air. It's atmosphere — don't let it fight the gameplay.

LIGHTING (optional) — set the top-level "lighting" field to wash the scene in a mood: dawn (soft warm), dusk (orange sunset), night (deep blue), gloom (murky green-grey). Match the premise's time of day / tone, or "none"/omit for plain daylight.

JUICE (optional) — set the top-level "juice" number (0–1.5) to scale screen-shake intensity: ~0.5 for a calm or cozy game, 1 (default) for most, up to ~1.4 for a punchy action game. Omit for the default feel.`;

const SHOOTER_BACKDROP_NOTE = `BACKDROP — this vertical shooter flies over the scene, so use ONLY one of: deepspace (star sea + planets), nebula (glowing gas clouds), asteroids (drifting rock field), ocean (open sea under clouds), metropolis (night rooftops), canyon (rocky gorge), swamp (toxic bog), tundra (cracked ice). Do not use the side-view backdrop names starfield, circuit, city, hills, or factory. Pick the scene that matches the premise; omit only if none fit.${BACKDROP_NOTE.slice(BACKDROP_NOTE.indexOf('\n\nWEATHER'))}`;

const ADVENTURE_ENVIRONMENT_NOTE = `ENVIRONMENT FAMILY — set the top-level "backdrop" field only as a semantic material and atmosphere hint for the later generated top-down room surfaces: starfield (space-station or astral), hills (countryside), clouds (sky realm), caves (cavern), mountains (alpine), candy (confectionery), city (urban), ruins (ancient remains), pyramids (desert), circuit (digital), factory (industrial). Adventure does NOT draw a procedural panoramic backdrop around its full-width rooms. Pick the closest family to the premise; omit only if none fit.${BACKDROP_NOTE.slice(BACKDROP_NOTE.indexOf('\n\nWEATHER'))}`;

/** Per-archetype library menus (annotated, grouped) + reskinnable-slot documentation. */
function spriteMenu(archetype: ArchetypeId): { libList: string; reskinNotes: string } {
  const small = [...LIB_PROJECTILES, ...LIB_PICKUPS].join(', ');
  const byArchetype: Record<ArchetypeId, string> = {
    platformer: [
      '\nHERO BODIES (side view; all take the generated likeness head — identity lives in the body):',
      annotated(LIB_HEROES_PLATFORMER),
      'ENEMY BODIES (any body can skin any behavior role):',
      annotated(LIB_ENEMIES_GROUND),
      'BOSSES (front-facing figures, arena-scale) — pick the SILHOUETTE that fits your premise and differs from recent games; do not reflexively pick boss_titan:',
      annotated(LIB_BOSSES_PLATFORMER),
      'OBJECTS:',
      annotated(LIB_OBJECTS),
      `SMALL ART (self-describing): ${small}`,
    ].join('\n'),
    shooter: [
      '\nSHIPS (top-down, pointing up; all take the generated likeness head in the canopy):',
      annotated(LIB_SHIPS),
      'FOE BODIES (top-down; any body can skin any behavior role):',
      annotated(LIB_FOES_SHOOTER),
      'BOSSES (top-down craft, screen-wide) — pick the one that fits your premise and differs from recent games:',
      annotated(LIB_BOSSES_SHOOTER),
      `SMALL ART (self-describing): ${small}`,
    ].join('\n'),
    adventure: [
      '\nHERO BODIES (top-down 3/4; all take the generated likeness head — identity lives in the body):',
      annotated(LIB_HEROES_ADVENTURE),
      'ENEMY BODIES (any body can skin any behavior role):',
      annotated(LIB_ENEMIES_GROUND),
      'BOSSES (front-facing figures, chamber-scale) — pick the SILHOUETTE that fits your premise and differs from recent games:',
      annotated(LIB_BOSSES_ADVENTURE),
      'NPCS:',
      annotated(LIB_NPCS),
      `ITEMS: ${LIB_ITEMS.join(', ')}`,
      `SMALL ART (self-describing): ${small}`,
    ].join('\n'),
    hshooter: [
      '\nCOMPATIBILITY-ONLY SHIP ASSIGNMENTS (unused by newly generated H-scroll games, whose player craft is required generated art):',
      annotated(LIB_SHIPS),
      'COMPATIBILITY-ONLY FOE ASSIGNMENTS (unused by newly generated H-scroll games, whose five-role cast is required generated art):',
      annotated(LIB_FOES_SHOOTER),
      'COMPATIBILITY-ONLY BOSS ASSIGNMENTS (unused by newly generated H-scroll games, whose finale boss is required generated art):',
      annotated(LIB_BOSSES_SHOOTER),
      `SMALL ART (self-describing): ${small}`,
    ].join('\n'),
    fighter: [
      '\nFIGHTER APPEARANCES DO NOT USE sprites.assign body art. Set sprites.assign.hero and sprites.assign.boss to any library sprite (both are unused schema placeholders), e.g. "hero": "lib:hero_squire", "boss": "lib:boss_titan". A later image-asset stage generates one complete 13-state atlas for the player, three ladder opponents, and boss from their required visualConcept, build, outfit family, and palette colorSlot. A supplied photo is identity truth for the player. The five-atlas roster is atomic and generation fails if any character remains incomplete. Never add unsupported face fields or encode the player as a custom sprite.',
    ].join('\n'),
  };
  const tileRoles: Record<ArchetypeId, string[]> = {
    platformer: [
      'tile_solid',
      'tile_solid_inner',
      'tile_platform',
      'tile_hazard',
      'tile_checkpoint',
      'tile_exit',
      'tile_deco',
    ],
    shooter: [],
    adventure: [
      'tile_wall',
      'tile_floor',
      'tile_hazard',
      'tile_block',
      'tile_pit',
      'tile_switch',
      'tile_deco',
      'tile_door_locked',
      'tile_door_boss',
      'tile_door_open',
    ],
    hshooter: ['tile_solid', 'tile_solid_inner', 'tile_hazard', 'tile_deco'],
    fighter: [],
  };
  const extraRoles: Record<ArchetypeId, string> = {
    platformer:
      "Also reskinnable via assign: projectile (your hero's shot), enemy_projectile, obj_spring, obj_platform.",
    shooter:
      "Also reskinnable via assign: projectile (your ship's shot), enemy_shot, pod (boss side-turrets), pickup_spread, pickup_rapid, pickup_shield, pickup_bomb.",
    adventure:
      'Also reskinnable via assign: proj_arrow (shot behavior), proj_wave (primary impact), item_boomerang (returning behavior), proj_bomb (blast behavior), enemy_shot.',
    hshooter:
      "Also reskinnable via assign: projectile (your ship's shot), enemy_shot, pod (boss side-turrets), pickup_spread, pickup_rapid, pickup_shield, pickup_bomb.",
    fighter:
      'Nothing to reskin — Fighter bodies come from the required generated roster atlases. The player and ladder roster are authored by the levels pass. Here, make the boss unmistakable with a concrete visualConcept plus a distinct build, outfit, and colorSlot.',
  };
  const roles = tileRoles[archetype];
  const connectedSolidNote =
    archetype === 'platformer' || archetype === 'hshooter'
      ? `
CONNECTED SOLID PAIR: \`tile_solid\` is the exposed cap and \`tile_solid_inner\` is the buried fill. Assign both from the SAME family (for example \`"tile_solid": "lib:ice_solid"\` plus \`"tile_solid_inner": "lib:ice_solid_inner"\`) or draw a matching custom pair. Each custom cap and inner sprite must be EXACTLY 16×16 and fully opaque. The cap must tile seamlessly left-to-right; the inner must tile seamlessly on both axes, and the cap's bottom edge must join the inner's top edge. Level generation still authors only semantic \`solid\` cells; the engine selects the cap or inner body art from neighbouring solid cells. Never invent separate cap/inner level characters or legend values.
`
      : '';
  const platformerImageFallbackNote =
    archetype === 'platformer'
      ? `
IMAGE-FIRST CHARACTER FALLBACKS: a later Muse Image stage authors the visible platformer boss and all four ordinary enemies. Set \`boss\`, \`walker\`, \`flyer\`, \`shooter\`, and \`chaser\` to appropriate \`lib:\` sprites as stable fallbacks; do NOT draw custom sprites for those roles. For platformer, this overrides the generic signature-sprite examples above. Spend any bespoke custom-pixel budget on terrain or a gameplay object that remains visible after generated character art loads.
`
      : '';
  const hshooterGeneratedCharacterNote =
    archetype === 'hshooter'
      ? `
REQUIRED IMAGE-GENERATED COMBATANTS: a later Muse Image stage authors the visible player craft, finale boss, and complete popcorn/weaver/tank/turret/kamikaze enemy cast. Their \`sprites.assign\` entries remain required compatibility placeholders for the schema and old saved games only; newly generated H-scroll games never display them. Do NOT draw custom sprites for those roles. Spend bespoke custom-pixel budget on terrain or a small gameplay object that remains visible after the generated atlas loads.
`
      : '';
  const familyKinds =
    archetype === 'platformer' || archetype === 'hshooter'
      ? archetype === 'platformer'
        ? 'solid/solid_inner/platform/hazard/checkpoint/exit/deco'
        : 'solid/solid_inner/hazard/deco'
      : 'solid/platform/hazard/checkpoint/exit/deco/wall/floor/block/pit/switch/door_locked/door_boss/door_open';
  const hdFamilies = LIB_HD_TILE_THEMES.map((theme) => `${theme}_*`).join(', ');
  const highDensityNote =
    archetype === 'platformer' || archetype === 'hshooter'
      ? ` These side-view archetypes also have image-authored ${hdFamilies}; they cover solid/solid_inner/platform/hazard/checkpoint/exit/deco and are automatically rendered at high density.`
      : archetype === 'adventure'
        ? " Adventure automatically renders the selected core family's wall/pit/block/hazard/deco material at high density with top-down connected edges and spatial variation. The selected floor is a compact resilience fallback; a later Muse Image stage authors the visible room-scale surface plates."
        : '';
  const reskinNotes =
    (roles.length
      ? `TERRAIN RESKIN — the strongest identity lever after the palette. ALWAYS reskin the terrain — assigning every tile slot is expected, not optional. The example just shows one family for format; pick the family that fits THIS game's world and never leave the tiles on the plain default. Each tile slot (${roles.join(', ')}) can be re-assigned:
- to a THEMED library family: castle_*, cave_*, wasteland_*, alien_*, ice_*, desert_*, clockwork_* (brass machinery), candy_* (confectionery), coral_* (undersea reef), garden_* (overgrown greenery) — e.g. "tile_solid": "lib:ice_solid". Every core family has every kind (${familyKinds}).${highDensityNote} Pick the family whose material and shapes fit the premise and stay within ONE family for coherence.
- or to a custom 16×16 sprite you draw (must be EXACTLY 16×16; solid/wall/floor tiles should be fully opaque and tile seamlessly edge-to-edge). When unsure, use a themed family — it always looks professional.
${connectedSolidNote}${platformerImageFallbackNote}${hshooterGeneratedCharacterNote}`
      : 'This archetype has no terrain tiles; its look comes from palette, backdrop, ship/foe sprites and wave choreography.\n') +
    extraRoles[archetype] +
    '\n\n' +
    (archetype === 'shooter'
      ? SHOOTER_BACKDROP_NOTE
      : archetype === 'adventure'
        ? ADVENTURE_ENVIRONMENT_NOTE
        : BACKDROP_NOTE);
  return { libList: byArchetype[archetype], reskinNotes };
}

/** lib refs / backdrop ids used by recent games — body-level anti-collision. */
export interface RecentUse {
  heroes: string[];
  bosses: string[];
  backdrops: string[];
}

export function buildEntitiesPrompt(
  archetype: ArchetypeId,
  design: DesignDoc,
  hasPhoto: boolean,
  recentUse?: RecentUse,
  diagnostics: readonly LintError[] = [],
): BuiltPrompt {
  const schema = stageSchema(archetype, 'entities');
  const bossNotes: Record<ArchetypeId, string> = {
    platformer:
      'Attacks vocabulary: stomp (leap + shockwave), charge (dash), spread (projectile fan), summon (minions). tempo 0.5–2 scales speed. Optionally set boss.arena to a custom fight room (same tile format as a level) themed to the finale — it MUST have solid wall columns on the far left/right and a solid floor across the bottom two rows; leave open space to move. Omit it for the default arena.',
    shooter:
      'Bullet patterns: fan, spiral, walls (rows with a gap), aimed. pods are destructible side turrets. bulletSpeed multiplies base speed.',
    adventure:
      "Patterns: charge (telegraphed dash), teleport (vanish + radial burst), spiral (rotating bullets), summon (minions). tempo 0.5–2 scales speed. The hero always has the design document's named B-button primary melee equipment and must collect its named Y-button secondary item before this fight. Keep HP between 18 and 32 so the finale rewards pattern mastery without becoming an endurance test.",
    hshooter:
      'Bullet patterns: fan, spiral, walls (a vertical bullet column with a gap), aimed. The boss flies in from the right of an open arena. pods are destructible turrets. bulletSpeed multiplies base speed.',
    fighter:
      'The boss is the final ladder fighter: use colorSlot 11 (the roster pass reserves it), author its build and outfit, give it more HP (100-200), and add 2-3 rage phases (aggression 0.8-2, rising as its HP drops). Prefer the armor outfit so its padded silhouette dominates the ladder; do not invent face details or moves.',
  };
  const menu = spriteMenu(archetype);
  const system = renderTemplate(loadTemplate('entities'), {
    ARCHETYPE: archetype,
    LIB_SPRITES: menu.libList,
    RESKIN_NOTES: menu.reskinNotes,
    BOSS_NOTES: bossNotes[archetype],
    GOLDEN_EXCERPT: safeExcerpt(archetype, 'entities'),
    SCHEMA: JSON.stringify(schema, null, 1),
  });
  // Variable per-cabinet content goes in the USER message (system stays cacheable).
  const uniq = (xs: string[]) => [...new Set(xs)];
  const recentBits = [
    recentUse?.heroes.length ? `hero bodies: ${uniq(recentUse.heroes).join(', ')}` : '',
    recentUse?.bosses.length ? `bosses: ${uniq(recentUse.bosses).join(', ')}` : '',
    recentUse?.backdrops.length ? `backdrops: ${uniq(recentUse.backdrops).join(', ')}` : '',
  ].filter(Boolean);
  const recentNote = recentBits.length
    ? `\n\nRECENTLY USED ON THIS CABINET (prefer different bodies/scenes when the premise allows — back-to-back games should not share a cast): ${recentBits.join('; ')}.`
    : '';
  const likenessBodyNote =
    hasPhoto && archetype === 'platformer'
      ? '\n\nLIKENESS BODY REQUIREMENT: Set sprites.assign.hero to one of the built-in lib:hero_* bodies listed above. The stable fallback needs that body and its 16px generated-head slot. Muse Image supplies the visible hero, boss, and ordinary enemies; put any bespoke custom-pixel budget into terrain or a gameplay object instead.'
      : '';
  return {
    system,
    user: [
      `DESIGN DOCUMENT:\n${JSON.stringify(design, null, 1)}`,
      ...(archetype === 'shooter' ? [shooterStyleBrief(design)] : []),
      ...(archetype === 'adventure' ? [adventureStyleBrief(design)] : []),
      ...(archetype === 'fighter' ? [fighterStyleBrief(design)] : []),
      `Photo for likeness: ${hasPhoto ? 'yes' : 'no'}.${likenessBodyNote}${recentNote}`,
      ...(archetype === 'platformer'
        ? [
            platformerStyleBrief(design),
            'Make the boss fight support the selected gameplay package. Melee heroes need safe attack openings within strike range. Tower heroes need exposed side walls for wall-jump dodges.',
          ]
        : []),
      diagnostics.length
        ? `THE PREVIOUS ENTITY OUTPUT FAILED THESE CHECKS. Recast it while specifically avoiding them:\n${formatDiagnostics(diagnostics)}`
        : '',
      'Write the entities JSON now.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    jsonSchema: schema,
    maxTokens: 9000,
    // Custom pixel-art casts are the slowest entity responses in live Muse runs.
    // Give them enough time to finish instead of paying for an identical retry.
    timeoutMs: 120_000,
  };
}

export function buildMusicPrompt(
  archetype: ArchetypeId,
  design: DesignDoc,
  diagnostics: readonly LintError[] = [],
): BuiltPrompt {
  const schema = stageSchema(archetype, 'music');
  const system = renderTemplate(loadTemplate('music'), {
    GOLDEN_EXCERPT: safeExcerpt(archetype, 'music'),
    SCHEMA: JSON.stringify(schema, null, 1),
  });
  const brief = { title: design.title, tagline: design.tagline, musicBrief: design.musicBrief };
  return {
    system,
    user: [
      `MUSICAL BRIEF:\n${JSON.stringify(brief, null, 1)}`,
      diagnostics.length
        ? `THE PREVIOUS MUSIC OUTPUT FAILED THESE CHECKS. Recompose it while specifically avoiding them:\n${formatDiagnostics(diagnostics)}`
        : '',
      'Write the music JSON now.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    jsonSchema: schema,
    maxTokens: 10000,
  };
}

const PATCH_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'RFC 6902 JSON Patch (repair output)',
  type: 'array',
  maxItems: 60,
  items: {
    type: 'object',
    properties: {
      op: { enum: ['add', 'remove', 'replace'] },
      path: { type: 'string' },
      value: {},
      from: { type: 'string' },
    },
    required: ['op', 'path'],
    additionalProperties: false,
  },
};

export function buildRepairPrompt(
  archetype: ArchetypeId,
  invalidJson: unknown,
  diagnostics: readonly LintError[],
  owner: RepairOwner = 'document',
): BuiltPrompt {
  const ownerSchema =
    owner === 'document'
      ? schemaForDocumentDiagnostics(archetype, diagnostics)
      : pruneUnusedDefs(stageSchema(archetype, owner));
  const system = renderTemplate(loadTemplate('repair'), {
    SCHEMA: JSON.stringify(ownerSchema, null, 1),
  });
  const context = repairContext(invalidJson, diagnostics, owner);
  const user = [
    ...(archetype === 'fighter'
      ? [fighterStyleBrief(invalidJson as Pick<DesignDoc, 'fighterStyle'>)]
      : []),
    ...(archetype === 'adventure'
      ? [adventureStyleBrief(invalidJson as Pick<DesignDoc, 'adventureStyle'>)]
      : []),
    ...(archetype === 'shooter'
      ? [shooterStyleBrief(invalidJson as Pick<DesignDoc, 'shooterStyle'>)]
      : []),
    `REPAIR OWNER: ${owner}. Every patch path is absolute in the original game document. Do not touch another owner.`,
    'VALIDATION DIAGNOSTICS (fix every one shown):',
    formatDiagnostics(diagnostics),
    'RELEVANT PROJECTION OF THE CURRENT DOCUMENT:',
    JSON.stringify(context),
    'Produce the JSON Patch array now.',
  ].join('\n\n');
  const topologyHeavy = diagnostics.some((d) =>
    /(GRID|ROW|TILE|PATH|REACH|GROUND|LANE|DOOR|ARENA)/i.test(`${d.code} ${d.message}`),
  );
  return { system, user, jsonSchema: PATCH_SCHEMA, maxTokens: topologyHeavy ? 4000 : 2200 };
}

/** Regenerate one bad level without paying to rewrite the healthy siblings. */
export function buildLevelRegenerationPrompt(
  archetype: ArchetypeId,
  design: DesignDoc,
  levelIndex: number,
  currentLevels: readonly unknown[],
  diagnostics: readonly LintError[],
  recentMechanics: readonly MechanicalFingerprint[] = [],
): BuiltPrompt {
  const compact = archetype === 'platformer' || archetype === 'hshooter';
  const fullSchema = (
    compact
      ? compactLevelsStageSchema(archetype, archetype === 'platformer')
      : stageSchema(archetype, 'levels')
  ) as {
    properties: Record<string, unknown>;
    $defs?: Record<string, unknown>;
  };
  const levelsProperty = fullSchema.properties['levels'] as { items?: unknown } | undefined;
  if (!levelsProperty?.items) throw new Error(`levels schema for ${archetype} has no item schema`);
  const schema = pruneUnusedDefs({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `Sparkade ${archetype} single-level replacement`,
    type: 'object',
    properties: { level: structuredClone(levelsProperty.items) },
    required: ['level'],
    additionalProperties: false,
    $defs: structuredClone(fullSchema.$defs ?? {}),
  });
  const baseSystem = renderTemplate(loadTemplate(`levels-${archetype}`), {
    GOLDEN_EXCERPT: compact
      ? safeCompactLevelsExcerpt(archetype)
      : safeExcerpt(archetype, 'levels'),
    SCHEMA: JSON.stringify(schema, null, 1),
  });
  const system = `${baseSystem}\n\n## Single-level regeneration override\n\nThis call replaces ONLY zero-based level ${levelIndex}. Ignore any earlier instruction to emit all levels. Return exactly one object shaped as {"level": ...}, matching the final schema below. Preserve the premise and progression role of this level, but rebuild the invalid geometry/content from scratch. Do not copy the invalid tile rows verbatim.${archetype === 'hshooter' ? ' The replacement schema uses compact tileRuns rather than literal tiles; emit [tile,count] tuples whose counts expand to equal-width rows.' : ''}`;
  const siblingSummary = currentLevels.map((level, index) => ({
    index,
    ...(level && typeof level === 'object'
      ? summarizeLevel(level as Record<string, unknown>, false)
      : { value: level }),
  }));
  return {
    system,
    user: [
      `DESIGN DOCUMENT:\n${JSON.stringify(design, null, 1)}`,
      ...(archetype === 'shooter' ? [shooterStyleBrief(design)] : []),
      ...(archetype === 'adventure' ? [adventureStyleBrief(design)] : []),
      ...(archetype === 'fighter' ? [fighterStyleBrief(design)] : []),
      ...(archetype === 'platformer'
        ? [
            platformerStyleBrief(design),
            encounterGuidance(design, recentMechanics),
            `Existing encounter sequences: ${JSON.stringify(currentLevels.map((level) => (level as { encounters?: unknown })?.encounters))}. Vary healthy siblings; preserve the requested kit.`,
          ]
        : []),
      `LEVEL SET SUMMARY (the entry at index ${levelIndex} is the one being replaced):\n${JSON.stringify(siblingSummary)}`,
      `FAILURES TO AVOID:\n${formatDiagnostics(diagnostics)}`,
      `Write only {"level": <replacement for index ${levelIndex}>} now.`,
    ].join('\n\n'),
    jsonSchema: schema,
    maxTokens: archetype === 'hshooter' ? 8000 : archetype === 'platformer' ? 6000 : 5000,
    timeoutMs: 150_000,
  };
}

function formatDiagnostics(diagnostics: readonly LintError[]): string {
  return diagnostics
    .slice(0, 30)
    .map((d) => `- [${d.code}] at ${d.path}: ${d.message}`)
    .join('\n');
}

function safeCompactLevelsExcerpt(
  archetype: Extract<ArchetypeId, 'platformer' | 'hshooter'>,
): string {
  try {
    if (archetype === 'platformer')
      return 'Each level contains only name, musicSong (theme), and encounterRoute. Choose its compatible patterns from the catalog in the user message; geometry is compiled by the engine.';
    const golden = loadGolden(archetype);
    const level = structuredClone(golden.levels[0]) as unknown as Record<string, unknown>;
    const rows = Array.isArray(level['tiles']) ? (level['tiles'] as string[]) : [];
    delete level['tiles'];
    level['tileRuns'] = rows.map(compactRow);
    return `One complete level object (the response envelope and level count come from the schema):\n${JSON.stringify(level, null, 1)}`;
  } catch {
    return '(example unavailable)';
  }
}

function compactRow(row: string): [tile: string, count: number][] {
  const runs: [tile: string, count: number][] = [];
  for (const tile of row) {
    const previous = runs.at(-1);
    if (previous?.[0] === tile) previous[1]++;
    else runs.push([tile, 1]);
  }
  return runs;
}

function pruneUnusedDefs(schema: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(schema) as Record<string, unknown> & {
    $defs?: Record<string, unknown>;
  };
  const allDefs = clone.$defs ?? {};
  const wanted = new Set<string>();
  const scan = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(scan);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const rec = value as Record<string, unknown>;
    if (typeof rec['$ref'] === 'string') {
      const match = /^#\/\$defs\/(.+)$/.exec(rec['$ref']);
      if (match && !wanted.has(match[1]!)) {
        wanted.add(match[1]!);
        scan(allDefs[match[1]!]);
      }
    }
    for (const [key, child] of Object.entries(rec)) {
      if (key !== '$defs') scan(child);
    }
  };
  scan(clone);
  clone.$defs = Object.fromEntries([...wanted].map((name) => [name, allDefs[name]]));
  return clone;
}

function schemaForDocumentDiagnostics(
  archetype: ArchetypeId,
  diagnostics: readonly LintError[],
): Record<string, unknown> {
  const roots = new Set(
    diagnostics
      .map((d) => d.path.split('/')[1])
      .filter((root): root is string => typeof root === 'string' && root.length > 0),
  );
  const full = ARCHETYPE_SCHEMAS[archetype] as {
    properties: Record<string, unknown>;
    required?: string[];
    $defs?: Record<string, unknown>;
  };
  const properties = Object.fromEntries(
    [...roots]
      .filter((root) => root in full.properties)
      .map((root) => [root, full.properties[root]]),
  );
  if (!Object.keys(properties).length) return pruneUnusedDefs(stageSchema(archetype, 'levels'));
  return pruneUnusedDefs({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `Sparkade ${archetype} document repair fragment`,
    type: 'object',
    properties,
    required: (full.required ?? []).filter((root) => roots.has(root)),
    additionalProperties: true,
    $defs: structuredClone(full.$defs ?? {}),
  });
}

function repairContext(
  invalidJson: unknown,
  diagnostics: readonly LintError[],
  owner: RepairOwner,
): unknown {
  if (!invalidJson || typeof invalidJson !== 'object') return invalidJson;
  const doc = invalidJson as Record<string, unknown>;
  if (owner === 'music') return { music: doc['music'] };
  if (owner === 'entities') {
    return pick(doc, ['sprites', 'boss', 'sfx', 'backdrop', 'weather', 'lighting', 'juice']);
  }
  if (owner === 'levels') {
    const levels = Array.isArray(doc['levels']) ? doc['levels'] : [];
    const indexes = new Set<number>();
    for (const diagnostic of diagnostics) {
      const match = /^\/levels\/(\d+)/.exec(diagnostic.path);
      if (match) indexes.add(Number(match[1]));
    }
    const selected = indexes.size
      ? Object.fromEntries([...indexes].sort((a, b) => a - b).map((i) => [String(i), levels[i]]))
      : Object.fromEntries(
          levels.map((level, i) => [
            String(i),
            level && typeof level === 'object'
              ? summarizeLevel(level as Record<string, unknown>, false)
              : level,
          ]),
        );
    const songs =
      doc['music'] && typeof doc['music'] === 'object'
        ? Object.keys(
            ((doc['music'] as Record<string, unknown>)['songs'] as object | undefined) ?? {},
          )
        : [];
    return {
      levelsByOriginalIndex: selected,
      ...(doc['player'] !== undefined ? { player: doc['player'] } : {}),
      availableMusicSongs: songs,
    };
  }
  const roots = [
    ...new Set(
      diagnostics
        .map((d) => d.path.split('/')[1])
        .filter((root): root is string => typeof root === 'string' && root.length > 0),
    ),
  ];
  return pick(doc, roots);
}

function summarizeLevel(
  level: Record<string, unknown>,
  includeTiles: boolean,
): Record<string, unknown> {
  const summary = { ...level };
  if (!includeTiles && Array.isArray(summary['tiles'])) {
    const rows = summary['tiles'] as unknown[];
    summary['tileShape'] = {
      rows: rows.length,
      widths: [
        ...new Set(rows.filter((r): r is string => typeof r === 'string').map((r) => r.length)),
      ],
    };
    delete summary['tiles'];
  }
  return summary;
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}

/** Golden excerpts require golden files on disk; degrade to a note if absent. */
function safeExcerpt(
  archetype: ArchetypeId,
  stage: 'design' | 'levels' | 'entities' | 'music',
): string {
  try {
    return goldenExcerpt(archetype, stage);
  } catch {
    return '(example unavailable)';
  }
}

/** Strip markdown fences / stray prose around a JSON payload, then parse. */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* try harder below */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]!.trim());
    } catch {
      /* fall through */
    }
  }
  const firstBrace = trimmed.search(/[[{]/);
  if (firstBrace >= 0) {
    const open = trimmed[firstBrace]!;
    const close = open === '{' ? '}' : ']';
    const lastClose = trimmed.lastIndexOf(close);
    if (lastClose > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastClose + 1));
    }
  }
  throw new Error('model output was not parseable JSON');
}
import { ADVENTURE_STYLE_CATALOG, adventureStylePreference } from '@sparkade/shared';
