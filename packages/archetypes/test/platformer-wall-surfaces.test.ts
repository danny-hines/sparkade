import { describe, expect, it } from 'vitest';
import { stepTowerMotion, type TowerMotion } from '../src/platformer/tower-motion';
import type { TileGrid } from '@sparkade/engine';

const state: TowerMotion = {
  x: 83.999,
  y: 84,
  w: 12,
  h: 28,
  vx: 0,
  vy: 20,
  grounded: false,
  wall: 0,
  lock: 0,
  coyote: 0,
  buffer: 0,
};
const input = { direction: 1, run: true, jump: false, release: false, drop: false };
function grid(kind: 'solid' | 'platform'): TileGrid {
  return {
    cols: 16,
    rows: 16,
    tileSize: 16,
    solidityAt: (x, y) => (x === 6 && y === 6 ? kind : 'empty'),
  };
}

describe('wall jumps from ledge sides', () => {
  it.each(['solid', 'platform'] as const)(
    'uses a short %s ledge and clears contact on takeoff',
    (kind) => {
      const contact = stepTowerMotion(grid(kind), state, input, 1 / 60);
      expect(contact.wall).toBe(1);
      expect(contact.x + contact.w).toBeLessThanOrEqual(96);
      const jump = stepTowerMotion(grid(kind), contact, { ...input, jump: true }, 1 / 60);
      expect(jump.vx).toBe(-90);
      expect(jump.vy).toBeLessThan(-200);
      expect(jump.wall).toBe(0);
    },
  );
  it('uses the physical side of a moving platform without treating its transparent padding as solid', () => {
    const empty = { ...grid('platform'), solidityAt: () => 'empty' as const };
    const platforms = [{ x: 96, y: 96, w: 24, h: 8 }];
    const contact = stepTowerMotion(empty, state, input, 1 / 60, platforms);
    expect(contact.wall).toBe(1);
    const jump = stepTowerMotion(empty, contact, { ...input, jump: true }, 1 / 60, platforms);
    expect(jump.vx).toBe(-90);
    expect(jump.vy).toBeLessThan(-200);
  });
  it('leaves the transparent space below a one-way slab open', () => {
    const moved = stepTowerMotion(grid('platform'), { ...state, y: 106 }, input, 1 / 60);
    expect(moved.wall).toBe(0);
    expect(moved.x).toBeGreaterThan(state.x);
  });
  it('preserves upward passage through the underside and explicit drop-through', () => {
    const below = { ...state, x: 98, y: 113, vy: -302 };
    const raised = stepTowerMotion(grid('platform'), below, { ...input, direction: 0 }, 1 / 30);
    expect(raised.y).toBeLessThan(113);
    expect(raised.vy).toBeLessThan(0);
    const dropped = stepTowerMotion(grid('platform'), state, { ...input, drop: true }, 1 / 60);
    expect(dropped.wall).toBe(0);
  });
});
