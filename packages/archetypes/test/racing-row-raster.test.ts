import { describe, expect, it } from 'vitest';
import {
  RowRaster,
  packRgba,
  parseCssColor,
  unpackRgba,
  type RasterPixels,
} from '../src/racing/row-raster';

function texture(width: number, height: number, px: (x: number, y: number) => number): RasterPixels {
  const data = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = px(x, y);
  return { width, height, data };
}

const noTextures = (): RasterPixels | null => null;
const at = (r: RowRaster, x: number, y: number) => unpackRgba(r.data[y * r.width + x]!);

/** Reference straight-alpha source-over, the canvas compositing rule. */
function over(
  src: [number, number, number, number],
  dst: [number, number, number, number],
): [number, number, number, number] {
  const sa = src[3] / 255;
  const da = dst[3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return [0, 0, 0, 0];
  const c = (i: number) => (src[i]! * sa + dst[i]! * da * (1 - sa)) / oa;
  return [c(0), c(1), c(2), oa * 255];
}

describe('parseCssColor', () => {
  it('parses the color forms the racer builds', () => {
    expect(parseCssColor('rgb(10,20,30)')).toEqual([10, 20, 30, 1]);
    expect(parseCssColor('rgba(240,240,220,0.35)')).toEqual([240, 240, 220, 0.35]);
    expect(parseCssColor('rgba(0, 0, 0, 0.45)')).toEqual([0, 0, 0, 0.45]);
    expect(parseCssColor('#ff7a2e')).toEqual([255, 122, 46, 1]);
    expect(parseCssColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseCssColor('#00000080')![3]).toBeCloseTo(128 / 255);
    expect(parseCssColor('orange')).toBeNull();
  });
});

describe('RowRaster', () => {
  it('fills whole device pixels at display scale and antialiases fractional edges', () => {
    const r = new RowRaster(8, 4, 2, noTextures);
    r.fillStyle = 'rgb(200,100,50)';
    // Logical 1.25..3.0 → device 2.5..6.0: pixel 2 half covered, 3..5 full.
    r.fillRect(1.25, 2, 1.75, 1);
    expect(at(r, 1, 2)[3]).toBe(0);
    expect(at(r, 2, 2)).toEqual([200, 100, 50, 128]);
    for (const x of [3, 4, 5]) expect(at(r, x, 2)).toEqual([200, 100, 50, 255]);
    expect(at(r, 6, 2)[3]).toBe(0);
    expect(r.dirtyRows()).toEqual({ min: 2, max: 2 });
  });

  it('matches canvas source-over for translucent fills over opaque ones', () => {
    const r = new RowRaster(4, 1, 1, noTextures);
    r.fillStyle = 'rgb(20,40,60)';
    r.fillRect(0, 0, 4, 1);
    r.fillStyle = 'rgba(240,240,220,0.3)';
    r.globalAlpha = 0.5;
    r.fillRect(0, 0, 4, 1);
    const want = over([240, 240, 220, 0.15 * 255], [20, 40, 60, 255]);
    const got = at(r, 1, 0);
    for (let i = 0; i < 4; i++) expect(Math.abs(got[i]! - want[i]!)).toBeLessThanOrEqual(1);
  });

  it('composited-then-blitted equals painting each call directly (associativity)', () => {
    const background: [number, number, number, number] = [30, 60, 90, 255];
    // Direct: paint background then two translucent layers.
    const direct = new RowRaster(2, 1, 1, noTextures);
    direct.fillStyle = `rgb(${background.slice(0, 3).join(',')})`;
    direct.fillRect(0, 0, 2, 1);
    const layers = ['rgba(255,0,0,0.4)', 'rgba(0,255,128,0.25)'];
    for (const l of layers) {
      direct.fillStyle = l;
      direct.fillRect(0, 0, 2, 1);
    }
    // Buffered: layers into a transparent buffer, then the buffer over the background.
    const buffered = new RowRaster(2, 1, 1, noTextures);
    for (const l of layers) {
      buffered.fillStyle = l;
      buffered.fillRect(0, 0, 2, 1);
    }
    const result = over(at(buffered, 0, 0), background);
    const want = at(direct, 0, 0);
    for (let i = 0; i < 4; i++) expect(Math.abs(result[i]! - want[i]!)).toBeLessThanOrEqual(1.5);
  });

  it('samples texture rows nearest-neighbour inside the source rect with global alpha', () => {
    // 4x2 texture: row 1 is red,green,blue,white.
    const colors = [packRgba(255, 0, 0, 255), packRgba(0, 255, 0, 255), packRgba(0, 0, 255, 255), packRgba(255, 255, 255, 255)];
    const tex = texture(4, 2, (x, y) => (y === 1 ? colors[x]! : packRgba(0, 0, 0, 255)));
    const img = {} as CanvasImageSource;
    const r = new RowRaster(8, 1, 1, (i) => (i === img ? tex : null));
    // Source x 1..3 (green, blue) stretched over dest 0..8.
    r.drawImage(img, 1, 1, 2, 1, 0, 0, 8, 1);
    expect(at(r, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(at(r, 3, 0)).toEqual([0, 255, 0, 255]);
    expect(at(r, 4, 0)).toEqual([0, 0, 255, 255]);
    expect(at(r, 7, 0)).toEqual([0, 0, 255, 255]);
    r.clear();
    r.globalAlpha = 0.5;
    r.drawImage(img, 0, 1, 1, 1, 0, 0, 2, 1);
    expect(at(r, 0, 0)).toEqual([255, 0, 0, 128]);
  });

  it('flags calls it cannot reproduce so the caller repaints on the canvas', () => {
    const r = new RowRaster(4, 4, 1, noTextures);
    r.fillStyle = 'rgb(1,2,3)';
    r.fillRect(0, 1.5, 2, 1);
    expect(r.unsupported).toBe(true);
    r.clear();
    expect(r.unsupported).toBe(false);
    r.fillRect(0, 0, 2, 2);
    expect(r.unsupported).toBe(true);
    r.clear();
    r.fillStyle = {} as CanvasGradient;
    expect(r.unsupported).toBe(true);
    r.clear();
    // Like the canvas, an unparsable color string is ignored, not fatal.
    r.fillStyle = 'rgb(9,8,7)';
    r.fillStyle = 'rgba(1,2,3,NaN)';
    expect(r.unsupported).toBe(false);
    r.fillRect(0, 0, 1, 1);
    expect(unpackRgba(r.data[0]!)).toEqual([9, 8, 7, 255]);
    r.clear();
    r.drawImage({} as CanvasImageSource, 0, 0, 1, 1, 0, 0, 1, 1);
    expect(r.unsupported).toBe(true);
  });

  it('reads the racer\'s plain rgb()/rgba() strings exactly', () => {
    const r = new RowRaster(1, 1, 1, noTextures);
    r.fillStyle = 'rgb(12,34,56)';
    r.fillRect(0, 0, 1, 1);
    expect(at(r, 0, 0)).toEqual([12, 34, 56, 255]);
    r.clear();
    r.fillStyle = 'rgba(240,240,220,0.35000000000000003)';
    r.fillRect(0, 0, 1, 1);
    expect(at(r, 0, 0)).toEqual([240, 240, 220, 89]);
    r.clear();
    // Other spellings still parse through the general path.
    r.fillStyle = 'rgba(0, 0, 0, 0.5)';
    r.fillRect(0, 0, 1, 1);
    expect(at(r, 0, 0)).toEqual([0, 0, 0, 128]);
  });

  it('copies pre-blended texels over an untouched opaque base exactly like blending each pixel', () => {
    const tex = texture(8, 1, (x) => packRgba(x * 30, 255 - x * 30, 90, 255));
    const img = {} as CanvasImageSource;
    const paint = (touchFirst: boolean): number[] => {
      const r = new RowRaster(64, 1, 1, (i) => (i === img ? tex : null));
      r.fillStyle = 'rgb(40,80,120)';
      r.fillRect(0, 0, 64, 1);
      // A 1-px translucent mark over the whole span forces the general blend.
      if (touchFirst) {
        r.fillStyle = 'rgba(40,80,120,0)';
        r.fillRect(0.5, 0, 63, 1);
      }
      r.globalAlpha = 0.45;
      r.drawImage(img, 1.5, 0, 5, 1, 3.25, 0, 57.5, 1);
      return Array.from(r.data);
    };
    const fast = paint(false);
    const general = paint(true);
    for (let i = 0; i < fast.length; i++) {
      const a = unpackRgba(fast[i]!);
      const b = unpackRgba(general[i]!);
      for (let c = 0; c < 4; c++) expect(Math.abs(a[c]! - b[c]!)).toBeLessThanOrEqual(1);
    }
  });

  it('clears only painted rows and resets alpha', () => {
    const r = new RowRaster(2, 3, 1, noTextures);
    r.fillStyle = '#ffffff';
    r.globalAlpha = 0.5;
    r.fillRect(0, 1, 2, 1);
    r.clear();
    expect(r.globalAlpha).toBe(1);
    expect(Array.from(r.data).every((p) => p === 0)).toBe(true);
    expect(r.dirtyRows()).toBeNull();
  });
});
