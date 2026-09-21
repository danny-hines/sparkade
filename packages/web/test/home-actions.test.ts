import { describe, expect, it } from 'vitest';
import type { GameListItem } from '@sparkade/shared';
import { actionsFor } from '../src/screens/home';

function game(overrides: Partial<GameListItem> = {}): GameListItem {
  return {
    id: 'game-1',
    title: 'Test Game',
    tagline: 'Test tagline',
    archetype: 'platformer',
    status: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    topScore: null,
    costUsd: 0,
    golden: false,
    jobId: null,
    cover: null,
    ...overrides,
  };
}

describe('home game actions', () => {
  it('never offers deletion for a built-in game', () => {
    expect(actionsFor(game({ golden: true })).map((action) => action.key)).toEqual([
      'play',
      'scores',
    ]);
  });

  it('keeps deletion available for a player-created game', () => {
    expect(actionsFor(game()).map((action) => action.key)).toEqual([
      'play',
      'scores',
      'publish',
      'delete',
    ]);
  });

  it('shows publishing and published cloud states without moving the action', () => {
    expect(actionsFor(game(), true).map((action) => action.key)).toEqual([
      'play',
      'scores',
      'publishing',
      'delete',
    ]);
    expect(
      actionsFor(
        game({
          publication: {
            status: 'published',
            link: { id: '7kmp2qx', url: 'https://sparkade.dev/p/7kmp2qx' },
          },
        }),
      ).map((action) => action.key),
    ).toEqual(['play', 'scores', 'share', 'delete']);
  });

  it('returns a failed publish to the retryable outline action', () => {
    expect(
      actionsFor(
        game({
          publication: {
            status: 'failed',
            link: { id: '7kmp2qx', url: 'https://sparkade.dev/p/7kmp2qx' },
          },
        }),
      ).map((action) => action.key),
    ).toEqual(['play', 'scores', 'publish', 'delete']);
  });
});
