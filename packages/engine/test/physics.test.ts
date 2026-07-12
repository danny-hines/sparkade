import { describe, expect, it } from 'vitest';
import { aabbOverlap, moveAABB, type TileGrid } from '@sparkade/engine';

function grid(rows: string[]): TileGrid {
  return {
    cols: rows[0]!.length,
    rows: rows.length,
    tileSize: 16,
    solidityAt: (x, y) => {
      const ch = rows[y]?.[x];
      return ch === '#' ? 'solid' : ch === '=' ? 'platform' : 'empty';
    },
  };
}

describe('swept tile collision', () => {
  const g = grid([
    '........',
    '........',
    '...##...',
    '========',
    '########',
  ]);

  it('lands on solid ground and reports onGround', () => {
    const r = moveAABB(g, { x: 8, y: 30, w: 10, h: 14 }, 0, 40);
    expect(r.hitY).toBe(true);
    expect(r.onGround).toBe(true);
    expect(r.y + 14).toBeLessThanOrEqual(3 * 16 + 0.01);
  });

  it('stops at walls horizontally', () => {
    const r = moveAABB(g, { x: 20, y: 34, w: 10, h: 12 }, 40, 0);
    expect(r.hitX).toBe(true);
    expect(r.x + 10).toBeLessThanOrEqual(3 * 16 + 0.01);
  });

  it('one-way platforms: land from above, pass from below, drop through', () => {
    // falling onto the platform row (y=3) from above
    const land = moveAABB(g, { x: 8, y: 28, w: 10, h: 14 }, 0, 30);
    expect(land.onGround).toBe(true);
    // jumping up through it from below
    const rise = moveAABB(g, { x: 8, y: 66, w: 10, h: 14 }, 0, -40);
    expect(rise.hitY).toBe(false);
    // drop-through requested
    const drop = moveAABB(g, { x: 8, y: 33.9, w: 10, h: 14 }, 0, 4, { dropThrough: true });
    expect(drop.onGround).toBe(false);
  });

  it('aabb overlap is exclusive at edges', () => {
    expect(aabbOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
    expect(aabbOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
  });
});
