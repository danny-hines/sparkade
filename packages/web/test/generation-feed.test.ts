import { describe, expect, it } from 'vitest';
import type { GenerationFeedEvent } from '@sparkade/shared';
import { isNearFeedBottom, mergeGenerationEvents } from '../src/generation-feed';

function event(id: number): GenerationFeedEvent {
  return {
    id,
    jobId: 'j-feed',
    gameId: 'g-feed',
    attempt: 1,
    kind: 'progress',
    message: `event ${id}`,
    at: new Date(id * 1000).toISOString(),
  };
}

describe('generation feed merging', () => {
  it('deduplicates an SSE/history race and preserves database order', () => {
    expect(
      mergeGenerationEvents([event(2), event(3)], [event(1), event(3), event(4)]).map((e) => e.id),
    ).toEqual([1, 2, 3, 4]);
  });

  it('only auto-follows while the player remains near the bottom', () => {
    expect(isNearFeedBottom(552, 400, 1000)).toBe(true);
    expect(isNearFeedBottom(300, 400, 1000)).toBe(false);
  });
});
