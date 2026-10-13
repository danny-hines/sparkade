// Procedural in-between frames for a generated platformer player's run. Each
// one moves a contact frame's pixels part of the way toward the side idle, so
// the runtime can play an eight-beat run from the three generated run frames.
// Pure computation on RGBA arrays: it runs in a browser worker, in Node, and in
// tests alike, and it only moves existing pixels (no new colors).

/** Bump when the output changes so device caches regenerate. */
export const RUN_INBETWEEN_VERSION = 1;
/** Fraction of the way from a contact frame toward the side idle. A third keeps
 * fast-moving hands and feet intact; halfway stretches them. */
export const RUN_INBETWEEN_T = 1 / 3;
export const RUN_INBETWEEN_POSES = ['runMid1', 'runMid2'] as const;
export type RunInbetweenPose = (typeof RUN_INBETWEEN_POSES)[number];

export interface RgbaFrame {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

const BLOCK = 6;
const SEARCH = 20;
const MARGIN = 3;
const TRANSPARENT_MISMATCH = 400;

/** One canvas for all frames: widths padded symmetrically, feet on the bottom
 * row, matching how the runtime centers each generated pose. */
export function alignRgbaFrames(frames: readonly RgbaFrame[]): RgbaFrame[] {
  const width = Math.max(...frames.map((f) => f.width));
  const height = Math.max(...frames.map((f) => f.height));
  return frames.map((frame) => {
    if (frame.width === width && frame.height === height) return frame;
    const data = new Uint8ClampedArray(width * height * 4);
    const left = Math.floor((width - frame.width) / 2);
    const top = height - frame.height;
    for (let y = 0; y < frame.height; y++)
      data.set(
        frame.data.subarray(y * frame.width * 4, (y + 1) * frame.width * 4),
        ((y + top) * width + left) * 4,
      );
    return { data, width, height };
  });
}

function alphaMask(frame: RgbaFrame): Uint8Array {
  const mask = new Uint8Array(frame.width * frame.height);
  for (let p = 0; p < mask.length; p++) mask[p] = frame.data[p * 4 + 3]! > 8 ? 1 : 0;
  return mask;
}

/** Per-block displacement from `from` to `to` by exhaustive block matching
 * over the block plus a margin. Transparent pixels count too, so edges must
 * line up (flat interiors alone match many shifts), and a small preference
 * for short moves breaks ties. Starting from the previous block's vector lets
 * most candidates stop early without changing the result. Coarser searches
 * were measured and changed 8-19% of output pixels, so the search stays
 * exhaustive. A 3x3 median then drops outliers. Blocks with fewer than four
 * opaque pixels carry no vector. */
function blockFlow(from: RgbaFrame, to: RgbaFrame): Array<[number, number] | null> {
  const { width, height } = from;
  const columns = Math.ceil(width / BLOCK);
  const rows = Math.ceil(height / BLOCK);
  const fromMask = alphaMask(from);
  const toMask = alphaMask(to);
  const a = from.data;
  const b = to.data;
  const raw: Array<[number, number] | null> = new Array(columns * rows).fill(null);
  const windowX = new Int16Array((BLOCK + MARGIN * 2) ** 2);
  const windowY = new Int16Array(windowX.length);
  let seed: [number, number] = [0, 0];
  for (let by = 0; by < rows; by++)
    for (let bx = 0; bx < columns; bx++) {
      let solid = 0;
      for (let y = by * BLOCK; y < Math.min(height, (by + 1) * BLOCK); y++)
        for (let x = bx * BLOCK; x < Math.min(width, (bx + 1) * BLOCK); x++)
          solid += fromMask[y * width + x]!;
      if (solid < 4) continue;
      let size = 0;
      for (
        let y = Math.max(0, by * BLOCK - MARGIN);
        y < Math.min(height, (by + 1) * BLOCK + MARGIN);
        y++
      )
        for (
          let x = Math.max(0, bx * BLOCK - MARGIN);
          x < Math.min(width, (bx + 1) * BLOCK + MARGIN);
          x++
        ) {
          windowX[size] = x;
          windowY[size] = y;
          size++;
        }
      let bestCost = Infinity;
      let best: [number, number] = [0, 0];
      const evaluate = (dx: number, dy: number) => {
        let cost = 2 * (Math.abs(dx) + Math.abs(dy));
        for (let i = 0; i < size && cost < bestCost; i++) {
          const x = windowX[i]!;
          const y = windowY[i]!;
          const p = y * width + x;
          const tx = x + dx;
          const ty = y + dy;
          const q = ty * width + tx;
          const inFrom = fromMask[p]!;
          const inTo = tx >= 0 && ty >= 0 && tx < width && ty < height ? toMask[q]! : 0;
          if (inFrom !== inTo) cost += TRANSPARENT_MISMATCH;
          else if (inFrom)
            cost +=
              Math.abs(a[p * 4]! - b[q * 4]!) +
              Math.abs(a[p * 4 + 1]! - b[q * 4 + 1]!) +
              Math.abs(a[p * 4 + 2]! - b[q * 4 + 2]!);
        }
        if (cost < bestCost) {
          bestCost = cost;
          best = [dx, dy];
        }
      };
      evaluate(seed[0], seed[1]);
      for (let dy = -SEARCH; dy <= SEARCH; dy++)
        for (let dx = -SEARCH; dx <= SEARCH; dx++) evaluate(dx, dy);
      raw[by * columns + bx] = best;
      seed = best;
    }
  const median = (values: number[]) => values.sort((x, y) => x - y)[values.length >> 1]!;
  return raw.map((vector, i) => {
    if (!vector) return null;
    const bx = i % columns;
    const by = Math.floor(i / columns);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let y = by - 1; y <= by + 1; y++)
      for (let x = bx - 1; x <= bx + 1; x++) {
        const v = x >= 0 && y >= 0 && x < columns && y < rows ? raw[y * columns + x] : null;
        if (v) {
          xs.push(v[0]);
          ys.push(v[1]);
        }
      }
    return [median(xs), median(ys)];
  });
}

/** Bilinear per-pixel displacement from block-center vectors; blocks without
 * a vector borrow the nearest one so the field covers the whole sprite. */
function denseField(flow: Array<[number, number] | null>, width: number, height: number) {
  const columns = Math.ceil(width / BLOCK);
  const rows = Math.ceil(height / BLOCK);
  const known = flow.flatMap((v, i) => (v ? [{ i, v }] : []));
  const filled = flow.map((v, i) => {
    if (v || !known.length) return v ?? ([0, 0] as [number, number]);
    const bx = i % columns;
    const by = Math.floor(i / columns);
    let best = known[0]!;
    let distance = Infinity;
    for (const k of known) {
      const d = ((k.i % columns) - bx) ** 2 + (Math.floor(k.i / columns) - by) ** 2;
      if (d < distance) {
        distance = d;
        best = k;
      }
    }
    return best.v;
  });
  return (x: number, y: number): [number, number] => {
    const fx = Math.min(columns - 1, Math.max(0, (x + 0.5) / BLOCK - 0.5));
    const fy = Math.min(rows - 1, Math.max(0, (y + 0.5) / BLOCK - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(columns - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (cx: number, cy: number) => filled[cy * columns + cx]!;
    const mix = (k: 0 | 1) =>
      (at(x0, y0)[k] * (1 - tx) + at(x1, y0)[k] * tx) * (1 - ty) +
      (at(x0, y1)[k] * (1 - tx) + at(x1, y1)[k] * tx) * ty;
    return [mix(0), mix(1)];
  };
}

/** The dense displacement field `runInbetween` moves `from`'s pixels along,
 * in pixels toward `to` (scaled by t when splatting). */
export function runInbetweenField(
  from: RgbaFrame,
  to: RgbaFrame,
): (x: number, y: number) => [number, number] {
  return denseField(blockFlow(from, to), from.width, from.height);
}

/** Pixel-shift morph: estimate block motion from `from` to `to`, smooth it
 * into a per-pixel field, move each of `from`'s pixels `t` of the way, and
 * close the one-pixel gaps that stretching leaves. Original colors only, from
 * one source frame, so nothing speckles. Both frames share one canvas. */
export function runInbetween(from: RgbaFrame, to: RgbaFrame, t = RUN_INBETWEEN_T): RgbaFrame {
  const { width, height } = from;
  const field = denseField(blockFlow(from, to), width, height);
  let out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (from.data[p * 4 + 3]! <= 8) continue;
      const [dx, dy] = field(x, y);
      const nx = x + Math.round(dx * t);
      const ny = y + Math.round(dy * t);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      out.set(from.data.subarray(p * 4, p * 4 + 4), (ny * width + nx) * 4);
    }
  // Fill a gap with opaque pixels on both sides horizontally or vertically.
  // Two passes close the streaks that stretching leaves.
  for (let pass = 0; pass < 2; pass++) {
    const next = out.slice();
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const p = y * width + x;
        if (out[p * 4 + 3]! > 8) continue;
        const solid = (n: number) => out[n * 4 + 3]! > 8;
        const source =
          solid(p - 1) && solid(p + 1)
            ? p - 1
            : solid(p - width) && solid(p + width)
              ? p - width
              : null;
        if (source !== null) next.set(out.subarray(source * 4, source * 4 + 4), p * 4);
      }
    out = next;
  }
  return { data: out, width, height };
}

/** The two run in-betweens for a generated player, on one shared canvas:
 * `runMid1` leans from contact A toward the side idle, `runMid2` from
 * contact B. */
export function buildRunInbetweens(frames: {
  walk1: RgbaFrame;
  sideIdle: RgbaFrame;
  walk2: RgbaFrame;
}): Record<RunInbetweenPose, RgbaFrame> {
  const [walk1, sideIdle, walk2] = alignRgbaFrames([frames.walk1, frames.sideIdle, frames.walk2]);
  return {
    runMid1: runInbetween(walk1!, sideIdle!),
    runMid2: runInbetween(walk2!, sideIdle!),
  };
}
