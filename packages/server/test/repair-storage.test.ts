import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';

let dir: string;
let db: Db;
let files: GameFiles;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sparkade-repair-storage-'));
  db = new Db(dir);
  files = new GameFiles(dir);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('repair telemetry', () => {
  it('round-trips ordered repair evidence by job and game', () => {
    const before = [
      { code: 'ROW_WIDTH', path: '/levels/0/rows/2', message: 'expected 40, got 41' },
    ];
    const after = [
      { code: 'BLOCKED_PICKUP', path: '/levels/0/pickups/1', message: 'inside terrain' },
    ];
    const patch = [{ op: 'replace', path: '/levels/0/rows/2', value: '....' }];

    db.insertRepairEvent({
      jobId: 'job-a',
      gameId: 'game-a',
      attempt: 2,
      pass: 1,
      owner: 'levels',
      action: 'model-repair',
      diagnosticsBefore: before,
      diagnosticsAfter: after,
      patch,
      elapsedMs: 1234.6,
      outcome: 'improved',
    });
    db.insertRepairEvent({
      jobId: 'job-a',
      gameId: 'game-a',
      attempt: 2,
      pass: 2,
      owner: 'levels',
      action: 'fallback',
      diagnosticsBefore: after,
      diagnosticsAfter: [],
      elapsedMs: -10,
      outcome: 'fixed',
    });
    db.insertRepairEvent({
      jobId: 'job-b',
      gameId: 'game-a',
      attempt: 1,
      pass: 1,
      owner: 'sprites',
      action: 'normalize',
      diagnosticsBefore: [],
      diagnosticsAfter: [],
      elapsedMs: 2,
      outcome: 'unchanged',
    });

    const byJob = db.repairEventsForJob('job-a');
    expect(byJob).toHaveLength(2);
    expect(byJob[0]).toMatchObject({
      jobId: 'job-a',
      gameId: 'game-a',
      attempt: 2,
      pass: 1,
      owner: 'levels',
      action: 'model-repair',
      diagnosticsBefore: before,
      diagnosticsAfter: after,
      patch,
      elapsedMs: 1235,
      outcome: 'improved',
    });
    expect(byJob[0]!.id).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(byJob[0]!.at))).toBe(false);
    expect(byJob[1]).toMatchObject({ pass: 2, patch: null, elapsedMs: 0 });
    expect(db.repairEventsForGame('game-a')).toHaveLength(3);
    expect(db.repairEventsForJob('missing')).toEqual([]);
  });
});

describe('raw stage checkpoints', () => {
  it('keeps every revision and isolates retries without touching preview staging', () => {
    const original = files.writeRawStageCheckpoint('job-a', 1, 'design', { title: 'First' });
    const replacement = files.writeRawStageCheckpoint('job-a', 1, 'design', { title: 'Second' });
    files.writeRawStageCheckpoint('job-a', 1, 'levels', { levels: [{ id: 'one' }] });
    files.writeRawStageCheckpoint('job-a', 2, 'design', { title: 'Retry' });

    expect(original.revision).toBe(0);
    expect(replacement.revision).toBe(1);
    expect(
      files.readRawStageCheckpoint<{ title: string }>('job-a', 1, 'design')?.document.title,
    ).toBe('Second');
    expect(
      files.readRawStageCheckpoint<{ title: string }>('job-a', 1, 'design', 0)?.document.title,
    ).toBe('First');
    expect(files.readRawStageCheckpoint('job-a', 1, 'music')).toBeNull();
    expect(
      files.readRawStageCheckpoint<{ title: string }>('job-a', 2, 'design')?.document.title,
    ).toBe('Retry');
    expect(files.listRawStageCheckpoints('job-a', 1)).toHaveLength(3);

    files.writePartial('job-a', {
      archetype: 'platformer',
      title: 'Preview',
      tagline: 'Only a preview',
      palette: [],
    });
    files.discardStaging('job-a');
    expect(files.readPartial('job-a')).toBeNull();
    expect(files.readRawStageCheckpoint('job-a', 1, 'levels')).not.toBeNull();
  });

  it('rejects path traversal and invalid attempt numbers', () => {
    expect(() => files.writeRawStageCheckpoint('../job', 1, 'design', {})).toThrow(
      'invalid checkpoint job id',
    );
    expect(() => files.writeRawStageCheckpoint('job', 0, 'design', {})).toThrow(
      'checkpoint attempt must be >= 1',
    );
  });
});
