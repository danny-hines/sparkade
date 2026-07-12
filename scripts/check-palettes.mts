// Dev-time checker for the curated palette-mood library.
// Usage:
//   npx tsx scripts/check-palettes.mts                       # whole library
//   npx tsx scripts/check-palettes.mts <relFile> <ExportName>  # one family file
// Validates each PaletteMood against paletteProblems() and renders a review
// sheet to scratch/palette-moods[-<export>].png: per mood a labeled 16-swatch
// strip plus a mini "in-use" scene (bg bands, hero blob, enemy blob, hazard,
// gold, and an f-on-bg text-contrast chip) to judge legibility at a glance.
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { paletteProblems, hexToRgb, type PaletteMood } from '../packages/shared/src/palette';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'scratch');

// Source: a single family file (agent workflow) or the merged library (default).
const [relFile, exportName] = process.argv.slice(2);
let PALETTE_MOODS: PaletteMood[];
let sheetName = 'palette-moods';
if (relFile && exportName) {
  const mod = await import(pathToFileURL(join(root, relFile)).href);
  PALETTE_MOODS = mod[exportName];
  if (!Array.isArray(PALETTE_MOODS)) {
    console.error(`${relFile} does not export an array named ${exportName}`);
    process.exit(1);
  }
  sheetName = `palette-moods-${exportName.toLowerCase()}`;
} else {
  PALETTE_MOODS = (await import('../packages/shared/src/palette-moods')).PALETTE_MOODS;
}

const errors: string[] = [];
const seen = new Set<string>();
for (const m of PALETTE_MOODS) {
  if (seen.has(m.id)) errors.push(`duplicate mood id: ${m.id}`);
  seen.add(m.id);
  if (m.colors.length !== 16) errors.push(`${m.id}: ${m.colors.length} colors (need 16)`);
  const probs = paletteProblems(m.colors);
  for (const p of probs) errors.push(`${m.id}: [${p.code}] ${p.message}`);
}

// ---- render ---------------------------------------------------------------
const SW = 34; // swatch size
const STRIP_H = SW + 16;
const SCENE_H = 90;
const ROW_H = STRIP_H + SCENE_H + 24;
const LABEL_W = 190;
const SCENE_W = 460;
const WIDTH = LABEL_W + Math.max(16 * SW, SCENE_W) + 40;
const HEIGHT = PALETTE_MOODS.length * ROW_H + 20;

const buf = Buffer.alloc(WIDTH * HEIGHT * 4);
function px(x: number, y: number, hex: string, a = 255): void {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const { r, g, b } = hexToRgb(hex);
  const i = (y * WIDTH + x) * 4;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
  buf[i + 3] = a;
}
function rect(x: number, y: number, w: number, h: number, hex: string): void {
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) px(x + xx, y + yy, hex);
}
function disc(cx: number, cy: number, rad: number, hex: string): void {
  for (let yy = -rad; yy <= rad; yy++)
    for (let xx = -rad; xx <= rad; xx++)
      if (xx * xx + yy * yy <= rad * rad) px(cx + xx, cy + yy, hex);
}
// dark charcoal page background
for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) px(x, y, '#0b0d16');

PALETTE_MOODS.forEach((m, row) => {
  const y0 = 10 + row * ROW_H;
  const c = m.colors;
  // swatch strip
  const sx = LABEL_W;
  for (let i = 0; i < 16; i++) {
    rect(sx + i * SW, y0, SW - 2, SW, c[i]!);
    // slot index tick in the row above (a 3px bar colored by the swatch, lightens dark ones)
  }
  // mini in-use scene, drawn to the right region below the strip
  const gy = y0 + STRIP_H;
  // bg bands (slots 2,3,4)
  rect(sx, gy, SCENE_W, SCENE_H, c[2]!);
  rect(sx, gy, SCENE_W, Math.floor(SCENE_H * 0.66), c[3]!);
  rect(sx, gy, SCENE_W, Math.floor(SCENE_H * 0.33), c[4]!);
  // hero (5/6/7 + outline 1)
  disc(sx + 60, gy + 55, 22, c[1]!);
  disc(sx + 60, gy + 55, 20, c[5]!);
  disc(sx + 60, gy + 50, 12, c[6]!);
  disc(sx + 56, gy + 46, 4, c[7]!);
  // enemy (8/9/a + outline)
  disc(sx + 150, gy + 55, 20, c[1]!);
  disc(sx + 150, gy + 55, 18, c[8]!);
  disc(sx + 150, gy + 52, 10, c[9]!);
  disc(sx + 146, gy + 48, 4, c[10]!);
  // hazard spikes (b)
  for (let k = 0; k < 5; k++) {
    const hx = sx + 210 + k * 14;
    for (let t = 0; t < 12; t++) rect(hx - Math.floor(t / 2), gy + SCENE_H - 6 - t, 1 + t, 1, c[11]!);
  }
  // gold pips (d) + warm accent (c)
  disc(sx + 300, gy + 30, 7, c[13]!);
  disc(sx + 320, gy + 40, 7, c[13]!);
  disc(sx + 310, gy + 60, 6, c[12]!);
  // text-contrast chip: f on 2 (left) label area
  rect(sx + 350, gy + 20, 100, 50, c[2]!);
  // fake 'TEXT' bars in near-white f
  for (const bx of [360, 372, 384, 396, 408, 420]) rect(sx + bx, gy + 34, 7, 22, c[15]!);
  rect(sx + 350, gy + 20, 100, 2, c[14]!);
});

const problems = new Set(errors.map((e) => e.split(':')[0]));
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${sheetName}.png`);
const sharp = (await import('sharp')).default;
await sharp(buf, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } }).png().toFile(outPath);
console.log(`  ${PALETTE_MOODS.length} moods · review sheet: ${outPath}`);
console.log(`  row order: ${PALETTE_MOODS.map((m) => m.name).join(', ')}`);

if (errors.length) {
  console.error(`\n${errors.length} problem(s) across ${problems.size} mood(s):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('\npalette check: OK');
