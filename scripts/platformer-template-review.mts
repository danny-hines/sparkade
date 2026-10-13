#!/usr/bin/env tsx
// Builds one self-contained HTML page that plays every template-lab run as
// animation, next to each game's production frames: the in-game run gait,
// the same rhythm with the extra passing frame, and a jump arc. Frames are
// embedded as data URIs so the page opens anywhere without a server.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const labDir = join(root, 'data', 'experiments', 'platformer-templates');
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
/** `--runs "Label=dir,Label=dir"`; directories are relative to the lab dir. */
const runs = (
  arg('runs') ??
  [
    'Filled mannequin=20261011-live-v2',
    'Outline=20261011-live-outline',
    'Skeleton=20261011-live-skeleton',
    'Video mannequin=20261012-live-video',
    'Video outline=20261012-live-video-outline',
  ].join(',')
)
  .split(',')
  .map((entry) => {
    const [label, dir] = entry.split('=');
    return { label: label!.trim(), dir: resolve(labDir, dir!.trim()) };
  })
  .filter(({ dir }) => existsSync(join(dir, 'summary.json')));
if (!runs.length) throw new Error('no completed template-lab runs found');
const out = resolve(arg('out') ?? join(labDir, 'review.html'));

const POSES = ['idle', 'sideIdle', 'walk1', 'walk2', 'jump', 'runPass'] as const;
type Pose = (typeof POSES)[number];

const images = new Map<string, string>();
function image(path: string | undefined): string | undefined {
  if (!path || !existsSync(path)) return undefined;
  const bytes = readFileSync(path);
  const key = createHash('sha1').update(bytes).digest('hex').slice(0, 12);
  if (!images.has(key)) images.set(key, `data:image/png;base64,${bytes.toString('base64')}`);
  return key;
}
/** Outline templates are hollow over key green; show the interior as empty. */
async function templateImage(path: string | undefined): Promise<string | undefined> {
  if (!path || !existsSync(path)) return undefined;
  const { data, info } = await sharp(readFileSync(path))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let o = 0; o < data.length; o += 4)
    if (data[o]! < 40 && data[o + 1]! > 215 && data[o + 2]! < 40) data[o + 3] = 0;
  const bytes = await sharp(data, { raw: info }).png().toBuffer();
  const key = createHash('sha1').update(bytes).digest('hex').slice(0, 12);
  if (!images.has(key)) images.set(key, `data:image/png;base64,${bytes.toString('base64')}`);
  return key;
}
async function thumbnail(path: string | undefined): Promise<string | undefined> {
  if (!path || !existsSync(path)) return undefined;
  const bytes = await sharp(readFileSync(path)).resize(320, 320).jpeg({ quality: 78 }).toBuffer();
  const key = createHash('sha1').update(bytes).digest('hex').slice(0, 12);
  if (!images.has(key)) images.set(key, `data:image/jpeg;base64,${bytes.toString('base64')}`);
  return key;
}

interface CellResult {
  pose: Pose;
  frame?: string;
  residue?: number;
}
interface BoardResult {
  index: number;
  raw?: string;
  error?: string;
  cells: CellResult[];
  judge?: { pose?: { accepted: boolean }; jump?: { accepted: boolean } };
}
interface CycleBoardResult {
  index: number;
  raw?: string;
  error?: string;
  cycle?: string[];
  frames?: Array<{ residue: number; nearestPhase: number }>;
  distinct?: number;
  identityShift?: number;
}
interface GameResult {
  game: string;
  kind?: 'cycle';
  templateCycle?: string[];
  heroConcept?: string;
  identityResidue?: number;
  production: Partial<Record<Pose, string>>;
  templates?: Partial<Record<Pose, string>>;
  boards: BoardResult[];
  productionJudge?: { pose?: { accepted: boolean }; jump?: { accepted: boolean } };
  error?: string;
}

interface Row {
  label: string;
  frames: Partial<Record<Pose, string>>;
  /** Eight-frame cycle rows play these instead of the pose animations. */
  cycle?: string[];
  requested?: string[];
  badges?: Array<{ text: string; cls: 'ok' | 'bad' | 'warn' | 'na' }>;
  pair?: boolean;
  jump?: boolean;
  gray?: boolean;
  board?: string;
  note?: string;
}

const games = new Map<string, { title: string; rows: Row[]; production?: Row }>();
const styleTemplates: Array<{
  label: string;
  frames: Partial<Record<Pose, string>>;
  cycle?: string[];
}> = [];

for (const run of runs) {
  // Imported (video) templates may carry the full source run cycle.
  const summary = JSON.parse(readFileSync(join(run.dir, 'summary.json'), 'utf8')) as {
    options?: { templates?: string };
  };
  const cycleDir = summary.options?.templates && join(summary.options.templates, 'cycle');
  if (cycleDir && existsSync(cycleDir)) {
    styleTemplates.push({
      label: `${run.label} source cycle`,
      frames: {},
      cycle: readdirSync(cycleDir)
        .filter((name) => name.endsWith('.png'))
        .sort()
        .map((name) => image(join(cycleDir, name))!),
    });
  }
  for (const game of readdirSync(run.dir).sort()) {
    const resultPath = join(run.dir, game, 'result.json');
    if (!existsSync(resultPath)) continue;
    const result = JSON.parse(readFileSync(resultPath, 'utf8')) as GameResult;
    const entry = games.get(game) ?? { title: result.heroConcept ?? '', rows: [] };
    games.set(game, entry);
    const at = (relative: string | undefined) => (relative ? join(run.dir, relative) : undefined);
    // Cycle runs carry no judges; take production verdicts from any run that has them.
    if (entry.production && entry.production.pair === undefined && result.productionJudge) {
      entry.production.pair = result.productionJudge.pose?.accepted;
      entry.production.jump = result.productionJudge.jump?.accepted;
    }
    if (!entry.production && result.production.walk1) {
      entry.production = {
        label: 'Production',
        frames: Object.fromEntries(
          POSES.map((pose) => [pose, image(at(result.production[pose]))]),
        ) as Row['frames'],
        pair: result.productionJudge?.pose?.accepted,
        jump: result.productionJudge?.jump?.accepted,
        note: 'existing game, best of ~9 candidates',
      };
    }
    if (game === 'golden-platformer' && result.templates) {
      styleTemplates.push({
        label: run.label,
        frames: Object.fromEntries(
          await Promise.all(
            POSES.map(async (pose) => [pose, await templateImage(at(result.templates![pose]))]),
          ),
        ) as Row['frames'],
      });
    }
    if (result.error) {
      entry.rows.push({ label: run.label, frames: {}, note: result.error });
      continue;
    }
    if (result.kind === 'cycle') {
      const requested = (result.templateCycle ?? []).map((path) => image(at(path))!);
      if (game === 'golden-platformer')
        styleTemplates.push({ label: `${run.label} requested`, frames: {}, cycle: requested });
      for (const board of result.boards as unknown as CycleBoardResult[]) {
        const frames = board.frames ?? [];
        const dressed = frames.filter(
          (f) => f.residue - (result.identityResidue ?? 0) <= 0.15,
        ).length;
        const count = frames.length;
        const distinct = board.distinct ?? count;
        const drift = (board.identityShift ?? 0) > 20;
        entry.rows.push({
          label: `${run.label} · board ${board.index}`,
          frames: {},
          cycle: board.cycle?.map((path) => image(at(path))!),
          requested,
          gray: count > 0 && dressed < count,
          badges: count
            ? [
                { text: `dressed ${dressed}/${count}`, cls: dressed === count ? 'ok' : 'warn' },
                {
                  text: `distinct poses ${distinct}/${count}`,
                  cls: distinct === count ? 'ok' : 'warn',
                },
                ...(drift ? [{ text: 'identity drift', cls: 'bad' as const }] : []),
              ]
            : [{ text: 'no cycle', cls: 'bad' }],
          board: await thumbnail(at(board.raw)),
          note: board.error,
        });
      }
      continue;
    }
    for (const board of result.boards) {
      const frames = Object.fromEntries(
        board.cells.map((cell) => [cell.pose, image(at(cell.frame))]),
      ) as Row['frames'];
      frames.idle = entry.production?.frames.idle;
      entry.rows.push({
        label: `${run.label} · board ${board.index}`,
        frames,
        pair: board.judge?.pose?.accepted,
        jump: board.judge?.jump?.accepted,
        gray: board.cells.some(
          (cell) =>
            cell.pose !== 'sideIdle' && (cell.residue ?? 0) - (result.identityResidue ?? 0) > 0.15,
        ),
        board: await thumbnail(at(board.raw)),
        note: board.error,
      });
    }
  }
}

const data = {
  runs: runs.map(({ label, dir }) => ({ label, dir: basename(dir) })),
  styleTemplates,
  games: [...games.entries()].map(([id, game]) => ({
    id,
    title: game.title,
    rows: game.production ? [game.production, ...game.rows] : game.rows,
  })),
};

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Template Animation Review</title>
<style>
:root{--bg:#f3f4f6;--fg:#1c2027;--muted:#5b6370;--card:#fff;--line:#d8dce3;--stage:#cfd8e3;--ground:#8a97a8;--ok:#17803a;--bad:#c42b2b;--warn:#a66300;--accent:#3b5bdb}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121418;--fg:#e7e9ee;--muted:#9aa3b2;--card:#1b1e24;--line:#30353f;--stage:#2a313c;--ground:#56647a;--ok:#5cc87a;--bad:#ff7a7a;--warn:#f0b35a;--accent:#8ea8ff}}
:root[data-theme="dark"]{--bg:#121418;--fg:#e7e9ee;--muted:#9aa3b2;--card:#1b1e24;--line:#30353f;--stage:#2a313c;--ground:#56647a;--ok:#5cc87a;--bad:#ff7a7a;--warn:#f0b35a;--accent:#8ea8ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center}
header h1{font-size:16px;margin:0 8px 0 0}label{display:inline-flex;gap:6px;align-items:center;color:var(--muted)}
button,select{font:inherit;padding:4px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);cursor:pointer}
main{padding:12px 16px 40px;max-width:1500px;margin:0 auto}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:14px 0}
section h2{font-size:15px;margin:0}section p.sub{margin:2px 0 10px;color:var(--muted);font-size:12px}
.grid{display:grid;grid-template-columns:minmax(150px,200px) repeat(3,minmax(0,1fr));gap:8px;align-items:stretch}
.head{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;padding:0 4px}
.label{padding:6px 4px;font-size:13px;display:flex;flex-direction:column;gap:4px;justify-content:center}
.label b{font-weight:600}.label small{color:var(--muted)}
.badges{display:flex;flex-wrap:wrap;gap:4px}.badge{font-size:11px;padding:1px 6px;border-radius:9px;border:1px solid currentColor}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}.na{color:var(--muted)}
.stage{position:relative;height:calc(158px * var(--scale) + 18px);background:var(--stage);border-radius:6px;overflow:hidden}
.stage::after{content:"";position:absolute;left:0;right:0;bottom:0;height:10px;background:repeating-linear-gradient(90deg,var(--ground) 0 14px,transparent 14px 28px);background-position-x:var(--scroll,0px);opacity:.7}
.stage img{position:absolute;left:50%;bottom:10px;transform:translate(-50%,var(--lift,0px));image-rendering:pixelated}
.stage .cap{position:absolute;left:6px;top:4px;font-size:11px;color:var(--muted);z-index:1}
.stage .empty{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted);font-size:12px}
details summary{cursor:pointer;font-size:12px;color:var(--accent)}details img{width:160px;margin-top:4px;border-radius:4px;image-rendering:pixelated}
.row-production .label b{color:var(--accent)}
.templates{display:flex;flex-wrap:wrap;gap:8px}.templates .stage{background:#dfe5ec}.templates .tile{width:220px}.templates .tile span{font-size:12px;color:var(--muted)}
@media (max-width:760px){.grid{grid-template-columns:1fr}.head{display:none}}
</style></head><body>
<header>
  <h1>Template animation review</h1>
  <label>Speed <input id="speed" type="range" min="4" max="16" step="0.5" value="11"><span id="speedOut"></span></label>
  <label>Scale <select id="scale"><option value="1.5">1.5×</option><option value="2" selected>2×</option><option value="3">3×</option></select></label>
  <button id="play">Pause</button><button id="step">Step</button>
  <label>Show <select id="filter"><option value="">All rows</option></select></label>
  <label><input id="flagged" type="checkbox"> Hide gray-body boards</label>
  <button id="theme">Theme</button>
</header>
<main>
  <section><h2>Requested motion</h2><p class="sub">The templates Muse was asked to follow (golden-platformer), playing the same animations. Speed is beats per second; the game runs 7–15 depending on run speed.</p><div class="templates" id="templates"></div></section>
  <div id="games"></div>
</main>
<script>
const DATA = ${JSON.stringify(data)};
const IMG = ${JSON.stringify(Object.fromEntries(images))};
const RUN = ['walk1','walk1','sideIdle','walk2','walk2','sideIdle'];
const PASS = ['walk1','walk1','runPass','walk2','walk2','runPass'];
const tiles = [];
let playing = true, beats = 0, last = performance.now();
const speed = document.getElementById('speed'), speedOut = document.getElementById('speedOut');
function tile(frames, kind, caption) {
  const stage = document.createElement('div'); stage.className = 'stage';
  if (caption) { const cap = document.createElement('span'); cap.className = 'cap'; cap.textContent = caption; stage.appendChild(cap); }
  const need = kind === 'cycle' || kind === 'cycleSlow' ? ['cycle'] : kind === 'jump' ? ['sideIdle','jump'] : kind === 'pass' ? PASS : RUN;
  if (need.some((p) => !frames[p])) { stage.insertAdjacentHTML('beforeend', '<div class="empty">' + (kind === 'pass' ? 'no passing frame' : 'frames missing') + '</div>'); return stage; }
  const img = document.createElement('img'); img.alt = kind; stage.appendChild(img);
  tiles.push({ stage, img, frames, kind, current: '' });
  return stage;
}
function badge(text, cls) { return '<span class="badge ' + cls + '">' + text + '</span>'; }
function verdict(name, value) { return value === undefined ? badge(name + ' –', 'na') : badge(name + (value ? ' ✓' : ' ✗'), value ? 'ok' : 'bad'); }
function render() {
  const t = document.getElementById('templates');
  for (const s of DATA.styleTemplates) {
    const d = document.createElement('div'); d.className = 'tile';
    d.appendChild(s.cycle ? tile({ cycle: s.cycle.map((k) => IMG[k]) }, 'cycle') : tile(Object.fromEntries(Object.entries(s.frames).filter(([, k]) => k).map(([p, k]) => [p, IMG[k]])), 'run')); const cap = document.createElement('span'); cap.textContent = s.label; d.appendChild(cap); t.appendChild(d);
  }
  const filter = document.getElementById('filter');
  for (const r of DATA.runs) { const o = document.createElement('option'); o.value = r.label; o.textContent = 'Production + ' + r.label; filter.appendChild(o); }
  const root = document.getElementById('games');
  for (const g of DATA.games) {
    const sec = document.createElement('section');
    sec.innerHTML = '<h2>' + g.id + '</h2><p class="sub"></p>';
    sec.querySelector('.sub').textContent = g.title;
    const grid = document.createElement('div'); grid.className = 'grid';
    grid.innerHTML = '<div></div><div class="head">Run as in game</div><div class="head">Run with passing frame</div><div class="head">Jump</div>';
    for (const row of g.rows) {
      const frames = Object.fromEntries(Object.entries(row.frames).filter(([, k]) => k).map(([p, k]) => [p, IMG[k]]));
      const cells = [];
      const label = document.createElement('div'); label.className = 'label';
      const badges = row.badges ? row.badges.map((b) => badge(b.text, b.cls)).join('') : verdict('run pair', row.pair) + verdict('jump', row.jump) + (row.gray ? badge('gray body left', 'warn') : '');
      label.innerHTML = '<b></b><div class="badges">' + badges + '</div>' + (row.note ? '<small></small>' : '') + (row.board ? '<details><summary>board</summary><img src="' + IMG[row.board] + '"></details>' : '');
      label.querySelector('b').textContent = row.label;
      if (row.note) label.querySelector('small').textContent = row.note;
      if (row.cycle || row.requested) {
        const own = { cycle: (row.cycle ?? []).map((k) => IMG[k]) }, asked = { cycle: (row.requested ?? []).map((k) => IMG[k]) };
        cells.push(label, tile(row.cycle ? own : {}, 'cycle', '8-frame cycle'), tile(row.cycle ? own : {}, 'cycleSlow', 'same, ⅓ speed'), tile(asked, 'cycle', 'requested motion'));
      } else cells.push(label, tile(frames, 'run'), tile(frames, 'pass'), tile(frames, 'jump'));
      const isProduction = row.label === 'Production';
      for (const c of cells) { c.dataset.row = isProduction ? '' : row.label.split(' · ')[0]; c.dataset.gray = row.gray ? '1' : ''; if (isProduction) c.classList.add('row-production'); grid.appendChild(c); }
    }
    sec.appendChild(grid); root.appendChild(sec);
  }
}
function applyFilters() {
  const run = document.getElementById('filter').value, hideGray = document.getElementById('flagged').checked;
  for (const el of document.querySelectorAll('.grid > [data-row]')) {
    const show = (!run || el.dataset.row === '' || el.dataset.row === run) && !(hideGray && el.dataset.gray);
    el.style.display = show ? '' : 'none';
  }
}
function frameFor(t) {
  const b = Math.floor(beats);
  // A source cycle plays over the same six beats as the in-game gait.
  if (t.kind === 'cycle' || t.kind === 'cycleSlow') {
    const period = t.kind === 'cycle' ? 6 : 18;
    return { src: t.frames.cycle[Math.floor((beats / period) * t.frames.cycle.length) % t.frames.cycle.length], lift: 0 };
  }
  if (t.kind === 'jump') {
    // 10-beat loop: stand, launch arc for 6 beats, land.
    const p = beats % 10;
    if (p < 3 || p >= 9) return { pose: 'sideIdle', lift: 0 };
    const u = (p - 3) / 6;
    return { pose: 'jump', lift: -4 * u * (1 - u) };
  }
  return { pose: (t.kind === 'pass' ? PASS : RUN)[b % 6], lift: 0 };
}
function draw() {
  const scale = Number(document.getElementById('scale').value);
  for (const t of tiles) {
    const f = frameFor(t);
    const src = f.src ?? t.frames[f.pose];
    if (t.current !== src) { t.img.src = src; t.current = src; }
    // Sprites draw at native pixels × scale; large video cutouts fit 128px.
    const natural = t.img.naturalHeight || 128;
    t.img.style.height = (natural > 160 ? 128 : natural) * scale + 'px';
    t.stage.style.setProperty('--lift', (f.lift * 28 * scale) + 'px');
    t.stage.style.setProperty('--scroll', (t.kind === 'jump' ? 0 : -beats * 9 * scale) + 'px');
  }
}
function loop(now) {
  const dt = (now - last) / 1000; last = now;
  if (playing) beats += dt * Number(speed.value);
  draw(); requestAnimationFrame(loop);
}
speed.oninput = () => speedOut.textContent = speed.value + '/s';
speed.oninput();
document.getElementById('scale').onchange = (e) => document.documentElement.style.setProperty('--scale', e.target.value);
document.documentElement.style.setProperty('--scale', '2');
document.getElementById('play').onclick = (e) => { playing = !playing; e.target.textContent = playing ? 'Pause' : 'Play'; };
document.getElementById('step').onclick = () => { playing = false; document.getElementById('play').textContent = 'Play'; beats = Math.floor(beats) + 1; };
document.getElementById('filter').onchange = applyFilters;
document.getElementById('flagged').onchange = applyFilters;
document.getElementById('theme').onclick = () => { const r = document.documentElement; r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark'; };
render(); requestAnimationFrame(loop);
</script></body></html>`;

writeFileSync(out, html);
console.log(
  JSON.stringify({
    out,
    runs: runs.map(({ label }) => label),
    games: data.games.length,
    sizeKb: Math.round(html.length / 1024),
  }),
);
