import { describe, expect, it } from 'vitest';
import { KEYBOARD_BUTTON_LABELS, type ButtonLabels } from '@sparkade/shared';
import { Camera, drawTileLayer, Renderer, worldTransform, worldZoomRect } from '../src/renderer';

describe('worldZoomRect', () => {
  it('uses the requested integer crop inside the rendered world', () => {
    expect(worldZoomRect({ scale: 2, sourceX: 96, sourceY: 48 }, 512, 300)).toEqual({
      sx: 96,
      sy: 48,
      sw: 256,
      sh: 150,
    });
  });

  it('clamps the crop at every world-canvas edge', () => {
    expect(worldZoomRect({ scale: 2, sourceX: -20, sourceY: -20 }, 512, 300)).toEqual({
      sx: 0,
      sy: 0,
      sw: 256,
      sh: 150,
    });
    expect(worldZoomRect({ scale: 2, sourceX: 500, sourceY: 290 }, 512, 300)).toEqual({
      sx: 256,
      sy: 150,
      sw: 256,
      sh: 150,
    });
  });
});

describe('worldTransform', () => {
  it('maps a logical heroic viewport directly onto the full backing canvas', () => {
    expect(worldTransform({ scale: 2 })).toEqual({
      scale: 2,
      translateX: 0,
      translateY: 0,
    });
    expect(worldTransform({ scale: 2, sourceX: 96, sourceY: 48 })).toEqual({
      scale: 2,
      translateX: -192,
      translateY: -96,
    });
  });
});

describe('Camera viewport', () => {
  it('follows and clamps against a smaller logical viewport', () => {
    const camera = new Camera();
    camera.follow(400, 200, 1, { w: 1000, h: 500 }, 1, {
      w: 256,
      h: 150,
      lookahead: 20,
    });
    expect(camera.x).toBe(292);
    expect(camera.y).toBe(117.5);
  });
});

describe('drawTileLayer', () => {
  it('scales high-density sources into the authored collision cell', () => {
    const calls: unknown[][] = [];
    const source = { naturalWidth: 64, naturalHeight: 64 } as HTMLImageElement;
    const renderer = {
      drawScaled: (...args: unknown[]) => calls.push(args),
    } as unknown as Renderer;

    drawTileLayer(renderer, { x: 0, y: 0 }, 1, 1, 16, () => source);

    expect(calls).toEqual([[source, 0, 0, 16, 16]]);
  });
});

describe('button labels', () => {
  // Skip the constructor (it needs a canvas); these methods only read buttonLabels.
  const labelled = (buttonLabels: ButtonLabels) =>
    Object.assign(Object.create(Renderer.prototype) as Renderer, { buttonLabels });

  it('keeps gamepad names when no labels are set', () => {
    const r = labelled({});
    expect(r.relabel('(A) SELECT  (B) RESUME')).toBe('(A) SELECT  (B) RESUME');
    expect(r.button('START')).toBe('START');
  });

  it('rewrites prompt tokens to keyboard keys without touching other parentheses', () => {
    const r = labelled(KEYBOARD_BUTTON_LABELS);
    expect(r.relabel('(A) Select  (B) Resume')).toBe('(X) Select  (Z) Resume');
    expect(r.relabel('(X) RESET PUZZLE (HALF METER) (START)')).toBe(
      '(A) RESET PUZZLE (HALF METER) (ENTER)',
    );
    expect(r.relabel('(D-PAD) MOVE')).toBe('(ARROWS) MOVE');
    expect(r.button('SELECT')).toBe('SHIFT');
    expect(r.button('UP')).toBe('UP');
  });
});
