import { describe, expect, it } from 'vitest';
import {
  generatedBackdropProgressSourceRect,
  generatedBackdropSourceRect,
  generatedVerticalBackdropProgressSourceRect,
} from '../src/backdrops';

describe('generated backdrop framing', () => {
  it('starts from the center of an extra-wide plate and pans without wrapping', () => {
    expect(generatedBackdropSourceRect(1536, 600, 512, 300, 0)).toEqual({
      sx: 256,
      sy: 0,
      sw: 1024,
      sh: 600,
    });
    expect(generatedBackdropSourceRect(1536, 600, 512, 300, 500)).toEqual({
      sx: 356,
      sy: 0,
      sw: 1024,
      sh: 600,
    });
    expect(generatedBackdropSourceRect(1536, 600, 512, 300, 10_000).sx).toBe(512);
  });

  it('uses the same composition aspect at heroic platformer scale', () => {
    expect(generatedBackdropSourceRect(1536, 600, 256, 150, 0)).toEqual({
      sx: 256,
      sy: 0,
      sw: 1024,
      sh: 600,
    });
  });

  it('letterbox-crops a plate that is taller than the viewport aspect', () => {
    expect(generatedBackdropSourceRect(800, 800, 512, 300, 0)).toEqual({
      sx: 0,
      sy: 166,
      sw: 800,
      sh: 469,
    });
  });

  it('maps authored stage progress across the complete plate without wrapping', () => {
    expect(generatedBackdropProgressSourceRect(1536, 600, 480, 270, 0).sx).toBe(0);
    expect(generatedBackdropProgressSourceRect(1536, 600, 480, 270, 0.5).sx).toBe(235);
    expect(generatedBackdropProgressSourceRect(1536, 600, 480, 270, 1).sx).toBe(469);
    expect(generatedBackdropProgressSourceRect(1536, 600, 480, 270, 50).sx).toBe(469);
    expect(generatedBackdropProgressSourceRect(1536, 600, 480, 270, -2).sx).toBe(0);
  });

  it('travels bottom-to-top through portrait flyover art so scenery moves downward', () => {
    expect(generatedVerticalBackdropProgressSourceRect(960, 1536, 512, 300, 0)).toEqual({
      sx: 0,
      sy: 973,
      sw: 960,
      sh: 563,
    });
    expect(generatedVerticalBackdropProgressSourceRect(960, 1536, 512, 300, 0.5).sy).toBe(487);
    expect(generatedVerticalBackdropProgressSourceRect(960, 1536, 512, 300, 1).sy).toBe(0);
  });
});
