import { describe, expect, it } from 'vitest';
import {
  PLATFORMER_POSE_DISSOLVE_DURATION_MS,
  platformerPosePreviewFrameDuration,
  platformerPosePreviewSequence,
  platformerPosePreviewTimeline,
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

  it('can replace each side-idle boundary with one runtime-length dissolve tick', () => {
    const sequence = platformerPosePreviewSequence('A2', 'B3', true);
    const timeline = platformerPosePreviewTimeline(sequence, [140, 70, 140, 70], true);

    expect(timeline).toHaveLength(8);
    expect(timeline.map(({ id, blendFromId }) => [id, blendFromId])).toEqual([
      ['A2', 'side-anchor'],
      ['A2', undefined],
      ['side-anchor', 'A2'],
      ['side-anchor', undefined],
      ['B3', 'side-anchor'],
      ['B3', undefined],
      ['side-anchor', 'B3'],
      ['side-anchor', undefined],
    ]);
    expect(timeline[0]!.durationMs).toBe(PLATFORMER_POSE_DISSOLVE_DURATION_MS);
    expect(timeline[1]!.durationMs).toBe(140 - PLATFORMER_POSE_DISSOLVE_DURATION_MS);
    expect(timeline.reduce((total, step) => total + step.durationMs, 0)).toBe(420);
  });

  it('can stretch the lab dissolve to three frames without slowing the gait', () => {
    const sequence = platformerPosePreviewSequence('A2', 'B3', true);
    const timeline = platformerPosePreviewTimeline(sequence, [140, 70, 140, 70], true, 3);

    expect(timeline).toHaveLength(8);
    expect(timeline[0]).toEqual({
      id: 'A2',
      blendFromId: 'side-anchor',
      durationMs: PLATFORMER_POSE_DISSOLVE_DURATION_MS * 3,
    });
    expect(timeline[1]!.durationMs).toBe(90);
    expect(timeline.reduce((total, step) => total + step.durationMs, 0)).toBe(420);
  });

  it('does not emit a zero-length hold when a dissolve fills the destination beat', () => {
    const timeline = platformerPosePreviewTimeline(
      ['A2', 'side-anchor', 'B3', 'side-anchor'],
      [110, 50, 110, 50],
      true,
      3,
    );

    expect(timeline).toHaveLength(6);
    expect(timeline.every((step) => step.durationMs > 0)).toBe(true);
    expect(timeline.reduce((total, step) => total + step.durationMs, 0)).toBe(320);
  });

  it('keeps the original timeline when dissolves are off or no side anchor exists', () => {
    expect(platformerPosePreviewTimeline(['A1', 'B1'], [140, 70, 140, 70], true)).toEqual([
      { id: 'A1', durationMs: 140 },
      { id: 'B1', durationMs: 140 },
    ]);
    expect(
      platformerPosePreviewTimeline(
        ['A1', 'side-anchor', 'B1', 'side-anchor'],
        [140, 70, 140, 70],
        false,
      ),
    ).toHaveLength(4);
  });
});
