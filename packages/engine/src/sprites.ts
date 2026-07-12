// Sprite decoding + the SpriteStore. All pixel work happens at load time
// (ImageData -> offscreen canvas); runtime drawing is drawImage only.
import type { GameSpec, SpriteData } from '@sparkade/shared';
import { LIBRARY } from './library/index';
import type { LibraryEntry } from './types';

/** Decode palette-indexed rows into an offscreen canvas. Index 0 and '.' are transparent. */
export function decodeSprite(data: SpriteData, palette: string[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = data.w;
  canvas.height = data.h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(data.w, data.h);
  for (let y = 0; y < data.h; y++) {
    const row = data.rows[y] ?? '';
    for (let x = 0; x < data.w; x++) {
      const ch = row[x];
      if (ch === undefined || ch === '.') continue;
      const idx = parseInt(ch, 16);
      if (idx === 0 || Number.isNaN(idx)) continue; // palette index 0 is transparent
      const hex = palette[idx] ?? '#ff00ff';
      const o = (y * data.w + x) * 4;
      img.data[o] = parseInt(hex.slice(1, 3), 16);
      img.data[o + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[o + 2] = parseInt(hex.slice(5, 7), 16);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Horizontal flip (load-time). */
export function flipCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d')!;
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return out;
}

/** Add a 1px outline of the given color around opaque pixels (load-time). */
export function outlineCanvas(src: HTMLCanvasElement, color = '#1a1c2c'): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const sctx = src.getContext('2d')!;
  const octx = out.getContext('2d')!;
  const sd = sctx.getImageData(0, 0, w, h);
  const od = octx.createImageData(w, h);
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const opaque = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && sd.data[(y * w + x) * 4 + 3]! > 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (sd.data[o + 3]! > 0) {
        od.data[o] = sd.data[o]!;
        od.data[o + 1] = sd.data[o + 1]!;
        od.data[o + 2] = sd.data[o + 2]!;
        od.data[o + 3] = sd.data[o + 3]!;
      } else if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1)) {
        od.data[o] = r;
        od.data[o + 1] = g;
        od.data[o + 2] = b;
        od.data[o + 3] = 255;
      }
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

/** A whitened "damage flash" copy (load-time). */
export function flashCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  return out;
}

export interface ResolvedSprite {
  w: number;
  h: number;
  frames: HTMLCanvasElement[];
  flipped: HTMLCanvasElement[];
  flash: HTMLCanvasElement[];
  anims: Record<string, number[]>;
}

export interface LikenessImages {
  head12: CanvasImageSource | null;
  head16: CanvasImageSource | null;
}

/**
 * Resolves `lib:` / `custom:` sprite refs against the game's palette, composites
 * the likeness head onto hero head slots, and caches everything as canvases.
 */
export class SpriteStore {
  private cache = new Map<string, ResolvedSprite>();

  constructor(
    private spec: GameSpec,
    private likeness: LikenessImages | null = null,
  ) {}

  /**
   * Resolve an assignment role (e.g. "hero", "walker", "tile_solid"), with a
   * library fallback ref. Pass bob:false for tile/terrain roles — the
   * synthesized walk-bob frame makes repeated tiles jitter.
   */
  byRole(role: string, fallbackRef: string, opts: { bob?: boolean } = {}): ResolvedSprite {
    const ref = this.spec.sprites.assign[role] ?? fallbackRef;
    return this.byRef(ref, role === 'hero', opts);
  }

  /** Resolve a direct sprite ref. */
  byRef(ref: string, applyLikeness = false, opts: { bob?: boolean } = {}): ResolvedSprite {
    const bob = opts.bob ?? true;
    const key = `${ref}|${applyLikeness ? 'L' : '-'}|${bob ? 'b' : '-'}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const resolved = this.build(ref, applyLikeness, bob);
    this.cache.set(key, resolved);
    return resolved;
  }

  private build(ref: string, applyLikeness: boolean, bob: boolean): ResolvedSprite {
    const [kind, id] = ref.split(':', 2) as [string, string];
    let entry: LibraryEntry | null = null;
    if (kind === 'lib') {
      entry = LIBRARY[id] ?? null;
    } else if (kind === 'custom') {
      const data = this.spec.sprites.custom[id];
      if (data) {
        if (!bob) {
          entry = { frames: [data], anims: { idle: [0] } }; // terrain must sit still
        } else if (data.frames && data.frames.length > 0) {
          // Model-authored animation: cycle [rows, ...frames] as idle + walk.
          const all: SpriteData[] = [
            { w: data.w, h: data.h, rows: data.rows },
            ...data.frames.map((rows) => ({ w: data.w, h: data.h, rows })),
          ];
          const idxs = all.map((_, i) => i);
          entry = { frames: all, anims: { idle: idxs, walk: idxs } };
        } else {
          // No authored frames: synthesize a 1px-bob walk frame for liveliness.
          entry = { frames: [data, bobbed(data)], anims: { idle: [0], walk: [0, 1] } };
        }
        // A custom hero can opt into wearing the player's baked likeness head by
        // declaring headSlot; mirror it across every frame so applyLikeness (hero
        // only) composites the face just like a built-in hero's headSlots.
        if (entry && data.headSlot) {
          const hs = data.headSlot;
          entry.headSlots = entry.frames.map(() => ({ x: hs.x, y: hs.y, size: hs.size }));
        }
      }
    }
    if (!entry) {
      // Unknown ref (validator should have caught it) — visible-but-safe fallback.
      entry = LIBRARY['pickup_star'] ?? {
        frames: [{ w: 8, h: 8, rows: Array(8).fill('ffffffff') }],
        anims: { idle: [0] },
      };
    }
    const frames = entry.frames.map((f) => decodeSprite(f, this.spec.palette));
    if (applyLikeness && this.likeness && entry.headSlots) {
      entry.headSlots.forEach((slot, i) => {
        const head = slot.size === 16 ? this.likeness!.head16 : this.likeness!.head12;
        const canvas = frames[i];
        if (head && canvas) {
          const ctx = canvas.getContext('2d')!;
          // Clear the drawn default head area, then paste the baked photo head.
          ctx.clearRect(slot.x, slot.y, slot.size, slot.size);
          ctx.drawImage(head, slot.x, slot.y, slot.size, slot.size);
        }
      });
    }
    return {
      w: entry.frames[0]?.w ?? 8,
      h: entry.frames[0]?.h ?? 8,
      frames,
      flipped: frames.map(flipCanvas),
      flash: frames.map(flashCanvas),
      anims: entry.anims,
    };
  }

  /** Frame canvas for an anim at a time offset (secs), ~7 fps anim rate. */
  frame(sprite: ResolvedSprite, anim: string, t: number, flip = false): HTMLCanvasElement {
    const idxs = sprite.anims[anim] ?? sprite.anims['idle'] ?? [0];
    const i = idxs[Math.floor(t * 7) % idxs.length] ?? 0;
    return (flip ? sprite.flipped : sprite.frames)[i] ?? sprite.frames[0]!;
  }
}

function bobbed(data: SpriteData): SpriteData {
  // Shift art down one pixel (drop the last row, prepend a transparent one).
  const blank = '.'.repeat(data.w);
  return { w: data.w, h: data.h, rows: [blank, ...data.rows.slice(0, data.h - 1)] };
}
