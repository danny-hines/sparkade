import { describe, expect, it } from 'vitest';
import type { GenerationFeedEvent } from '@sparkade/shared';
import { elapsedTime, progressTiming, projectGenerationEvents } from '../lib/generation-progress';

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 16, 12, 0, seconds)).toISOString();
const event = (
  id: number,
  message: string,
  extra: Partial<GenerationFeedEvent> = {},
): GenerationFeedEvent => ({
  id,
  jobId: 'private-job',
  gameId: 'private-game',
  attempt: 1,
  kind: 'progress',
  stage: 'building-assets',
  at: at(id),
  message,
  ...extra,
});
const timingInput = {
  attempt: 1,
  createdAt: at(0),
  updatedAt: at(160),
  startedAt: at(2),
  status: 'running',
  stage: 'building-assets',
  inputApproved: true,
  rejected: false,
  events: [event(10, 'Designing', { stage: 'designing' }), event(30, 'Painting a world')],
  reviews: [{ phase: 'input', decision: 'allow', createdAt: at(1), completedAt: at(5) }],
};

describe('generation activity presentation', () => {
  it('coalesces repeated fallbacks and candidates, preserving distinct art and decisions', () => {
    const events = [
      event(1, 'unrecognized internal detail'),
      event(2, 'another internal detail'),
      event(3, 'Player run Phase A candidate 1'),
      event(4, 'Player run Phase B candidate 1'),
      event(5, 'Player run Phase A candidate 2'),
      event(6, 'Player jump candidate 1'),
      event(7, 'Restored the selected platformer boss'),
      event(8, 'Player jump candidate 2'),
      event(9, 'more internal detail'),
      event(10, '', { kind: 'asset', payload: { filename: 'hero.png', role: 'playerSprite' } }),
      event(11, '', { kind: 'asset', payload: { filename: 'boss.png', role: 'bossSprite' } }),
      event(12, '', { kind: 'decision', payload: { title: 'Moon Run', tagline: 'A lunar chase' } }),
    ];
    const items = projectGenerationEvents(events, 'game', 1);
    expect(items.map((item) => item.message)).toEqual([
      'Creating the art and music',
      'Animating your hero’s run',
      'Animating your hero’s jump',
      'Player sprite is ready',
      'Boss sprite is ready',
      'Game concept: Moon Run',
    ]);
    expect(items[1]).toMatchObject({ id: 'build:1:3', at: at(3) });
    expect(items.filter((item) => item.image)).toHaveLength(2);
    expect(
      projectGenerationEvents([...events, event(13, 'Player jump candidate 3')], 'game', 1)[1],
    ).toEqual(items[1]);
  });

  it('turns actual fighter pipeline events into useful, bounded milestones', () => {
    const items = projectGenerationEvents(
      [
        event(1, 'MARK identity 1'),
        event(2, 'MARK identity 2'),
        event(3, 'MARK ground and aerial attacks sheet'),
        event(4, "MARK's attacks sheet yielded 5/6 poses (300 bleed pixels reclaimed)"),
        event(5, 'Repainting 1 weak MARK poses with Spark guidance…'),
        event(6, "Spark reviewed MARK's complete pose set"),
        event(7, 'Levels done (1/3)', { stage: 'writing-spec' }),
      ],
      'game',
      1,
    );
    expect(items.map((item) => item.message)).toEqual([
      'Exploring fighter designs for MARK',
      'Animating MARK’s attacks',
      'Prepared 5 of 6 attack poses for MARK',
      'Refining MARK’s animation',
      "Spark reviewed MARK's complete pose set",
      'Levels drafted · 1 of 3 game design parts ready',
    ]);
    expect(JSON.stringify(items)).not.toContain('bleed pixels');
  });

  it('continues hiding provider details, source photos and premature outcomes', () => {
    const items = projectGenerationEvents(
      [
        event(1, 'Painting with provider key secret'),
        event(2, 'Painting https://private.example/photo.jpg'),
        event(3, 'Generated an asset for $0.04'),
        event(4, 'source', { kind: 'asset', payload: { filename: '../photo.jpg' } }),
        event(5, 'complete', { kind: 'complete', stage: 'done' }),
        event(6, 'old attempt', { attempt: 2 }),
      ],
      'game',
      1,
    );
    expect(JSON.stringify(items)).not.toMatch(
      /private\.example|photo\.jpg|\$|secret|complete|old attempt/,
    );
  });
});

describe('persisted progress timing', () => {
  it('keeps stage age and last activity stable across polls and replayed earlier stages', () => {
    const input = {
      ...timingInput,
      events: [...timingInput.events, event(90, 'Resuming design', { stage: 'designing' })],
    };
    const first = progressTiming(input, at(160));
    const later = progressTiming({ ...input, updatedAt: at(180) }, at(190));
    expect(first).toMatchObject({
      phase: 'assets',
      startedAt: at(0),
      phaseStartedAt: at(30),
      lastActivityAt: at(90),
      finishedAt: null,
    });
    expect({ ...later, asOf: first.asOf }).toEqual(first);
  });

  it('includes final review in elapsed time and freezes only at the canonical outcome', () => {
    const input = {
      ...timingInput,
      events: [...timingInput.events, event(100, 'Finished', { kind: 'complete', stage: 'done' })],
      reviews: [
        ...timingInput.reviews,
        { phase: 'output', decision: 'allow', createdAt: at(110), completedAt: at(150) },
      ],
    };
    expect(progressTiming({ ...input, status: 'publishing' }, at(155))).toMatchObject({
      phase: 'checks',
      finishedAt: null,
    });
    const finished = progressTiming({ ...input, status: 'done' }, at(200));
    expect(finished).toMatchObject({
      phase: 'ready',
      finishedAt: at(160),
      lastActivityAt: at(160),
    });
    expect(elapsedTime(finished.startedAt, finished.finishedAt!)).toBe('2:40');
    expect(progressTiming({ ...input, status: 'failed', rejected: true }, at(200))).toMatchObject({
      phase: 'checks',
      finishedAt: at(160),
    });
  });

  it('resets elapsed time for a retry and handles a retry still waiting to start', () => {
    const input = {
      ...timingInput,
      attempt: 2,
      startedAt: at(120),
      reviews: [],
      events: [...timingInput.events, event(121, 'Designing', { attempt: 2, stage: 'designing' })],
      stage: 'designing',
    };
    expect(progressTiming(input, at(160))).toMatchObject({
      startedAt: at(120),
      phase: 'design',
      phaseStartedAt: at(121),
    });
    expect(
      progressTiming(
        { ...input, status: 'queued', stage: 'queued', events: [], startedAt: undefined },
        at(170),
      ).startedAt,
    ).toBe(at(160));
  });

  it('formats long durations and clamps clock skew without negative or invalid times', () => {
    expect(elapsedTime(at(0), at(9))).toBe('0:09');
    expect(elapsedTime(at(0), at(3661))).toBe('1:01:01');
    expect(elapsedTime(at(5), at(1))).toBe('0:00');
    expect(elapsedTime('unknown', at(0))).toBe('0:00');
  });
});
