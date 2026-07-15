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

const BOSSES: Record<string, string[][]> = {
  boss_ooze: [ooze('idle'), ooze('attack'), ooze('hurt')],
  boss_automaton: [automaton('idle'), automaton('attack'), automaton('hurt')],
  boss_kraken: [kraken('idle'), kraken('attack'), kraken('hurt')],
  boss_wraith: [wraith('idle'), wraith('attack'), wraith('hurt')],
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
