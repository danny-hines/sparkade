// Sprite decoding + the SpriteStore. All pixel work happens at load time
// (ImageData -> offscreen canvas); runtime drawing is drawImage only.
import { type GameSpec, type SpriteData } from '@sparkade/shared';
import { LIBRARY } from './library/index';
import type { HeadSlot, HeadView, LibraryEntry } from './types';

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
  /** The presentation that survived eligibility checks and was actually built. */
  appliedPresentation: SpritePresentation;
  frames: HTMLCanvasElement[];
  flipped: HTMLCanvasElement[];
  flash: HTMLCanvasElement[];
  anims: Record<string, number[]>;
}

export interface LikenessImages {
  head12: CanvasImageSource | null;
  head16: CanvasImageSource | null;
  head12Side?: CanvasImageSource | null;
  head12Back?: CanvasImageSource | null;
  head16Side?: CanvasImageSource | null;
  head16Back?: CanvasImageSource | null;
}

/** Pick a directional likeness image, falling back to the legacy front view. */
export function resolveLikenessHead(
  likeness: LikenessImages,
  slot: HeadSlot,
): CanvasImageSource | null {
  const front = slot.size === 16 ? likeness.head16 : likeness.head12;
  if (slot.view === 'side') {
    return (slot.size === 16 ? likeness.head16Side : likeness.head12Side) ?? front;
  }
  if (slot.view === 'back') {
    return (slot.size === 16 ? likeness.head16Back : likeness.head12Back) ?? front;
  }
  return front;
}

export type SpritePresentation = 'native' | 'tall-humanoid';

export interface SpriteResolveOptions {
  bob?: boolean;
  /** Load-time visual treatment; archetypes still own collision and may match the applied result. */
  presentation?: SpritePresentation;
  /**
   * Shift leading transparent rows to the bottom of each frame. Surface-bound
   * sprites (moving platforms) can then put canvas row 0 exactly on their
   * collision surface, even when generated art included accidental padding.
   */
  anchorOpaqueTop?: boolean;
}

/**
 * Preserve a sprite's canvas size while moving its first visible row to y=0.
 * Index 0 and `.` are transparent, matching decodeSprite().
 */
export function anchorSpriteOpaqueTop(data: SpriteData): SpriteData {
  const firstOpaque = data.rows.findIndex((row) => /[1-9a-f]/i.test(row));
  if (firstOpaque <= 0) return data;
  const blank = '.'.repeat(data.w);
  return {
    ...data,
    rows: [...data.rows.slice(firstOpaque), ...Array<string>(firstOpaque).fill(blank)],
  };
}

/**
 * Turn a legacy 16x16 humanoid into a 16x32 likeness carrier. The authored
 * lower band already contains the torso, gear, arms, and leg poses, so stretch
 * only that band and leave a clean 16x16 slot for the higher-detail head.
 */
export function makeTallHumanoidEntry(
  entry: LibraryEntry,
  preserveNativeHead = false,
): LibraryEntry {
  const slots = entry.headSlots;
  if (
    !slots ||
    slots.length !== entry.frames.length ||
    entry.frames.some((frame, i) => frame.w !== 16 || frame.h !== 16 || slots[i]?.size !== 12)
  ) {
    return entry;
  }

  const blank = '.'.repeat(16);
  const likenessOverlays: SpriteData[] = [];
  const frames = entry.frames.map((frame, i): SpriteData => {
    const slot = slots[i]!;
    // Authored humanoids transition from face to costume around row 9.
    const bodyStart = Math.max(0, Math.min(frame.h - 1, slot.y + 9));
    const overlayRows = Array.from({ length: 32 }, () => Array<string>(16).fill('.'));
    // Preserve only pixels the native 12px likeness compositor would have
    // left outside its head slot (pick blades, sword hilts, scarf tips). Scale
    // their vertical spacing into the new 16px head region, then redraw them
    // after the larger head is pasted.
    for (let sy = 0; sy < bodyStart; sy++) {
      const row = frame.rows[sy] ?? blank;
      const dy = bodyStart <= 1 ? 0 : Math.round((sy * 15) / (bodyStart - 1));
      for (let x = 0; x < 16; x++) {
        const outsideOldSlot =
          sy < slot.y || sy >= slot.y + slot.size || x < slot.x || x >= slot.x + slot.size;
        const ch = row[x] ?? '.';
        if (outsideOldSlot && ch !== '.' && ch !== '0') overlayRows[dy]![x] = ch;
      }
    }
    likenessOverlays.push({
      w: 16,
      h: 32,
      rows: overlayRows.map((row) => row.join('')),
    });
    const source = frame.rows.slice(bodyStart);
    const body = Array.from({ length: 16 }, (_, y) => {
      // Keep the shoulder line at one pixel so tiny one-pixel accessories do
      // not become long vertical streaks. Spend the added height on the torso
      // and legs, where repeated rows read as volume instead.
      const sy = Math.min(source.length - 1, Math.ceil((y * Math.max(0, source.length - 1)) / 15));
      return source[sy] ?? blank;
    });
    const head = Array.from({ length: 16 }, () => Array<string>(16).fill('.'));
    if (preserveNativeHead) {
      // The native library head occupies a 12px slot. Nearest-neighbor scale it
      // into the new 16px head budget, then restore props that lived outside
      // that slot (hat brims, tools, scarf tips) over the scaled pixels.
      for (let y = 0; y < 16; y++) {
        const sy = slot.y + Math.min(slot.size - 1, Math.floor((y * slot.size) / 16));
        const row = frame.rows[sy] ?? blank;
        for (let x = 0; x < 16; x++) {
          const sx = slot.x + Math.min(slot.size - 1, Math.floor((x * slot.size) / 16));
          head[y]![x] = row[sx] ?? '.';
        }
      }
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const ch = overlayRows[y]![x]!;
          if (ch !== '.' && ch !== '0') head[y]![x] = ch;
        }
      }
    }
    return { w: 16, h: 32, rows: [...head.map((row) => row.join('')), ...body] };
  });

  return {
    frames,
    anims: entry.anims,
    headSlots: slots.map((slot) => ({
      x: 0,
      y: 0,
      size: 16 as const,
      ...(slot.view ? { view: slot.view } : {}),
    })),
    likenessOverlays,
  };
}

/**
 * Normalize an arbitrary sprite entry to the platformer's 16x32 player
 * contract. Every authored frame and overlay is retained and scaled with
 * nearest-neighbor sampling, so old custom 16x16 heroes remain animated while
 * new 16x32 heroes pass through unchanged.
 */
export function makeTallSpriteEntry(entry: LibraryEntry): LibraryEntry {
  if (entry.frames.every((frame) => frame.w === 16 && frame.h === 32)) return entry;

  const scaleFrame = (frame: SpriteData): SpriteData => {
    const sourceW = Math.max(1, frame.w);
    const sourceH = Math.max(1, frame.h);
    const rows = Array.from({ length: 32 }, (_, y) => {
      const sy = Math.min(sourceH - 1, Math.floor((y * sourceH) / 32));
      const source = frame.rows[sy] ?? '';
      return Array.from({ length: 16 }, (_, x) => {
        const sx = Math.min(sourceW - 1, Math.floor((x * sourceW) / 16));
        return source[sx] ?? '.';
      }).join('');
    });
    return { w: 16, h: 32, rows };
  };

  const frames = entry.frames.map(scaleFrame);
  const headSlots = entry.headSlots?.map((slot, i) => {
    const source = entry.frames[i] ?? entry.frames[0]!;
    const size: 12 | 16 = slot.size === 16 ? 16 : 12;
    const centerX = ((slot.x + slot.size / 2) * 16) / Math.max(1, source.w);
    const centerY = ((slot.y + slot.size / 2) * 32) / Math.max(1, source.h);
    return {
      x: Math.max(0, Math.min(16 - size, Math.round(centerX - size / 2))),
      y: Math.max(0, Math.min(32 - size, Math.round(centerY - size / 2))),
      size,
      ...(slot.view ? { view: slot.view } : {}),
    };
  });

  return {
    frames,
    anims: entry.anims,
    ...(headSlots ? { headSlots } : {}),
    ...(entry.likenessOverlays ? { likenessOverlays: entry.likenessOverlays.map(scaleFrame) } : {}),
  };
}

/** Select the humanoid-aware transform when possible, generic normalization otherwise. */
export function makeTallHeroEntry(entry: LibraryEntry, preserveNativeHead: boolean): LibraryEntry {
  const canUseHumanoidLayout =
    entry.headSlots?.length === entry.frames.length &&
    entry.frames.every(
      (frame, i) => frame.w === 16 && frame.h === 16 && entry.headSlots?.[i]?.size === 12,
    );
  return canUseHumanoidLayout
    ? makeTallHumanoidEntry(entry, preserveNativeHead)
    : makeTallSpriteEntry(entry);
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
   * Return one of the player's already-loaded likeness heads for procedural
   * renderers that do not resolve a library sprite (the fighter archetype is
   * the first such consumer). Directional fallback stays centralized here so
   * legacy games with only a front head still render a likeness.
   */
  likenessHead(size: 12 | 16, view: HeadView = 'front'): CanvasImageSource | null {
    if (!this.likeness) return null;
    return resolveLikenessHead(this.likeness, { x: 0, y: 0, size, view });
  }

  /**
   * Resolve an assignment role (e.g. "hero", "walker", "tile_solid"), with a
   * library fallback ref. Pass bob:false for tile/terrain roles — the
   * synthesized walk-bob frame makes repeated tiles jitter.
   */
  byRole(role: string, fallbackRef: string, opts: SpriteResolveOptions = {}): ResolvedSprite {
    const ref = this.spec.sprites.assign[role] ?? fallbackRef;
    return this.byRef(ref, role === 'hero', opts);
  }

  /** Resolve a direct sprite ref. */
  byRef(ref: string, applyLikeness = false, opts: SpriteResolveOptions = {}): ResolvedSprite {
    const bob = opts.bob ?? true;
    const presentation = opts.presentation ?? 'native';
    const anchorOpaqueTop = opts.anchorOpaqueTop ?? false;
    const key = `${ref}|${applyLikeness ? 'L' : '-'}|${bob ? 'b' : '-'}|${presentation}|${anchorOpaqueTop ? 'top' : '-'}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const resolved = this.build(ref, applyLikeness, bob, presentation, anchorOpaqueTop);
    this.cache.set(key, resolved);
    return resolved;
  }

  private build(
    ref: string,
    applyLikeness: boolean,
    bob: boolean,
    presentation: SpritePresentation,
    anchorOpaqueTop: boolean,
  ): ResolvedSprite {
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

    // The platformer's explicit height marker is a visual + collision contract,
    // not a likeness feature flag. A marked hero is always resolved at 16x32:
    // supported 16x16 humanoids keep their native head when no photo exists,
    // while arbitrary/custom art is deterministically normalized with every
    // animation frame intact.
    let appliedPresentation: SpritePresentation = 'native';
    if (presentation === 'tall-humanoid') {
      entry = makeTallHeroEntry(entry, !(applyLikeness && this.likeness?.head16));
      appliedPresentation = 'tall-humanoid';
    }

    if (anchorOpaqueTop) {
      entry = { ...entry, frames: entry.frames.map(anchorSpriteOpaqueTop) };
    }

    const frames = entry.frames.map((f) => decodeSprite(f, this.spec.palette));
    const likenessOverlays = entry.likenessOverlays?.map((f) => decodeSprite(f, this.spec.palette));
    if (applyLikeness && this.likeness && entry.headSlots) {
      entry.headSlots.forEach((slot, i) => {
        const head = resolveLikenessHead(this.likeness!, slot);
        const canvas = frames[i];
        if (head && canvas) {
          const ctx = canvas.getContext('2d')!;
          // Clear the drawn default head area, then paste the baked photo head.
          ctx.clearRect(slot.x, slot.y, slot.size, slot.size);
          ctx.drawImage(head, slot.x, slot.y, slot.size, slot.size);
          const overlay = likenessOverlays?.[i];
          if (overlay) ctx.drawImage(overlay, 0, 0);
        }
      });
    }
    return {
      w: entry.frames[0]?.w ?? 8,
      h: entry.frames[0]?.h ?? 8,
      appliedPresentation,
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
