import { describe, expect, it } from 'vitest';
import { RUN_INBETWEEN_VERSION } from '@sparkade/shared/run-inbetweens';
import { loadRunInbetweens, runInbetweenCacheKey } from '../src/run-inbetweens';

const frame = (value: number) => ({
  data: new Uint8ClampedArray(4 * 4 * 4).fill(value),
  width: 4,
  height: 4,
});

describe('run in-between loading', () => {
  it('keys the device cache by algorithm version and exact pixels', () => {
    const key = runInbetweenCacheKey([frame(1), frame(2), frame(3)]);
    expect(key).toBe(runInbetweenCacheKey([frame(1), frame(2), frame(3)]));
    expect(key.startsWith(`v${RUN_INBETWEEN_VERSION}-`)).toBe(true);
    expect(runInbetweenCacheKey([frame(1), frame(2), frame(4)])).not.toBe(key);
  });

  it('skips in-betweens where workers are unavailable, keeping the original run', () => {
    const image = { width: 112, height: 128 } as unknown as CanvasImageSource;
    expect(typeof Worker).toBe('undefined');
    expect(loadRunInbetweens({ walk1: image, sideIdle: image, walk2: image })).toBeNull();
  });
});
