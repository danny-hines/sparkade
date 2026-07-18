import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GameSpec } from '@sparkade/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyzeRepairData, formatRepairAnalysis } from '../src/pipeline/repair-analysis';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';

let dir: string;
let db: Db;
let files: GameFiles;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sparkade-repair-analysis-'));
  db = new Db(dir);
  files = new GameFiles(dir);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const SPEC = {
  specVersion: 1,
  archetype: 'platformer',
  seed: 7,
  meta: { title: 'Ice Test', tagline: 'Careful footing' },
  palette: new Array(16).fill('#123456'),
  story: { intro: [], levelIntros: [], bossIntro: '', victory: [], defeat: [] },
  sprites: { custom: {}, assign: { hero: 'lib:hero_squire', boss: 'lib:boss_titan' } },
  levels: [],
  boss: {},
  music: {},
  scoring: {
    events: { enemyKill: 1, pickup: 1, bossHit: 1, levelClear: 1 },
    timeBonusPerSecond: 1,
  },
} as unknown as GameSpec;

describe('repair analysis', () => {
  it('aggregates durable events and compares published/checkpoint specs read-only', () => {
    db.insertJob(
      {
        id: 'job-a',
        gameId: 'game-a',
        status: 'done',
        stage: 'done',
        detail: 'done',
        promptText: 'ice game',
        sourceKind: 'voice',
        seed: 7,
        idempotencyKey: 'analysis-a',
        hasPhoto: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        costSoFarUsd: 0,
        attempt: 1,
      },
      {},
    );
    db.upsertGame({
      id: 'game-a',
      title: 'Ice Test',
      tagline: 'Careful footing',
      archetype: 'platformer',
      status: 'ready',
      createdAt: '2026-01-01T00:00:00.000Z',
      golden: false,
      jobId: 'job-a',
      costUsd: 0,
      cover: null,
      failure: null,
      engineVersion: '1.0.0',
      archetypeVersion: '1.0.0',
    });
    files.writeSpec('game-a', SPEC);
    db.insertRepairEvent({
      jobId: 'job-a',
      gameId: 'game-a',
      attempt: 1,
      pass: 1,
      owner: 'levels',
      action: 'normalize',
      diagnosticsBefore: [
        { code: 'ROW_WIDTH', path: '/levels/0/rows/1', message: 'too long' },
        { code: 'ROW_WIDTH', path: '/levels/0/rows/2', message: 'too short' },
      ],
      diagnosticsAfter: [
        { code: 'BLOCKED_PICKUP', path: '/levels/0/pickups/0', message: 'blocked' },
      ],
      patch: { fixes: 2 },
      elapsedMs: 5,
      outcome: 'improved',
    });
    db.insertRepairEvent({
      jobId: 'job-a',
      gameId: 'game-a',
      attempt: 1,
      pass: 2,
      owner: 'levels',
      action: 'model-repair',
      diagnosticsBefore: [
        { code: 'BLOCKED_PICKUP', path: '/levels/0/pickups/0', message: 'blocked' },
      ],
      diagnosticsAfter: [],
      elapsedMs: 20,
      outcome: 'fixed',
    });

    files.writeRawStageCheckpoint('job-a', 1, 'design', {
      archetype: 'platformer',
      title: SPEC.meta.title,
      tagline: SPEC.meta.tagline,
      palette: SPEC.palette,
      story: SPEC.story,
      scoring: SPEC.scoring,
    });
    files.writeRawStageCheckpoint('job-a', 1, 'levels', { levels: [] });
    files.writeRawStageCheckpoint('job-a', 1, 'entities', {
      sprites: SPEC.sprites,
      boss: SPEC.boss,
    });
    files.writeRawStageCheckpoint('job-a', 1, 'music', { music: SPEC.music });

    const gameBefore = readFileSync(join(dir, 'games', 'game-a', 'game.json'), 'utf8');
    const report = analyzeRepairData(dir, {
      now: () => '2026-07-17T00:00:00.000Z',
      normalizer: (spec) => ({
        spec: { ...spec, seed: spec.seed + 1 },
        fixes: [{ code: 'TEST_FIX', path: '/seed', message: 'test-only normalization' }],
      }),
    });

    expect(report.sources).toEqual({
      publishedGames: 1,
      checkpointSnapshots: 1,
      repairEvents: 2,
    });
    expect(report.repairs).toMatchObject({
      jobs: 1,
      games: 1,
      events: 2,
      diagnosticsBefore: 3,
      diagnosticsAfter: 1,
      byArchetype: [{ key: 'platformer', count: 2 }],
      byOwner: [{ key: 'levels', count: 2 }],
      byCode: [
        { key: 'ROW_WIDTH', count: 2 },
        { key: 'BLOCKED_PICKUP', count: 1 },
      ],
      unresolvedByCode: [],
      byAction: [
        { key: 'model-repair', count: 1 },
        { key: 'normalize', count: 1 },
      ],
      byOutcome: [
        { key: 'fixed', count: 1 },
        { key: 'improved', count: 1 },
      ],
    });
    expect(report.normalization).toMatchObject({
      enabled: true,
      evaluatedSpecs: 2,
      changedSpecs: 2,
      erroredSpecs: 0,
      totalFixes: 2,
      byFixCode: [{ key: 'TEST_FIX', count: 2 }],
    });
    expect(report.normalization.comparisons.map((item) => item.source)).toEqual([
      'published',
      'checkpoint',
    ]);
    expect(readFileSync(join(dir, 'games', 'game-a', 'game.json'), 'utf8')).toBe(gameBefore);
    expect(formatRepairAnalysis(report)).toContain('2 events across 1 jobs / 1 games');
  });

  it('can report a legacy or telemetry-free dataset with normalization disabled', () => {
    const report = analyzeRepairData(dir, {
      normalizer: null,
      includePublished: false,
      includeCheckpoints: false,
      now: () => '2026-07-17T00:00:00.000Z',
    });
    expect(report.sources).toEqual({
      publishedGames: 0,
      checkpointSnapshots: 0,
      repairEvents: 0,
    });
    expect(report.normalization.enabled).toBe(false);
    expect(formatRepairAnalysis(report)).toContain('no normalizer supplied');
  });
});
