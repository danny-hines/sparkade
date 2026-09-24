/**
 * Software compositor for the racer's per-row ground paint.
 *
 * The generated-surface renderer paints every logical row below the horizon
 * as a stack of 1-px-tall fills and texture-row blits (~15 canvas calls per
 * row, ~3000 per frame). Low-end GPUs (Raspberry Pi 3 / VC4) choke on that
 * op count, not on pixels. This target accepts the same subset of the 2D
 * context API — `fillStyle`, `globalAlpha`, `fillRect` and 9-arg `drawImage`
 * on single rows — and composites into a typed buffer, which `flush` hands to
 * the real context as ONE blit. Source-over is associative, so compositing
 * into a transparent buffer and blitting it once yields the same pixels as
 * issuing each call on the canvas.
 *
 * Horizontal resolution is logical width × `scale` (the display scale), so
 * fractional span edges keep the sub-logical-pixel precision (with coverage
 * antialiasing) that the scaled canvas gave them; each logical row stays one
 * buffer row and is stretched vertically by the flush blit.
 */

/** The 2D-context subset the row loops use; the real context satisfies it. */
export interface RowTarget {
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

/** Straight-alpha RGBA pixels, one uint32 per pixel in ImageData byte order. */
export interface RasterPixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint32Array;
}

/** Little-endian packing matches ImageData's RGBA byte order. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

export function packRgba(r: number, g: number, b: number, a: number): number {
  return LITTLE_ENDIAN
    ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

export function unpackRgba(p: number): [number, number, number, number] {
  return LITTLE_ENDIAN
    ? [p & 255, (p >>> 8) & 255, (p >>> 16) & 255, p >>> 24]
    : [p >>> 24, (p >>> 16) & 255, (p >>> 8) & 255, p & 255];
}

const clampByte = (v: number): number => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

/**
 * Parse the CSS colors the racer builds (`rgb()`, `rgba()`, `#rgb`,
 * `#rrggbb`, `#rrggbbaa`) into [r, g, b, a(0..1)], or null when unsupported.
 */
export function parseCssColor(s: string): [number, number, number, number] | null {
  const c = s.trim();
  if (c.charCodeAt(0) === 35 /* # */) {
    const hex = c.slice(1);
    if (!/^[0-9a-f]+$/i.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) {
      const v = [...hex].map((h) => parseInt(h + h, 16));
      return [v[0]!, v[1]!, v[2]!, hex.length === 4 ? v[3]! / 255 : 1];
    }
    if (hex.length === 6 || hex.length === 8) {
      const n = (i: number): number => parseInt(hex.slice(i, i + 2), 16);
      return [n(0), n(2), n(4), hex.length === 8 ? n(6) / 255 : 1];
    }
    return null;
  }
  const m = /^rgba?\(([^)]*)\)$/i.exec(c);
  if (!m) return null;
  const parts = m[1]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const nums = parts.map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  let a = 1;
  if (parts.length === 4) {
    a = parts[3]!.endsWith('%') ? parseFloat(parts[3]!) / 100 : nums[3]!;
  }
  return [clampByte(nums[0]!), clampByte(nums[1]!), clampByte(nums[2]!), Math.max(0, Math.min(1, a))];
}

export class RowRaster implements RowTarget {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly data: Uint32Array<ArrayBuffer>;
  globalAlpha = 1;
  /** First/last buffer row painted since the last clear (inclusive). */
  private rowMin: number;
  private rowMax = -1;
  private styleString: string | CanvasGradient | CanvasPattern = '#000000';
  private sr = 0;
  private sg = 0;
  private sb = 0;
  private sa = 1;
  private readonly colors = new Map<string, [number, number, number, number] | null>();
  /**
   * Pixels [baseLo, baseHi) of `baseRow` hold exactly `baseColor` from the
   * row's latest opaque fill, except the span [touchLo, touchHi) painted
   * since. A texture blit wholly inside the untouched part blends each
   * source texel against that one color once, then only copies pixels.
   */
  private baseRow = -1;
  private baseLo = 0;
  private baseHi = 0;
  private baseColor = 0;
  private touchLo = 0;
  private touchHi = 0;
  private preblend = new Uint32Array(256);
  private lastImage: CanvasImageSource | null = null;
  private lastPixels: RasterPixels | null = null;
  /** Set when a call fell outside the supported subset; the frame is unsafe. */
  unsupported = false;

  constructor(
    logicalWidth: number,
    rows: number,
    scale: number,
    protected readonly pixelsOf: (img: CanvasImageSource) => RasterPixels | null,
  ) {
    // The blend loops read/write ImageData's RGBA bytes as little-endian
    // uint32s (every browser platform we ship on); big-endian hosts fall
    // back to painting through the canvas.
    if (!LITTLE_ENDIAN) throw new Error('RowRaster requires a little-endian host');
    this.scale = scale;
    this.width = Math.round(logicalWidth * scale);
    this.height = rows;
    this.data = new Uint32Array(this.width * rows);
    this.rowMin = rows;
  }

  get fillStyle(): string | CanvasGradient | CanvasPattern {
    return this.styleString;
  }

  set fillStyle(v: string | CanvasGradient | CanvasPattern) {
    this.styleString = v;
    let rgba: [number, number, number, number] | null = null;
    if (typeof v === 'string') {
      // ~1100 shaded strings per frame: parse the racer's plain `rgb()` /
      // `rgba()` form without allocating; anything else goes through the
      // general parser, cached by string.
      if (this.parsePlainRgb(v)) return;
      const cached = this.colors.get(v);
      if (cached !== undefined) rgba = cached;
      else {
        rgba = parseCssColor(v) ?? this.resolveColor(v);
        if (this.colors.size >= 8192) this.colors.clear();
        this.colors.set(v, rgba);
      }
    }
    if (rgba === null) {
      // The canvas ignores an unparsable color string and keeps the previous
      // one; gradients and patterns have no row equivalent.
      if (typeof v !== 'string') this.unsupported = true;
      return;
    }
    [this.sr, this.sg, this.sb, this.sa] = rgba;
  }

  /**
   * Allocation-free parse of `rgb(r,g,b)` / `rgba(r,g,b,a)` with plain
   * unsigned decimal components (the form the racer builds). Sets the fill
   * color and returns true, or returns false for any other spelling.
   */
  private parsePlainRgb(v: string): boolean {
    const n = v.length;
    if (n < 10 || v.charCodeAt(0) !== 114 /* r */ || v.charCodeAt(1) !== 103 || v.charCodeAt(2) !== 98) return false;
    let i = 3;
    const hasAlpha = v.charCodeAt(i) === 97; /* a */
    if (hasAlpha) i++;
    if (v.charCodeAt(i++) !== 40 /* ( */) return false;
    const want = hasAlpha ? 4 : 3;
    let r = 0, g = 0, b = 0, a = 1;
    for (let k = 0; k < want; k++) {
      let int = 0;
      let frac = 0;
      let scale = 1;
      let digits = 0;
      let c = v.charCodeAt(i);
      while (c >= 48 && c <= 57) {
        int = int * 10 + (c - 48);
        digits++;
        c = v.charCodeAt(++i);
      }
      if (c === 46 /* . */) {
        c = v.charCodeAt(++i);
        while (c >= 48 && c <= 57) {
          if (scale < 1e12) {
            frac = frac * 10 + (c - 48);
            scale *= 10;
          }
          digits++;
          c = v.charCodeAt(++i);
        }
      }
      if (digits === 0) return false;
      const value = int + frac / scale;
      if (k === 0) r = value;
      else if (k === 1) g = value;
      else if (k === 2) b = value;
      else a = value;
      if (c !== (k === want - 1 ? 41 /* ) */ : 44) /* , */) return false;
      i++;
    }
    if (i !== n) return false;
    this.sr = r >= 255 ? 255 : Math.round(r);
    this.sg = g >= 255 ? 255 : Math.round(g);
    this.sb = b >= 255 ? 255 : Math.round(b);
    this.sa = a >= 1 ? 1 : a;
    return true;
  }

  /** Colors outside `parseCssColor` (e.g. named colors); null = unsupported. */
  protected resolveColor(_css: string): [number, number, number, number] | null {
    return null;
  }

  /** Dirty row span painted since the last clear, or null when untouched. */
  dirtyRows(): { min: number; max: number } | null {
    return this.rowMax < this.rowMin ? null : { min: this.rowMin, max: this.rowMax };
  }

  /** Reset painted rows to transparent and the state to canvas defaults. */
  clear(): void {
    if (this.rowMax >= this.rowMin) {
      this.data.fill(0, this.rowMin * this.width, (this.rowMax + 1) * this.width);
    }
    this.rowMin = this.height;
    this.rowMax = -1;
    this.baseRow = -1;
    this.globalAlpha = 1;
    this.unsupported = false;
  }

  /** Record pixels [p0, p1) of `row` as painted over the current base. */
  private touch(row: number, p0: number, p1: number): void {
    if (row !== this.baseRow) return;
    if (p0 < this.touchLo) this.touchLo = p0;
    if (p1 > this.touchHi) this.touchHi = p1;
  }

  private rowIndex(y: number, h: number): number {
    if (h !== 1 || !Number.isInteger(y)) {
      this.unsupported = true;
      return -1;
    }
    if (y < 0 || y >= this.height) return -1;
    if (y < this.rowMin) this.rowMin = y;
    if (y > this.rowMax) this.rowMax = y;
    return y;
  }

  /**
   * Source-over blend of straight-alpha (r,g,b,a∈0..1) into pixel i. The
   * general path: partial-coverage edges and not-yet-opaque destinations.
   * Interior runs over opaque pixels use the integer loops below.
   */
  private blend(i: number, r: number, g: number, b: number, a: number): void {
    if (a <= 0) return;
    const data = this.data;
    if (a >= 1) {
      data[i] = packRgba(r, g, b, 255);
      return;
    }
    const d = data[i]!;
    const dr = d & 255;
    const dg = (d >>> 8) & 255;
    const db = (d >>> 16) & 255;
    const da = d >>> 24;
    if (da === 255) {
      const k = 1 - a;
      data[i] = packRgba(
        (r * a + dr * k + 0.5) | 0,
        (g * a + dg * k + 0.5) | 0,
        (b * a + db * k + 0.5) | 0,
        255,
      );
      return;
    }
    const dA = da / 255;
    const outA = a + dA * (1 - a);
    const kd = (dA * (1 - a)) / outA;
    const ks = a / outA;
    data[i] = packRgba(
      (r * ks + dr * kd + 0.5) | 0,
      (g * ks + dg * kd + 0.5) | 0,
      (b * ks + db * kd + 0.5) | 0,
      (outA * 255 + 0.5) | 0,
    );
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    if (!(w === w) || !(x === x)) return;
    if (w < 0) {
      x += w;
      w = -w;
    }
    const row = this.rowIndex(y, h);
    if (row < 0 || w <= 0) return;
    const a = this.sa * this.globalAlpha;
    if (a <= 0) return;
    const x0 = Math.max(0, x * this.scale);
    const x1 = Math.min(this.width, (x + w) * this.scale);
    if (x1 <= x0) return;
    const base = row * this.width;
    const p0 = Math.floor(x0);
    const p1 = Math.ceil(x1);
    const { sr, sg, sb } = this;
    if (a >= 1 && Math.floor(x1) > Math.ceil(x0)) {
      this.baseRow = row;
      this.baseLo = Math.ceil(x0);
      this.baseHi = Math.floor(x1);
      this.baseColor = packRgba(sr, sg, sb, 255);
      this.touchLo = Infinity;
      this.touchHi = -Infinity;
    } else {
      this.touch(row, p0, p1);
    }
    if (p1 - p0 === 1) {
      this.blend(base + p0, sr, sg, sb, a * (x1 - x0));
      return;
    }
    // Partial-coverage edge pixels, then the fully covered interior.
    this.blend(base + p0, sr, sg, sb, a * (p0 + 1 - x0));
    this.blend(base + p1 - 1, sr, sg, sb, a * (x1 - (p1 - 1)));
    const start = base + p0 + 1;
    const end = base + p1 - 1;
    if (end <= start) return;
    const data = this.data;
    if (a >= 1) {
      data.fill(packRgba(sr, sg, sb, 255), start, end);
      return;
    }
    // x/255 ≈ ((x + 128) * 257) >> 16, exact to rounding for x ≤ 255².
    const a8 = (a * 255 + 0.5) | 0;
    const ia = 255 - a8;
    const pr = sr * a8 + 128;
    const pg = sg * a8 + 128;
    const pb = sb * a8 + 128;
    for (let i = start; i < end; i++) {
      const d = data[i]!;
      if (d >>> 24 !== 255) {
        this.blend(i, sr, sg, sb, a);
        continue;
      }
      data[i] =
        0xff000000 |
        ((((pb + ((d >>> 16) & 255) * ia) * 257) >> 16) << 16) |
        ((((pg + ((d >>> 8) & 255) * ia) * 257) >> 16) << 8) |
        (((pr + (d & 255) * ia) * 257) >> 16);
    }
  }

  /** Coverage-weighted blit of the texel under partially covered pixel p. */
  private edgeTexel(
    p: number,
    X0: number,
    X1: number,
    sx: number,
    du: number,
    sMin: number,
    sMax: number,
    texels: Uint32Array,
    srcBase: number,
    base: number,
    ga: number,
  ): void {
    let tx = Math.floor(sx + (p + 0.5 - X0) * du);
    tx = tx < sMin ? sMin : tx > sMax ? sMax : tx;
    const t = texels[srcBase + tx]!;
    const ta = t >>> 24;
    if (ta === 0) return;
    const cover = Math.min(p + 1, X1) - Math.max(p, X0);
    this.blend(base + p, t & 255, (t >>> 8) & 255, (t >>> 16) & 255, (ta / 255) * ga * cover);
  }

  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    const row = this.rowIndex(dy, dh);
    if (row < 0 || !(dw > 0) || !(sw > 0) || sh <= 0) return;
    let src = this.lastPixels;
    if (image !== this.lastImage) {
      src = this.pixelsOf(image);
      this.lastImage = image;
      this.lastPixels = src;
    }
    if (src === null) {
      this.unsupported = true;
      return;
    }
    const srcRow = Math.floor(sy);
    if (srcRow < 0 || srcRow >= src.height) return;
    const ga = this.globalAlpha;
    if (ga <= 0) return;
    const X0 = dx * this.scale;
    const X1 = (dx + dw) * this.scale;
    const p0 = Math.max(0, Math.floor(X0));
    const p1 = Math.min(this.width, Math.ceil(X1));
    if (p1 <= p0) return;
    // Nearest-neighbour sampling (imageSmoothingEnabled = false): the texel
    // under each destination pixel center, clamped to the source rect.
    const du = sw / (X1 - X0);
    const sMin = Math.max(0, Math.floor(sx));
    const sMax = Math.min(src.width - 1, Math.ceil(sx + sw) - 1);
    const srcBase = srcRow * src.width;
    const texels = src.data;
    const data = this.data;
    const base = row * this.width;
    // Fully covered pixels [pf, pe) take the integer loop; the (at most two)
    // partially covered edge pixels take the coverage-weighted general blend.
    const pf = Math.min(p1, Math.max(p0, Math.ceil(X0)));
    const pe = Math.max(pf, Math.min(p1, Math.floor(X1)));
    for (let p = p0; p < pf; p++) this.edgeTexel(p, X0, X1, sx, du, sMin, sMax, texels, srcBase, base, ga);
    const ga8 = Math.round(ga * 256);
    const u = sx + (pf + 0.5 - X0) * du;
    // 16.16 fixed-point texel stepping (≈2× faster than float on a Pi 3).
    // The sampled index range comes from the same fixed-point math, so a
    // magnified span's reused texels can be pre-blended and the copy loop
    // needs no per-pixel clamp.
    let uf = Math.floor(u * 65536);
    const df = Math.round(du * 65536);
    const kLo = uf >> 16;
    const kHi = pe > pf ? (uf + (pe - pf - 1) * df) >> 16 : kLo;
    const texelCount = kHi - kLo + 1;
    if (
      row === this.baseRow &&
      pf >= this.baseLo &&
      pe <= this.baseHi &&
      (pe <= this.touchLo || pf >= this.touchHi) &&
      texelCount * 2 <= pe - pf
    ) {
      // Uniform opaque destination: blend each used texel against the base
      // once, then copy.
      if (this.preblend.length < texelCount) this.preblend = new Uint32Array(texelCount);
      const pre = this.preblend;
      const c = this.baseColor;
      const cr = c & 255;
      const cg = (c >>> 8) & 255;
      const cb = (c >>> 16) & 255;
      for (let k = 0; k < texelCount; k++) {
        const tx = kLo + k;
        const t = texels[srcBase + (tx < sMin ? sMin : tx > sMax ? sMax : tx)]!;
        const a = ((t >>> 24) * ga8 + 128) >> 8;
        if (a === 0) pre[k] = c;
        else if (a === 255) pre[k] = t;
        else {
          const ia = 255 - a;
          pre[k] =
            0xff000000 |
            (((((t >>> 16) & 255) * a + cb * ia + 128) * 257) >> 16) << 16 |
            (((((t >>> 8) & 255) * a + cg * ia + 128) * 257) >> 16) << 8 |
            ((((t & 255) * a + cr * ia + 128) * 257) >> 16);
        }
      }
      uf -= kLo << 16;
      for (let i = base + pf, end = base + pe; i < end; i++, uf += df) data[i] = pre[uf >> 16]!;
      for (let p = pe; p < p1; p++) this.edgeTexel(p, X0, X1, sx, du, sMin, sMax, texels, srcBase, base, ga);
      this.touch(row, p0, p1);
      return;
    }
    for (let p = pf; p < pe; p++, uf += df) {
      let tx = uf >> 16;
      tx = tx < sMin ? sMin : tx > sMax ? sMax : tx;
      const t = texels[srcBase + tx]!;
      const a = ((t >>> 24) * ga8 + 128) >> 8;
      if (a === 0) continue;
      const i = base + p;
      if (a === 255) {
        data[i] = t;
        continue;
      }
      const d = data[i]!;
      if (d >>> 24 !== 255) {
        this.blend(i, t & 255, (t >>> 8) & 255, (t >>> 16) & 255, a / 255);
        continue;
      }
      const ia = 255 - a;
      data[i] =
        0xff000000 |
        (((((t >>> 16) & 255) * a + ((d >>> 16) & 255) * ia + 128) * 257) >> 16) << 16 |
        (((((t >>> 8) & 255) * a + ((d >>> 8) & 255) * ia + 128) * 257) >> 16) << 8 |
        ((((t & 255) * a + (d & 255) * ia + 128) * 257) >> 16);
    }
    for (let p = pe; p < p1; p++) this.edgeTexel(p, X0, X1, sx, du, sMin, sMax, texels, srcBase, base, ga);
    this.touch(row, p0, p1);
  }
}

function sourceSize(img: CanvasImageSource): { w: number; h: number } | null {
  const s = img as { naturalWidth?: number; naturalHeight?: number; width?: unknown; height?: unknown };
  const w = s.naturalWidth || (typeof s.width === 'number' ? s.width : 0);
  const h = s.naturalHeight || (typeof s.height === 'number' ? s.height : 0);
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * Browser-backed row raster: reads atlas pixels once per image (cached) and
 * presents the painted rows with a single `drawImage`. Returns null outside a
 * DOM (unit tests), where callers paint straight to the context instead.
 */
export class CanvasRowRaster extends RowRaster {
  private readonly canvas: HTMLCanvasElement;
  private readonly bctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly logicalWidth: number;

  private constructor(logicalWidth: number, rows: number, scale: number) {
    const cache = new WeakMap<object, RasterPixels | null>();
    super(logicalWidth, rows, scale, (img) => {
      const key = img as unknown as object;
      if (cache.has(key)) return cache.get(key)!;
      let px: RasterPixels | null = null;
      try {
        const size = sourceSize(img);
        if (size) {
          const c = document.createElement('canvas');
          c.width = size.w;
          c.height = size.h;
          const x = c.getContext('2d', { willReadFrequently: true });
          if (x) {
            x.drawImage(img, 0, 0);
            const d = x.getImageData(0, 0, size.w, size.h).data;
            px = { width: size.w, height: size.h, data: new Uint32Array(d.buffer, d.byteOffset, d.byteLength >> 2) };
          }
        }
      } catch {
        px = null; // tainted or not yet decoded: paint through the context
      }
      cache.set(key, px);
      return px;
    });
    this.logicalWidth = logicalWidth;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = rows;
    this.bctx = this.canvas.getContext('2d')!;
    this.image = new ImageData(
      new Uint8ClampedArray(this.data.buffer, this.data.byteOffset, this.data.byteLength),
      this.width,
      rows,
    );
  }

  static create(logicalWidth: number, rows: number, scale: number): CanvasRowRaster | null {
    if (typeof document === 'undefined' || typeof ImageData === 'undefined') return null;
    try {
      return new CanvasRowRaster(logicalWidth, rows, scale);
    } catch {
      return null;
    }
  }

  private colorProbe: CanvasRenderingContext2D | null = null;
  private readonly namedColors = new Map<string, [number, number, number, number] | null>();

  /** Let the browser normalize any other CSS color (named, hsl, ...). */
  protected override resolveColor(css: string): [number, number, number, number] | null {
    let rgba = this.namedColors.get(css);
    if (rgba !== undefined) return rgba;
    this.colorProbe ??= document.createElement('canvas').getContext('2d');
    rgba = null;
    if (this.colorProbe) {
      this.colorProbe.fillStyle = '#010203';
      this.colorProbe.fillStyle = css;
      const normalized = String(this.colorProbe.fillStyle);
      rgba = normalized === '#010203' ? null : parseCssColor(normalized);
    }
    if (this.namedColors.size < 256) this.namedColors.set(css, rgba);
    return rgba;
  }

  /** Whether `img` can be sampled here (pixels readable). */
  canSample(img: CanvasImageSource): boolean {
    return this.pixelsOf(img) !== null;
  }

  /** Blit the painted rows onto `ctx` (logical coordinates) in one call. */
  flushTo(ctx: CanvasRenderingContext2D): void {
    const rows = this.dirtyRows();
    if (rows === null) return;
    const n = rows.max - rows.min + 1;
    this.bctx.putImageData(this.image, 0, 0, 0, rows.min, this.width, n);
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.canvas, 0, rows.min, this.width, n, 0, rows.min, this.logicalWidth, n);
    ctx.globalAlpha = alpha;
  }
}
