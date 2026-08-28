import { describe, expect, it } from 'vitest';
import {
  platformerPosePreviewFrameDuration,
  platformerPosePreviewSequence,
} from '../src/screens/platformer-poses-lab';

describe('platformer pose lab animation preview', () => {
  it('inserts the neutral side idle between both running contacts', () => {
    expect(platformerPosePreviewSequence('A2', 'B3', true)).toEqual([
      'A2',
      'side-anchor',
      'B3',
      'side-anchor',
    ]);
  });

  it('falls back to the direct pair when an older run has no side anchor', () => {
    expect(platformerPosePreviewSequence('A1', 'B1', false)).toEqual(['A1', 'B1']);
    expect(platformerPosePreviewSequence('', 'B1', true)).toEqual([]);
  });

  it('lets every beat use an independent hold duration', () => {
    const durations: [number, number, number, number] = [150, 40, 130, 80];
    expect(
      [0, 1, 2, 3].map((frame) => platformerPosePreviewFrameDuration(frame, 4, durations)),
    ).toEqual(durations);
    expect([0, 1].map((frame) => platformerPosePreviewFrameDuration(frame, 2, durations))).toEqual([
      150, 130,
    ]);
  });
});
