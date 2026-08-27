import { describe, expect, it } from 'vitest';
import { Camera, worldTransform, worldZoomRect } from '../src/renderer';

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
