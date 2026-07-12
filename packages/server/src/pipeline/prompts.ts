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
import { goldenExcerpt, loadTemplate, renderTemplate } from '@sparkade/generation';
import type { LintError } from '@sparkade/shared';

export interface BuiltPrompt {
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  /** Per-call timeout override (ms) for stages measured to run long. */
  timeoutMs?: number;
}

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

export function buildLevelsPrompt(archetype: ArchetypeId, design: DesignDoc): BuiltPrompt {
  const schema = stageSchema(archetype, 'levels');
  const system = renderTemplate(loadTemplate(`levels-${archetype}`), {
    GOLDEN_EXCERPT: safeExcerpt(archetype, 'levels'),
    SCHEMA: JSON.stringify(schema, null, 1),
  });
  return {
    system,
    user: `DESIGN DOCUMENT:\n${JSON.stringify(design, null, 1)}\n\nWrite the levels JSON now.`,
    jsonSchema: schema,
    maxTokens: 14000,
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

WEATHER (optional) — set the top-level "weather" field for a subtle ambient particle overlay in your palette colors: rain, storm (heavy driving rain), snow, embers (rising sparks — fire/volcano), ash (falling grey flecks — ruins/aftermath), leaves (autumn/forest), petals (blossom/candy), fog (drifting mist), bubbles (undersea), fireflies (glowing night motes), dust (drifting desert/dungeon motes). Choose one that reinforces the mood, or "none"/omit for clear air. It's atmosphere — don't let it fight the gameplay.`;

/** Per-archetype library menus (annotated, grouped) + reskinnable-slot documentation. */
function spriteMenu(archetype: ArchetypeId): { libList: string; reskinNotes: string } {
  const small = [...LIB_PROJECTILES, ...LIB_PICKUPS].join(', ');
  const byArchetype: Record<ArchetypeId, string> = {
    platformer: [
      '\nHERO BODIES (side view; all take the photo-likeness head — identity lives in the body):',
      annotated(LIB_HEROES_PLATFORMER),
      'ENEMY BODIES (any body can skin any behavior role):',
      annotated(LIB_ENEMIES_GROUND),
      'BOSSES (side view, arena-scale):',
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
      'BOSSES (top-down, screen-wide):',
      annotated(LIB_BOSSES_SHOOTER),
      `SMALL ART (self-describing): ${small}`,
    ].join('\n'),
    adventure: [
      '\nHERO BODIES (top-down 3/4; all take the photo-likeness head — identity lives in the body):',
      annotated(LIB_HEROES_ADVENTURE),
      'ENEMY BODIES (any body can skin any behavior role):',
      annotated(LIB_ENEMIES_GROUND),
      'BOSSES (top-down, chamber-scale):',
      annotated(LIB_BOSSES_ADVENTURE),
      'NPCS:',
      annotated(LIB_NPCS),
      `ITEMS: ${LIB_ITEMS.join(', ')}`,
      `SMALL ART (self-describing): ${small}`,
    ].join('\n'),
  };
  const tileRoles: Record<ArchetypeId, string[]> = {
    platformer: ['tile_solid', 'tile_platform', 'tile_hazard', 'tile_checkpoint', 'tile_exit', 'tile_deco'],
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
  };
  const extraRoles: Record<ArchetypeId, string> = {
    platformer:
      'Also reskinnable via assign: projectile (your hero\'s shot), enemy_projectile, obj_spring, obj_platform.',
    shooter:
      'Also reskinnable via assign: projectile (your ship\'s shot), enemyShot, pod (boss side-turrets), pickup_spread, pickup_rapid, pickup_shield, pickup_bomb.',
    adventure:
      'Also reskinnable via assign: proj_arrow, proj_wave (sword slash), item_boomerang, proj_bomb, enemyShot.',
  };
  const roles = tileRoles[archetype];
  const reskinNotes =
    (roles.length
      ? `TERRAIN RESKIN — the strongest identity lever after the palette. Each tile slot (${roles.join(', ')}) can be re-assigned:
- to a THEMED library family: castle_*, cave_*, wasteland_*, alien_*, ice_*, desert_*, clockwork_* (brass machinery), candy_* (confectionery), coral_* (undersea reef), garden_* (overgrown greenery) — e.g. "tile_solid": "lib:ice_solid". Every family has every kind (solid/platform/hazard/checkpoint/exit/deco/wall/floor/block/pit/switch/door_locked/door_boss/door_open). Families are SHAPE languages — your palette supplies all color, so pick the family whose shapes fit the premise and stay within ONE family for coherence.
- or to a custom 16×16 sprite you draw (must be EXACTLY 16×16; solid/wall/floor tiles should be fully opaque and tile seamlessly edge-to-edge). When unsure, use a themed family — it always looks professional.
`
      : 'This archetype has no terrain tiles; its look comes from palette, backdrop, ship/foe sprites and wave choreography.\n') +
    extraRoles[archetype] +
    '\n\n' +
    BACKDROP_NOTE;
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
): BuiltPrompt {
  const schema = stageSchema(archetype, 'entities');
  const bossNotes: Record<ArchetypeId, string> = {
    platformer:
      'Attacks vocabulary: stomp (leap + shockwave), charge (dash), spread (projectile fan), summon (minions). tempo 0.5–2 scales speed.',
    shooter:
      'Bullet patterns: fan, spiral, walls (rows with a gap), aimed. pods are destructible side turrets. bulletSpeed multiplies base speed.',
    adventure:
      'Patterns: charge (telegraphed dash), teleport (vanish + radial burst), spiral (rotating bullets), summon (minions). tempo 0.5–2 scales speed.',
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
  return {
    system,
    user: `DESIGN DOCUMENT:\n${JSON.stringify(design, null, 1)}\n\nPhoto for likeness: ${hasPhoto ? 'yes' : 'no'}.${recentNote}\n\nWrite the entities JSON now.`,
    jsonSchema: schema,
    maxTokens: 9000,
  };
}

export function buildMusicPrompt(archetype: ArchetypeId, design: DesignDoc): BuiltPrompt {
  const schema = stageSchema(archetype, 'music');
  const system = renderTemplate(loadTemplate('music'), {
    GOLDEN_EXCERPT: safeExcerpt(archetype, 'music'),
    SCHEMA: JSON.stringify(schema, null, 1),
  });
  const brief = { title: design.title, tagline: design.tagline, musicBrief: design.musicBrief };
  return {
    system,
    user: `MUSICAL BRIEF:\n${JSON.stringify(brief, null, 1)}\n\nWrite the music JSON now.`,
    jsonSchema: schema,
    maxTokens: 10000,
  };
}

const PATCH_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'RFC 6902 JSON Patch (repair output)',
  type: 'array',
  maxItems: 200,
  items: {
    type: 'object',
    properties: {
      op: { enum: ['add', 'remove', 'replace', 'move', 'copy', 'test'] },
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
  diagnostics: LintError[],
): BuiltPrompt {
  const system = renderTemplate(loadTemplate('repair'), {
    SCHEMA: JSON.stringify(ARCHETYPE_SCHEMAS[archetype], null, 1),
  });
  const user = [
    'VALIDATION DIAGNOSTICS (fix every one):',
    diagnostics
      .slice(0, 30)
      .map((d) => `- [${d.code}] at ${d.path}: ${d.message}`)
      .join('\n'),
    'THE CURRENT (INVALID) DOCUMENT:',
    JSON.stringify(invalidJson),
    'Produce the JSON Patch array now.',
  ].join('\n\n');
  return { system, user, jsonSchema: PATCH_SCHEMA, maxTokens: 8000 };
}

/** Golden excerpts require golden files on disk; degrade to a note if absent. */
function safeExcerpt(archetype: ArchetypeId, stage: 'design' | 'levels' | 'entities' | 'music'): string {
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
