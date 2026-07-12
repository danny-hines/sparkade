// Dev-time checker for the hand-authored engine sprite library.
// Usage: npx tsx scripts/check-art.mts [group ...]   (groups: heroes enemies bosses objects tiles font)
// Validates data shape and renders an upscaled PNG contact sheet per group to
// scratch/art-<group>.png (using sharp) for visual review.
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'scratch');

// Preview palette following the PALETTE_SLOTS semantics (Sweetie-16-derived, CC0).
const PREVIEW_PALETTE = [
  '#000000', // 0 transparent (not drawn)
  '#1a1c2c', // 1 outline
  '#29366f', // 2 bg-dark
  '#3b5dc9', // 3 bg-mid
  '#41a6f6', // 4 bg-light
  '#38b764', // 5 hero-primary
  '#a7f070', // 6 hero-secondary
  '#ffcd75', // 7 hero-accent
  '#b13e53', // 8 enemy-primary
  '#ef7d57', // 9 enemy-secondary
  '#5d275d', // a enemy-accent
  '#e04040', // b hazard
  '#ffa300', // c accent-warm
  '#ffd75e', // d gold
  '#94b0c2', // e light
  '#f4f4f4', // f white
];

interface SpriteData {
  w: number;
  h: number;
  rows: string[];
}
interface LibraryEntry {
  frames: SpriteData[];
  anims: Record<string, number[]>;
  headSlots?: { x: number; y: number; size: 12 | 16 }[];
}

const EXPECTED: Record<string, string[]> = {
  heroes: [
    'hero_squire',
    'hero_gadget',
    'hero_ranger',
    'hero_wander',
    'hero_scout',
    'hero_sage',
    'ship_dart',
    'ship_falcon',
    'ship_bloom',
  ],
  enemies: [
    'enemy_walker',
    'enemy_flyer',
    'enemy_shooter',
    'enemy_chaser',
    'enemy_bruiser',
    'foe_popcorn',
    'foe_weaver',
    'foe_tank',
    'foe_turret',
    'foe_kamikaze',
  ],
  bosses: ['boss_titan', 'boss_leviathan', 'boss_warden'],
  objects: [
    'proj_pellet',
    'proj_orb',
    'proj_arrow',
    'proj_bolt',
    'proj_bomb',
    'proj_wave',
    'pickup_coin',
    'pickup_heart',
    'pickup_key',
    'pickup_power',
    'pickup_gem',
    'pickup_bomb',
    'pickup_shield',
    'pickup_spread',
    'pickup_rapid',
    'pickup_star',
    'item_boomerang',
    'item_bombs',
    'item_bow',
    'npc_keeper',
    'obj_spring',
    'obj_platform',
  ],
  tiles: [
    'tile_solid',
    'tile_platform',
    'tile_hazard',
    'tile_checkpoint',
    'tile_exit',
    'tile_deco',
    'tile_wall',
    'tile_floor',
    'tile_block',
    'tile_pit',
    'tile_switch',
    'tile_door_locked',
    'tile_door_boss',
    'tile_door_open',
  ],
};

// Expansion waves live in their own files (one author per file — no merge
// conflicts): group name = file name, export = GROUP_NAME upper-snake.
EXPECTED['heroes-platformer'] = ['hero_miner', 'hero_astro', 'hero_ninja'];
EXPECTED['heroes-adventure'] = ['hero_paladin', 'hero_druid', 'hero_tinker'];
EXPECTED['ships'] = ['ship_saucer', 'ship_manta', 'ship_hammer'];
EXPECTED['enemies-ground'] = ['enemy_slime', 'enemy_beetle', 'enemy_wisp'];
EXPECTED['foes-shooter'] = ['foe_drone', 'foe_ray', 'foe_orbiter'];
EXPECTED['npcs'] = ['npc_elder', 'npc_merchant', 'npc_ghost', 'npc_tinker'];
EXPECTED['bosses-platformer'] = ['boss_drake', 'boss_knight', 'boss_thorn'];
EXPECTED['bosses-shooter'] = ['boss_fortress', 'boss_hive', 'boss_prism'];
EXPECTED['bosses-adventure'] = ['boss_minotaur', 'boss_lich', 'boss_spider'];

// Themed tilesets: tiles-<theme> groups, ids <theme>_<kind>, export TILES_<THEME>.
const TILE_KINDS = [
  'solid',
  'platform',
  'hazard',
  'checkpoint',
  'exit',
  'deco',
  'wall',
  'floor',
  'block',
  'pit',
  'switch',
  'door_locked',
  'door_boss',
  'door_open',
];
for (const theme of [
  'castle',
  'cave',
  'wasteland',
  'alien',
  'ice',
  'desert',
  'clockwork',
  'candy',
  'coral',
  'garden',
]) {
  EXPECTED[`tiles-${theme}`] = TILE_KINDS.map((k) => `${theme}_${k}`);
}

const errors: string[] = [];
function err(msg: string) {
  errors.push(msg);
}

function coverage(s: SpriteData): number {
  let opaque = 0;
  for (const row of s.rows) for (const ch of row) if (ch !== '.') opaque++;
  return opaque / (s.w * s.h);
}

function checkEntry(group: string, id: string, e: LibraryEntry) {
  if (!Array.isArray(e.frames) || e.frames.length === 0) {
    err(`${id}: no frames`);
    return;
  }
  const { w, h } = e.frames[0]!;
  e.frames.forEach((f, i) => {
    if (f.w !== w || f.h !== h) err(`${id} frame ${i}: inconsistent size ${f.w}x${f.h} vs ${w}x${h}`);
    if (f.rows.length !== f.h) err(`${id} frame ${i}: rows.length ${f.rows.length} != h ${f.h}`);
    f.rows.forEach((row, ri) => {
      if (row.length !== f.w) err(`${id} frame ${i} row ${ri}: length ${row.length} != w ${f.w}`);
      if (!/^[0-9a-f.]*$/.test(row)) err(`${id} frame ${i} row ${ri}: bad chars`);
    });
    const cov = coverage(f);
    const min = group.startsWith('tiles') ? 0.15 : 0.1;
    if (cov < min) err(`${id} frame ${i}: only ${(cov * 100).toFixed(0)}% opaque — too sparse`);
  });
  if (!e.anims || !e.anims['idle']) err(`${id}: missing 'idle' anim`);
  for (const [name, idxs] of Object.entries(e.anims ?? {})) {
    for (const ix of idxs)
      if (ix < 0 || ix >= e.frames.length) err(`${id} anim '${name}': frame index ${ix} out of range`);
  }
  if (e.headSlots) {
    if (e.headSlots.length !== e.frames.length)
      err(`${id}: headSlots length ${e.headSlots.length} != frames ${e.frames.length}`);
    for (const [i, hs] of e.headSlots.entries()) {
      if (hs.x < 0 || hs.y < 0 || hs.x + hs.size > w + 4 || hs.y + hs.size > h + 4)
        err(`${id} headSlot ${i}: ${JSON.stringify(hs)} escapes ${w}x${h} sprite too far`);
    }
  }
  // Solid structural tiles must read as solid.
  if (/(_solid|_wall|_floor|_block)$/.test(id)) {
    if (coverage(e.frames[0]!) < 0.95) err(`${id}: structural tile must be ~fully opaque`);
  }
  if (group.startsWith('tiles') && (w !== 16 || h !== 16)) err(`${id}: tiles must be 16x16`);
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

async function renderSheet(group: string, entries: Record<string, LibraryEntry>) {
  const sharp = (await import('sharp')).default;
  const scale = 6;
  const pad = 4;
  const items = Object.entries(entries);
  const cell = Math.max(...items.flatMap(([, e]) => e.frames.map((f) => Math.max(f.w, f.h)))) + pad;
  const cols = Math.max(...items.map(([, e]) => e.frames.length));
  const width = (cols * cell + pad) * scale;
  const height = (items.length * cell + pad) * scale;
  const buf = Buffer.alloc(width * height * 4);
  // checkerboard background so transparency is visible
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dark = ((x >> 4) + (y >> 4)) % 2 === 0;
      buf[i] = dark ? 24 : 32;
      buf[i + 1] = dark ? 24 : 32;
      buf[i + 2] = dark ? 28 : 38;
      buf[i + 3] = 255;
    }
  items.forEach(([, e], row) => {
    e.frames.forEach((f, col) => {
      const ox = (pad + col * cell) * scale;
      const oy = (pad + row * cell) * scale;
      f.rows.forEach((r, py) => {
        for (let px = 0; px < r.length; px++) {
          const ch = r[px]!;
          if (ch === '.') continue;
          const [cr, cg, cb] = hexToRgb(PREVIEW_PALETTE[parseInt(ch, 16)]!);
          for (let sy = 0; sy < scale; sy++)
            for (let sx = 0; sx < scale; sx++) {
              const X = ox + px * scale + sx;
              const Y = oy + py * scale + sy;
              const i = (Y * width + X) * 4;
              buf[i] = cr;
              buf[i + 1] = cg;
              buf[i + 2] = cb;
              buf[i + 3] = 255;
            }
        }
      });
    });
  });
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `art-${group}.png`);
  await sharp(buf, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(out);
  console.log(`  contact sheet: ${out}`);
  console.log(`  row order: ${items.map(([id]) => id).join(', ')}`);
}

async function checkFont() {
  const modPath = join(root, 'packages/engine/src/fontdata.ts');
  if (!existsSync(modPath)) {
    err('fontdata.ts missing');
    return;
  }
  const mod = await import(String(new URL(`file:///${modPath.replace(/\\/g, '/')}`)));
  const glyphs: Record<string, string[]> = mod.FONT_GLYPHS;
  const required =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?:;\'"()[]+-*/=<>_%#@&$^~{}|\\';
  for (const ch of required) {
    const g = glyphs[ch];
    if (!g) {
      err(`font: missing glyph '${ch}'`);
      continue;
    }
    if (g.length !== 8) err(`font '${ch}': needs 8 rows`);
    for (const row of g) if (!/^[.#]{8}$/.test(row)) err(`font '${ch}': rows must be 8 chars of . or #`);
  }
  // render sheet
  const entries: Record<string, LibraryEntry> = {};
  const chars = Object.keys(glyphs);
  for (let i = 0; i < chars.length; i += 16) {
    const group = chars.slice(i, i + 16);
    entries[`row${i / 16}`] = {
      frames: group.map((c) => ({
        w: 8,
        h: 8,
        rows: glyphs[c]!.map((r) => r.replace(/#/g, 'f')),
      })),
      anims: { idle: [0] },
    };
  }
  await renderSheet('font', entries);
}

const groups = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(EXPECTED).concat('font');
for (const group of groups) {
  if (group === 'font') {
    await checkFont();
    continue;
  }
  const modPath = join(root, `packages/engine/src/library/${group}.ts`);
  if (!existsSync(modPath)) {
    err(`${group}.ts missing`);
    continue;
  }
  const mod = await import(String(new URL(`file:///${modPath.replace(/\\/g, '/')}`)));
  const exportName = group.toUpperCase().replace(/-/g, '_');
  const entries: Record<string, LibraryEntry> = mod[exportName];
  if (!entries) {
    err(`${group}.ts must export const ${exportName}`);
    continue;
  }
  for (const id of EXPECTED[group] ?? []) if (!entries[id]) err(`${group}: missing id ${id}`);
  for (const [id, e] of Object.entries(entries)) checkEntry(group, id, e);
  await renderSheet(group, entries);
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('\nart check: OK');
