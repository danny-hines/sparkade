import { describe, expect, it } from 'vitest';
import { containedCoverRect, coveringSourceRect } from '../src/cover-layout';

describe('cover layout', () => {
  it('keeps an entire 16:9 cover visible inside the wide detail banner', () => {
    expect(containedCoverRect(480, 270, 960, 360)).toEqual({
      x: 160,
      y: 0,
      width: 640,
      height: 360,
    });
  });

  it('center-crops only the dimmed background layer', () => {
    expect(coveringSourceRect(480, 270, 960, 360)).toEqual({
      x: 0,
      y: 45,
      width: 480,
      height: 180,
    });
  });
});
