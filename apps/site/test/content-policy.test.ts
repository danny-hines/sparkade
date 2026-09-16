import { describe, expect, it } from 'vitest';
import {
  CONTENT_REVIEW_PROMPT,
  parseContentVerdict,
  rejectionMessage,
} from '../lib/content-policy';
import { projectGenerationEvents } from '../lib/generation-progress';
import type { GenerationFeedEvent } from '@sparkade/shared';
describe('content verdict validation', () => {
  it('accepts only an explicit, internally consistent verdict', () => {
    expect(parseContentVerdict('{"decision":"allow","category":"none"}')).toEqual({
      decision: 'allow',
      category: 'none',
    });
    expect(parseContentVerdict('{"decision":"reject","category":"hate"}').decision).toBe('reject');
    for (const text of [
      '{}',
      'null',
      '[]',
      '{"decision":"allow","category":"hate"}',
      '{"decision":"reject","category":"none"}',
      '{"decision":"allow","category":"none","reason":"private thinking"}',
      '```json\n{"decision":"allow","category":"none"}\n```',
    ])
      expect(() => parseContentVerdict(text)).toThrow();
  });
  it('provides explicit policy allowances, exclusions and injection boundaries', () => {
    for (const phrase of [
      'PG-13',
      'Ordinary profanity',
      'MMA',
      'homophobic',
      'sexual',
      'untrusted',
      'identity alone',
      'empty plot',
    ])
      expect(CONTENT_REVIEW_PROMPT).toContain(phrase);
    expect(rejectionMessage('untrusted model prose')).toBe(
      'This game did not pass our PG-13 content check.',
    );
  });
});
describe('owner feed projection', () => {
  it('never exposes raw messages, costs, thought payloads, old attempts or premature completion', () => {
    const events = [
      { id: 1, attempt: 1, kind: 'progress', stage: 'queued', message: 'Creation brief approved' },
      {
        id: 2,
        attempt: 1,
        kind: 'decision',
        message: 'hidden reasoning',
        payload: { title: 'Moon Cup', tagline: 'Race stars', costUsd: 99, reasoning: 'private' },
      },
      { id: 3, attempt: 1, kind: 'asset', payload: { filename: '../photo.jpg', role: 'source' } },
      { id: 4, attempt: 1, kind: 'asset', payload: { filename: 'hero.png', role: 'playerSprite' } },
      { id: 5, attempt: 1, kind: 'failure', message: 'provider key' },
      { id: 6, attempt: 1, kind: 'complete' },
      { id: 7, attempt: 2, kind: 'progress' },
    ].map((e) => ({
      at: '2026-09-16T00:00:00Z',
      jobId: 'private-job',
      gameId: 'private-game',
      message: '',
      ...e,
    })) as GenerationFeedEvent[];
    const feed = projectGenerationEvents(events, 'public-id', 1);
    expect(feed).toHaveLength(4);
    expect(feed[0].message).toBe('Your creation request is saved');
    expect(feed[1].message).toBe('Game concept: Moon Cup');
    expect(feed[2].image).toBeUndefined();
    expect(feed[3].image).toBe('/api/me/games/public-id/preview/hero.png');
    expect(JSON.stringify(feed)).not.toMatch(
      /hidden reasoning|costUsd|provider key|private-job|private-game/,
    );
  });
});
