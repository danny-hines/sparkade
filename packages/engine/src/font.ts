// 8×8 bitmap font renderer. Glyph data lives in fontdata.ts (hand-authored).
// Glyphs are pre-rendered per color into atlas canvases at first use — runtime
// text drawing is drawImage only.
import { FONT_GLYPHS } from './fontdata';

export const GLYPH = 8;

const atlasCache = new Map<string, { canvas: HTMLCanvasElement; index: Map<string, number> }>();
let glyphOrder: string[] | null = null;

function order(): string[] {
  if (!glyphOrder) glyphOrder = Object.keys(FONT_GLYPHS);
  return glyphOrder;
}

function buildAtlas(color: string): { canvas: HTMLCanvasElement; index: Map<string, number> } {
  const chars = order();
  const canvas = document.createElement('canvas');
  canvas.width = chars.length * GLYPH;
  canvas.height = GLYPH;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(canvas.width, GLYPH);
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const index = new Map<string, number>();
  chars.forEach((ch, ci) => {
    index.set(ch, ci);
    const rows = FONT_GLYPHS[ch]!;
    for (let y = 0; y < GLYPH; y++) {
      const row = rows[y] ?? '';
      for (let x = 0; x < GLYPH; x++) {
        if (row[x] === '#') {
          const o = (y * canvas.width + ci * GLYPH + x) * 4;
          img.data[o] = r;
          img.data[o + 1] = g;
          img.data[o + 2] = b;
          img.data[o + 3] = 255;
        }
      }
    }
  });
  ctx.putImageData(img, 0, 0);
  return { canvas, index };
}

function atlas(color: string) {
  let a = atlasCache.get(color);
  if (!a) {
    a = buildAtlas(color);
    atlasCache.set(color, a);
  }
  return a;
}

export interface TextOpts {
  scale?: number;
  align?: 'left' | 'center' | 'right';
  /** Draw only the first n characters (letter-by-letter reveal). */
  reveal?: number;
}

/** The font is caps-only; lowercase maps up. Unknown glyphs render as space. */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color = '#f4f4f4',
  opts: TextOpts = {},
): void {
  const { canvas, index } = atlas(color);
  const scale = opts.scale ?? 1;
  const upper = text.toUpperCase();
  const w = upper.length * GLYPH * scale;
  let px = x;
  if (opts.align === 'center') px = Math.round(x - w / 2);
  else if (opts.align === 'right') px = Math.round(x - w);
  const n = opts.reveal !== undefined ? Math.min(opts.reveal, upper.length) : upper.length;
  for (let i = 0; i < n; i++) {
    const ch = upper[i]!;
    if (ch !== ' ') {
      const gi = index.get(ch);
      if (gi !== undefined) {
        ctx.drawImage(canvas, gi * GLYPH, 0, GLYPH, GLYPH, px, y, GLYPH * scale, GLYPH * scale);
      }
    }
    px += GLYPH * scale;
  }
}

export function textWidth(text: string, scale = 1): number {
  return text.length * GLYPH * scale;
}

/** Greedy word wrap to a pixel width. */
export function wrapText(text: string, maxWidth: number, scale = 1): string[] {
  const maxChars = Math.max(1, Math.floor(maxWidth / (GLYPH * scale)));
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length === 0) {
      line = word;
    } else if (line.length + 1 + word.length <= maxChars) {
      line += ' ' + word;
    } else {
      lines.push(line);
      line = word;
    }
    // Hard-break pathological long words.
    while (line.length > maxChars) {
      lines.push(line.slice(0, maxChars));
      line = line.slice(maxChars);
    }
  }
  if (line.length) lines.push(line);
  return lines;
}
