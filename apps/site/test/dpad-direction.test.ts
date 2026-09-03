import { describe, expect, it } from 'vitest';
import { dpadKeysAtPoint } from '../app/p/[id]/dpad-direction';

const bounds = { left: 100, top: 200, width: 120, height: 120 };

describe('dpadKeysAtPoint', () => {
  it.each([
    [160, 205, ['ArrowUp']],
    [215, 260, ['ArrowRight']],
    [160, 315, ['ArrowDown']],
    [105, 260, ['ArrowLeft']],
  ])('maps cardinal point (%i, %i)', (x, y, expected) => {
    expect(dpadKeysAtPoint(x, y, bounds)).toEqual(expected);
  });

  it.each([
    [205, 215, ['ArrowRight', 'ArrowUp']],
    [205, 305, ['ArrowRight', 'ArrowDown']],
    [115, 305, ['ArrowLeft', 'ArrowDown']],
    [115, 215, ['ArrowLeft', 'ArrowUp']],
  ])('maps diagonal point (%i, %i)', (x, y, expected) => {
    expect(dpadKeysAtPoint(x, y, bounds)).toEqual(expected);
  });

  it('has a small center dead zone', () => {
    expect(dpadKeysAtPoint(160, 260, bounds)).toEqual([]);
    expect(dpadKeysAtPoint(165, 255, bounds)).toEqual([]);
  });

  it('handles an element with no rendered size', () => {
    expect(dpadKeysAtPoint(0, 0, { ...bounds, width: 0 })).toEqual([]);
  });
});
