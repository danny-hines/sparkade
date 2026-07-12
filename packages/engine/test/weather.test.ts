import { describe, expect, it } from 'vitest';
import { makeWeather, WEATHER_KINDS } from '@sparkade/engine';

const PALETTE = [
  '#000000', '#1a1c2c', '#29366f', '#3b5dc9', '#41a6f6', '#38b764', '#a7f070', '#ffcd75',
  '#b13e53', '#ef7d57', '#5d275d', '#e04040', '#ffa300', '#ffd75e', '#94b0c2', '#f4f4f4',
];

/** Minimal 2D-context stand-in that logs the geometry of every draw call. */
function recCtx() {
  const ops: string[] = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    fillRect: (x: number, y: number, w: number, h: number) => ops.push(`R${x | 0},${y | 0},${w | 0},${h | 0}`),
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: (x: number, y: number) => ops.push(`M${x | 0},${y | 0}`),
    lineTo: (x: number, y: number) => ops.push(`L${x | 0},${y | 0}`),
    stroke: () => {},
    arc: (x: number, y: number, r: number) => ops.push(`A${x | 0},${y | 0},${r | 0}`),
    fill: () => {},
    save: () => {},
    restore: () => {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

describe('weather overlays', () => {
  it('every kind constructs, updates and draws for two seconds without throwing', () => {
    for (const kind of WEATHER_KINDS) {
      const w = makeWeather(kind, PALETTE, 12345);
      const { ctx } = recCtx();
      expect(() => {
        for (let i = 0; i < 120; i++) {
          w.update(1 / 60);
          w.draw(ctx, i * 3, 0);
        }
      }, kind).not.toThrow();
    }
  });

  it("'none' draws nothing", () => {
    const w = makeWeather('none', PALETTE, 1);
    const { ctx, ops } = recCtx();
    for (let i = 0; i < 60; i++) {
      w.update(1 / 60);
      w.draw(ctx, 0, 0);
    }
    expect(ops.length).toBe(0);
  });

  it('every kind except none actually renders (guards a missing KINDS entry)', () => {
    for (const kind of WEATHER_KINDS) {
      if (kind === 'none') continue;
      const w = makeWeather(kind, PALETTE, 5);
      const { ctx, ops } = recCtx();
      for (let i = 0; i < 20; i++) {
        w.update(1 / 60);
        w.draw(ctx, i * 4, 0);
      }
      expect(ops.length, `${kind} should draw something`).toBeGreaterThan(0);
    }
  });

  it('is deterministic for a given seed and varies across seeds', () => {
    const run = (seed: number): string => {
      const w = makeWeather('rain', PALETTE, seed);
      const { ctx, ops } = recCtx();
      for (let i = 0; i < 30; i++) {
        w.update(1 / 60);
        w.draw(ctx, i, 0);
      }
      return ops.join('|');
    };
    expect(run(999)).toBe(run(999)); // same seed → identical
    expect(run(999)).not.toBe(run(1000)); // different seed → different field
  });

  it('stays within a bounded per-frame primitive budget (Pi 3B+)', () => {
    for (const kind of WEATHER_KINDS) {
      const w = makeWeather(kind, PALETTE, 7);
      const { ctx, ops } = recCtx();
      w.update(1 / 60);
      w.draw(ctx, 0, 0);
      expect(ops.length, `${kind} primitives/frame`).toBeLessThanOrEqual(160);
    }
  });
});
