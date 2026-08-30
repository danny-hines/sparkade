import { describe, expect, it } from 'vitest';
import type { HShooterLevel } from '@sparkade/shared';
import { corridorSurfaceDecorations } from '../src/hshooter/decor';
import {
  HSHOOTER_GENERATED_BACKDROP_DIM_ALPHA,
  HSHOOTER_PROCEDURAL_BACKDROP_ALPHA,
  hshooterBackdropPanDistance,
  horizontalSpriteDimensions,
  usesDetailedHShooterPresentation,
} from '../src/hshooter/game';

function corridorLevel(): HShooterLevel {
  const cols = 100;
  const solid = '#'.repeat(cols);
  const open = `#${'.'.repeat(cols - 2)}#`;
  const hazard = `#${'.'.repeat(38)}^${'.'.repeat(cols - 41)}#`;
  return {
    name: 'Fixture Run',
    musicSong: 'theme',
    scroll: 30,
    durationS: 45,
    tiles: [solid, solid, open, hazard, open, solid, solid],
    legend: { '#': 'solid', '^': 'hazard' },
    waves: [],
    pickups: [],
  };
}

describe('H-scroll presentation helpers', () => {
  it('keeps published specs on legacy presentation until they explicitly opt in', () => {
    expect(usesDetailedHShooterPresentation(undefined)).toBe(false);
    expect(usesDetailedHShooterPresentation('chunky')).toBe(false);
    expect(usesDetailedHShooterPresentation('detailed')).toBe(true);
  });

  it('paces generated panorama travel over the complete authored level duration', () => {
    expect(hshooterBackdropPanDistance({ scroll: 30, durationS: 45 })).toBe(1350);
    expect(hshooterBackdropPanDistance({ scroll: 0, durationS: 0 })).toBe(1);
    expect(HSHOOTER_GENERATED_BACKDROP_DIM_ALPHA).toBeGreaterThan(0);
    expect(HSHOOTER_PROCEDURAL_BACKDROP_ALPHA).toBeGreaterThan(0);
    expect(HSHOOTER_GENERATED_BACKDROP_DIM_ALPHA + HSHOOTER_PROCEDURAL_BACKDROP_ALPHA).toBeLessThan(
      0.75,
    );
  });

  it('swaps top-down sprite dimensions into the horizontal flight plane', () => {
    expect(horizontalSpriteDimensions({ w: 48, h: 32 })).toEqual({ w: 32, h: 48 });
    expect(horizontalSpriteDimensions({ w: 16, h: 12 }, 4)).toEqual({ w: 8, h: 12 });
  });

  it('places deterministic decoration only on exposed solid cells', () => {
    const level = corridorLevel();
    const first = corridorSurfaceDecorations(level, 1234);
    const again = corridorSurfaceDecorations(level, 1234);
    expect(first).toEqual(again);
    expect(first.length).toBeGreaterThan(1);

    const kindAt = (x: number, y: number) => {
      const ch = level.tiles[y]?.[x] ?? '.';
      return ch === '.' ? 'empty' : level.legend[ch];
    };
    for (const cell of first) {
      expect(kindAt(cell.x, cell.y)).toBe('solid');
      expect([
        kindAt(cell.x, cell.y - 1),
        kindAt(cell.x + 1, cell.y),
        kindAt(cell.x, cell.y + 1),
        kindAt(cell.x - 1, cell.y),
      ]).toContain('empty');
    }
    expect(first.every((cell, index) => index === 0 || cell.x - first[index - 1]!.x >= 9)).toBe(
      true,
    );
  });

  it('does not spend gameplay RNG state or place fixtures in a sealed solid grid', () => {
    const level = corridorLevel();
    level.tiles = Array.from({ length: 7 }, () => '#'.repeat(100));
    expect(corridorSurfaceDecorations(level, 99)).toEqual([]);
  });
});
