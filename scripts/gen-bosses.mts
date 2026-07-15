// Boss-sprite generator: compose 32×32 bosses from shape primitives, enforce
// left-right symmetry, auto-outline the rim, shade top→bottom, then BAKE the
// rows into packages/engine/src/library/bosses-extra.ts. Also writes a
// self-contained render.html (to the OS temp dir) for visual iteration.
//   npx tsx scripts/gen-bosses.mts   → re-bake bosses-extra.ts + render.html
// Edit the shape functions below and re-run rather than nudging pixels by hand.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(tmpdir(), 'sparkade-boss-render');
mkdirSync(DIR, { recursive: true });
const N = 32;
type Grid = string[][];
const make = (): Grid => Array.from({ length: N }, () => Array.from({ length: N }, () => '.'));
const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;
const set = (g: Grid, x: number, y: number, c: string) => { if (inb(Math.round(x), Math.round(y))) g[Math.round(y)]![Math.round(x)] = c; };

function ellipse(g: Grid, cx: number, cy: number, rx: number, ry: number, c: string, fill = true) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    const d = dx * dx + dy * dy;
    if (fill ? d <= 1 : Math.abs(d - 1) < 0.35) g[y]![x] = c;
  }
}
function rect(g: Grid, x0: number, y0: number, x1: number, y1: number, c: string) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(g, x, y, c);
}
function line(g: Grid, x0: number, y0: number, x1: number, y1: number, c: string) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) set(g, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, c);
}
/** Vertical tapering tentacle/limb with a slight S-curve, symmetric partner handled by mirror. */
function tentacle(g: Grid, x: number, yTop: number, yBot: number, amp: number, phase: number, w0: number, c: string) {
  for (let y = yTop; y <= yBot; y++) {
    const t = (y - yTop) / (yBot - yTop);
    const cx = x + Math.sin(t * Math.PI * 1.4 + phase) * amp * t;
    const w = Math.max(1, w0 * (1 - t * 0.7));
    for (let k = -w; k <= w; k++) set(g, cx + k, y, c);
  }
}
/** Mirror the left half onto the right (col 16+i := col 15-i) → perfect symmetry. */
function mirrorX(g: Grid) {
  for (let y = 0; y < N; y++) for (let i = 0; i < N / 2; i++) g[y]![N / 2 + i] = g[y]![N / 2 - 1 - i]!;
}
/** Convert fill cells on the silhouette edge into outline (1). */
function rimOutline(g: Grid) {
  const isFill = (x: number, y: number) => inb(x, y) && g[y]![x] !== '.' && g[y]![x] !== '1';
  const toEdge: [number, number][] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!isFill(x, y)) continue;
    if (!isFill(x - 1, y) || !isFill(x + 1, y) || !isFill(x, y - 1) || !isFill(x, y + 1)) toEdge.push([x, y]);
  }
  for (const [x, y] of toEdge) g[y]![x] = '1';
}
/** Shade remaining primary (8) cells: top band → 9 (light), bottom band → a (shadow). */
function shade(g: Grid, top: number, bot: number) {
  const h = bot - top;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (g[y]![x] !== '8') continue;
    const t = (y - top) / h;
    if (t < 0.32) g[y]![x] = '9';
    else if (t > 0.72) g[y]![x] = 'a';
  }
}
function eye(g: Grid, cx: number, cy: number, glow: string) {
  rect(g, cx - 1, cy - 1, cx + 1, cy + 1, 'f'); // white
  set(g, cx, cy, '1'); // pupil
  set(g, cx, cy + 1, glow); // glow under
}
type Mode = 'idle' | 'attack' | 'hurt';
/** Filled triangle — wings, horns, headdresses, crystal facets, fins. */
function tri(g: Grid, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, ch: string) {
  const s = (px: number, py: number, x0: number, y0: number, x1: number, y1: number) => (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0);
  for (let y = Math.min(ay, by, cy); y <= Math.max(ay, by, cy); y++)
    for (let x = Math.min(ax, bx, cx); x <= Math.max(ax, bx, cx); x++) {
      const d1 = s(x, y, ax, ay, bx, by), d2 = s(x, y, bx, by, cx, cy), d3 = s(x, y, cx, cy, ax, ay);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) set(g, x, y, ch);
    }
}
/** Concentric eye: white sclera → iris → dark pupil, with a glint. */
function bigEye(g: Grid, cx: number, cy: number, r: number, iris: string) {
  ellipse(g, cx, cy, r, r, 'f');
  ellipse(g, cx, cy, r - 1, r - 1, iris);
  ellipse(g, cx, cy, Math.max(1, r - 2), Math.max(1, r - 2), '1');
  set(g, cx - 1, cy - 1, 'f');
}
/** Clean white hurt flash — body lightens, no dither. */
function flash(g: Grid) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = g[y]![x]; if (c === '8') g[y]![x] = 'e'; else if (c === '9') g[y]![x] = 'f'; else if (c === 'a') g[y]![x] = '9';
  }
}
/** Tapering serpentine limb from base (xb,yb) UP to tip (xt,yt) — hydra necks,
 *  medusa hair. A gentle sideways bulge gives it life. */
function neck(g: Grid, xb: number, yb: number, xt: number, yt: number, w: number, c: string) {
  const steps = Math.max(1, yb - yt);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = xb + (xt - xb) * t + Math.sin(t * Math.PI) * 1.5;
    const ww = Math.max(0, w * (1 - t * 0.45));
    for (let k = -ww; k <= ww; k++) set(g, x + k, yb - i, c);
  }
}
/** Ruffle the silhouette edge into deterministic fur tufts (call before outline). */
function fur(g: Grid, c: string) {
  const add: [number, number][] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (g[y]![x] === '.' || g[y]![x] === '1') continue;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const)
      if (inb(x + dx, y + dy) && g[y + dy]![x + dx] === '.' && ((x + dx) * 5 + (y + dy) * 3) % 4 === 0) add.push([x + dx, y + dy]);
  }
  for (const [x, y] of add) g[y]![x] = c;
}
const rows = (g: Grid): string[] => g.map((r) => r.join(''));

// ---------------------------------------------------------------------------
// boss_ooze — crowned slime king: gelatinous dome, inner core, big eyes, drippy
// underside, a gold crown of points on top.
// ---------------------------------------------------------------------------
function ooze(mode: 'idle' | 'attack' | 'hurt'): string[] {
  const g = make();
  const cy = 21, ry = 10, rx = 13;
  // gelatinous dome, flat-ish bottom sitting on the ground with drips
  ellipse(g, 16, cy, rx, ry, '8');
  rect(g, 4, 30, 27, 31, '8');
  for (const dx of [6, 11, 16, 21, 26]) rect(g, dx - 1, 29, dx + 1, 31, '8'); // drips
  rimOutline(g);
  shade(g, cy - ry, 31);
  // small warm core glimmering inside the belly
  ellipse(g, 16, 25, 2, 2, mode === 'attack' ? 'f' : 'c');
  // gold crown, band sitting on the head, five points
  rect(g, 9, 9, 22, 10, 'd');
  line(g, 9, 8, 22, 8, '1');
  line(g, 9, 11, 22, 11, '1');
  for (const px of [10, 13, 16, 19, 22]) { set(g, px, 6, 'd'); set(g, px, 7, 'd'); set(g, px, 5, '1'); }
  // angry brows + eyes
  line(g, 9, 15, 12, 16, '1'); line(g, 19, 16, 22, 15, '1');
  eye(g, 11, 18, 'b'); eye(g, 20, 18, 'b');
  // mouth
  if (mode === 'attack') { rect(g, 13, 24, 18, 27, '1'); rect(g, 14, 25, 17, 26, 'b'); rect(g, 14, 24, 17, 24, 'f'); }
  else line(g, 13, 25, 18, 25, '1');
  // hurt: clean white flash (body lightens), no dither
  if (mode === 'hurt') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = g[y]![x];
    if (c === '8') g[y]![x] = 'e'; else if (c === '9') g[y]![x] = 'f'; else if (c === 'a') g[y]![x] = '9';
  }
  mirrorX(g);
  return rows(g);
}

// ---------------------------------------------------------------------------
// boss_automaton — clockwork colossus: boxy head + single glowing eye, blocky
// torso with a big gear in the chest, piston arms, stompy legs.
// ---------------------------------------------------------------------------
function gear(g: Grid, cx: number, cy: number, r: number, c: string) {
  ellipse(g, cx, cy, r, r, c);
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) { set(g, cx + Math.cos(a) * (r + 1), cy + Math.sin(a) * (r + 1), c); }
  ellipse(g, cx, cy, r - 2, r - 2, '1');
}
function automaton(mode: 'idle' | 'attack' | 'hurt'): string[] {
  const g = make();
  // head
  rect(g, 12, 3, 19, 8, '8');
  set(g, 15, 1, 'd'); set(g, 15, 2, '1'); set(g, 16, 1, 'd'); set(g, 16, 2, '1'); // antenna
  // torso
  rect(g, 8, 10, 23, 23, '8');
  // shoulders + arms (pistons ending in fists)
  rect(g, 4, 11, 7, 14, '8'); rect(g, 24, 11, 27, 14, '8');
  rect(g, 4, 15, 6, 22, '8'); rect(g, 25, 15, 27, 22, '8');
  rect(g, 3, 22, 7, 26, '8'); rect(g, 24, 22, 28, 26, '8'); // fists
  // legs
  rect(g, 10, 24, 14, 31, '8'); rect(g, 17, 24, 21, 31, '8');
  rimOutline(g);
  shade(g, 3, 31);
  // face: single glowing eye band
  rect(g, 13, 5, 18, 6, '1'); rect(g, 14, 5, 17, 5, mode === 'attack' ? 'f' : 'c');
  // chest gear
  gear(g, 16, 16, 4, mode === 'attack' ? 'f' : 'd');
  // rivets
  for (const [x, y] of [[9, 11], [22, 11], [9, 22], [22, 22]] as const) set(g, x, y, 'd');
  if (mode === 'hurt') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = g[y]![x];
    if (c === '8') g[y]![x] = 'e'; else if (c === '9') g[y]![x] = 'f'; else if (c === 'a') g[y]![x] = '9';
  }
  mirrorX(g);
  return rows(g);
}

// ---------------------------------------------------------------------------
// boss_kraken — cephalopod: round mantle, two big eyes, hard beak, six tentacles
// splaying out and down with glowing suckers.
// ---------------------------------------------------------------------------
function kraken(mode: 'idle' | 'attack' | 'hurt'): string[] {
  const g = make();
  const spread = mode === 'attack' ? 1.5 : 1;
  // six tentacles (draw three on the left, mirror). curl outward (negative amp).
  tentacle(g, 10, 13, 31, -6 * spread, 0, 2.2, '8');
  tentacle(g, 13, 14, 31, -3 * spread, 0.6, 2, '8');
  tentacle(g, 15, 15, 30, -1, 1.1, 1.8, '8');
  // mantle (head)
  ellipse(g, 16, 9, 8, 7, '8');
  ellipse(g, 16, 5, 5, 4, '8'); // domed top
  rimOutline(g);
  shade(g, 2, 31);
  // glowing suckers down the tentacles
  for (const [x, y] of [[9, 18], [8, 23], [9, 28], [12, 20], [12, 25], [15, 22], [15, 27]] as const) set(g, x, y, 'c');
  // eyes + beak
  eye(g, 11, 9, 'b'); eye(g, 20, 9, 'b');
  if (mode === 'attack') { rect(g, 14, 13, 17, 15, '1'); set(g, 15, 14, 'b'); set(g, 16, 14, 'b'); }
  else { line(g, 14, 14, 17, 14, 'd'); } // hard beak
  set(g, 15, 15, 'd'); set(g, 16, 15, 'd');
  if (mode === 'hurt') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = g[y]![x]; if (c === '8') g[y]![x] = 'e'; else if (c === '9') g[y]![x] = 'f'; else if (c === 'a') g[y]![x] = '9';
  }
  mirrorX(g);
  return rows(g);
}

// ---------------------------------------------------------------------------
// boss_wraith — hooded reaper: pointed cowl over a black void face with two
// burning eyes, a robe that flares to a tattered hem, bony claws at the sides.
// ---------------------------------------------------------------------------
function wraith(mode: 'idle' | 'attack' | 'hurt'): string[] {
  const g = make();
  const spread = mode === 'attack' ? 1.2 : 1;
  // rounded hood cowl on top, robe flaring to the hem below
  ellipse(g, 16, 11, 9, 9, '8');
  for (let y = 16; y <= 31; y++) {
    const hw = (9 + (y - 16) * 0.34) * spread;
    rect(g, Math.round(16 - hw), y, Math.round(15 + hw), y, '8');
  }
  // bony claws reaching from the sleeves
  for (const [cx, cy2] of [[5, 21]] as const) { rect(g, cx - 1, cy2, cx + 1, cy2 + 4, 'e'); set(g, cx - 2, cy2 + 1, 'e'); set(g, cx + 2, cy2 + 1, 'e'); set(g, cx, cy2 + 5, '1'); }
  rimOutline(g);
  shade(g, 2, 31);
  // large black void face set INTO the hood (leaves a cowl rim framing it)
  ellipse(g, 16, 12, 6, 6, '1');
  rect(g, 11, 12, 20, 17, '1');
  // burning eyes deep in the cowl
  const glow = mode === 'attack' ? 'f' : 'b';
  rect(g, 12, 11, 13, 12, glow); rect(g, 18, 11, 19, 12, glow);
  set(g, 12, 13, 'c'); set(g, 19, 13, 'c');
  if (mode === 'attack') { rect(g, 14, 15, 17, 16, glow); } // shrieking maw
  // tattered hem
  for (let x = 3; x < 29; x++) if (x % 3 === 0) set(g, x, 31, '.');
  if (mode === 'hurt') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = g[y]![x]; if (c === '8') g[y]![x] = 'e'; else if (c === '9') g[y]![x] = 'f'; else if (c === 'a') g[y]![x] = '9';
  }
  mirrorX(g);
  return rows(g);
}

// boss_cyclops — one-eyed brute: broad body, thick arms/fists, single huge eye.
function cyclops(mode: Mode): string[] {
  const g = make();
  const atk = mode === 'attack';
  ellipse(g, 16, 8, 7, 6, '8'); // head
  rect(g, 8, 13, 23, 24, '8'); // torso
  rect(g, 4, 14, 7, 22, '8'); rect(g, 3, 21, 7, 26, '8'); // left arm + fist
  rect(g, 10, 25, 14, 31, '8'); rect(g, 17, 25, 21, 31, '8'); // legs
  rimOutline(g);
  shade(g, 2, 31);
  bigEye(g, 16, 8, atk ? 4 : 3, 'b'); // one eye
  line(g, 10, 3, 14, 4, '1'); // brow
  if (atk) { rect(g, 12, 12, 19, 14, '1'); rect(g, 13, 13, 18, 13, 'b'); } else line(g, 13, 12, 18, 12, '1');
  set(g, 6, 24, 'd'); set(g, 6, 22, 'd'); // knuckle studs
  if (mode === 'hurt') flash(g);
  mirrorX(g);
  return rows(g);
}

// boss_toad — giant toad: squat wide body, bulging eyes, cavernous maw, warts.
function toad(mode: Mode): string[] {
  const g = make();
  const atk = mode === 'attack';
  ellipse(g, 16, 20, 13, 9, '8'); rect(g, 4, 24, 27, 31, '8');
  ellipse(g, 10, 11, 4, 4, '8'); ellipse(g, 21, 11, 4, 4, '8'); // eye bulges
  rect(g, 2, 26, 6, 31, '8'); rect(g, 25, 26, 29, 31, '8'); // splayed legs
  rimOutline(g);
  shade(g, 7, 31);
  bigEye(g, 10, 11, 2, 'd'); bigEye(g, 21, 11, 2, 'd');
  if (atk) { rect(g, 8, 17, 23, 24, '1'); rect(g, 9, 18, 22, 22, 'b'); rect(g, 14, 22, 17, 27, 'b'); }
  else { line(g, 7, 20, 24, 20, '1'); }
  for (const [x, y] of [[8, 25], [16, 27], [23, 25], [12, 16]] as const) set(g, x, y, 'a');
  if (mode === 'hurt') flash(g);
  mirrorX(g);
  return rows(g);
}

// boss_treant — walking tree: leafy crown, knotted trunk face, branch arms, roots.
function treant(mode: Mode): string[] {
  const g = make();
  const atk = mode === 'attack';
  ellipse(g, 16, 8, 10, 6, '8'); // crown
  ellipse(g, 7, 12, 4, 3, '8'); // side foliage
  rect(g, 12, 12, 19, 29, '8'); // trunk
  line(g, 12, 17, 5, 13, '8'); line(g, 5, 13, 2, atk ? 8 : 10, '8'); line(g, 5, 13, 3, 15, '8'); // branch arm + twigs
  rect(g, 9, 29, 12, 31, '8'); rect(g, 19, 29, 22, 31, '8'); line(g, 10, 31, 7, 31, '8'); // roots
  rimOutline(g);
  shade(g, 2, 31);
  eye(g, 13, 18, 'd'); eye(g, 18, 18, 'd');
  if (atk) { rect(g, 13, 22, 18, 25, '1'); rect(g, 14, 23, 17, 24, 'c'); } else line(g, 14, 23, 17, 23, '1');
  set(g, 12, 26, 'a'); set(g, 15, 15, 'a');
  if (mode === 'hurt') flash(g);
  mirrorX(g);
  return rows(g);
}

// boss_beholder — floating eye-horror: central sphere with a giant eye + fanged
// maw, several eye-stalks radiating out.
function beholder(mode: Mode): string[] {
  const g = make();
  const atk = mode === 'attack';
  // eye-stalks (left; mirror). line + glowing tip
  line(g, 11, 8, 9, 1, '8'); set(g, 9, 1, 'f'); set(g, 9, 2, atk ? 'f' : 'b');
  line(g, 8, 11, 3, 5, '8'); set(g, 2, 4, 'f'); set(g, 3, 5, atk ? 'f' : 'b');
  line(g, 7, 16, 1, 14, '8'); set(g, 0, 13, 'f'); set(g, 1, 14, atk ? 'f' : 'b');
  ellipse(g, 16, 16, 10, 9, '8'); // central sphere
  rimOutline(g);
  shade(g, 3, 31);
  bigEye(g, 16, 14, atk ? 6 : 5, 'b'); // giant central eye
  // fanged maw
  rect(g, 10, 22, 21, 24, '1');
  for (const x of [11, 14, 17, 20]) { set(g, x, 22, 'f'); set(g, x, 23, 'f'); }
  if (mode === 'hurt') flash(g);
  mirrorX(g);
  return rows(g);
}

// boss_demon — winged devil: horned head, V-torso, big strutted bat wings, hooves.
function demon(mode: Mode): string[] {
  const g = make();
  const atk = mode === 'attack';
  const sp = atk ? 2 : 0; // wing spread
  // big bat wing membrane (left; mirror), then notch the hem into finger scallops
  tri(g, 11, 10, 1 - sp, 4, 8, 23, '8');
  for (const [x, y] of [[2, 15], [3, 19], [5, 22], [6, 17]] as const) set(g, x, y, '.');
  // torso: broad shoulders tapering to the waist
  rect(g, 11, 13, 20, 16, '8'); rect(g, 12, 16, 19, 22, '8');
  // head + swept horns
  ellipse(g, 16, 9, 4, 3, '8');
  line(g, 13, 7, 10, 2, '8'); set(g, 10, 1, '8'); set(g, 11, 5, '8');
  // arm + hooved legs
  rect(g, 9, 14, 11, 20, '8');
  rect(g, 11, 22, 14, 31, '8'); rect(g, 17, 22, 20, 31, '8');
  rimOutline(g);
  shade(g, 0, 31);
  // wing bone struts (after outline so they read as ribs)
  line(g, 11, 11, 2 - sp, 5, '1'); line(g, 11, 12, 5, 21, '1'); line(g, 11, 12, 3, 15, '1');
  // burning eyes + maw
  set(g, 13, 9, atk ? 'f' : 'b'); set(g, 13, 8, '1');
  if (atk) rect(g, 14, 11, 17, 12, '1');
  // glowing chest sigil
  set(g, 16, 18, 'c'); set(g, 16, 19, 'b');
  set(g, 12, 31, 'a'); set(g, 13, 31, 'a'); // hoof
  if (mode === 'hurt') flash(g);
  mirrorX(g);
  return rows(g);
}

// boss_hydra — three-headed serpent: bulbous body, serpentine necks + snake heads.
function hydra(mode: Mode): string[] {
  const g = make();
  const atk = mode === 'attack';
  ellipse(g, 16, 26, 11, 5, '8'); // body
  neck(g, 11, 24, 6, atk ? 7 : 9, 2, '8'); ellipse(g, 6, atk ? 6 : 8, 3, 2, '8'); // left neck+head
  neck(g, 15, 23, 16, atk ? 4 : 5, 2.2, '8'); ellipse(g, 16, atk ? 4 : 5, 3, 2, '8'); // centre
  neck(g, 21, 24, 26, atk ? 7 : 9, 2, '8'); ellipse(g, 26, atk ? 6 : 8, 3, 2, '8'); // right
  rimOutline(g);
  shade(g, 3, 31);
  for (const [hx, hy] of [[6, atk ? 6 : 8], [16, atk ? 4 : 5], [26, atk ? 6 : 8]] as const) {
    set(g, hx - 1, hy - 1, atk ? 'f' : 'b'); set(g, hx + 1, hy - 1, atk ? 'f' : 'b');
    if (atk) { rect(g, hx - 1, hy + 1, hx + 1, hy + 2, '1'); set(g, hx, hy + 2, 'b'); } else line(g, hx - 1, hy + 1, hx + 1, hy + 1, '1');
  }
  for (const [x, y] of [[13, 28], [16, 29], [19, 28]] as const) set(g, x, y, 'a');
  if (mode === 'hurt') flash(g);
  mirrorX(g);
  return rows(g);
}

// boss_pharaoh — mummy king: striped nemes headdress framing a wrapped face,
// bandaged body, crook & flail crossed on the chest.
function pharaoh(mode: Mode): string[] {
  const g = make();
  const atk = mode === 'attack';
  // nemes headdress: trapezoid flaring from the crown down to the shoulders
  for (let y = 4; y <= 16; y++) { const hw = 4 + (y - 4) * 0.72; rect(g, Math.round(16 - hw), y, Math.round(15 + hw), y, 'd'); }
  ellipse(g, 16, 11, 4, 4, '8'); rect(g, 12, 9, 19, 16, '8'); // wrapped face opening
  rect(g, 11, 16, 20, 27, '8'); // wrapped body
  rect(g, 11, 27, 14, 31, '8'); rect(g, 17, 27, 20, 31, '8'); // legs
  rimOutline(g);
  shade(g, 4, 31);
  for (const x of [10, 12, 19, 21]) line(g, x, 5, x, 15, '1'); // nemes stripes
  for (const y of [19, 22, 25, 29]) line(g, 11, y, 20, y, 'a'); // bandages
  set(g, 14, 11, atk ? 'f' : 'c'); set(g, 17, 11, atk ? 'f' : 'c'); line(g, 13, 10, 14, 10, '1'); line(g, 17, 10, 18, 10, '1'); // kohl eyes
  if (atk) rect(g, 14, 13, 17, 14, '1');
  line(g, 14, 17, 15, 24, 'd'); set(g, 14, 16, 'd'); line(g, 17, 17, 16, 24, 'd'); set(g, 17, 16, 'd'); // crook + flail
  if (mode === 'hurt') flash(g);
  mirrorX(g);
  return rows(g);
}

// boss_yeti — furry snow-beast: shaggy body + arms, horned head, fanged roar.
function yeti(mode: Mode): string[] {
  const g = make();
  const atk = mode === 'attack';
  ellipse(g, 16, 19, 11, 10, '8'); // body
  ellipse(g, 16, 8, 6, 5, '8'); // head
  rect(g, 3, 15, 7, 27, '8'); rect(g, 25, 15, 29, 27, '8'); // arms
  rect(g, 9, 28, 14, 31, '8'); rect(g, 17, 28, 22, 31, '8'); // feet
  tri(g, 12, 4, 9, 0, 13, 5, '8'); tri(g, 20, 4, 23, 0, 19, 5, '8'); // horns
  fur(g, '8');
  rimOutline(g);
  shade(g, 3, 31);
  eye(g, 13, 7, 'b'); eye(g, 19, 7, 'b');
  if (atk) { rect(g, 12, 10, 19, 12, '1'); for (const x of [12, 15, 18]) { set(g, x, 10, 'f'); set(g, x, 11, 'f'); } }
  else line(g, 13, 10, 18, 10, '1');
  for (const [x, y] of [[4, 26], [27, 26], [5, 24], [26, 24]] as const) set(g, x, y, 'f'); // claws
  if (mode === 'hurt') flash(g);
  mirrorX(g);
  return rows(g);
}

// boss_scorpion — armored scorpion: pincers forward, segmented tail arcing over
// with a glowing sting.
function scorpion(mode: Mode): string[] {
  const g = make();
  const atk = mode === 'attack';
  ellipse(g, 16, 22, 8, 6, '8'); // cephalothorax
  ellipse(g, 16, 28, 5, 3, '8'); // abdomen
  // pincer arms (left + right), claws reaching forward
  rect(g, 6, 18, 9, 20, '8'); rect(g, 23, 18, 26, 20, '8');
  rect(g, atk ? 2 : 3, 15, 6, 21, '8'); rect(g, 26, 15, atk ? 30 : 29, 21, '8'); // upper claw
  rect(g, atk ? 4 : 5, 20, 7, 24, '8'); rect(g, 25, 20, atk ? 28 : 27, 24, '8'); // lower claw
  // legs
  for (const y of [21, 24, 27]) { line(g, 9, y, 5, y + 2, '8'); line(g, 23, y, 27, y + 2, '8'); }
  // tail arcing up the centre-back to a sting
  for (const [x, y] of [[16, 18], [16, 14], [15, 11], [14, 8], [14, 5]] as const) ellipse(g, x, y, 2, 2, '8');
  rimOutline(g);
  shade(g, 4, 31);
  eye(g, 14, 21, 'b'); eye(g, 18, 21, 'b');
  set(g, 13, 4, atk ? 'f' : 'b'); set(g, 14, 4, 'd'); set(g, 14, 3, atk ? 'f' : 'b'); // sting
  if (atk) rect(g, 11, 15, 8, 16, '1');
  if (mode === 'hurt') flash(g);
  mirrorX(g);
  return rows(g);
}

// boss_gorgon — medusa: female bust with a nest of snake-hair and a coiled tail.
function gorgon(mode: Mode): string[] {
  const g = make();
  const atk = mode === 'attack';
  // snake hair writhing from the head
  neck(g, 12, 8, 7, atk ? 1 : 3, 1.4, '8'); neck(g, 14, 6, 11, atk ? 0 : 2, 1.2, '8');
  neck(g, 20, 8, 25, atk ? 1 : 3, 1.4, '8'); neck(g, 18, 6, 21, atk ? 0 : 2, 1.2, '8');
  ellipse(g, 16, 10, 5, 4, '8'); // head
  rect(g, 11, 13, 20, 19, '8'); // bust/torso
  // coiled serpent tail below (stacked offset ovals)
  ellipse(g, 16, 22, 8, 4, '8'); ellipse(g, 14, 27, 7, 3, '8'); ellipse(g, 19, 30, 5, 2, '8');
  rimOutline(g);
  shade(g, 1, 31);
  for (const [x, y] of [[7, 3], [25, 3], [11, 2], [21, 2]] as const) { set(g, x, y, 'f'); set(g, x, y + 1, 'b'); } // hair eyes
  eye(g, 14, 10, atk ? 'f' : 'c'); eye(g, 18, 10, atk ? 'f' : 'c');
  if (atk) rect(g, 14, 12, 17, 13, '1'); else line(g, 14, 12, 17, 12, '1');
  for (const [x, y] of [[13, 23], [19, 23], [16, 28], [12, 27]] as const) set(g, x, y, 'a'); // scales
  if (mode === 'hurt') flash(g);
  mirrorX(g);
  return rows(g);
}

// ===== VEHICLE bosses — top-down craft (shooter/hshooter), nose pointing down ==

// boss_saucer — classic UFO: glass dome on a wide lit disc, tractor beam.
function saucer(mode: Mode): string[] {
  const g = make();
  const atk = mode === 'attack';
  ellipse(g, 16, 19, 15, 4, '8'); // disc
  ellipse(g, 16, 14, 7, 5, '8'); // dome
  rimOutline(g);
  shade(g, 9, 23);
  ellipse(g, 16, 13, 3, 2, atk ? 'f' : 'c'); // canopy glow
  for (const x of [4, 9, 16, 23, 28]) set(g, x, 20, atk ? 'f' : 'd'); // rim lights
  if (atk) tri(g, 16, 22, 10, 31, 22, 31, 'c'); else set(g, 16, 23, 'c'); // beam
  mirrorX(g);
  return rows(g);
}

// boss_core — armored battle-station: a single vast reactor eye ringed by turrets.
function core(mode: Mode): string[] {
  const g = make();
  const atk = mode === 'attack';
  ellipse(g, 16, 16, 12, 12, '8');
  for (const [x, y] of [[3, 10], [3, 22], [29, 10], [29, 22], [16, 2], [16, 30]] as const) rect(g, x - 1, y - 1, x + 1, y + 1, '8');
  rimOutline(g);
  shade(g, 4, 28);
  ellipse(g, 16, 16, 10, 10, '1', false); // armour ring
  bigEye(g, 16, 16, atk ? 8 : 7, 'b'); // reactor eye
  for (const [x, y] of [[3, 10], [3, 22], [16, 2]] as const) set(g, x, y, atk ? 'f' : 'd');
  if (mode === 'hurt') flash(g);
  mirrorX(g);
  return rows(g);
}

// boss_dreadnought — heavy warship: long armoured hull, stern engines, side gun
// decks, pointed prow.
function dreadnought(mode: Mode): string[] {
  const g = make();
  const atk = mode === 'attack';
  rect(g, 11, 3, 20, 8, '8'); // stern block
  rect(g, 8, 8, 23, 22, '8'); // midship
  tri(g, 16, 31, 8, 22, 23, 22, '8'); // prow
  rect(g, 3, 12, 8, 19, '8'); rect(g, 23, 12, 28, 19, '8'); // side gun decks
  rect(g, 12, 1, 14, 3, '8'); rect(g, 17, 1, 19, 3, '8'); // engine nozzles
  rimOutline(g);
  shade(g, 1, 31);
  for (const x of [13, 18]) set(g, x, 1, atk ? 'f' : 'c'); // engine glow
  for (const y of [11, 15, 19]) set(g, 16, y, atk ? 'f' : 'c'); // spinal bridge
  for (const y of [13, 16]) { set(g, 4, y, 'd'); set(g, 27, y, 'd'); } // deck turrets
  for (const y of [11, 15, 19]) { set(g, 9, y, 'd'); set(g, 22, y, 'd'); } // hull turrets
  if (mode === 'hurt') flash(g);
  mirrorX(g);
  return rows(g);
}

// boss_mecha — top-down war-mech: round core cockpit with four jointed limbs
// radiating to clawed corners.
function mecha(mode: Mode): string[] {
  const g = make();
  const atk = mode === 'attack';
  ellipse(g, 16, 16, 6, 6, '8'); // core
  // jointed limbs from the core out to clawed corners (left two; mirror does right)
  const arm = (jx: number, jy: number, ex: number, ey: number) => {
    line(g, jx, jy, ex, ey, '8'); line(g, jx, jy + 1, ex, ey + 1, '8'); line(g, jx + 1, jy, ex + 1, ey, '8');
    rect(g, ex - 2, ey - 2, ex + 1, ey + 1, '8');
  };
  arm(11, 12, 5, 6); arm(11, 20, 5, 26);
  rimOutline(g);
  shade(g, 4, 29);
  bigEye(g, 16, 16, atk ? 5 : 4, 'b'); // cockpit eye
  for (const [x, y] of [[5, 5], [5, 27]] as const) set(g, x, y, atk ? 'f' : 'd'); // claw thrusters
  if (mode === 'hurt') flash(g);
  mirrorX(g);
  return rows(g);
}

// boss_wasp — bio-mech wasp: thorax + striped abdomen, glassy wings, barbed sting.
function wasp(mode: Mode): string[] {
  const g = make();
  const atk = mode === 'attack';
  ellipse(g, 16, 8, 4, 3, '8'); ellipse(g, 16, 15, 5, 4, '8'); ellipse(g, 16, 24, 4, 5, '8');
  tri(g, 16, 31, 14, 28, 18, 28, '8'); // stinger
  tri(g, 12, 12, 2, atk ? 5 : 8, 6, 20, '8'); tri(g, 20, 12, 30, atk ? 5 : 8, 26, 20, '8'); // wings
  for (const y of [14, 17]) { line(g, 12, y, 7, y + 3, '8'); line(g, 20, y, 25, y + 3, '8'); } // legs
  rimOutline(g);
  shade(g, 5, 31);
  set(g, 14, 8, atk ? 'f' : 'b'); set(g, 18, 8, atk ? 'f' : 'b'); // eyes
  for (const y of [22, 24, 26]) line(g, 13, y, 19, y, 'd'); // abdomen stripes
  set(g, 16, 30, atk ? 'f' : 'b'); // sting tip
  if (mode === 'hurt') flash(g);
  mirrorX(g);
  return rows(g);
}

// boss_bomber — swept-wing gunship: broad delta wings, engine pods, bomb-bay glow.
function bomber(mode: Mode): string[] {
  const g = make();
  const atk = mode === 'attack';
  tri(g, 16, 9, 1, 21, 16, 24, '8'); tri(g, 16, 9, 31, 21, 16, 24, '8'); // delta wings
  rect(g, 12, 4, 19, 27, '8'); tri(g, 16, 31, 12, 26, 19, 26, '8'); // fuselage + nose
  rect(g, 4, 15, 8, 21, '8'); rect(g, 23, 15, 27, 21, '8'); // engine pods
  rimOutline(g);
  shade(g, 4, 31);
  set(g, 16, 8, atk ? 'f' : 'c'); set(g, 16, 9, atk ? 'f' : 'c'); // cockpit
  for (const x of [6, 25]) { set(g, x, 21, atk ? 'f' : 'c'); } // engine glow
  for (const y of [14, 18, 22]) set(g, 16, y, atk ? 'f' : 'b'); // bomb-bay lights
  if (mode === 'hurt') flash(g);
  mirrorX(g);
  return rows(g);
}

const BOSSES: Record<string, string[][]> = {
  boss_ooze: [ooze('idle'), ooze('attack'), ooze('hurt')],
  boss_automaton: [automaton('idle'), automaton('attack'), automaton('hurt')],
  boss_kraken: [kraken('idle'), kraken('attack'), kraken('hurt')],
  boss_wraith: [wraith('idle'), wraith('attack'), wraith('hurt')],
  boss_cyclops: [cyclops('idle'), cyclops('attack'), cyclops('hurt')],
  boss_toad: [toad('idle'), toad('attack'), toad('hurt')],
  boss_treant: [treant('idle'), treant('attack'), treant('hurt')],
  boss_beholder: [beholder('idle'), beholder('attack'), beholder('hurt')],
  boss_demon: [demon('idle'), demon('attack'), demon('hurt')],
  boss_hydra: [hydra('idle'), hydra('attack'), hydra('hurt')],
  boss_pharaoh: [pharaoh('idle'), pharaoh('attack'), pharaoh('hurt')],
  boss_yeti: [yeti('idle'), yeti('attack'), yeti('hurt')],
  boss_scorpion: [scorpion('idle'), scorpion('attack'), scorpion('hurt')],
  boss_gorgon: [gorgon('idle'), gorgon('attack'), gorgon('hurt')],
  boss_saucer: [saucer('idle'), saucer('attack'), saucer('hurt')],
  boss_core: [core('idle'), core('attack'), core('hurt')],
  boss_dreadnought: [dreadnought('idle'), dreadnought('attack'), dreadnought('hurt')],
  boss_mecha: [mecha('idle'), mecha('attack'), mecha('hurt')],
  boss_wasp: [wasp('idle'), wasp('attack'), wasp('hurt')],
  boss_bomber: [bomber('idle'), bomber('attack'), bomber('hurt')],
};

// ---- output + render harness ----------------------------------------------
writeFileSync(join(DIR, 'bosses.json'), JSON.stringify(BOSSES, null, 0));

// sanity: every row 32 chars, every frame 32 rows
for (const [id, frames] of Object.entries(BOSSES))
  frames.forEach((f, i) => {
    if (f.length !== 32) console.log(`!! ${id}[${i}] has ${f.length} rows`);
    f.forEach((r, y) => { if (r.length !== 32) console.log(`!! ${id}[${i}] row ${y} len ${r.length}`); });
  });

const PALETTES = [
  ['#0000', '#160f24', '#000', '#000', '#000', '#000', '#000', '#000', '#5a8f3c', '#8fd45a', '#2f5a24', '#e5484d', '#ff9d3b', '#ffd75e', '#c9e8a0', '#ffffff'],
  ['#0000', '#1a1226', '#000', '#000', '#000', '#000', '#000', '#000', '#6b3fa0', '#b07fe0', '#3d2168', '#e5484d', '#ff9d3b', '#ffd75e', '#d8c8f5', '#ffffff'],
];
const data = JSON.stringify(BOSSES), pals = JSON.stringify(PALETTES);
const html = `<!doctype html><meta charset=utf8><body style="margin:0;background:#0b0e17;font-family:monospace;color:#cdd">
<div id=root></div><script>
const B=${data},P=${pals};
function dec(rows,pal,scale){const c=document.createElement('canvas');c.width=32*scale;c.height=32*scale;const x=c.getContext('2d');x.imageSmoothingEnabled=false;for(let y=0;y<32;y++){const row=rows[y]||'';for(let X=0;X<32;X++){const ch=row[X];if(!ch||ch==='.'||ch==='0')continue;const i=parseInt(ch,16);if(Number.isNaN(i)||i===0)continue;x.fillStyle=pal[i]||'#f0f';x.fillRect(X*scale,y*scale,scale,scale);}}return c;}
const root=document.getElementById('root');
for(const[id,frames]of Object.entries(B)){const h=document.createElement('div');h.style.padding='14px 18px';h.innerHTML='<b style=color:#8ec>'+id+'</b>';root.appendChild(h);
 for(const pi in P){const rowdiv=document.createElement('div');rowdiv.style.cssText='display:flex;gap:22px;align-items:center;padding:6px 18px 18px';
  frames.forEach((f,fi)=>{const wrap=document.createElement('div');wrap.style.textAlign='center';const big=dec(f,P[pi],8);big.style.cssText='background:#141826;image-rendering:pixelated';wrap.appendChild(big);const small=dec(f,P[pi],2);small.style.cssText='margin-top:6px;background:#141826;image-rendering:pixelated';wrap.appendChild(document.createElement('br'));wrap.appendChild(small);const lbl=document.createElement('div');lbl.style.cssText='font-size:11px;color:#789;margin-top:4px';lbl.textContent=['idle','attack','hurt'][fi];wrap.appendChild(lbl);rowdiv.appendChild(wrap);});
  root.appendChild(rowdiv);} }
</script>`;
writeFileSync(join(DIR, 'render.html'), html);

// ---- bake the engine library file -----------------------------------------
const cname = (id: string) => id.replace('boss_', '').toUpperCase();
const fnames = ['IDLE', 'ATTACK', 'HURT'];
let ts = `// Extra creature/humanoid bosses — 32×32 FRONT-FACING figures, so they read
// correctly both side-view (platformer) and top-down 3/4 (adventure); both
// archetypes draw from the shared creature pool. Palette slots: 1 outline ·
// 8 enemy-primary · 9 enemy-secondary · a enemy-accent/shadow · b hazard red ·
// c warm glow · d gold · e light · f white.
// NOTE: composed by scripts/gen-bosses.mts for clean symmetry — edit the shape
// functions there and re-run (npx tsx scripts/gen-bosses.mts), not by hand.
import type { LibraryEntry } from '../types';

`;
for (const [id, frames] of Object.entries(BOSSES))
  frames.forEach((f, i) => {
    ts += `const ${cname(id)}_${fnames[i]} = [\n${f.map((r) => `  '${r}',`).join('\n')}\n];\n\n`;
  });
ts += `function frame(w: number, h: number, rows: string[]): { w: number; h: number; rows: string[] } {\n  return { w, h, rows };\n}\n\n`;
ts += `export const BOSSES_EXTRA: Record<string, LibraryEntry> = {\n`;
for (const id of Object.keys(BOSSES)) {
  const c = cname(id);
  ts += `  ${id}: {\n    frames: [frame(32, 32, ${c}_IDLE), frame(32, 32, ${c}_ATTACK), frame(32, 32, ${c}_HURT)],\n    anims: { idle: [0], attack: [1], hurt: [2] },\n  },\n`;
}
ts += `};\n`;
writeFileSync(join(REPO, 'packages/engine/src/library/bosses-extra.ts'), ts);
console.log('wrote render.html + baked bosses-extra.ts for', Object.keys(BOSSES).join(', '));
