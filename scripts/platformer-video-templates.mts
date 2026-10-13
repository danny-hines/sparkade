#!/usr/bin/env tsx
// Video-sourced pose templates for the template-board lab. Animates the lab's
// two-tone side-view mannequin with an image-to-video model (fal, Runway, or
// OpenAI Sora), extracts frames, keys the green screen, and selects the five
// template poses plus one full run cycle. Frames are chosen from measured
// stride width and from which leg (light near / dark far) leads, and can be
// overridden with --pick. Output feeds `platformer-template-lab --templates`.
//
//   npx tsx scripts/platformer-video-templates.mts --provider fal
//   npx tsx scripts/platformer-video-templates.mts --run-video run.mp4 --jump-video jump.mp4
//
// Templates are authored once, not per game, so these providers are build
// tools for the lab; game generation itself remains on Meta models.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import {
  PLATFORMER_TEMPLATE_MANNEQUIN_VERSION,
  PLATFORMER_TEMPLATE_POSES,
  renderPlatformerMannequin,
  type PlatformerTemplatePose,
} from '../packages/server/src/assets/platformer-template-board';

type Provider = 'fal' | 'runway' | 'openai';
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const root = resolve(import.meta.dirname, '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const provider = arg('provider') as Provider | undefined;
const importedRun = arg('run-video') ? resolve(arg('run-video')!) : undefined;
const importedJump = arg('jump-video') ? resolve(arg('jump-video')!) : undefined;
if (provider && !['fal', 'runway', 'openai'].includes(provider))
  throw new Error('--provider must be fal, runway, or openai');
if (!provider && !(importedRun && importedJump))
  throw new Error('pass --provider fal|runway|openai, or both --run-video and --jump-video');
const DEFAULT_MODELS: Record<Provider, string> = {
  fal: 'fal-ai/kling-video/v2.5-turbo/standard/image-to-video',
  runway: 'gen4_turbo',
  openai: 'sora-2',
};
const model = provider ? (arg('model') ?? DEFAULT_MODELS[provider]) : 'imported';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(
  arg('out') ??
    join(
      root,
      'data',
      'experiments',
      'platformer-video-templates',
      `${stamp}-${provider ?? 'imported'}`,
    ),
);
const FPS = 24;
const WIDTH = 1280;
const HEIGHT = 720;
const GROUND_Y = 640;
const UPSCALE = 3;

const PROMPTS = {
  run: [
    "A flat 2D gray artist's mannequin character runs to the right at a steady running pace, seen in strict side view like a side-scrolling video game character.",
    'Full running cycle with wide strides, knees driving forward, and arms pumping opposite the legs.',
    'The camera tracks with the runner so it stays centered in frame at the same size for the whole clip.',
    'The light-gray arm and leg always stay in front of the body; the dark-gray arm and leg always stay behind it.',
    'Plain flat solid green background. No floor, no shadow, no scenery, no other objects, no camera cuts, no zoom.',
  ].join(' '),
  jump: [
    "A flat 2D gray artist's mannequin character stands facing right in strict side view, crouches briefly, jumps straight up high with the front knee tucked and arms swinging up, then lands back in the same spot and stands.",
    'Locked-off camera; the figure stays the same size.',
    'The light-gray arm and leg always stay in front of the body; the dark-gray arm and leg always stay behind it.',
    'Plain flat solid green background. No floor, no shadow, no scenery, no other objects, no camera cuts, no zoom.',
  ].join(' '),
};
const NEGATIVE =
  'camera movement, zoom, floor, ground, shadow, scenery, extra people, text, blur, morphing, extra limbs';
/** Published list prices checked 2026-10-11; the provider's bill is authoritative. */
function estimateUsd(seconds: number): number | null {
  if (provider === 'runway' && model === 'gen4_turbo') return seconds * 0.05;
  if (provider === 'openai' && model === 'sora-2') return seconds * 0.1;
  if (provider === 'fal' && model.includes('kling-video/v2.5-turbo/standard'))
    return 0.21 + Math.max(0, seconds - 5) * 0.042;
  return null;
}

function write(path: string, contents: Buffer | string): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function key(...names: string[]): string {
  for (const name of names) if (process.env[name]) return process.env[name]!;
  throw new Error(`set ${names.join(' or ')} in .env`);
}
async function download(url: string, headers: Record<string, string> = {}): Promise<Buffer> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function json(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 600)}`);
  return JSON.parse(text) as Record<string, unknown>;
}
async function poll<T>(check: () => Promise<T | undefined>, label: string): Promise<T> {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const done = await check();
    if (done !== undefined) return done;
    await sleep(5_000);
  }
  throw new Error(`${label} did not finish within 15 minutes`);
}

async function generate(
  kind: 'run' | 'jump',
  image: Buffer,
): Promise<{ video: Buffer; seconds: number; id: string }> {
  const prompt = PROMPTS[kind];
  const dataUri = `data:image/png;base64,${image.toString('base64')}`;
  if (provider === 'fal') {
    const auth = { Authorization: `Key ${key('FAL_KEY', 'FAL_API_KEY')}` };
    const veo = model.includes('veo');
    const seconds = veo ? 8 : 5;
    // fal accepts base64 data URIs wherever a file URL is expected.
    const input = veo
      ? {
          prompt,
          image_url: dataUri,
          duration: '8s',
          resolution: '720p',
          aspect_ratio: '16:9',
          generate_audio: false,
          negative_prompt: NEGATIVE,
        }
      : { prompt, image_url: dataUri, duration: '5', negative_prompt: NEGATIVE, cfg_scale: 0.5 };
    const submitted = await json(
      await fetch(`https://queue.fal.run/${model}`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
    const id = String(submitted.request_id);
    await poll(async () => {
      const status = await json(await fetch(String(submitted.status_url), { headers: auth }));
      if (status.status === 'COMPLETED') return true;
      if (status.error) throw new Error(`fal ${kind} failed: ${JSON.stringify(status.error)}`);
      return undefined;
    }, `fal ${kind}`);
    const result = await json(await fetch(String(submitted.response_url), { headers: auth }));
    const url = (result.video as { url?: string } | undefined)?.url;
    if (!url) throw new Error(`fal ${kind} returned no video URL`);
    return { video: await download(url), seconds, id };
  }
  if (provider === 'runway') {
    const headers = {
      Authorization: `Bearer ${key('RUNWAYML_API_SECRET', 'RUNWAY_API_KEY')}`,
      'X-Runway-Version': '2024-11-06',
      'content-type': 'application/json',
    };
    const seconds = 5;
    const task = await json(
      await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          promptImage: dataUri,
          promptText: prompt,
          ratio: '1280:720',
          duration: seconds,
        }),
      }),
    );
    const id = String(task.id);
    const url = await poll(async () => {
      const status = await json(
        await fetch(`https://api.dev.runwayml.com/v1/tasks/${id}`, { headers }),
      );
      if (status.status === 'SUCCEEDED') return (status.output as string[])[0]!;
      if (status.status === 'FAILED' || status.status === 'CANCELLED')
        throw new Error(`runway ${kind} failed: ${String(status.failure ?? status.status)}`);
      return undefined;
    }, `runway ${kind}`);
    return { video: await download(url), seconds, id };
  }
  const auth = { Authorization: `Bearer ${key('OPENAI_API_KEY')}` };
  const seconds = Number(arg('seconds') ?? 8);
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('seconds', String(seconds));
  form.append('size', `${WIDTH}x${HEIGHT}`);
  // Sora requires the reference image to match the requested size exactly.
  form.append(
    'input_reference',
    new Blob([new Uint8Array(image)], { type: 'image/png' }),
    'mannequin.png',
  );
  const created = await json(
    await fetch('https://api.openai.com/v1/videos', { method: 'POST', headers: auth, body: form }),
  );
  const id = String(created.id);
  await poll(async () => {
    const status = await json(
      await fetch(`https://api.openai.com/v1/videos/${id}`, { headers: auth }),
    );
    if (status.status === 'completed') return true;
    if (status.status === 'failed')
      throw new Error(`openai ${kind} failed: ${JSON.stringify(status.error ?? status)}`);
    return undefined;
  }, `openai ${kind}`);
  return {
    video: await download(`https://api.openai.com/v1/videos/${id}/content`, auth),
    seconds,
    id,
  };
}

/** The lab's volume mannequin, upscaled like the board, standing on a green stage. */
async function mannequinStage(): Promise<Buffer> {
  const { png } = await renderPlatformerMannequin('sideIdle', { height: 150, style: 'volume' });
  const meta = await sharp(png).metadata();
  const figure = await sharp(png)
    .resize(meta.width! * UPSCALE, meta.height! * UPSCALE, { kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: '#00ff00' } })
    .composite([
      {
        input: figure,
        left: Math.round((WIDTH - meta.width! * UPSCALE) / 2),
        top: GROUND_Y - meta.height! * UPSCALE,
      },
    ])
    .flatten({ background: '#00ff00' })
    .png()
    .toBuffer();
}

interface Cutout {
  index: number;
  png: Buffer;
  /** Bounds in source pixels. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Horizontal extent of the lower 40% of the figure. */
  stride: number;
  /** (light leg centroid − dark leg centroid) / figure height; >0 means the near leg leads. */
  depth: number;
}

/** Key green-dominant pixels (compressed video green is never exactly #00ff00;
 * the gray mannequin is neutral, so dominance separates it cleanly) and keep
 * the largest connected figure. */
async function cutout(path: string, index: number): Promise<Cutout | null> {
  const { data, info } = await sharp(readFileSync(path))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const solid = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const r = data[p * 4]!;
    const g = data[p * 4 + 1]!;
    const b = data[p * 4 + 2]!;
    solid[p] = g > 80 && g > r * 1.3 && g > b * 1.3 ? 0 : 1;
  }
  const label = new Int32Array(width * height).fill(-1);
  let best = { id: -1, size: 0 };
  const stack: number[] = [];
  for (let start = 0, id = 0; start < width * height; start++) {
    if (!solid[start] || label[start] !== -1) continue;
    let size = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % width;
      const y = (p - x) / width;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (solid[n] && label[n] === -1) {
          label[n] = id;
          stack.push(n);
        }
      }
    }
    if (size > best.size) best = { id, size };
    id++;
  }
  if (best.size < 2_000) return null;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let p = 0; p < width * height; p++) {
    if (label[p] !== best.id) {
      data[p * 4 + 3] = 0;
      continue;
    }
    const x = p % width;
    const y = (p - x) / width;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const figureHeight = bottom - top + 1;
  const lowerTop = bottom - Math.round(figureHeight * 0.4);
  let strideLeft = width;
  let strideRight = -1;
  const light = { x: 0, n: 0 };
  const dark = { x: 0, n: 0 };
  for (let y = lowerTop; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      const p = y * width + x;
      if (label[p] !== best.id) continue;
      strideLeft = Math.min(strideLeft, x);
      strideRight = Math.max(strideRight, x);
      const r = data[p * 4]!;
      const g = data[p * 4 + 1]!;
      const b = data[p * 4 + 2]!;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40) continue;
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luminance >= 175) Object.assign(light, { x: light.x + x, n: light.n + 1 });
      else if (luminance >= 65 && luminance <= 125)
        Object.assign(dark, { x: dark.x + x, n: dark.n + 1 });
    }
  const depth =
    light.n > 30 && dark.n > 30 ? (light.x / light.n - dark.x / dark.n) / figureHeight : 0;
  const png = await sharp(data, { raw: { width, height, channels: 4 } })
    .extract({ left, top, width: right - left + 1, height: figureHeight })
    .png()
    .toBuffer();
  return { index, png, left, top, right, bottom, stride: strideRight - strideLeft + 1, depth };
}

function extract(video: string, dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    video,
    '-vf',
    `fps=${FPS}`,
    '-start_number',
    '0',
    join(dir, '%04d.png'),
  ]);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.png'))
    .sort()
    .map((name) => join(dir, name));
}

async function contactSheet(cutouts: Cutout[], selected: Map<number, string>): Promise<Buffer> {
  const cell = 104;
  const columns = 12;
  const rows = Math.ceil(cutouts.length / columns);
  const overlays: OverlayOptions[] = [];
  for (const [i, c] of cutouts.entries()) {
    const x = (i % columns) * cell;
    const y = Math.floor(i / columns) * (cell + 16);
    const tag = selected.get(c.index);
    const thumb = await sharp(c.png)
      .resize(cell - 8, cell - 8, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    overlays.push(
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${cell + 16}"><rect x="1" y="1" width="${cell - 2}" height="${cell - 2}" fill="#e9edf2" stroke="${tag ? '#d6336c' : '#c3cad3'}" stroke-width="${tag ? 4 : 1}"/><text x="4" y="${cell + 12}" font-family="monospace" font-size="11" fill="#222">${c.index}${tag ? ` ${tag}` : ''} s${c.stride} d${c.depth.toFixed(2)}</text></svg>`,
        ),
        left: x,
        top: y,
      },
      { input: thumb, left: x + 4, top: y + 4 },
    );
  }
  return sharp({
    create: {
      width: columns * cell,
      height: rows * (cell + 16),
      channels: 4,
      background: '#ffffff',
    },
  })
    .composite(overlays)
    .jpeg({ quality: 85 })
    .toBuffer();
}

const LINE_NEAR = [0x1f, 0x24, 0x30] as const;
const LINE_FAR = [0xa3, 0xac, 0xb9] as const;
/** Cycle-board v2 far-limb label; pale far lines were drawn as translucent limbs. */
const LINE_FAR_MAGENTA = [0xd9, 0x36, 0xe6] as const;

/** Convert a keyed mannequin frame to the lab's outline style: dark lines on
 * the contour and around near limbs, pale lines around far limbs, and key
 * green inside. Classes come from the mannequin's three grays plus its dark
 * outline color. */
async function outlineTemplate(
  png: Buffer,
  ratio: number,
  farColor: readonly number[] = LINE_FAR,
): Promise<{ outline: Buffer; solid: Buffer }> {
  const meta = await sharp(png).metadata();
  const width = Math.max(1, Math.round(meta.width! * ratio));
  const height = Math.max(1, Math.round(meta.height! * ratio));
  const { data } = await sharp(png)
    .resize(width, height, { kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const TRANSPARENT = 0;
  const NEAR = 1;
  const BODY = 2;
  const FAR = 3;
  const LINE = 4;
  const raw = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    if (data[p * 4 + 3]! < 128) continue;
    const luminance = 0.299 * data[p * 4]! + 0.587 * data[p * 4 + 1]! + 0.114 * data[p * 4 + 2]!;
    raw[p] = luminance >= 175 ? NEAR : luminance < 55 ? LINE : luminance <= 125 ? FAR : BODY;
  }
  // Resampling blends the dark outline into its neighbors, which reads as far
  // gray. Assign each opaque pixel the majority fill class around it instead.
  const kind = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    if (raw[p] === TRANSPARENT) continue;
    const x = p % width;
    const y = (p - x) / width;
    const counts = [0, 0, 0, 0];
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = raw[ny * width + nx]!;
        if (n === NEAR || n === BODY || n === FAR) counts[n]!++;
      }
    const best = [NEAR, BODY, FAR].reduce((a, b) => (counts[b]! > counts[a]! ? b : a));
    kind[p] = counts[best]! > 0 ? best : BODY;
  }
  const outline = Buffer.alloc(width * height * 4);
  const solid = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    if (kind[p] === TRANSPARENT) continue;
    data.copy(solid, p * 4, p * 4, p * 4 + 3);
    solid[p * 4 + 3] = 255;
    const x = p % width;
    const y = (p - x) / width;
    const neighbors = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ].map(([nx, ny]) =>
      nx! < 0 || ny! < 0 || nx! >= width || ny! >= height ? TRANSPARENT : kind[ny! * width + nx!]!,
    );
    // Region boundaries are drawn on the nearer side only, so each one is a
    // single pixel line in the nearer part's color.
    const nearer = (a: number, b: number) =>
      a === FAR ? false : b === FAR || (a === NEAR && b === BODY);
    const edge =
      raw[p] === LINE ||
      neighbors.some((n) => n === TRANSPARENT || (n !== kind[p] && nearer(kind[p]!, n)));
    const color = !edge ? [0, 255, 0] : kind[p] === FAR ? farColor : LINE_NEAR;
    outline.set([...color, 255], p * 4);
  }
  const encode = (pixels: Buffer) =>
    sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
  return { outline: await encode(outline), solid: await encode(solid) };
}

/** Crop every frame to their shared bounds so a played cycle keeps its bob. */
async function sharedCanvas(frames: Cutout[]): Promise<Buffer[]> {
  const left = Math.min(...frames.map((f) => f.left));
  const top = Math.min(...frames.map((f) => f.top));
  const right = Math.max(...frames.map((f) => f.right));
  const bottom = Math.max(...frames.map((f) => f.bottom));
  return Promise.all(
    frames.map((f) =>
      sharp({
        create: {
          width: right - left + 1,
          height: bottom - top + 1,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: f.png, left: f.left - left, top: f.top - top }])
        .png()
        .toBuffer(),
    ),
  );
}

mkdirSync(out, { recursive: true });
const manifest: Record<string, unknown> = {
  createdAt: new Date().toISOString(),
  provider: provider ?? 'imported',
  model,
  mannequin: PLATFORMER_TEMPLATE_MANNEQUIN_VERSION,
  prompts: PROMPTS,
  negativePrompt: NEGATIVE,
};
const clips: Record<'run' | 'jump', string> = {
  run: join(out, 'run.mp4'),
  jump: join(out, 'jump.mp4'),
};
if (provider) {
  const stage = await mannequinStage();
  write(join(out, 'input.png'), stage);
  console.log(`Generating run and jump clips with ${provider} ${model}…`);
  const results = await Promise.all(
    (['run', 'jump'] as const).map(async (kind) => {
      const started = Date.now();
      const result = await generate(kind, stage);
      write(clips[kind], result.video);
      console.log(`${kind} clip ready in ${Math.round((Date.now() - started) / 1000)}s`);
      return [
        kind,
        {
          id: result.id,
          seconds: result.seconds,
          estimatedUsd: estimateUsd(result.seconds),
          elapsedMs: Date.now() - started,
        },
      ] as const;
    }),
  );
  manifest.clips = Object.fromEntries(results);
} else {
  // Re-deriving templates in a generated run's own directory keeps its
  // provider, model and clip records.
  const previous = existsSync(join(out, 'manifest.json'))
    ? (JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as Record<string, unknown>)
    : undefined;
  if (previous && importedRun === clips.run && importedJump === clips.jump) {
    Object.assign(manifest, {
      provider: previous.provider,
      model: previous.model,
      clips: previous.clips,
      rederivedAt: manifest.createdAt,
      createdAt: previous.createdAt,
    });
  } else {
    write(clips.run, readFileSync(importedRun!));
    write(clips.jump, readFileSync(importedJump!));
    manifest.clips = { run: { importedFrom: importedRun }, jump: { importedFrom: importedJump } };
  }
}

const keyed = {} as Record<'run' | 'jump', Cutout[]>;
for (const kind of ['run', 'jump'] as const) {
  const frames = extract(clips[kind], join(out, 'frames', kind));
  keyed[kind] = (await Promise.all(frames.map((path, index) => cutout(path, index)))).filter(
    (c): c is Cutout => c !== null,
  );
  if (keyed[kind].length < 8) throw new Error(`${kind} clip produced too few keyable frames`);
}

// Skip the start-up from the still pose and the tail; select within the steady run.
const run = keyed.run;
const steady = run.slice(Math.floor(run.length * 0.2), Math.ceil(run.length * 0.95));
const pickArg = Object.fromEntries(
  (arg('pick') ?? '')
    .split(',')
    .filter(Boolean)
    .map((entry) => entry.split('=') as [PlatformerTemplatePose, string]),
);
const byIndex = (clip: Cutout[], index: number) => {
  const found = clip.find((c) => c.index === index);
  if (!found) throw new Error(`frame ${index} is not a keyable frame`);
  return found;
};
const widest = (frames: Cutout[]) => frames.reduce((a, b) => (b.stride > a.stride ? b : a));
const narrowest = (frames: Cutout[]) => frames.reduce((a, b) => (b.stride < a.stride ? b : a));
const nearLeads = steady.filter((c) => c.depth > 0.04);
const farLeads = steady.filter((c) => c.depth < -0.04);
const jumpGround = [...keyed.jump.slice(0, Math.max(3, Math.floor(keyed.jump.length * 0.1)))]
  .map((c) => c.bottom)
  .sort((a, b) => a - b)[1]!;
const airborne = keyed.jump.slice(Math.floor(keyed.jump.length * 0.15));
const apex = airborne.reduce((a, b) => (b.bottom < a.bottom ? b : a));
const selection: Record<
  PlatformerTemplatePose,
  { clip: 'run' | 'jump'; frame: Cutout; rule: string }
> = {
  sideIdle: {
    clip: 'jump',
    frame: keyed.jump[0]!,
    rule: 'first frame of the jump clip (the still input)',
  },
  walk1: {
    clip: 'run',
    frame: widest(nearLeads.length ? nearLeads : steady),
    rule: 'widest stride with the light (near) leg leading',
  },
  walk2: {
    clip: 'run',
    frame: widest(farLeads.length ? farLeads : steady),
    rule: 'widest stride with the dark (far) leg leading',
  },
  runPass: { clip: 'run', frame: narrowest(steady), rule: 'narrowest stride in the steady run' },
  jump: { clip: 'jump', frame: apex, rule: 'highest airborne frame' },
};
for (const [pose, value] of Object.entries(pickArg)) {
  const [clip, index] = value.includes(':') ? value.split(':') : ['run', value];
  selection[pose as PlatformerTemplatePose] = {
    clip: clip as 'run' | 'jump',
    frame: byIndex(keyed[clip as 'run' | 'jump'], Number(index)),
    rule: 'manual --pick',
  };
}
const standingHeight = selection.sideIdle.frame.bottom - selection.sideIdle.frame.top + 1;
for (const pose of PLATFORMER_TEMPLATE_POSES)
  write(join(out, 'templates', `${pose}.png`), selection[pose].frame.png);
const lifts = { jump: Math.max(0, (jumpGround - selection.jump.frame.bottom) / standingHeight) };
write(join(out, 'templates', 'lifts.json'), JSON.stringify(lifts, null, 2));

// The same frames as hollow line art, the style Muse dressed most reliably.
// Drawn at native sprite scale so 1px lines survive the board's upscale;
// `silhouette/` keeps the filled cutouts for the lab's overlap metrics.
const NATIVE_STANDING_HEIGHT = 112;
for (const pose of PLATFORMER_TEMPLATE_POSES) {
  const { outline, solid } = await outlineTemplate(
    selection[pose].frame.png,
    NATIVE_STANDING_HEIGHT / standingHeight,
  );
  write(join(out, 'templates-outline', `${pose}.png`), outline);
  write(join(out, 'templates-outline', 'silhouette', `${pose}.png`), solid);
}
write(join(out, 'templates-outline', 'lifts.json'), JSON.stringify(lifts, null, 2));

// One full cycle for review: from a near-leading contact to the next one.
const startAt = selection.walk1.frame.index;
const cycleEnd =
  run.find(
    (c) =>
      c.index > startAt + 6 && c.depth > 0.04 && c.stride >= selection.walk1.frame.stride * 0.9,
  )?.index ?? startAt + 16;
const cycle = run.filter((c) => c.index >= startAt && c.index < cycleEnd);
for (const [i, png] of (await sharedCanvas(cycle)).entries())
  write(join(out, 'templates', 'cycle', `${String(i).padStart(2, '0')}.png`), png);

// Evenly spaced phases of that cycle for the run-cycle board, on one shared
// canvas so the bob survives, as outline line art at native scale plus filled
// cutouts for metrics. `cycle8` keeps the original pale far lines.
const cycleExports = [
  { dir: 'cycle8', phases: 8, farLines: 'pale' },
  { dir: 'cycle8-magenta', phases: 8, farLines: 'magenta' },
  { dir: 'cycle6-magenta', phases: 6, farLines: 'magenta' },
] as const;
const cycleIndexes: Record<string, number[]> = {};
for (const spec of cycleExports) {
  const phases = Array.from(
    { length: spec.phases },
    (_, k) => cycle[Math.round((k * cycle.length) / spec.phases)]!,
  );
  for (const [k, png] of (await sharedCanvas(phases)).entries()) {
    const { outline, solid } = await outlineTemplate(
      png,
      NATIVE_STANDING_HEIGHT / standingHeight,
      spec.farLines === 'magenta' ? LINE_FAR_MAGENTA : LINE_FAR,
    );
    write(join(out, spec.dir, `${k}.png`), outline);
    write(join(out, spec.dir, 'silhouette', `${k}.png`), solid);
  }
  write(
    join(out, spec.dir, 'cycle.json'),
    JSON.stringify(
      { frames: spec.phases, farLines: spec.farLines, videoFrames: phases.map((c) => c.index) },
      null,
      2,
    ),
  );
  cycleIndexes[spec.dir] = phases.map((c) => c.index);
}
manifest.cycles = cycleIndexes;

for (const kind of ['run', 'jump'] as const) {
  const tags = new Map(
    PLATFORMER_TEMPLATE_POSES.filter((pose) => selection[pose].clip === kind).map((pose) => [
      selection[pose].frame.index,
      pose,
    ]),
  );
  write(join(out, `${kind}-sheet.jpg`), await contactSheet(keyed[kind], tags));
}
manifest.selection = Object.fromEntries(
  PLATFORMER_TEMPLATE_POSES.map((pose) => {
    const { clip, frame, rule } = selection[pose];
    return [
      pose,
      {
        clip,
        frame: frame.index,
        stride: frame.stride,
        depth: Number(frame.depth.toFixed(3)),
        rule,
      },
    ];
  }),
);
manifest.lifts = lifts;
manifest.cycleFrames = cycle.map((c) => c.index);
manifest.keyedFrames = { run: keyed.run.length, jump: keyed.jump.length };
write(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify({ out, selection: manifest.selection, lifts, cycleFrames: cycle.length }, null, 2),
);
