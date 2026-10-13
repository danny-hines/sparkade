#!/usr/bin/env tsx
// SAM rig lab: segments each saved game's three run frames into body parts
// with Meta SAM 3.1 concept prompts, builds run in-betweens by rotating limbs
// as rigid parts (packages/server/src/assets/platformer-sam-rig.ts), and
// writes a self-contained review page comparing them with today's 3-frame
// gait and the pixel-shift in-betweens.
//
//   npx tsx scripts/platformer-sam-rig-lab.mts                 # cached SAM responses only
//   npx tsx scripts/platformer-sam-rig-lab.mts --live          # call SAM for uncached frames
//   npx tsx scripts/platformer-sam-rig-lab.mts --games g-a,g-b --run tuning-1
//
// Options: --max-calls N (live call cap, default 200), --scale N (upscale
// before SAM, default 6), --background gray|white, --pad N, --retry-errors.
// SAM responses are cached in data/experiments/platformer-sam-rig/cache, keyed
// by game, frame, concept and upscale, so reruns cost nothing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  assignParts,
  checkRigFrame,
  decodeRigImage,
  decodeSamMask,
  encodeRigImage,
  maskCoverage,
  maskOverlay,
  partOverlay,
  rigidArmsInbetween,
  rigidLimbInbetween,
  SamResponseCache,
  samInputPixels,
  SAM_RIG_VERSION,
  standingHeightGain,
  type PartMap,
  type RigidInbetween,
  type RigImage,
  type RigMask,
  type SamBackground,
  type SamInputOptions,
} from '../packages/server/src/assets/platformer-sam-rig';
import {
  MetaSamAdapter,
  META_SAM_PRICE_PER_IMAGE_USD,
} from '../packages/server/src/providers/meta-sam';
import { ConfigStore } from '../packages/server/src/storage/config';
import {
  alignRgbaFrames,
  buildRunInbetweens,
  RUN_INBETWEEN_T,
} from '../packages/shared/src/run-inbetweens';

const root = resolve(import.meta.dirname, '..');
const dataDir = resolve(process.env.SPARKADE_DATA ?? join(root, 'data'));
const gamesDir = join(dataDir, 'games');
const labDir = join(dataDir, 'experiments', 'platformer-sam-rig');
const DEFAULT_GAMES = [
  'golden-platformer',
  'g-3ozov1rfzj',
  'g-9ncsqbiwot',
  'g-gwj65cz1hv',
  'g-hsqnmk8ntw',
  'g-mkujetzsu4',
  'g-aco9qwvbvx',
  'g-hehhcnoczp',
  'g-28mdl1klva',
  'g-k8dta3erxq',
];
// Contact frames: "leg" and "arm" find both instances; hands and feet are
// sometimes left out of those masks, and the head anchors the shoulders.
// "upper arm" finds upper arms "arm" leaves on the body (sleeves, fur);
// rewordings ("whole arm", "arm and hand", "sleeve") and leg variants
// ("thigh", "whole leg") were tried and found nothing new.
// The standing idle: "leg" finds nothing, "lower body" finds both legs.
// --contact-concepts a,b,c swaps the contact list (to try other phrasings).
const conceptsArg = process.argv.indexOf('--contact-concepts');
const CONTACT_CONCEPTS =
  conceptsArg >= 0 && process.argv[conceptsArg + 1]
    ? process.argv[conceptsArg + 1]!.split(',').map((c) => c.trim())
    : ['arm', 'upper arm', 'hand', 'leg', 'foot', 'head'];
const IDLE_CONCEPTS = ['arm', 'hand', 'lower body', 'head'];
const FRAMES = [
  { key: 'walk1', file: 'walk-1', concepts: CONTACT_CONCEPTS },
  { key: 'idle', file: 'side-idle', concepts: IDLE_CONCEPTS },
  { key: 'walk2', file: 'walk-2', concepts: CONTACT_CONCEPTS },
] as const;
type FrameKey = (typeof FRAMES)[number]['key'];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const games = option('games', DEFAULT_GAMES.join(','))
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean);
const live = flag('live');
const input: SamInputOptions = {
  scale: Number(option('scale', '6')),
  pad: Number(option('pad', '8')),
  background: option('background', 'gray') as SamBackground,
};
const t = RUN_INBETWEEN_T;
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
const run = option('run', stamp);
const compareRun = option('compare-run', '');
const out = join(labDir, run);
mkdirSync(out, { recursive: true });

let segment:
  ((png: Buffer, concept: string) => ReturnType<MetaSamAdapter['segmentImage']>) | undefined;
if (live) {
  process.loadEnvFile(join(root, '.env'));
  const adapter = new MetaSamAdapter(new ConfigStore(dataDir).get().imageGeneration);
  segment = (png, concept) => adapter.segmentImage(png, concept);
}
const cache = new SamResponseCache({
  cacheDir: join(labDir, 'cache'),
  live,
  segment,
  maxLiveCalls: Number(option('max-calls', '200')),
  concurrency: 4,
  retryErrors: flag('retry-errors'),
});

const asset = (game: string, name: string) =>
  join(gamesDir, game, 'assets', `platformer-player-${name}.png`);
const uri = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;
const deg = (radians: number) => Math.round((radians * 180) / Math.PI);
const pt = (p?: [number, number]) =>
  p ? [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10] : null;

interface FrameReport {
  concepts: Record<string, { masks: number; pixels: number[]; error?: string; missing?: boolean }>;
  units: Array<{
    id: number;
    kind: string;
    depth: string;
    pixels: number;
    sources: string[];
    root: number[] | null;
    joint: number[] | null;
    tip: number[] | null;
    angleDeg: number | null;
  }>;
  arms: number;
  legs: number;
  warnings: string[];
}
interface GameRow {
  id: string;
  title: string;
  status: 'complete' | 'incomplete';
  split: string;
  motion: string;
  frames: Record<string, string>;
}

function rigidReport(result: RigidInbetween) {
  return {
    shoulder: pt(result.shoulder ?? undefined),
    hip: pt(result.hip ?? undefined),
    limbs: result.limbs.map((l) => ({
      unit: l.unit,
      kind: l.kind,
      depth: l.depth,
      pivot: pt(l.pivot),
      turnDeg: deg(l.turn),
    })),
    legSquash: Math.round(result.legSquash * 100) / 100,
    rise: result.rise,
    riseCap: result.riseCap === null ? null : Math.round(result.riseCap * 10) / 10,
    grownTop: result.grownTop,
    warnings: result.warnings,
  };
}

const rows: GameRow[] = [];
const results: Record<string, unknown> = {};
for (const game of games) {
  const gameOut = join(out, game);
  mkdirSync(join(gameOut, 'masks'), { recursive: true });
  const decoded = await Promise.all(
    FRAMES.map((f) => decodeRigImage(readFileSync(asset(game, f.file)))),
  );
  const aligned = alignRgbaFrames(decoded) as RigImage[];
  const images = Object.fromEntries(FRAMES.map((f, i) => [f.key, aligned[i]!])) as Record<
    FrameKey,
    RigImage
  >;
  const maps = {} as Record<FrameKey, PartMap>;
  const reports = {} as Record<FrameKey, FrameReport>;
  let complete = true;
  for (const frame of FRAMES) {
    const image = images[frame.key];
    const png = await encodeRigImage(samInputPixels(image, input));
    const entries = await Promise.all(
      frame.concepts.map((concept) =>
        cache
          .get({ game, frame: frame.file, concept, input, png })
          .then((entry) => ({ concept, entry })),
      ),
    );
    const masks: RigMask[] = [];
    const concepts: FrameReport['concepts'] = {};
    for (const { concept, entry } of entries) {
      if (!entry) {
        complete = false;
        concepts[concept] = { masks: 0, pixels: [], missing: true };
        continue;
      }
      const mine = entry.masks.map((m) => ({
        concept,
        objectId: m.objectId,
        coverage: maskCoverage(decodeSamMask(m), image, input),
      }));
      masks.push(...mine);
      concepts[concept] = {
        masks: mine.length,
        pixels: mine.map((m) => m.coverage.reduce((n, v) => n + (v >= 0.5 ? 1 : 0), 0)),
        error: entry.error,
      };
      writeFileSync(
        join(gameOut, 'masks', `${frame.key}-${concept.replace(/\s+/g, '-')}.png`),
        await encodeRigImage(maskOverlay(image, mine)),
      );
    }
    const map = assignParts(image, masks);
    maps[frame.key] = map;
    reports[frame.key] = {
      concepts,
      units: map.units.map((u) => ({
        id: u.id,
        kind: u.kind,
        depth: u.depth,
        pixels: u.pixels,
        sources: u.sources,
        root: pt(u.root),
        joint: pt(u.joint),
        tip: pt(u.tip),
        angleDeg: u.angle === undefined ? null : deg(u.angle),
      })),
      arms: map.units.filter((u) => u.kind === 'arm').length,
      legs: map.units.filter((u) => u.kind === 'leg').length,
      warnings: map.warnings,
    };
  }
  const pixel = buildRunInbetweens({
    walk1: images.walk1,
    sideIdle: images.idle,
    walk2: images.walk2,
  });
  const frames: Record<string, RigImage> = {
    walk1: images.walk1,
    idle: images.idle,
    walk2: images.walk2,
    pixel1: pixel.runMid1 as RigImage,
    pixel2: pixel.runMid2 as RigImage,
  };
  let inbetweens: Record<string, unknown> | null = null;
  let motion = '';
  const pngs: Record<string, Buffer> = {};
  if (complete) {
    // Rise cap: a third of how much taller the figure stands in the idle.
    const cap = (key: 'walk1' | 'walk2') => t * standingHeightGain(images[key], images.idle);
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    // Each contact frame on its own: rigid limbs where SAM separated both
    // legs and an arm, rigid arms over pixel-shift legs where it separated only
    // arms, pixel shift where it separated neither.
    const decide = (key: 'walk1' | 'walk2', pixelFrame: RigImage) => {
      const check = checkRigFrame(images[key], maps[key]);
      if (check.ok) {
        const r = rigidLimbInbetween(images[key], maps[key], t, { riseCap: cap(key) });
        return {
          image: r.image,
          label: `rigid (legs at ${pct(r.legSquash)} height)`,
          report: { method: 'rigid', check, ...rigidReport(r) },
        };
      }
      if (check.arms.ok) {
        const r = rigidArmsInbetween(images[key], maps[key], images.idle, t);
        return {
          image: r.image,
          label: `rigid arms, pixel-shift body and legs (${check.legs.reasons.join('; ')})`,
          report: {
            method: 'rigid arms',
            check,
            shift: r.shift,
            limbs: r.limbs.map((l) => ({ ...l, pivot: pt(l.pivot), turnDeg: deg(l.turn) })),
            warnings: r.warnings,
          },
        };
      }
      return {
        image: pixelFrame,
        label: `pixel shift (${[...check.arms.reasons, ...check.legs.reasons].join('; ')})`,
        report: { method: 'pixel shift', check },
      };
    };
    const a = decide('walk1', frames.pixel1!);
    const b = decide('walk2', frames.pixel2!);
    Object.assign(frames, { v31: a.image, v32: b.image });
    if (compareRun)
      for (const [name, file] of [
        ['prev1', 'v21'],
        ['prev2', 'v22'],
      ] as const) {
        const path = join(labDir, compareRun, game, `${file}.png`);
        if (existsSync(path)) frames[name] = await decodeRigImage(readFileSync(path));
      }
    inbetweens = { v31: a.report, v32: b.report };
    motion = `A: ${a.label} · B: ${b.label}`;
    for (const key of ['walk1', 'idle', 'walk2'] as const)
      pngs[`parts-${key}`] = await encodeRigImage(partOverlay(images[key], maps[key]));
  }
  // One canvas for every frame (feet on the bottom row) so taller rigid
  // frames play in place.
  const names = Object.keys(frames);
  const display = alignRgbaFrames(names.map((n) => frames[n]!)) as RigImage[];
  for (const [i, name] of names.entries()) pngs[name] = await encodeRigImage(display[i]!);
  for (const [name, png] of Object.entries(pngs)) writeFileSync(join(gameOut, `${name}.png`), png);
  const split = complete
    ? FRAMES.map((f) => `${f.key} ${reports[f.key].arms}A/${reports[f.key].legs}L`).join(', ')
    : 'missing SAM responses (rerun with --live)';
  const spec = JSON.parse(readFileSync(join(gamesDir, game, 'game.json'), 'utf8')) as {
    meta?: { heroConcept?: string };
  };
  results[game] = { status: complete ? 'complete' : 'incomplete', frames: reports, inbetweens };
  writeFileSync(join(gameOut, 'result.json'), JSON.stringify(results[game], null, 2) + '\n');
  rows.push({
    id: game,
    title: spec.meta?.heroConcept ?? '',
    status: complete ? 'complete' : 'incomplete',
    split,
    motion,
    frames: Object.fromEntries(Object.entries(pngs).map(([k, v]) => [k, uri(v)])),
  });
  console.log(`${game}: ${split}${motion ? `; ${motion}` : ''}`);
}

const ledger = cache.ledgerTotals();
const summary = {
  run,
  version: SAM_RIG_VERSION,
  createdAt: new Date().toISOString(),
  t,
  input,
  concepts: { contact: CONTACT_CONCEPTS, idle: IDLE_CONCEPTS },
  compareRun,
  games: rows.map((r) => ({ id: r.id, status: r.status, split: r.split })),
  thisRun: { ...cache.usage, pricePerCallUsd: META_SAM_PRICE_PER_IMAGE_USD },
  allRuns: ledger,
};
writeFileSync(join(out, 'result.json'), JSON.stringify(results, null, 2) + '\n');
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
writeFileSync(join(out, 'review.html'), reviewHtml(rows, summary));
console.log(
  JSON.stringify({
    review: join(out, 'review.html'),
    thisRun: cache.usage,
    allRuns: ledger,
  }),
);

function reviewHtml(data: GameRow[], meta: typeof summary): string {
  const cost = `${meta.allRuns.calls} SAM calls in all lab runs (~$${meta.allRuns.estimatedCostUsd.toFixed(3)}); this build: ${meta.thisRun.liveCalls} live, ${meta.thisRun.cacheHits + meta.thisRun.dedupedHits} cached`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SAM Rig Review</title>
<style>
:root{--bg:#f3f4f6;--fg:#1c2027;--muted:#5b6370;--card:#fff;--line:#d8dce3;--stage:#cfd8e3;--ground:#7d8a9c;--accent:#3b5bdb;--warn:#b35c00}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121418;--fg:#e7e9ee;--muted:#9aa3b2;--card:#1b1e24;--line:#30353f;--stage:#2a313c;--ground:#5d6b80;--accent:#8ea8ff;--warn:#ffb067}}
:root[data-theme="dark"]{--bg:#121418;--fg:#e7e9ee;--muted:#9aa3b2;--card:#1b1e24;--line:#30353f;--stage:#2a313c;--ground:#5d6b80;--accent:#8ea8ff;--warn:#ffb067}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}
header h1{font-size:16px;margin:0 6px 0 0}label{display:inline-flex;gap:5px;align-items:center;color:var(--muted)}
button,select{font:inherit;padding:3px 9px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);cursor:pointer}
main{padding:12px 16px 40px;max-width:1500px;margin:0 auto}
.note{color:var(--muted);font-size:13px;margin:4px 0 0}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:14px 0}
section h2{font-size:15px;margin:0}section p{margin:2px 0 10px;color:var(--muted);font-size:12px}
.split{font-variant-numeric:tabular-nums}.incomplete{color:var(--warn)}
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.tile{display:flex;flex-direction:column;gap:4px;min-width:0}.tile span{font-size:12px;color:var(--muted)}
canvas{width:100%;background:var(--stage);border-radius:6px;image-rendering:pixelated}
.strip{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.strip.frames{display:none}.strip.frames.on{display:flex}
.strip figure{margin:0;text-align:center;font-size:11px;color:var(--muted)}.strip img{height:128px;max-width:100%;image-rendering:pixelated;background:var(--stage);border-radius:4px}
.legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--muted);margin:8px 0 0}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
@media (max-width:1100px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.tiles{grid-template-columns:minmax(0,1fr)}}
</style></head><body>
<header>
  <h1>SAM rig review</h1>
  <label>Speed <input id="speed" type="range" min="2" max="16" step="0.5" value="11"><span id="speedOut"></span></label>
  <label>Scale <select id="scale"><option value="1">1× (about in-game)</option><option value="2" selected>2×</option><option value="3">3×</option></select></label>
  <button id="play">Pause</button><button id="step">Step</button>
  <label><input type="checkbox" id="polish">runtime polish (bob, squash, lean, dust)</label>
  <label><input type="checkbox" id="frames">show frames</label>
  <button id="theme">Theme</button>
</header>
<main>
  <p class="note">Each game's three run frames (contact A, side idle, contact B). <b>Game today</b> plays them as the runtime does (six beats). The other tiles play the 8-beat cycle [contact A, mid A, idle, mid B, contact B, mid B, idle, mid A] in the same cycle time. <b>Pixel shift</b> moves pixels one third of the way along a block-matching flow field (<code>buildRunInbetweens</code>). <b>Rigid v2</b> is last review's tile${meta.compareRun ? ` (<code>${meta.compareRun}</code> run)` : ''}. <b>Rigid v3</b> decides each mid frame on its own from SAM 3.1's parts (${meta.concepts.contact.map((c) => `"${c}"`).join(', ')}; ${meta.input.scale}× upscale on ${meta.input.background}): with both legs and an arm separated, every limb turns as one piece a third of the way toward straight down and the legs squash so the figure rises at most a third of how much taller it stands in the side idle; with only arms separated, the body and legs move exactly as pixel shift moves them and the arms turn rigidly on top, riding pixel shift's motion at the shoulder; otherwise it is the pixel-shift frame. The camera-facing arm turns about its own topmost visible point; the back arm about the midpoint of the two arms' tops, behind the body. Legs turn about the midpoint of their tops, raised into the body when the legs start lower than 30% of the figure's height (thighs under a garment). Legs and the back arm extend toward their joint under the body, out of sight until turning pulls them out. Each game's caption says which method each frame used and why. Speed is gait beats per second (7–15 in play).</p>
  <p class="note">${cost}. Part colors: <span class="legend" style="display:inline-flex"><span><i style="background:#969696"></i>body</span><span><i style="background:#fad228"></i>head</span><span><i style="background:#e62828"></i>near arm</span><span><i style="background:#fa8c1e"></i>far arm</span><span><i style="background:#1e6ef0"></i>near leg</span><span><i style="background:#1ec8dc"></i>far leg</span><span>hands/feet lighter; bone root white, joint magenta, tip black</span></span></p>
  <div id="games"></div>
</main>
<script>
const ROWS = ${JSON.stringify(data)};
const RUNTIME = [
  { f: 'walk1', bob: 0, squash: 0, lean: 0, dust: true },
  { f: 'walk1', bob: 0, squash: 1, lean: 0 },
  { f: 'idle', bob: 2, squash: 0, lean: 1 },
  { f: 'walk2', bob: 0, squash: 0, lean: 0, dust: true },
  { f: 'walk2', bob: 0, squash: 1, lean: 0 },
  { f: 'idle', bob: 2, squash: 0, lean: 1 },
];
const CYCLE = (m) => [
  { f: 'walk1', bob: 0, squash: 0, lean: 0, dust: true },
  { f: m + '1', bob: 0, squash: 1, lean: 0 },
  { f: 'idle', bob: 1, squash: 0, lean: 1 },
  { f: m + '2', bob: 2, squash: 0, lean: 1 },
  { f: 'walk2', bob: 0, squash: 0, lean: 0, dust: true },
  { f: m + '2', bob: 0, squash: 1, lean: 0 },
  { f: 'idle', bob: 1, squash: 0, lean: 1 },
  { f: m + '1', bob: 2, squash: 0, lean: 1 },
];
const KINDS = [
  { label: 'Game today (3 frames)', seq: RUNTIME },
  { label: 'Pixel shift in-betweens (1/3)', seq: CYCLE('pixel') },
  { label: 'Rigid v2 (last review)', seq: CYCLE('prev'), need: 'prev1' },
  { label: 'Rigid v3 (per frame, arms and legs separately)', seq: CYCLE('v3'), need: 'v31' },
];
const UNIT = 4;
const RUN_PER_BEAT = 43;
const $ = (id) => document.getElementById(id);
let playing = true, beats = 0, last = performance.now();
const tiles = [];
function render() {
  const root = $('games');
  for (const row of ROWS) {
    const sec = document.createElement('section');
    sec.innerHTML = '<h2></h2><p></p><div class="tiles"></div><div class="strip parts"></div><div class="strip frames"></div>';
    sec.querySelector('h2').textContent = row.id;
    const p = sec.querySelector('p');
    p.textContent = (row.title ? row.title + ' · ' : '') + 'SAM split: ' + row.split + (row.motion ? ' · ' + row.motion : '');
    p.className = row.status === 'complete' ? 'split' : 'split incomplete';
    const imgs = Object.fromEntries(Object.entries(row.frames).map(([k, v]) => { const i = new Image(); i.src = v; return [k, i]; }));
    for (const kind of KINDS) {
      const tile = document.createElement('div'); tile.className = 'tile';
      const canvas = document.createElement('canvas');
      const cap = document.createElement('span');
      cap.textContent = kind.label + (kind.need && !row.frames[kind.need] ? ' — not available' : '');
      tile.append(canvas, cap); sec.querySelector('.tiles').appendChild(tile);
      tiles.push({ canvas, kind, imgs, dust: [], lastIndex: -1 });
    }
    const figure = (strip, name, label) => {
      if (!row.frames[name]) return;
      const fig = document.createElement('figure');
      fig.innerHTML = '<img alt=""><figcaption></figcaption>';
      fig.querySelector('img').src = row.frames[name];
      fig.querySelector('figcaption').textContent = label;
      strip.appendChild(fig);
    };
    const parts = sec.querySelector('.parts');
    figure(parts, 'parts-walk1', 'SAM parts: contact A');
    figure(parts, 'parts-idle', 'SAM parts: side idle');
    figure(parts, 'parts-walk2', 'SAM parts: contact B');
    const frames = sec.querySelector('.frames');
    for (const [name, label] of [['walk1','contact A'],['pixel1','pixel shift A'],['prev1','v2 A'],['v31','v3 A'],['idle','side idle'],['v32','v3 B'],['prev2','v2 B'],['pixel2','pixel shift B'],['walk2','contact B']]) figure(frames, name, label);
    root.appendChild(sec);
  }
}
function draw() {
  const scale = Number($('scale').value);
  const polish = $('polish').checked;
  const groundColor = getComputedStyle(document.documentElement).getPropertyValue('--ground');
  for (const t of tiles) {
    const sample = t.imgs.walk1;
    if (!sample || !sample.naturalWidth) continue;
    const w = sample.naturalWidth, h = sample.naturalHeight;
    const cw = (w + 96) * scale, ch = (h + 44) * scale;
    if (t.canvas.width !== cw || t.canvas.height !== ch) { t.canvas.width = cw; t.canvas.height = ch; }
    const g = t.canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cw, ch);
    const ground = ch - 12 * scale;
    const scroll = beats * RUN_PER_BEAT * scale;
    g.fillStyle = groundColor;
    for (let x = -((scroll % (28 * scale)) + 28 * scale); x < cw; x += 28 * scale) g.fillRect(x, ground + 2 * scale, 14 * scale, 4 * scale);
    const index = Math.floor((beats / 6) * t.kind.seq.length) % t.kind.seq.length;
    const beat = t.kind.seq[index];
    const left = (cw - w * scale) / 2;
    if (index !== t.lastIndex) {
      if (beat.dust && polish) for (let k = 0; k < 3; k++) t.dust.push({ x: left / scale + w * 0.3 - k * 5, born: beats, rise: 1 + k });
      t.lastIndex = index;
    }
    t.dust = t.dust.filter((d) => beats - d.born < 3);
    for (const d of t.dust) {
      const age = beats - d.born;
      const size = (4 + age * 2) * scale;
      g.fillStyle = 'rgba(214,220,228,' + (0.85 * (1 - age / 3)).toFixed(3) + ')';
      g.fillRect((d.x - age * RUN_PER_BEAT * 0.5) * scale, ground - (d.rise * 3 + age * 3) * scale - size / 2, size, size);
    }
    const image = t.imgs[beat.f];
    if (!image || !image.naturalWidth) continue;
    const bob = polish ? Math.round(beat.bob * UNIT / 2) : 0;
    const squash = polish ? Math.round(beat.squash * UNIT) : 0;
    const lean = polish ? Math.round(beat.lean * 2) : 0;
    const drawH = h - squash;
    const top = ground - (drawH + bob) * scale;
    const hip = Math.round(h * 0.45);
    const k = drawH / h;
    g.drawImage(image, 0, hip, w, h - hip, left, top + hip * k * scale, w * scale, (h - hip) * k * scale);
    g.drawImage(image, 0, 0, w, hip, left + lean * scale, top, w * scale, hip * k * scale);
  }
}
function loop(now) {
  const dt = (now - last) / 1000; last = now;
  if (playing) beats += dt * Number($('speed').value);
  draw(); requestAnimationFrame(loop);
}
$('speed').oninput = () => $('speedOut').textContent = $('speed').value + '/s';
$('speed').oninput();
$('play').onclick = (e) => { playing = !playing; e.target.textContent = playing ? 'Pause' : 'Play'; };
$('step').onclick = () => { playing = false; $('play').textContent = 'Play'; beats = (Math.floor((beats / 6) * 8 + 1e-6) + 1) * 6 / 8 + 1e-6; };
$('frames').onchange = (e) => document.querySelectorAll('.strip.frames').forEach((s) => s.classList.toggle('on', e.target.checked));
$('theme').onclick = () => { const r = document.documentElement; r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark'; };
render(); requestAnimationFrame(loop);
</script></body></html>`;
}
