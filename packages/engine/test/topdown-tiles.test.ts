import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SOLID_NORTH,
  TopDownConnectedAutotiles,
  renderTopDownTerrainVariant,
} from '@sparkade/engine';

describe('top-down connected terrain', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('composes density-aware raised edges from exposed neighbors', () => {
    const operations: Array<{ args: number[]; color: string }> = [];
    const context = {
      imageSmoothingEnabled: true,
      fillStyle: '',
      drawImage: () => undefined,
      fillRect(x: number, y: number, w: number, h: number) {
        operations.push({ args: [x, y, w, h], color: this.fillStyle });
      },
    };
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    });

    const output = renderTopDownTerrainVariant(
      { naturalWidth: 64, naturalHeight: 64 } as HTMLImageElement,
      0,
      'raised',
      { raised: '#777777', light: '#eeeeee', dark: '#111111', recess: '#000000' },
    );

    expect(output).toMatchObject({ width: 64, height: 64 });
    expect(operations).toEqual([
      { args: [0, 0, 64, 64], color: '#777777' },
      { args: [0, 0, 64, 4], color: '#eeeeee' },
      { args: [60, 0, 4, 64], color: '#111111' },
      { args: [0, 60, 64, 4], color: '#111111' },
      { args: [0, 0, 4, 64], color: '#eeeeee' },
    ]);
  });

  it('darkens recessed cells and inverts their exposed lip lighting', () => {
    const operations: Array<{ args: number[]; color: string }> = [];
    const context = {
      imageSmoothingEnabled: true,
      fillStyle: '',
      drawImage: () => undefined,
      fillRect(x: number, y: number, w: number, h: number) {
        operations.push({ args: [x, y, w, h], color: this.fillStyle });
      },
    };
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    });

    renderTopDownTerrainVariant(
      { width: 16, height: 16 } as HTMLCanvasElement,
      SOLID_NORTH,
      'recessed',
      { raised: '#777777', light: '#eeeeee', dark: '#111111', recess: '#333333' },
    );

    expect(operations[0]).toEqual({ args: [0, 0, 16, 16], color: '#333333' });
    expect(operations.slice(1)).toEqual([
      { args: [15, 0, 1, 16], color: '#eeeeee' },
      { args: [0, 15, 16, 1], color: '#eeeeee' },
      { args: [0, 0, 1, 16], color: '#111111' },
    ]);
  });

  it('precomposes every mask and wraps independent spatial frames', () => {
    type TaggedCanvas = HTMLCanvasElement & { source?: CanvasImageSource };
    vi.stubGlobal('document', {
      createElement: () => {
        const output = {
          width: 0,
          height: 0,
          getContext: () => ({
            imageSmoothingEnabled: true,
            fillStyle: '',
            drawImage: (source: CanvasImageSource) => {
              output.source = source;
            },
            fillRect: () => undefined,
          }),
        } as unknown as TaggedCanvas;
        return output;
      },
    });
    const frames = [
      { width: 16, height: 16, id: 'a' },
      { width: 16, height: 16, id: 'b' },
      { width: 16, height: 16, id: 'c' },
    ] as unknown as HTMLCanvasElement[];
    const tiles = new TopDownConnectedAutotiles(frames, 'raised');

    expect((tiles.frame(0, 4) as TaggedCanvas).source).toBe(frames[1]);
    expect((tiles.frame(SOLID_NORTH, -1) as TaggedCanvas).source).toBe(frames[2]);
  });
});
