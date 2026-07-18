// Server-side prompt assembly: loads the .md templates from
// packages/generation and fills their placeholders (schemas verbatim from
// @sparkade/shared, golden few-shot excerpts, anti-collision block).
import {
  ARCHETYPE_SCHEMAS,
  DESIGN_SCHEMA,
  LIB_BOSSES_ADVENTURE,
  LIB_BOSSES_PLATFORMER,
  LIB_BOSSES_SHOOTER,
  LIB_ENEMIES_GROUND,
  LIB_FOES_SHOOTER,
  LIB_HEROES_ADVENTURE,
  LIB_HEROES_PLATFORMER,
  LIB_ITEMS,
  LIB_NPCS,
  LIB_OBJECTS,
  LIB_PICKUPS,
  LIB_PROJECTILES,
  LIB_SHIPS,
  PALETTE_MOODS,
  stageSchema,
  type ArchetypeId,
  type DesignDoc,
} from '@sparkade/shared';
import { goldenExcerpt, loadGolden, loadTemplate, renderTemplate } from '@sparkade/generation';
import type { LintError } from '@sparkade/shared';
import { compactLevelsStageSchema } from './tile-runs';

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
  const user = [
    `PLAYER REQUEST:\n${opts.promptText.slice(0, 1200)}`,
    `PHOTO FOR LIKENESS: ${opts.hasPhoto ? 'yes' : 'no'}. ${likenessNotes}`,
    `GAMES ALREADY ON THIS CABINET (be clearly different):\n${anti}`,
    ...(moodNote ? [moodNote] : []),
    ...(opts.extraNote ? [`IMPORTANT: ${opts.extraNote}`] : []),
    'Design the game now.',
  ].join('\n\n');
  return { system, user, jsonSchema: DESIGN_SCHEMA, maxTokens: 4000 };
}

export function buildLevelsPrompt(
  archetype: ArchetypeId,
  design: DesignDoc,
  diagnostics: readonly LintError[] = [],
): BuiltPrompt {
  const compact = archetype === 'platformer' || archetype === 'hshooter';
  const schema = compact ? compactLevelsStageSchema(archetype) : stageSchema(archetype, 'levels');
  const renderedSystem = renderTemplate(loadTemplate(`levels-${archetype}`), {
    GOLDEN_EXCERPT: compact
      ? safeCompactLevelsExcerpt(archetype)
      : safeExcerpt(archetype, 'levels'),
    SCHEMA: JSON.stringify(schema, null, 1),
  });
  const system = compact
    ? `${renderedSystem}\n\n## Compact tile rows\n\nThe output schema deliberately replaces each level's literal \`tiles\` strings with \`tileRuns\`. For every visual row, emit a left-to-right array of two-item \`[tile,count]\` tuples, for example \`[[".",72],["#",8]]\`. Adjacent tuples reconstruct the row; all expanded rows in a level must have the same total width. This compact form is compiled to ordinary tile strings by the engine.`
    : renderedSystem;
  return {
    system,
    user: [
      `DESIGN DOCUMENT:\n${JSON.stringify(design, null, 1)}`,
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
    // Levels are the heaviest artifact (measured live: muse-spark-1.1 regularly
    // needs >90s for platformer tile grids). 150s here deviates from the 90s
    // default deliberately — without it, platformer generation cannot complete.
    timeoutMs: 150_000,
  };
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

/** Per-archetype library menus (annotated, grouped) + reskinnable-slot documentation. */
function spriteMenu(archetype: ArchetypeId): { libList: string; reskinNotes: string } {
  const small = [...LIB_PROJECTILES, ...LIB_PICKUPS].join(', ');
  const byArchetype: Record<ArchetypeId, string> = {
    platformer: [
      '\nHERO BODIES (side view; all take the photo-likeness head — identity lives in the body):',
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
      '\nSHIPS (top-down, pointing up; all take the photo-likeness head in the canopy):',
      annotated(LIB_SHIPS),
      'FOE BODIES (top-down; any body can skin any behavior role):',
      annotated(LIB_FOES_SHOOTER),
      'BOSSES (top-down craft, screen-wide) — pick the one that fits your premise and differs from recent games:',
      annotated(LIB_BOSSES_SHOOTER),
      `SMALL ART (self-describing): ${small}`,
    ].join('\n'),
    adventure: [
      '\nHERO BODIES (top-down 3/4; all take the photo-likeness head — identity lives in the body):',
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
      '\nSHIPS (the engine flips them to face RIGHT; all take the photo-likeness head in the canopy):',
      annotated(LIB_SHIPS),
      'FOE BODIES (any body can skin any behavior role; they fly in from the right):',
      annotated(LIB_FOES_SHOOTER),
      'BOSSES (top-down craft, screen-scale; enters from the right) — pick the one that fits your premise and differs from recent games:',
      annotated(LIB_BOSSES_SHOOTER),
      `SMALL ART (self-describing): ${small}`,
    ].join('\n'),
    fighter: [
      '\nFIGHTERS ARE DRAWN PROCEDURALLY — there are NO body sprites to pick. Set sprites.assign.hero and sprites.assign.boss to any library sprite (both are unused placeholders), e.g. "hero": "lib:hero_squire", "boss": "lib:boss_titan". A fighter\'s look comes from its build (nimble/balanced/heavy), outfit silhouette (gi/boxer/wrestler/street/robe/armor), and palette colorSlot. Opponent and boss faces are deterministic pixel avatars derived from the game seed, roster slot, and name; do not add unsupported face fields. When a photo exists, the player automatically receives the baked directional likeness head; never try to encode their face as a custom sprite.',
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
    hshooter: ['tile_solid', 'tile_hazard', 'tile_deco'],
    fighter: [],
  };
  const extraRoles: Record<ArchetypeId, string> = {
    platformer:
      "Also reskinnable via assign: projectile (your hero's shot), enemy_projectile, obj_spring, obj_platform.",
    shooter:
      "Also reskinnable via assign: projectile (your ship's shot), enemy_shot, pod (boss side-turrets), pickup_spread, pickup_rapid, pickup_shield, pickup_bomb.",
    adventure:
      'Also reskinnable via assign: proj_arrow, proj_wave (sword slash), item_boomerang, proj_bomb, enemy_shot.',
    hshooter:
      "Also reskinnable via assign: projectile (your ship's shot), enemy_shot, pod (boss side-turrets), pickup_spread, pickup_rapid, pickup_shield, pickup_bomb.",
    fighter:
      'Nothing to reskin — fighters, arena and effects are all drawn by the engine from your palette. The player and ladder roster are authored by the levels pass. Here, make the boss unmistakable with a distinct build + outfit + colorSlot.',
  };
  const roles = tileRoles[archetype];
  const platformerSolidNote =
    archetype === 'platformer'
      ? `
PLATFORMER SOLID PAIR: \`tile_solid\` is the exposed cap and \`tile_solid_inner\` is the buried fill. Assign both from the SAME family (for example \`"tile_solid": "lib:ice_solid"\` plus \`"tile_solid_inner": "lib:ice_solid_inner"\`) or draw a matching custom pair. Each custom cap and inner sprite must be EXACTLY 16×16 and fully opaque. The cap must tile seamlessly left-to-right; the inner must tile seamlessly on both axes, and the cap's bottom edge must join the inner's top edge. Level generation still authors only semantic \`solid\` cells; the engine selects the cap when no solid is directly above and the inner sprite when another solid is above. Never invent separate cap/inner level characters or legend values.
`
      : '';
  const familyKinds =
    archetype === 'platformer'
      ? 'solid/solid_inner/platform/hazard/checkpoint/exit/deco/wall/floor/block/pit/switch/door_locked/door_boss/door_open'
      : 'solid/platform/hazard/checkpoint/exit/deco/wall/floor/block/pit/switch/door_locked/door_boss/door_open';
  const reskinNotes =
    (roles.length
      ? `TERRAIN RESKIN — the strongest identity lever after the palette. ALWAYS reskin the terrain — assigning every tile slot is expected, not optional. The example just shows one family for format; pick the family that fits THIS game's world and never leave the tiles on the plain default. Each tile slot (${roles.join(', ')}) can be re-assigned:
- to a THEMED library family: castle_*, cave_*, wasteland_*, alien_*, ice_*, desert_*, clockwork_* (brass machinery), candy_* (confectionery), coral_* (undersea reef), garden_* (overgrown greenery) — e.g. "tile_solid": "lib:ice_solid". Every family has every kind (${familyKinds}). Families are SHAPE languages — your palette supplies all color, so pick the family whose shapes fit the premise and stay within ONE family for coherence.
- or to a custom 16×16 sprite you draw (must be EXACTLY 16×16; solid/wall/floor tiles should be fully opaque and tile seamlessly edge-to-edge). When unsure, use a themed family — it always looks professional.
${platformerSolidNote}`
      : 'This archetype has no terrain tiles; its look comes from palette, backdrop, ship/foe sprites and wave choreography.\n') +
    extraRoles[archetype] +
    '\n\n' +
    (archetype === 'shooter' ? SHOOTER_BACKDROP_NOTE : BACKDROP_NOTE);
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
      'Patterns: charge (telegraphed dash), teleport (vanish + radial burst), spiral (rotating bullets), summon (minions). tempo 0.5–2 scales speed.',
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
      ? '\n\nLIKENESS BODY REQUIREMENT: Set sprites.assign.hero to one of the built-in lib:hero_* bodies listed above. The 16x32 likeness presentation needs that body and its 16px face slot. Put bespoke signature art on the boss, an enemy, or an object instead of the hero.'
      : '';
  return {
    system,
    user: [
      `DESIGN DOCUMENT:\n${JSON.stringify(design, null, 1)}`,
      `Photo for likeness: ${hasPhoto ? 'yes' : 'no'}.${likenessBodyNote}${recentNote}`,
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
): BuiltPrompt {
  const compact = archetype === 'platformer' || archetype === 'hshooter';
  const fullSchema = (
    compact ? compactLevelsStageSchema(archetype) : stageSchema(archetype, 'levels')
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
  const system = `${baseSystem}\n\n## Single-level regeneration override\n\nThis call replaces ONLY zero-based level ${levelIndex}. Ignore any earlier instruction to emit all levels. Return exactly one object shaped as {"level": ...}, matching the final schema below. Preserve the premise and progression role of this level, but rebuild the invalid geometry/content from scratch. Do not copy the invalid tile rows verbatim.${compact ? ' The replacement schema uses compact tileRuns rather than literal tiles; emit [tile,count] tuples whose counts expand to equal-width rows.' : ''}`;
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
    const golden = loadGolden(archetype);
    const level = structuredClone(golden.levels[0]) as unknown as Record<string, unknown>;
    let rows = Array.isArray(level['tiles']) ? (level['tiles'] as string[]) : [];
    if (archetype === 'platformer' && level['legend'] && typeof level['legend'] === 'object') {
      const legend = level['legend'] as Record<string, string>;
      const engineOwned = new Set(
        Object.entries(legend)
          .filter(([, kind]) => kind === 'decoration' || kind === 'exit')
          .map(([tile]) => tile),
      );
      rows = rows.map((row) =>
        [...row].map((tile) => (engineOwned.has(tile) ? '.' : tile)).join(''),
      );
      level['legend'] = Object.fromEntries(
        Object.entries(legend).filter(([, kind]) => kind !== 'decoration' && kind !== 'exit'),
      );
    }
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
