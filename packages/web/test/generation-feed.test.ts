import { describe, expect, it } from 'vitest';
import type { GenerationFeedEvent } from '@sparkade/shared';
import {
  isCompactGenerationAssetRole,
  isNearFeedBottom,
  mergeGenerationEvents,
} from '../src/generation-feed';

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

  it('uses a compact preview only for small platformer prop assets', () => {
    expect(isCompactGenerationAssetRole('platformerPropHeroProjectile')).toBe(true);
    expect(isCompactGenerationAssetRole('platformerPropCollectible')).toBe(true);
    expect(isCompactGenerationAssetRole('platformerEnemyWalker')).toBe(false);
    expect(isCompactGenerationAssetRole('platformerBackdropLevel1')).toBe(false);
    expect(isCompactGenerationAssetRole(null)).toBe(false);
  });
});
