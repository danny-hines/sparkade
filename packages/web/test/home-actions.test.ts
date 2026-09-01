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
    expect(actionsFor(game({ golden: true })).map((action) => action.key)).toEqual(['play']);
  });

  it('keeps deletion available for a player-created game', () => {
    expect(actionsFor(game()).map((action) => action.key)).toEqual(['play', 'delete']);
  });
});
