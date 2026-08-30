import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Db } from '../src/storage/db';

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

describe('durable generation feed', () => {
  it('persists ordered milestone payloads across database reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sparkade-generation-feed-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

    const db = new Db(dir);
    const first = db.appendGenerationEvent({
      jobId: 'j-feed',
      gameId: 'g-feed',
      attempt: 1,
      kind: 'decision',
      stage: 'designing',
      message: 'Spark chose Moon Garden',
      payload: { title: 'Moon Garden', palette: ['#000000', '#ffffff'] },
    });
    const second = db.appendGenerationEvent({
      jobId: 'j-feed',
      gameId: 'g-feed',
      attempt: 1,
      kind: 'asset',
      stage: 'building-assets',
      message: 'Finished key art',
      payload: { filename: 'key-art.png', width: 480, height: 270 },
    });
    db.close();

    const reopened = new Db(dir);
    cleanup.push(() => reopened.close());
    const events = reopened.generationEventsForJob('j-feed');
    expect(events.map((event) => event.id)).toEqual([first.id, second.id]);
    expect(events[0]).toMatchObject({
      kind: 'decision',
      stage: 'designing',
      payload: { title: 'Moon Garden' },
    });
    expect(events[1]).toMatchObject({
      kind: 'asset',
      payload: { filename: 'key-art.png', width: 480, height: 270 },
    });
  });
});
