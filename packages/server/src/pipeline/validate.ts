// Validation gates: ajv schema validation → security scan (no markup, URLs,
// code, paths or unknown ids in any string field) → custom-sprite checks with
// silent library fallback → title/premise similarity. Archetype lint() runs
// from the runner via the archetypes registry.
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import {
  ARCHETYPE_SCHEMAS,
  DESIGN_SCHEMA,
  LIB_SPRITE_IDS,
  type ArchetypeId,
  type GameSpec,
  type LintError,
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
  return (v.errors ?? []).slice(0, 40).map((e) => ({
    code: 'SCHEMA',
    path: e.instancePath || '/',
    message: `${e.instancePath || '(root)'} ${e.message ?? 'is invalid'}${
      e.keyword === 'additionalProperties'
        ? ` (unexpected property "${(e.params as { additionalProperty?: string }).additionalProperty}")`
        : ''
    }`,
  }));
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
        out.push({ code: 'SCAN_REJECTED', path: `/sprites/custom/${id}`, message: 'bad sprite id' });
      }
    }
  }
  return out;
}

function escapePointer(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

// ---------------------------------------------------------------------------
// Custom-sprite checks with silent library fallback (a downgrade, not an error)
// ---------------------------------------------------------------------------

const ROLE_LIB_FALLBACK: Record<ArchetypeId, Record<string, string>> = {
  platformer: {
    hero: 'lib:hero_squire',
    boss: 'lib:boss_titan',
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
    enemyShot: 'lib:proj_pellet',
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
    enemyShot: 'lib:proj_pellet',
  },
};

const GENERIC_FALLBACK: Record<ArchetypeId, string> = {
  platformer: 'lib:enemy_walker',
  shooter: 'lib:foe_popcorn',
  adventure: 'lib:enemy_walker',
};

export function spriteProblem(s: SpriteData, opts: { isTile?: boolean } = {}): string | null {
  if (s.rows.length !== s.h) return `rows.length ${s.rows.length} != h ${s.h}`;
  for (const [i, row] of s.rows.entries()) {
    if (row.length !== s.w) return `row ${i} length ${row.length} != w ${s.w}`;
    if (!/^[0-9a-f.]+$/.test(row)) return `row ${i} has invalid characters`;
  }
  let opaque = 0;
  for (const row of s.rows) for (const ch of row) if (ch !== '.' && ch !== '0') opaque++;
  const coverage = opaque / (s.w * s.h);
  if (coverage < 0.15) return `only ${(coverage * 100).toFixed(0)}% opaque (minimum 15%)`;
  // The anti-blob ceiling is for characters; terrain tiles are legitimately
  // solid (a fully-opaque wall tile is correct, not a defect).
  if (!opts.isTile && coverage > 0.85) return `${(coverage * 100).toFixed(0)}% opaque (maximum 85%)`;
  if (opts.isTile && (s.w !== 16 || s.h !== 16)) return `tile sprites must be 16×16 (got ${s.w}×${s.h})`;
  return null;
}

/**
 * Checks every custom sprite; bad ones are dropped and any role that referenced
 * them silently falls back to the assigned library sprite for that role.
 * Mutates a copy; returns the sanitized spec + a human-readable downgrade list.
 */
export function applySpriteFallbacks(spec: GameSpec): { spec: GameSpec; downgraded: string[] } {
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
  for (const [id, sprite] of Object.entries(out.sprites.custom)) {
    const problem = spriteProblem(sprite, { isTile: tileCustomIds.has(id) });
    if (problem) {
      bad.add(id);
      downgraded.push(`custom sprite "${id}" (${problem})`);
      delete out.sprites.custom[id];
    }
  }
  const fallbacks = ROLE_LIB_FALLBACK[out.archetype];
  for (const [role, ref] of Object.entries(out.sprites.assign)) {
    const m = SPRITE_REF_RE.exec(ref);
    const isBadCustom = m && m[1] === 'custom' && (bad.has(m[2]!) || !out.sprites.custom[m[2]!]);
    const isUnknownLib = m && m[1] === 'lib' && !LIB_SPRITE_IDS.includes(m[2]!);
    if (!m || isBadCustom || isUnknownLib) {
      // Self-named roles (tile_solid, obj_spring, proj_arrow, pickup_spread, …)
      // fall back to their same-named library sprite — a bad custom wall must
      // become the default wall, never a character sprite.
      const selfNamed = LIB_SPRITE_IDS.includes(role) ? `lib:${role}` : undefined;
      out.sprites.assign[role] = fallbacks[role] ?? selfNamed ?? GENERIC_FALLBACK[out.archetype];
      if (m && !isBadCustom && isUnknownLib) downgraded.push(`assign.${role} pointed at unknown "${ref}"`);
    }
  }
  return { spec: out, downgraded };
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
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
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
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
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
