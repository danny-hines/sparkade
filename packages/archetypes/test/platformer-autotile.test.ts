import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SOLID_EAST,
  SOLID_NORTH,
  SOLID_SOUTH,
  SOLID_WEST,
  PlatformerSolidAutotiles,
  exposedSolidEdges,
  inferSolidInnerRef,
  isSolidInnerLibraryId,
  renderSolidVariant,
  resolveSolidInnerRef,
  roundedSolidCorners,
  solidNeighborMask,
  solidTileVariant,
} from '../src/platformer/autotile';

describe('platformer solid autotiling', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds a four-neighbour mask without consulting diagonals', () => {
    const solids = new Set(['2,1', '3,2', '2,3', '1,2', '3,3']);
    const mask = solidNeighborMask((x, y) => solids.has(`${x},${y}`), 2, 2);

    expect(mask).toBe(SOLID_NORTH | SOLID_EAST | SOLID_SOUTH | SOLID_WEST);
    solids.delete('2,1');
    expect(solidNeighborMask((x, y) => solids.has(`${x},${y}`), 2, 2)).toBe(
      SOLID_EAST | SOLID_SOUTH | SOLID_WEST,
    );
  });

  it('uses cap art only when the north side is exposed', () => {
    expect(solidTileVariant(0)).toBe('cap');
    expect(solidTileVariant(SOLID_EAST | SOLID_SOUTH | SOLID_WEST)).toBe('cap');
    expect(solidTileVariant(SOLID_NORTH)).toBe('inner');
    expect(solidTileVariant(SOLID_NORTH | SOLID_EAST | SOLID_SOUTH | SOLID_WEST)).toBe('inner');
  });

  it('turns a solid rectangle into one cap row, buried body, and perimeter-only edges', () => {
    const solids = new Set(['0,0', '1,0', '0,1', '1,1']);
    const maskAt = (x: number, y: number) =>
      solidNeighborMask((tx, ty) => solids.has(`${tx},${ty}`), x, y);

    expect(solidTileVariant(maskAt(0, 0))).toBe('cap');
    expect(solidTileVariant(maskAt(1, 0))).toBe('cap');
    expect(solidTileVariant(maskAt(0, 1))).toBe('inner');
    expect(solidTileVariant(maskAt(1, 1))).toBe('inner');
    expect(exposedSolidEdges(maskAt(0, 0))).toEqual(['north', 'west']);
    expect(exposedSolidEdges(maskAt(1, 0))).toEqual(['north', 'east']);
    expect(exposedSolidEdges(maskAt(0, 1))).toEqual(['south', 'west']);
    expect(exposedSolidEdges(maskAt(1, 1))).toEqual(['east', 'south']);
  });

  it('outlines exposed sides and rounds only convex outside corners', () => {
    const northWestOpen = SOLID_EAST | SOLID_SOUTH;
    expect(exposedSolidEdges(northWestOpen)).toEqual(['north', 'west']);
    expect(roundedSolidCorners(northWestOpen)).toEqual(['northWest']);

    expect(roundedSolidCorners(0)).toEqual(['northWest', 'northEast', 'southEast', 'southWest']);
    expect(roundedSolidCorners(SOLID_EAST | SOLID_SOUTH | SOLID_WEST)).toEqual([]);
  });

  it('infers only conventional built-in solid-inner companion ids', () => {
    expect(inferSolidInnerRef('lib:ice_solid')).toBe('lib:ice_solid_inner');
    expect(inferSolidInnerRef('lib:tile_solid')).toBe('lib:tile_solid_inner');
    expect(inferSolidInnerRef('lib:ice_wall')).toBeNull();
    expect(inferSolidInnerRef('custom:ice_solid')).toBeNull();
    expect(isSolidInnerLibraryId('ice_solid_inner')).toBe(true);
    expect(isSolidInnerLibraryId('hero_squire')).toBe(false);
    expect(isSolidInnerLibraryId('ice_wall')).toBe(false);
  });

  it('prefers a valid explicit assignment and otherwise uses an available inferred ref', () => {
    const available = new Set(['custom:hand_inner', 'lib:ice_solid_inner']);
    const exists = (ref: string): boolean => available.has(ref);

    expect(resolveSolidInnerRef('lib:ice_solid', 'custom:hand_inner', exists)).toBe(
      'custom:hand_inner',
    );
    expect(resolveSolidInnerRef('lib:ice_solid', undefined, exists)).toBe('lib:ice_solid_inner');
    expect(resolveSolidInnerRef('custom:hand_cap', undefined, exists)).toBeNull();
    expect(resolveSolidInnerRef('lib:ice_solid', 'custom:missing', exists)).toBe(
      'lib:ice_solid_inner',
    );
    expect(resolveSolidInnerRef('lib:cave_solid', undefined, exists)).toBeNull();
  });

  it('selects cap/body sources per mask and wraps their animation independently', () => {
    type TaggedCanvas = HTMLCanvasElement & { source?: HTMLCanvasElement };
    vi.stubGlobal('document', {
      createElement: () => {
        const output = {
          width: 0,
          height: 0,
          getContext: () => ({
            imageSmoothingEnabled: true,
            fillStyle: '',
            drawImage: (source: HTMLCanvasElement) => {
              output.source = source;
            },
            fillRect: () => undefined,
            clearRect: () => undefined,
          }),
        } as unknown as TaggedCanvas;
        return output;
      },
    });
    const source = (name: string) =>
      ({ width: 16, height: 16, name }) as unknown as HTMLCanvasElement;
    const caps = [source('cap-0'), source('cap-1')];
    const inners = [source('inner-0'), source('inner-1'), source('inner-2')];
    const autotiles = new PlatformerSolidAutotiles(caps, inners, '#123456');

    expect((autotiles.frame(0, 3) as TaggedCanvas).source).toBe(caps[1]);
    expect((autotiles.frame(SOLID_NORTH, 4) as TaggedCanvas).source).toBe(inners[1]);
    expect((autotiles.frame(SOLID_NORTH, -1) as TaggedCanvas).source).toBe(inners[2]);
  });

  it('stamps a one-pixel perimeter and two-pixel stepped outside corners', () => {
    const operations: Array<{ op: string; args: number[]; color?: string }> = [];
    const context = {
      imageSmoothingEnabled: true,
      fillStyle: '',
      drawImage: () => operations.push({ op: 'drawImage', args: [] }),
      fillRect(x: number, y: number, w: number, h: number) {
        operations.push({ op: 'fillRect', args: [x, y, w, h], color: this.fillStyle });
      },
      clearRect: (x: number, y: number, w: number, h: number) =>
        operations.push({ op: 'clearRect', args: [x, y, w, h] }),
    };
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => context,
      }),
    });

    const output = renderSolidVariant(
      { width: 16, height: 16 } as HTMLCanvasElement,
      0,
      '#123456',
    );

    expect(output.width).toBe(16);
    expect(output.height).toBe(16);
    expect(operations.filter(({ op }) => op === 'drawImage')).toHaveLength(1);
    expect(operations.filter(({ op }) => op === 'clearRect').map(({ args }) => args)).toEqual([
      [0, 0, 2, 2],
      [14, 0, 2, 2],
      [14, 14, 2, 2],
      [0, 14, 2, 2],
    ]);
    expect(
      operations
        .filter(({ op, args }) => op === 'fillRect' && args[2] === 1 && args[3] === 1)
        .map(({ args, color }) => ({ args, color })),
    ).toEqual([
      { args: [1, 1, 1, 1], color: '#123456' },
      { args: [14, 1, 1, 1], color: '#123456' },
      { args: [14, 14, 1, 1], color: '#123456' },
      { args: [1, 14, 1, 1], color: '#123456' },
    ]);
  });
});
