// Validation gates: ajv schema validation → security scan (no markup, URLs,
// code, paths or unknown ids in any string field) → custom-sprite checks with
// silent library fallback → title/premise similarity. Archetype lint() runs
// from the runner via the archetypes registry.
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import {
  ARCHETYPE_SCHEMAS,
  DESIGN_SCHEMA,
  LIB_BOSSES_PLATFORMER,
  LIB_HEROES_PLATFORMER,
  LIB_SPRITE_IDS,
  type ArchetypeId,
  type GameSpec,
  type LintError,
  type ShooterSpec,
  type SpriteData,
} from '@sparkade/shared';
import { reconcileDoors } from '@sparkade/archetypes';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const compiled = new Map<string, ValidateFunction>();

function validator(key: string, schema: Record<string, unknown>): ValidateFunction {
  let v = compiled.get(key);
  if (!v) {
    v = ajv.compile(schema);
    compiled.set(key, v);
  }
  return v;
}

export function validateAgainst(
  key: string,
  schema: Record<string, unknown>,
  data: unknown,
): LintError[] {
  const v = validator(key, schema);
  if (v(data)) return [];
  return (v.errors ?? []).slice(0, 40).map((e) => {
    const params = e.params as { additionalProperty?: string; missingProperty?: string };
    const property =
      e.keyword === 'required'
        ? params.missingProperty
        : e.keyword === 'additionalProperties'
          ? params.additionalProperty
          : undefined;
    const path = property ? `${e.instancePath}/${escapePointer(property)}` : e.instancePath || '/';
    return {
      code: 'SCHEMA',
      path,
      message: `${e.instancePath || '(root)'} ${e.message ?? 'is invalid'}${
        e.keyword === 'additionalProperties'
          ? ` (unexpected property "${params.additionalProperty}")`
          : ''
      }`,
    };
  });
}

export function validateGameSchema(archetype: ArchetypeId, spec: unknown): LintError[] {
  return validateAgainst(`game:${archetype}`, ARCHETYPE_SCHEMAS[archetype], spec);
}

export function validateDesignSchema(design: unknown): LintError[] {
  return validateAgainst('design', DESIGN_SCHEMA, design);
}

// ---------------------------------------------------------------------------
// Security scan
// ---------------------------------------------------------------------------

const BAD_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'markup', re: /<[a-zA-Z!/]/ },
  { name: 'url', re: /(https?:\/\/|www\.)/i },
  { name: 'script', re: /(<script|javascript:|\bon(click|load|error|mouseover)\s*=)/i },
  { name: 'code', re: /(\bfunction\s*\(|\beval\s*\(|\brequire\s*\(|\bimport\s+[a-zA-Z{]|=>)/ },
  { name: 'path', re: /(\.\.\/|\.\.\\|\/etc\/|\/usr\/|\/home\/|\/var\/|[A-Za-z]:\\)/ },
  { name: 'template', re: /(\{\{|\}\}|\$\{)/ },
];

const SPRITE_REF_RE = /^(lib|custom):([a-z][a-z0-9_]{0,31})$/;
const LIKENESS_HERO_REFS = new Set<string>(LIB_HEROES_PLATFORMER.map((id) => `lib:${id}`));

/**
 * A photo platformer needs one of the bodies that can carry the 16px head.
 * The prompt asks for this; this deterministic guard makes it a guarantee if
 * a provider still chooses a custom or cross-archetype hero.
 */
export function ensureLikenessHeroBody(spec: GameSpec, hasPhoto: boolean): GameSpec {
  const assign = spec.sprites?.assign;
  if (
    !hasPhoto ||
    spec.archetype !== 'platformer' ||
    !assign ||
    LIKENESS_HERO_REFS.has(assign['hero'] ?? '')
  ) {
    return spec;
  }
  const id = LIB_HEROES_PLATFORMER[(spec.seed >>> 0) % LIB_HEROES_PLATFORMER.length]!;
  return {
    ...spec,
    sprites: {
      ...spec.sprites,
      assign: { ...assign, hero: `lib:${id}` },
    },
  };
}

/**
 * Walks every string in the object graph. Sprite-ref-shaped strings are checked
 * against known ids; everything else is scanned for hostile content. The spec's
 * schemas already restrict charsets, so hits here are genuinely suspicious.
 */
export function securityScan(spec: GameSpec): LintError[] {
  const out: LintError[] = [];
  const customIds = new Set(Object.keys(spec.sprites?.custom ?? {}));
  const libIds = new Set(LIB_SPRITE_IDS);

  const visit = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      const refMatch = SPRITE_REF_RE.exec(value);
      if (refMatch) {
        const [, kind, id] = refMatch;
        const known = kind === 'lib' ? libIds.has(id!) : customIds.has(id!);
        if (!known && path.startsWith('/sprites/assign')) {
          out.push({ code: 'SCAN_UNKNOWN_ID', path, message: `unknown sprite id "${value}"` });
        }
        return;
      }
      for (const { name, re } of BAD_PATTERNS) {
        if (re.test(value)) {
          out.push({
            code: 'SCAN_REJECTED',
            path,
            message: `string field contains disallowed content (${name}): ${value.slice(0, 60)}`,
          });
          return;
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${path}/${i}`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) visit(v, `${path}/${escapePointer(k)}`);
    }
  };

  // Sprite pixel rows are schema-locked to [0-9a-f.] and would only produce
  // false positives here; scan everything else.
  const { sprites, ...rest } = spec;
  visit(rest, '');
  if (sprites) {
    visit(sprites.assign, '/sprites/assign');
    for (const id of Object.keys(sprites.custom ?? {})) {
      if (!/^[a-z][a-z0-9_]{0,31}$/.test(id)) {
        out.push({
          code: 'SCAN_REJECTED',
          path: `/sprites/custom/${id}`,
          message: 'bad sprite id',
        });
      }
    }
  }
  return out;
}

function escapePointer(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

// ---------------------------------------------------------------------------
// Custom-sprite checks with library fallback (a downgrade, not an error)
// ---------------------------------------------------------------------------

const ROLE_LIB_FALLBACK: Record<ArchetypeId, Record<string, string>> = {
  platformer: {
    hero: 'lib:hero_squire',
    // applySpriteFallbacks selects the actual fallback from the full pool.
    boss: 'lib:boss_knight',
    walker: 'lib:enemy_walker',
    flyer: 'lib:enemy_flyer',
    shooter: 'lib:enemy_shooter',
    chaser: 'lib:enemy_chaser',
    coin: 'lib:pickup_coin',
    heart: 'lib:pickup_heart',
    powerup: 'lib:pickup_power',
    projectile: 'lib:proj_orb',
  },
  shooter: {
    hero: 'lib:ship_dart',
    boss: 'lib:boss_leviathan',
    popcorn: 'lib:foe_popcorn',
    weaver: 'lib:foe_weaver',
    tank: 'lib:foe_tank',
    turret: 'lib:foe_turret',
    kamikaze: 'lib:foe_kamikaze',
    projectile: 'lib:proj_bolt',
    enemy_shot: 'lib:proj_pellet',
  },
  adventure: {
    hero: 'lib:hero_wander',
    boss: 'lib:boss_warden',
    walker: 'lib:enemy_walker',
    flyer: 'lib:enemy_flyer',
    shooter: 'lib:enemy_shooter',
    chaser: 'lib:enemy_chaser',
    bruiser: 'lib:enemy_bruiser',
    npc: 'lib:npc_keeper',
    key: 'lib:pickup_key',
    heart: 'lib:pickup_heart',
    item: 'lib:pickup_power',
    enemy_shot: 'lib:proj_pellet',
  },
  hshooter: {
    hero: 'lib:ship_dart',
    boss: 'lib:boss_leviathan',
    popcorn: 'lib:foe_popcorn',
    weaver: 'lib:foe_weaver',
    tank: 'lib:foe_tank',
    turret: 'lib:foe_turret',
    kamikaze: 'lib:foe_kamikaze',
    projectile: 'lib:proj_bolt',
    enemy_shot: 'lib:proj_pellet',
  },
  fighter: {
    // Fighters are procedural; hero/boss assigns are unused placeholders.
    hero: 'lib:hero_squire',
    boss: 'lib:boss_titan',
  },
};

const GENERIC_FALLBACK: Record<ArchetypeId, string> = {
  platformer: 'lib:enemy_walker',
  shooter: 'lib:foe_popcorn',
  adventure: 'lib:enemy_walker',
  hshooter: 'lib:foe_popcorn',
  fighter: 'lib:enemy_walker',
};

export function spriteProblem(
  s: SpriteData,
  opts: { isTile?: boolean; requireOpaque?: boolean } = {},
): string | null {
  if (s.rows.length !== s.h) return `rows.length ${s.rows.length} != h ${s.h}`;
  for (const [i, row] of s.rows.entries()) {
    if (row.length !== s.w) return `row ${i} length ${row.length} != w ${s.w}`;
    if (!/^[0-9a-f.]+$/.test(row)) return `row ${i} has invalid characters`;
  }
  let opaque = 0;
  for (const row of s.rows) for (const ch of row) if (ch !== '.' && ch !== '0') opaque++;
  const coverage = opaque / (s.w * s.h);
  if (coverage < 0.15) return `only ${(coverage * 100).toFixed(0)}% opaque (minimum 15%)`;
  if (opts.requireOpaque && coverage < 1) {
    return `${(coverage * 100).toFixed(0)}% opaque (solid terrain must be 100%)`;
  }
  // The anti-blob ceiling is for characters; terrain tiles are legitimately
  // solid (a fully-opaque wall tile is correct, not a defect).
  if (!opts.isTile && coverage > 0.85)
    return `${(coverage * 100).toFixed(0)}% opaque (maximum 85%)`;
  if (opts.isTile && (s.w !== 16 || s.h !== 16))
    return `tile sprites must be 16×16 (got ${s.w}×${s.h})`;
  return null;
}

export interface SpriteFallbackOptions {
  /** Newest-first library boss refs used by recent games. */
  recentBosses?: readonly string[];
}

/**
 * Pick a stable platformer boss for a given seed, preferring one that has not
 * appeared in the recent-game window. This is used only when authored boss art
 * is unavailable or remains malformed after repair.
 */
export function platformerBossFallback(seed: number, recentBosses: readonly string[] = []): string {
  const recentIds = new Set(
    recentBosses.map((ref) => (ref.startsWith('lib:') ? ref.slice(4) : ref)),
  );
  const unused = LIB_BOSSES_PLATFORMER.filter((id) => !recentIds.has(id));
  const candidates = unused.length ? unused : LIB_BOSSES_PLATFORMER;
  const id = candidates[(seed >>> 0) % candidates.length]!;
  return `lib:${id}`;
}

/**
 * Pixel-shape diagnostics intentionally target only an authored platformer
 * boss. Other malformed custom sprites retain the cheap silent-downgrade
 * behavior; a bespoke boss is important enough to spend the repair budget on.
 */
export function customBossSpriteDiagnostics(spec: GameSpec): LintError[] {
  if (spec.archetype !== 'platformer') return [];
  const ref = spec.sprites.assign['boss'];
  if (!ref?.startsWith('custom:')) return [];
  const id = ref.slice(7);
  const sprite = spec.sprites.custom[id];
  if (!sprite) return [];
  const problem = spriteProblem(sprite);
  return problem
    ? [
        {
          code: 'SPRITE_INVALID',
          path: `/sprites/custom/${escapePointer(id)}`,
          message: `authored boss sprite "${id}" is malformed: ${problem}`,
        },
      ]
    : [];
}

/** True if an animation frame's rows match the sprite's w×h and charset. */
function framesDimsOk(rows: string[], w: number, h: number): boolean {
  return rows.length === h && rows.every((r) => r.length === w && /^[0-9a-f.]+$/.test(r));
}

/**
 * Checks every custom sprite; bad ones are dropped and any role that referenced
 * them silently falls back to the assigned library sprite for that role.
 * Mutates a copy; returns the sanitized spec + a human-readable downgrade list.
 */
export function applySpriteFallbacks(
  spec: GameSpec,
  options: SpriteFallbackOptions = {},
): { spec: GameSpec; downgraded: string[] } {
  const out = structuredClone(spec);
  const downgraded: string[] = [];
  const bad = new Set<string>();
  // A custom sprite assigned to any tile_* role is judged by tile rules
  // (must be exactly 16×16; may be fully opaque).
  const tileCustomIds = new Set(
    Object.entries(out.sprites.assign)
      .filter(([role, ref]) => role.startsWith('tile_') && ref.startsWith('custom:'))
      .map(([, ref]) => ref.slice(7)),
  );
  const opaqueTileCustomIds = new Set(
    Object.entries(out.sprites.assign)
      .filter(
        ([role, ref]) =>
          (role === 'tile_solid' || role === 'tile_solid_inner') && ref.startsWith('custom:'),
      )
      .map(([, ref]) => ref.slice(7)),
  );
  for (const [id, sprite] of Object.entries(out.sprites.custom)) {
    const problem = spriteProblem(sprite, {
      isTile: tileCustomIds.has(id),
      requireOpaque: opaqueTileCustomIds.has(id),
    });
    if (problem) {
      bad.add(id);
      downgraded.push(`custom sprite "${id}" (${problem})`);
      delete out.sprites.custom[id];
    } else if (sprite.frames) {
      // Keep only well-formed animation frames; a malformed extra frame is
      // dropped rather than costing the whole sprite.
      const requireOpaque = opaqueTileCustomIds.has(id);
      const good = sprite.frames.filter(
        (rows) =>
          framesDimsOk(rows, sprite.w, sprite.h) &&
          (!requireOpaque || rows.every((row) => !/[.0]/.test(row))),
      );
      if (good.length) sprite.frames = good;
      else delete sprite.frames;
    }
  }
  const fallbacks = ROLE_LIB_FALLBACK[out.archetype];
  for (const [role, ref] of Object.entries(out.sprites.assign)) {
    const m = SPRITE_REF_RE.exec(ref);
    const isBadCustom = m && m[1] === 'custom' && (bad.has(m[2]!) || !out.sprites.custom[m[2]!]);
    const isUnknownLib = m && m[1] === 'lib' && !LIB_SPRITE_IDS.includes(m[2]!);
    const isWrongInnerLib =
      role === 'tile_solid_inner' &&
      m?.[1] === 'lib' &&
      !/^[a-z][a-z0-9_]*_solid_inner$/.test(m[2]!);
    if (!m || isBadCustom || isUnknownLib || isWrongInnerLib) {
      // An invalid optional body assignment must be absent, not replaced with
      // the default body's family. The runtime can then infer the matching
      // companion from a themed cap, or reuse a custom cap unchanged.
      if (role === 'tile_solid_inner') {
        delete out.sprites.assign[role];
        if (isWrongInnerLib) {
          downgraded.push(`assign.${role} pointed at incompatible "${ref}"`);
        } else if (m && !isBadCustom && isUnknownLib) {
          downgraded.push(`assign.${role} pointed at unknown "${ref}"`);
        }
        continue;
      }
      // Self-named roles (tile_solid, obj_spring, proj_arrow, pickup_spread, …)
      // fall back to their same-named library sprite — a bad custom wall must
      // become the default wall, never a character sprite.
      const selfNamed = LIB_SPRITE_IDS.includes(role) ? `lib:${role}` : undefined;
      const replacement =
        out.archetype === 'platformer' && role === 'boss'
          ? platformerBossFallback(out.seed, options.recentBosses)
          : (fallbacks[role] ?? selfNamed ?? GENERIC_FALLBACK[out.archetype]);
      out.sprites.assign[role] = replacement;
      if (ref !== replacement) {
        downgraded.push(`assign.${role} fell back from "${ref}" to "${replacement}"`);
      }
      if (m && !isBadCustom && isUnknownLib)
        downgraded.push(`assign.${role} pointed at unknown "${ref}"`);
    }
  }
  return { spec: out, downgraded };
}

/**
 * Sanitize normally, then restore only a malformed, defined custom platformer
 * boss so the repair model can see and patch it. If that sprite was shared by
 * another role, the other role stays safely downgraded.
 */
export function applySpriteFallbacksForRepair(
  spec: GameSpec,
  options: SpriteFallbackOptions = {},
): GameSpec {
  const bossRef = spec.archetype === 'platformer' ? spec.sprites.assign['boss'] : undefined;
  const bossId = bossRef?.startsWith('custom:') ? bossRef.slice(7) : undefined;
  const bossSprite = bossId ? spec.sprites.custom[bossId] : undefined;
  const shouldRestore = !!bossSprite && !!spriteProblem(bossSprite);
  const sanitized = applySpriteFallbacks(spec, options).spec;
  if (!shouldRestore || !bossId || !bossRef || !bossSprite) return sanitized;
  sanitized.sprites.custom[bossId] = structuredClone(bossSprite);
  sanitized.sprites.assign['boss'] = bossRef;
  return sanitized;
}

// ---------------------------------------------------------------------------
// Deterministic generated-spec normalization
// ---------------------------------------------------------------------------

/** A mechanical correction made before spending an LLM repair attempt. */
export interface NormalizationFix {
  code:
    | 'SPRITE_DIMENSIONS'
    | 'SPRITE_ROLE_ALIAS'
    | 'SPRITE_REF_ALIAS'
    | 'SPRITE_ROLE_UNUSED'
    | 'BACKDROP_ALIAS'
    | 'TILE_WHITESPACE'
    | 'TILE_ROWS'
    | 'PLATFORMER_COORD'
    | 'PLATFORMER_CHECKPOINT_COORD'
    | 'PLATFORMER_MOVING_PLATFORM_COORD'
    | 'PLATFORMER_MOVING_PLATFORM_STATIONARY'
    | 'PLATFORMER_ARENA_HEADROOM'
    | 'ADVENTURE_COORD'
    | 'ADVENTURE_CONTENT'
    | 'SHOOTER_TIMING';
  path: string;
  message: string;
}

export interface NormalizedGeneratedSpec {
  spec: GameSpec;
  fixes: NormalizationFix[];
}

const PLATFORMER_ASSIGN_ROLES = new Set([
  'hero',
  'boss',
  'walker',
  'flyer',
  'shooter',
  'chaser',
  'coin',
  'heart',
  'powerup',
  'projectile',
  'enemy_projectile',
  'obj_spring',
  'obj_platform',
  'tile_solid',
  'tile_solid_inner',
  'tile_platform',
  'tile_hazard',
  'tile_checkpoint',
  'tile_exit',
  'tile_deco',
]);

const SHOOTER_ASSIGN_ROLES = new Set([
  'hero',
  'boss',
  'popcorn',
  'weaver',
  'tank',
  'turret',
  'kamikaze',
  'pod',
  'projectile',
  'enemy_shot',
  'pickup_spread',
  'pickup_rapid',
  'pickup_shield',
  'pickup_bomb',
]);

const ADVENTURE_ASSIGN_ROLES = new Set([
  'hero',
  'boss',
  'walker',
  'flyer',
  'shooter',
  'chaser',
  'bruiser',
  'npc',
  'key',
  'heart',
  'item',
  'enemy_shot',
  'proj_arrow',
  'proj_wave',
  'item_boomerang',
  'proj_bomb',
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
]);

const HSHOOTER_ASSIGN_ROLES = new Set([
  ...SHOOTER_ASSIGN_ROLES,
  'tile_solid',
  'tile_hazard',
  'tile_deco',
]);

const ASSIGN_ROLES: Record<ArchetypeId, ReadonlySet<string>> = {
  platformer: PLATFORMER_ASSIGN_ROLES,
  shooter: SHOOTER_ASSIGN_ROLES,
  adventure: ADVENTURE_ASSIGN_ROLES,
  hshooter: HSHOOTER_ASSIGN_ROLES,
  fighter: new Set(['hero', 'boss']),
};

const ROLE_ALIASES: Record<ArchetypeId, Readonly<Record<string, string>>> = {
  platformer: {
    spring: 'obj_spring',
    platform: 'obj_platform',
    enemyShot: 'enemy_projectile',
    enemy_shot: 'enemy_projectile',
    tile_decoration: 'tile_deco',
  },
  shooter: {
    spread: 'pickup_spread',
    rapid: 'pickup_rapid',
    shield: 'pickup_shield',
    bomb: 'pickup_bomb',
    enemyShot: 'enemy_shot',
    enemy_projectile: 'enemy_shot',
    tile_decoration: 'tile_deco',
  },
  adventure: {
    enemyShot: 'enemy_shot',
    enemy_projectile: 'enemy_shot',
    tile_decoration: 'tile_deco',
  },
  hshooter: {
    spread: 'pickup_spread',
    rapid: 'pickup_rapid',
    shield: 'pickup_shield',
    bomb: 'pickup_bomb',
    enemyShot: 'enemy_shot',
    enemy_projectile: 'enemy_shot',
    tile_decoration: 'tile_deco',
  },
  fighter: {},
};

const SHOOTER_BACKDROP_ALIASES: Readonly<Record<string, NonNullable<ShooterSpec['backdrop']>>> = {
  starfield: 'deepspace',
  circuit: 'metropolis',
  city: 'metropolis',
  factory: 'metropolis',
  candy: 'nebula',
  caves: 'asteroids',
  mountains: 'canyon',
  ruins: 'canyon',
  pyramids: 'canyon',
  hills: 'ocean',
  clouds: 'ocean',
};

function addFix(
  fixes: NormalizationFix[],
  code: NormalizationFix['code'],
  path: string,
  message: string,
): void {
  fixes.push({ code, path, message });
}

function normalizeSpriteAssignments(out: GameSpec, fixes: NormalizationFix[]): void {
  const assign = out.sprites.assign;
  for (const [alias, role] of Object.entries(ROLE_ALIASES[out.archetype])) {
    const ref = assign[alias];
    if (!ref) continue;
    if (!assign[role]) assign[role] = ref;
    delete assign[alias];
    addFix(
      fixes,
      'SPRITE_ROLE_ALIAS',
      `/sprites/assign/${escapePointer(alias)}`,
      `normalized role "${alias}" to runtime role "${role}"`,
    );
  }

  // "circuit" is a backdrop name, not a tile family. The mechanically closest
  // existing family is clockwork; it has the same complete set of tile kinds.
  for (const [role, ref] of Object.entries(assign)) {
    const match = /^lib:circuit_([a-z][a-z0-9_]*)$/.exec(ref);
    if (!match) continue;
    const replacement = `lib:clockwork_${match[1]}`;
    if (!LIB_SPRITE_IDS.includes(replacement.slice(4))) continue;
    assign[role] = replacement;
    addFix(
      fixes,
      'SPRITE_REF_ALIAS',
      `/sprites/assign/${escapePointer(role)}`,
      `normalized unavailable "${ref}" to "${replacement}"`,
    );
  }

  const supported = ASSIGN_ROLES[out.archetype];
  for (const role of Object.keys(assign)) {
    if (supported.has(role)) continue;
    delete assign[role];
    addFix(
      fixes,
      'SPRITE_ROLE_UNUSED',
      `/sprites/assign/${escapePointer(role)}`,
      `removed role "${role}" because ${out.archetype} never reads it`,
    );
  }
}

function normalizeBackdrop(out: GameSpec, fixes: NormalizationFix[]): void {
  if (out.archetype !== 'shooter' || !out.backdrop) return;
  const replacement = SHOOTER_BACKDROP_ALIASES[out.backdrop];
  if (!replacement) return;
  const previous = out.backdrop;
  out.backdrop = replacement;
  addFix(
    fixes,
    'BACKDROP_ALIAS',
    '/backdrop',
    `mapped side-view backdrop "${previous}" to vertical-shooter backdrop "${replacement}"`,
  );
}

function cleanPixelRow(row: string): string {
  return row.replace(/\s/g, '.').replace(/[A-F]/g, (ch) => ch.toLowerCase());
}

function contentWidth(rows: readonly string[]): number {
  let width = 0;
  for (const row of rows) {
    for (let x = row.length - 1; x >= 0; x--) {
      if (row[x] !== '.' && row[x] !== '0') {
        width = Math.max(width, x + 1);
        break;
      }
    }
  }
  return width;
}

function contentHeight(rows: readonly string[]): number {
  for (let y = rows.length - 1; y >= 0; y--) {
    if ([...rows[y]!].some((ch) => ch !== '.' && ch !== '0')) return y + 1;
  }
  return 0;
}

/**
 * Reconcile a custom sprite's declared canvas with its authored pixels. Short
 * rows/frames are transparent-padded; transparent overhang is trimmed; real
 * overhang expands the canvas (up to the schema's 48px ceiling). Nothing with
 * irrecoverable >48px content is clipped.
 */
function normalizeCustomSprites(out: GameSpec, fixes: NormalizationFix[]): void {
  const tileIds = new Set(
    Object.entries(out.sprites.assign)
      .filter(([role, ref]) => role.startsWith('tile_') && ref.startsWith('custom:'))
      .map(([, ref]) => ref.slice(7)),
  );

  for (const [id, sprite] of Object.entries(out.sprites.custom)) {
    if (
      !Number.isInteger(sprite.w) ||
      !Number.isInteger(sprite.h) ||
      sprite.w < 4 ||
      sprite.h < 4 ||
      sprite.w > 48 ||
      sprite.h > 48 ||
      !Array.isArray(sprite.rows) ||
      !sprite.rows.every((row) => typeof row === 'string') ||
      (sprite.frames &&
        (!Array.isArray(sprite.frames) ||
          !sprite.frames.every(
            (frame) => Array.isArray(frame) && frame.every((row) => typeof row === 'string'),
          )))
    ) {
      continue;
    }

    const groups = [sprite.rows, ...(sprite.frames ?? [])].map((rows) => rows.map(cleanPixelRow));
    const neededW = Math.max(sprite.w, ...groups.map(contentWidth));
    const neededH = Math.max(sprite.h, ...groups.map(contentHeight));
    const isTile = tileIds.has(id);
    // A tile cannot flex its dimensions because it is drawn on a fixed 16px
    // collision grid. Transparent counting slips are safe; real overhang waits
    // for repair/fallback instead of being cropped.
    if (
      neededW > 48 ||
      neededH > 48 ||
      (isTile && (sprite.w !== 16 || sprite.h !== 16 || neededW > 16 || neededH > 16))
    ) {
      continue;
    }
    const targetW = isTile ? 16 : neededW;
    const targetH = isTile ? 16 : neededH;
    const normalizeFrame = (rows: readonly string[]): string[] => {
      const normalized = rows.slice(0, targetH).map((row) => {
        if (row.length >= targetW) return row.slice(0, targetW);
        return row + '.'.repeat(targetW - row.length);
      });
      while (normalized.length < targetH) normalized.push('.'.repeat(targetW));
      return normalized;
    };
    const nextRows = normalizeFrame(groups[0]!);
    const nextFrames = groups.slice(1).map(normalizeFrame);
    const before = JSON.stringify({
      w: sprite.w,
      h: sprite.h,
      rows: sprite.rows,
      frames: sprite.frames,
    });
    const after = JSON.stringify({
      w: targetW,
      h: targetH,
      rows: nextRows,
      frames: sprite.frames ? nextFrames : undefined,
    });
    if (before === after) continue;
    const oldShape = `${sprite.w}x${sprite.h}`;
    sprite.w = targetW;
    sprite.h = targetH;
    sprite.rows = nextRows;
    if (sprite.frames) sprite.frames = nextFrames;
    addFix(
      fixes,
      'SPRITE_DIMENSIONS',
      `/sprites/custom/${escapePointer(id)}`,
      `reconciled custom sprite rows/frames from declared ${oldShape} to ${targetW}x${targetH}`,
    );
  }
}

function cleanTileWhitespace(
  rows: readonly string[],
  legend: Readonly<Record<string, string>>,
): { rows: string[]; changed: number } {
  let changed = 0;
  const cleaned = rows.map((row) =>
    [...row]
      .map((ch) => {
        if (!/\s/.test(ch)) return ch;
        const kind = legend[ch];
        if (kind !== undefined && kind !== 'empty' && kind !== 'floor') return ch;
        changed++;
        return '.';
      })
      .join(''),
  );
  return { rows: cleaned, changed };
}

function equalizeRows(
  rows: readonly string[],
  maxWidth: number,
  forcedWidth?: number,
): string[] | null {
  if (!rows.length) return [...rows];
  const target = forcedWidth ?? Math.max(...rows.map((row) => row.length));
  if (target < 1 || target > maxWidth) return null;
  const out: string[] = [];
  for (const row of rows) {
    if (row.length === target) out.push(row);
    else if (row.length < target) out.push(row + '.'.repeat(target - row.length));
    else if (/^[.]*$/.test(row.slice(target))) out.push(row.slice(0, target));
    else return null;
  }
  return out;
}

function normalizeGrid(
  rows: string[],
  legend: Record<string, string>,
  path: string,
  maxWidth: number,
  fixes: NormalizationFix[],
  forcedWidth?: number,
): string[] {
  const whitespace = cleanTileWhitespace(rows, legend);
  if (whitespace.changed) {
    addFix(
      fixes,
      'TILE_WHITESPACE',
      path,
      `replaced ${whitespace.changed} undeclared whitespace tile character(s) with empty cells`,
    );
  }
  const equal = equalizeRows(whitespace.rows, maxWidth, forcedWidth);
  if (!equal) return whitespace.rows;
  if (equal.some((row, i) => row !== whitespace.rows[i])) {
    addFix(
      fixes,
      'TILE_ROWS',
      path,
      `equalized ${equal.length} tile rows to ${equal[0]?.length ?? 0} columns`,
    );
  }
  return equal;
}

type GridCoord = { x: number; y: number };

function nearestCell(
  origin: GridCoord,
  w: number,
  h: number,
  accepts: (x: number, y: number) => boolean,
): GridCoord | null {
  let best: GridCoord | null = null;
  let bestScore: readonly number[] | null = null;
  const isBefore = (left: readonly number[], right: readonly number[]): boolean => {
    for (let i = 0; i < left.length; i++) {
      if (left[i] === right[i]) continue;
      return left[i]! < right[i]!;
    }
    return false;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!accepts(x, y)) continue;
      // Prefer minimal movement, then staying in the same column, then the
      // smallest horizontal displacement. The final coordinates make ties
      // deterministic without inventing randomness.
      const score = [
        Math.abs(x - origin.x) + Math.abs(y - origin.y),
        x === origin.x ? 0 : 1,
        Math.abs(x - origin.x),
        y,
        x,
      ] as const;
      if (!bestScore || isBefore(score, bestScore)) {
        best = { x, y };
        bestScore = score;
      }
    }
  }
  return best;
}

function normalizePlatformerContent(out: GameSpec, fixes: NormalizationFix[]): void {
  if (out.archetype !== 'platformer') return;
  const playerHeight = out.playerHeightTiles === 2 ? 2 : 1;
  out.levels.forEach((level, li) => {
    const gridPath = `/levels/${li}/tiles`;
    level.tiles = normalizeGrid(level.tiles, level.legend, gridPath, 256, fixes);
    const h = level.tiles.length;
    const w = level.tiles[0]?.length ?? 0;
    if (!w || !h || level.tiles.some((row) => row.length !== w)) return;
    const kind = (x: number, y: number): string => {
      const ch = level.tiles[y]?.[x];
      return ch === undefined || ch === '.' ? 'empty' : (level.legend[ch] ?? 'empty');
    };
    const solidLike = (value: string) => value === 'solid' || value === 'platform';
    const bodyOpen = (value: string) =>
      value !== 'solid' && value !== 'platform' && value !== 'hazard';
    const standable = (x: number, y: number) =>
      x >= 0 &&
      x < w &&
      y >= playerHeight - 1 &&
      y + 1 < h &&
      bodyOpen(kind(x, y)) &&
      (playerHeight === 1 || bodyOpen(kind(x, y - 1))) &&
      solidLike(kind(x, y + 1));
    const setCell = (x: number, y: number, value: string): void => {
      const row = level.tiles[y];
      if (row === undefined || x < 0 || x >= row.length) return;
      level.tiles[y] = row.slice(0, x) + value + row.slice(x + 1);
    };

    for (const [name, coord] of [
      ['playerSpawn', level.playerSpawn],
      ['exit', level.exit],
    ] as const) {
      if (standable(coord.x, coord.y)) continue;
      const replacement = nearestCell(coord, w, h, standable);
      if (!replacement) continue;
      const before = `(${coord.x},${coord.y})`;
      coord.x = replacement.x;
      coord.y = replacement.y;
      addFix(
        fixes,
        'PLATFORMER_COORD',
        `/levels/${li}/${name}`,
        `moved ${name} from ${before} to grounded open cell (${coord.x},${coord.y})`,
      );
    }

    // A checkpoint is itself a walk-through tile, but it still needs the same
    // supported foot cell and headroom as the player. Moving the marker is
    // lossless: retain its authored character, clear only its old cell, and
    // choose an empty destination so no terrain or other marker is replaced.
    const checkpoints: { x: number; y: number; ch: string }[] = [];
    level.tiles.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]!;
        if (level.legend[ch] === 'checkpoint') checkpoints.push({ x, y, ch });
      }
    });
    const reserved = new Set([
      `${level.playerSpawn.x},${level.playerSpawn.y}`,
      `${level.exit.x},${level.exit.y}`,
    ]);
    for (const checkpoint of checkpoints) {
      if (standable(checkpoint.x, checkpoint.y)) continue;
      setCell(checkpoint.x, checkpoint.y, '.');
      const replacement = nearestCell(checkpoint, w, h, (x, y) => {
        return !reserved.has(`${x},${y}`) && kind(x, y) === 'empty' && standable(x, y);
      });
      if (!replacement) {
        setCell(checkpoint.x, checkpoint.y, checkpoint.ch);
        continue;
      }
      setCell(replacement.x, replacement.y, checkpoint.ch);
      addFix(
        fixes,
        'PLATFORMER_CHECKPOINT_COORD',
        `/levels/${li}/tiles/${checkpoint.y}`,
        `moved checkpoint "${checkpoint.ch}" from (${checkpoint.x},${checkpoint.y}) to supported cell (${replacement.x},${replacement.y}) with required headroom`,
      );
    }

    const movingPlatformPathClear = (
      startX: number,
      startY: number,
      dx: number,
      dy: number,
    ): boolean => {
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const platformX = Math.round(startX + dx * t);
        const platformY = Math.round(startY + dy * t);
        if (
          platformX < 0 ||
          platformX + 1 >= w ||
          platformY < playerHeight ||
          platformY >= h
        ) {
          return false;
        }
        for (const x of [platformX, platformX + 1]) {
          // The moving platform owns its whole 24x8 surface. Letting it travel
          // through an authored solid or one-way platform makes the two
          // surfaces flicker/stack and can leave its collider hidden in the
          // terrain. Its rider also needs the full configured body corridor.
          if (solidLike(kind(x, platformY))) return false;
          for (let riderRow = 1; riderRow <= playerHeight; riderRow++) {
            if (!bodyOpen(kind(x, platformY - riderRow))) return false;
          }
        }
      }
      return true;
    };
    const movingPlatformClearance =
      playerHeight === 2 ? 'two clear player rows' : 'a clear player row';

    level.entities.forEach((entity, ei) => {
      if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) return;
      const origin = { x: Math.round(entity.x), y: Math.round(entity.y) };

      if (entity.type === 'movingPlatform') {
        const dx = entity.props?.dx ?? 0;
        const dy = entity.props?.dy ?? 0;
        const replacement = nearestCell(origin, w, h, (x, y) =>
          movingPlatformPathClear(x, y, dx, dy),
        );
        if (replacement) {
          if (replacement.x === entity.x && replacement.y === entity.y) return;
          const before = `(${entity.x},${entity.y})`;
          entity.x = replacement.x;
          entity.y = replacement.y;
          addFix(
            fixes,
            'PLATFORMER_MOVING_PLATFORM_COORD',
            `/levels/${li}/entities/${ei}`,
            `moved movingPlatform from ${before} to (${entity.x},${entity.y}) while retaining travel vector (${dx},${dy}) and ${movingPlatformClearance}`,
          );
          return;
        }

        const stationary = nearestCell(origin, w, h, (x, y) => movingPlatformPathClear(x, y, 0, 0));
        if (!stationary) return;
        const before = `(${entity.x},${entity.y})`;
        entity.x = stationary.x;
        entity.y = stationary.y;
        entity.props = { ...entity.props, dx: 0, dy: 0 };
        addFix(
          fixes,
          'PLATFORMER_MOVING_PLATFORM_STATIONARY',
          `/levels/${li}/entities/${ei}`,
          `made movingPlatform stationary at (${entity.x},${entity.y}) because travel vector (${dx},${dy}) had no in-bounds path with ${movingPlatformClearance} (previous origin ${before})`,
        );
        return;
      }

      let x = Math.max(0, Math.min(w - 1, origin.x));
      let y = Math.max(0, Math.min(h - 1, origin.y));
      if (solidLike(kind(x, y))) {
        const needsSupport =
          entity.type === 'walker' ||
          entity.type === 'shooter' ||
          entity.type === 'chaser' ||
          entity.type === 'spring';
        const open = nearestCell({ x, y }, w, h, (cx, cy) => {
          // Pickups and flyers may float, but every entity should leave the
          // authored one-way tile itself. The nearest-cell ordering selects
          // the same-column cell immediately above whenever it is available.
          if (kind(cx, cy) !== 'empty') return false;
          return !needsSupport || (cy + 1 < h && solidLike(kind(cx, cy + 1)));
        });
        if (open) ({ x, y } = open);
      }
      if (x === entity.x && y === entity.y) return;
      const before = `(${entity.x},${entity.y})`;
      entity.x = x;
      entity.y = y;
      addFix(
        fixes,
        'PLATFORMER_COORD',
        `/levels/${li}/entities/${ei}`,
        `moved ${entity.type} from ${before} to valid cell (${x},${y})`,
      );
    });
  });

  if (out.boss.arena) {
    out.boss.arena.tiles = normalizeGrid(
      out.boss.arena.tiles,
      out.boss.arena.legend,
      '/boss/arena/tiles',
      256,
      fixes,
    );
    const arena = out.boss.arena;
    const h = arena.tiles.length;
    const w = arena.tiles[0]?.length ?? 0;
    if (playerHeight === 2 && h >= 4 && w >= 2 && arena.tiles.every((row) => row.length === w)) {
      let cleared = 0;
      for (const y of [h - 4, h - 3]) {
        const row = arena.tiles[y]!;
        const chars = [...row];
        for (let x = 1; x < w - 1; x++) {
          const tileKind = arena.legend[chars[x]!] ?? 'empty';
          if (tileKind !== 'solid' && tileKind !== 'platform' && tileKind !== 'hazard') continue;
          chars[x] = '.';
          cleared++;
        }
        arena.tiles[y] = chars.join('');
      }
      if (cleared) {
        addFix(
          fixes,
          'PLATFORMER_ARENA_HEADROOM',
          '/boss/arena/tiles',
          `cleared ${cleared} blocking interior cell(s) from boss-arena headroom rows ${h - 4}-${h - 3} while preserving both side walls`,
        );
      }
    }
  }
}

function normalizeAdventureContent(out: GameSpec, fixes: NormalizationFix[]): void {
  if (out.archetype !== 'adventure') return;
  const dungeon = out.levels[0];
  if (!dungeon) return;
  const enemyTypes = new Set(['walker', 'flyer', 'shooter', 'chaser', 'bruiser']);
  dungeon.rooms.forEach((room, ri) => {
    room.tiles = normalizeGrid(
      room.tiles,
      room.legend,
      `/levels/0/rooms/${ri}/tiles`,
      24,
      fixes,
      24,
    );
    const h = room.tiles.length;
    const w = room.tiles[0]?.length ?? 0;
    if (w && h && room.tiles.every((row) => row.length === w)) {
      const kind = (x: number, y: number): string => {
        const ch = room.tiles[y]?.[x];
        return ch === undefined || ch === '.' ? 'floor' : (room.legend[ch] ?? 'floor');
      };
      room.entities.forEach((entity, ei) => {
        if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) return;
        const origin = { x: Math.round(entity.x), y: Math.round(entity.y) };
        const clamped = {
          x: Math.max(0, Math.min(w - 1, origin.x)),
          y: Math.max(0, Math.min(h - 1, origin.y)),
        };
        const replacement =
          kind(clamped.x, clamped.y) === 'wall' || kind(clamped.x, clamped.y) === 'pit'
            ? nearestCell(clamped, w, h, (x, y) => kind(x, y) !== 'wall' && kind(x, y) !== 'pit')
            : clamped;
        if (!replacement || (replacement.x === entity.x && replacement.y === entity.y)) return;
        const before = `(${entity.x},${entity.y})`;
        entity.x = replacement.x;
        entity.y = replacement.y;
        addFix(
          fixes,
          'ADVENTURE_COORD',
          `/levels/0/rooms/${ri}/entities/${ei}`,
          `moved ${entity.type} from ${before} to walkable cell (${entity.x},${entity.y})`,
        );
      });
    }

    for (const [ei, entity] of room.entities.entries()) {
      if (entity.type !== 'item' || entity.props?.item === dungeon.items.secondary) continue;
      entity.props = { ...entity.props, item: dungeon.items.secondary };
      addFix(
        fixes,
        'ADVENTURE_CONTENT',
        `/levels/0/rooms/${ri}/entities/${ei}/props/item`,
        `matched item pedestal to dungeon secondary item "${dungeon.items.secondary}"`,
      );
    }

    if (room.id === dungeon.bossRoom) {
      const before = room.entities.length;
      room.entities = room.entities.filter((entity) => !enemyTypes.has(entity.type));
      const removed = before - room.entities.length;
      if (removed) {
        addFix(
          fixes,
          'ADVENTURE_CONTENT',
          `/levels/0/rooms/${ri}/entities`,
          `removed ${removed} ordinary enemy ${removed === 1 ? 'spawn' : 'spawns'} from the boss room`,
        );
      }
    }
  });
  const doorsBefore = JSON.stringify(dungeon.rooms.map((room) => room.doors));
  reconcileDoors(dungeon);
  if (doorsBefore !== JSON.stringify(dungeon.rooms.map((room) => room.doors))) {
    addFix(
      fixes,
      'ADVENTURE_CONTENT',
      '/levels/0/rooms',
      'mirrored adjacent door declarations so both sides agree',
    );
  }
}

type TimedLevel = Extract<GameSpec, { archetype: 'shooter' | 'hshooter' }>['levels'][number];

function normalizeShooterTiming(level: TimedLevel, path: string, fixes: NormalizationFix[]): void {
  if (
    !Number.isFinite(level.durationS) ||
    level.waves.some(
      (wave) =>
        !Number.isFinite(wave.t) || !Number.isFinite(wave.count) || !Number.isFinite(wave.fireRate),
    ) ||
    level.pickups.some((pickup) => !Number.isFinite(pickup.t))
  ) {
    return;
  }
  const before = JSON.stringify({ waves: level.waves, pickups: level.pickups });
  const maxWaveT = Math.max(0, level.durationS - 4);
  const maxPickupT = Math.max(0, level.durationS - 2);
  const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
  const round = (value: number) => Math.round(value * 1000) / 1000;

  level.waves.forEach((wave) => {
    wave.t = round(clamp(wave.t, 0, maxWaveT));
    wave.count = Math.round(clamp(wave.count, 1, 8));
    wave.fireRate = round(clamp(wave.fireRate, 0, 2));
  });
  level.waves.sort((a, b) => a.t - b.t);

  const lifetime = 8;
  const maxActive = 18;
  const maxBulletsPerSecond = 14;
  const withinEntityBudget = (waves: typeof level.waves): boolean =>
    waves.every((at) => {
      const active = waves.reduce(
        (sum, other) =>
          other.t <= at.t + 0.01 && other.t + lifetime > at.t ? sum + other.count : sum,
        0,
      );
      return active <= maxActive;
    });
  const scheduled: typeof level.waves = [];
  for (const wave of level.waves) {
    const requestedT = wave.t;
    const candidateSet = new Set<number>([requestedT, 0, maxWaveT]);
    for (const prior of scheduled) {
      candidateSet.add(prior.t);
      if (prior.t + lifetime <= maxWaveT) candidateSet.add(round(prior.t + lifetime));
    }
    const candidates = [...candidateSet].filter((t) => t >= 0 && t <= maxWaveT);
    candidates.sort((a, b) => {
      const aLater = a >= requestedT;
      const bLater = b >= requestedT;
      if (aLater !== bLater) return aLater ? -1 : 1;
      return aLater ? a - b : b - a;
    });
    let placed = false;
    for (let count = wave.count; count >= 1 && !placed; count--) {
      for (const t of candidates) {
        const candidate = { ...wave, t, count };
        if (!withinEntityBudget([...scheduled, candidate])) continue;
        wave.t = t;
        wave.count = count;
        scheduled.push(wave);
        placed = true;
        break;
      }
    }
    // durationS is schema-bounded to at least 45 seconds and a level has at
    // most 30 waves, so a one-enemy slot is always available. Keep this guard
    // non-destructive if handed a pre-schema object outside those contracts.
    if (!placed) scheduled.push(wave);
  }
  level.waves = scheduled.sort((a, b) => a.t - b.t);

  for (let i = 0; i < level.waves.length; i++) {
    const wave = level.waves[i]!;
    const active = level.waves
      .slice(0, i)
      .filter((prior) => prior.t <= wave.t + 0.01 && prior.t + lifetime > wave.t);
    const priorBps = active.reduce((sum, prior) => sum + prior.count * prior.fireRate, 0);
    const availableBps = Math.max(0, maxBulletsPerSecond - priorBps);
    wave.fireRate = round(Math.min(wave.fireRate, availableBps / Math.max(1, wave.count)));
  }

  level.pickups.forEach((pickup) => {
    pickup.t = round(clamp(pickup.t, 0, maxPickupT));
  });
  level.pickups.sort((a, b) => a.t - b.t);

  const after = JSON.stringify({ waves: level.waves, pickups: level.pickups });
  if (before !== after) {
    addFix(
      fixes,
      'SHOOTER_TIMING',
      path,
      'sorted/clamped wave timing and enforced the 18-entity / 14-bullets-per-second budgets',
    );
  }
}

/**
 * Apply only deterministic, content-preserving corrections that are cheaper
 * and more reliable than an LLM JSON-patch repair. Ambiguous topology, missing
 * authored content, and destructive clipping remain diagnostics for repair.
 */
export function normalizeGeneratedSpec(spec: GameSpec): NormalizedGeneratedSpec {
  const out = structuredClone(spec);
  const fixes: NormalizationFix[] = [];
  normalizeSpriteAssignments(out, fixes);
  normalizeCustomSprites(out, fixes);
  normalizeBackdrop(out, fixes);

  if (out.archetype === 'platformer') {
    normalizePlatformerContent(out, fixes);
  } else if (out.archetype === 'adventure') {
    normalizeAdventureContent(out, fixes);
  } else if (out.archetype === 'hshooter') {
    out.levels.forEach((level, li) => {
      level.tiles = normalizeGrid(level.tiles, level.legend, `/levels/${li}/tiles`, 340, fixes);
      normalizeShooterTiming(level, `/levels/${li}`, fixes);
    });
  } else if (out.archetype === 'shooter') {
    out.levels.forEach((level, li) => normalizeShooterTiming(level, `/levels/${li}`, fixes));
  }
  return { spec: out, fixes };
}

// ---------------------------------------------------------------------------
// Tile-grid normalization (a downgrade-free cleanup, not an error):
// LLMs reliably misalign long fixed-width row strings by a few characters.
// Padding short rows with '.' (empty) is always safe; overlong rows are
// trimmed only when the overhang is entirely '.', otherwise left for the
// lint → repair loop to surface honestly.
// ---------------------------------------------------------------------------

function normalizeRows(rows: string[], forcedWidth?: number): string[] {
  if (rows.length === 0) return rows;
  // Mode width (most common row length) is the intended width.
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
  let width = forcedWidth ?? rows[0]!.length;
  if (forcedWidth === undefined) {
    let best = 0;
    for (const [len, n] of counts) {
      if (n > best || (n === best && len > width)) {
        best = n;
        width = len;
      }
    }
  }
  return rows.map((row) => {
    if (row.length === width) return row;
    if (row.length < width) return row + '.'.repeat(width - row.length);
    const overhang = row.slice(width);
    return /^\.*$/.test(overhang) ? row.slice(0, width) : row;
  });
}

/** Normalize every tile grid in a spec (platformer levels, adventure rooms). */
export function normalizeTileGrids(spec: GameSpec): GameSpec {
  const out = structuredClone(spec);
  if (out.archetype === 'platformer') {
    for (const level of out.levels) level.tiles = normalizeRows(level.tiles);
  } else if (out.archetype === 'adventure') {
    const dungeon = out.levels[0];
    if (dungeon?.rooms) {
      for (const room of dungeon.rooms) room.tiles = normalizeRows(room.tiles, 24);
      // Mirror/agree the two declarations of each shared door so a one-sided
      // door slip doesn't fail generation on ADV_DOOR_MISMATCH.
      reconcileDoors(dungeon);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Title / premise similarity (anti-duplicate)
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i, ...new Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n]!;
}

/** 0..1 similarity of two titles (normalized edit distance + containment). */
export function titleSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

export function tooSimilar(title: string, existingTitles: string[]): string | null {
  for (const t of existingTitles) {
    if (titleSimilarity(title, t) >= 0.8) return t;
  }
  return null;
}
