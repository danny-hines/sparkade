// Lab experiment around the production rig in platformer-run-rig.ts: a disk
// cache of every SAM response (so lab reruns cost nothing) and debug overlays
// for the review page in scripts/platformer-sam-rig-lab.mts.
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { SegmentationMaskRecord } from '@meta-sam/parser';
import {
  META_SAM_MODEL,
  META_SAM_PRICE_PER_IMAGE_USD,
  type SpriteSegmentation,
} from '../providers/meta-sam';
import {
  SEGMENTS,
  type PartMap,
  type Point,
  type RigImage,
  type RigMask,
  type SamInputOptions,
} from './platformer-run-rig';

export * from './platformer-run-rig';

const opaqueAt = (image: RigImage, p: number) => image.data[p * 4 + 3]! > 8;
/** Mask coverage at which a pixel counts as inside (as in part assignment). */
const COVERED = 0.5;

// ---------------------------------------------------------------------------
// SAM response cache

export interface SamRequest {
  game: string;
  frame: string;
  concept: string;
  input: SamInputOptions;
  /** Encoded SAM input image. */
  png: Buffer;
}

export interface SamCacheEntry {
  version: 1;
  game: string;
  frame: string;
  concept: string;
  input: SamInputOptions;
  inputSha256: string;
  model: string;
  responseId?: string;
  createdAt: string;
  elapsedMs: number;
  /** Set when this entry was copied from an identical input of another key. */
  copiedFrom?: string;
  error?: string;
  rawOutput?: string;
  masks: SegmentationMaskRecord[];
}

export interface SamUsage {
  liveCalls: number;
  failedCalls: number;
  cacheHits: number;
  dedupedHits: number;
  missing: number;
  estimatedCostUsd: number;
}

export type SegmentFn = (png: Buffer, concept: string) => Promise<SpriteSegmentation>;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function samCacheKey(request: Omit<SamRequest, 'png'>): string {
  const { scale, pad, background } = request.input;
  return join(
    slug(request.game),
    slug(request.frame),
    `${slug(request.concept)}@x${scale}p${pad}-${background}.json`,
  );
}

/** Every SAM response is cached under `cacheDir`, keyed by game, frame,
 * concept and upscale settings. An identical input image under another key
 * (two games sharing frames) reuses the stored response. Without `live`,
 * nothing is sent and uncached requests return null. Live calls append to a
 * ledger so spend accumulates across runs. */
export class SamResponseCache {
  readonly usage: SamUsage = {
    liveCalls: 0,
    failedCalls: 0,
    cacheHits: 0,
    dedupedHits: 0,
    missing: 0,
    estimatedCostUsd: 0,
  };
  private readonly byContent = new Map<string, string>();
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly options: {
      cacheDir: string;
      live: boolean;
      segment?: SegmentFn;
      maxLiveCalls: number;
      concurrency?: number;
      retryErrors?: boolean;
    },
  ) {
    mkdirSync(options.cacheDir, { recursive: true });
    const walk = (dir: string) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, name.name);
        if (name.isDirectory()) walk(path);
        else if (name.name.endsWith('.json')) {
          try {
            const entry = JSON.parse(readFileSync(path, 'utf8')) as SamCacheEntry;
            if (entry.version === 1 && !entry.error && entry.inputSha256)
              this.byContent.set(`${entry.inputSha256}|${entry.concept}`, path);
          } catch {
            // Not a cache entry.
          }
        }
      }
    };
    walk(options.cacheDir);
  }

  /** Total live calls and spend recorded in the ledger across every run. */
  ledgerTotals(): { calls: number; failures: number; estimatedCostUsd: number } {
    const path = join(this.options.cacheDir, 'ledger.jsonl');
    if (!existsSync(path)) return { calls: 0, failures: 0, estimatedCostUsd: 0 };
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const failures = lines.filter((line) => (JSON.parse(line) as { ok: boolean }).ok === false);
    return {
      calls: lines.length,
      failures: failures.length,
      estimatedCostUsd: round(lines.length * META_SAM_PRICE_PER_IMAGE_USD),
    };
  }

  async get(request: SamRequest): Promise<SamCacheEntry | null> {
    const key = samCacheKey(request);
    const path = join(this.options.cacheDir, key);
    const sha = createHash('sha256').update(request.png).digest('hex');
    if (existsSync(path)) {
      const entry = JSON.parse(readFileSync(path, 'utf8')) as SamCacheEntry;
      if (entry.inputSha256 === sha && !(entry.error && this.options.retryErrors)) {
        this.usage.cacheHits++;
        return entry;
      }
    }
    const twin = this.byContent.get(`${sha}|${request.concept}`);
    if (twin && existsSync(twin)) {
      const source = JSON.parse(readFileSync(twin, 'utf8')) as SamCacheEntry;
      const entry: SamCacheEntry = {
        ...source,
        game: request.game,
        frame: request.frame,
        copiedFrom: source.copiedFrom ?? twin.slice(this.options.cacheDir.length + 1),
      };
      this.write(path, entry);
      this.usage.dedupedHits++;
      return entry;
    }
    if (!this.options.live || !this.options.segment) {
      this.usage.missing++;
      return null;
    }
    if (this.usage.liveCalls >= this.options.maxLiveCalls) {
      this.usage.missing++;
      return null;
    }
    this.usage.liveCalls++;
    await this.slot();
    const started = Date.now();
    let entry: SamCacheEntry;
    try {
      const result = await this.options.segment(request.png, request.concept);
      entry = {
        version: 1,
        game: request.game,
        frame: request.frame,
        concept: request.concept,
        input: request.input,
        inputSha256: sha,
        model: result.model,
        responseId: result.responseId,
        createdAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        rawOutput: result.rawOutput,
        masks: [...result.masks],
      };
      this.byContent.set(`${sha}|${request.concept}`, path);
    } catch (error) {
      this.usage.failedCalls++;
      entry = {
        version: 1,
        game: request.game,
        frame: request.frame,
        concept: request.concept,
        input: request.input,
        inputSha256: sha,
        model: META_SAM_MODEL,
        createdAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        masks: [],
      };
    } finally {
      this.release();
    }
    this.usage.estimatedCostUsd = round(this.usage.liveCalls * META_SAM_PRICE_PER_IMAGE_USD);
    appendFileSync(
      join(this.options.cacheDir, 'ledger.jsonl'),
      JSON.stringify({
        at: entry.createdAt,
        key,
        ok: !entry.error,
        masks: entry.masks.length,
        elapsedMs: entry.elapsedMs,
        costUsd: META_SAM_PRICE_PER_IMAGE_USD,
      }) + '\n',
    );
    this.write(path, entry);
    return entry;
  }

  private write(path: string, entry: SamCacheEntry) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(entry, null, 1) + '\n');
  }

  private async slot(): Promise<void> {
    const limit = this.options.concurrency ?? 4;
    if (this.active < limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
  }

  private release() {
    this.active--;
    this.waiting.shift()?.();
  }
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

// ---------------------------------------------------------------------------
// Debug overlays

const UNIT_COLORS: Record<string, [number, number, number]> = {
  body: [150, 150, 150],
  head: [250, 210, 40],
  'arm-near': [230, 40, 40],
  'arm-far': [250, 140, 30],
  'leg-near': [30, 110, 240],
  'leg-far': [30, 200, 220],
};

/** The sprite tinted by unit (body gray, head yellow, near/far arm red/orange,
 * near/far leg blue/cyan); hands and feet a lighter tint of their limb; bone
 * roots white and tips black. */
export function partOverlay(image: RigImage, map: PartMap): RigImage {
  const data = new Uint8ClampedArray(image.data.length);
  for (let p = 0; p < map.unit.length; p++) {
    const id = map.unit[p]!;
    if (id < 0) continue;
    const u = map.units[id]!;
    const seg = SEGMENTS[map.segment[p]!];
    const key = u.kind === 'body' ? (seg === 'head' ? 'head' : 'body') : `${u.kind}-${u.depth}`;
    const tint = UNIT_COLORS[key]!;
    const mix = seg === 'hand' || seg === 'foot' ? 0.45 : 0.65;
    for (let k = 0; k < 3; k++)
      data[p * 4 + k] = Math.round(image.data[p * 4 + k]! * (1 - mix) + tint[k]! * mix);
    data[p * 4 + 3] = 255;
  }
  const dot = (pt: Point | undefined, rgb: [number, number, number]) => {
    if (!pt) return;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = Math.floor(pt[0]) + dx;
        const y = Math.floor(pt[1]) + dy;
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
        data.set([...rgb, 255], (y * map.width + x) * 4);
      }
  };
  for (const u of map.units) {
    if (!u.root || !u.tip) continue;
    const steps = Math.ceil(Math.hypot(u.tip[0] - u.root[0], u.tip[1] - u.root[1]));
    for (let i = 0; i <= steps; i += 2) {
      const x = Math.floor(u.root[0] + ((u.tip[0] - u.root[0]) * i) / steps);
      const y = Math.floor(u.root[1] + ((u.tip[1] - u.root[1]) * i) / steps);
      if (x >= 0 && y >= 0 && x < map.width && y < map.height)
        data.set([255, 255, 255, 255], (y * map.width + x) * 4);
    }
    dot(u.root, [255, 255, 255]);
    dot(u.joint, [255, 0, 255]);
    dot(u.tip, [0, 0, 0]);
  }
  return { data, width: image.width, height: image.height };
}

/** Each SAM instance of one concept tinted a distinct color over a faded
 * sprite, for checking masks against the art. */
export function maskOverlay(image: RigImage, masks: readonly RigMask[]): RigImage {
  const palette: Array<[number, number, number]> = [
    [230, 40, 40],
    [30, 110, 240],
    [40, 190, 60],
    [250, 160, 20],
    [190, 40, 230],
  ];
  const data = new Uint8ClampedArray(image.data.length);
  for (let p = 0; p < image.width * image.height; p++) {
    if (!opaqueAt(image, p)) continue;
    const hit = masks.findIndex((m) => m.coverage[p]! >= COVERED);
    const tint = hit >= 0 ? palette[hit % palette.length]! : ([255, 255, 255] as const);
    const mix = hit >= 0 ? 0.65 : 0.6;
    for (let k = 0; k < 3; k++)
      data[p * 4 + k] = Math.round(image.data[p * 4 + k]! * (1 - mix) + tint[k]! * mix);
    data[p * 4 + 3] = 255;
  }
  return { data, width: image.width, height: image.height };
}
