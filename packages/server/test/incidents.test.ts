import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JobRecord } from '@sparkade/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RepairEvent } from '../src/storage/db';
import {
  hasSubstantiveRepair,
  IncidentStore,
  type IncidentRuntime,
} from '../src/storage/incidents';

let dir: string;
let incidents: IncidentStore;

const JOB: JobRecord = {
  id: 'j-test',
  gameId: 'g-test',
  status: 'failed',
  stage: 'failed',
  detail: 'failed',
  promptText: 'private prompt that must not be copied',
  sourceKind: 'voice',
  seed: 7,
  idempotencyKey: 'private-idempotency-key',
  hasPhoto: true,
  createdAt: '2026-08-27T04:52:28.000Z',
  costSoFarUsd: 0.02,
  attempt: 1,
};

const RUNTIME: IncidentRuntime = {
  engineVersion: '1.0.0',
  archetypeVersion: '1.0.0',
  provider: 'meta',
  textModel: 'muse-spark-1.2-contributor',
  imageModel: 'muse-image-1.0',
  git: { commit: 'abc123', dirty: true },
};

const REPAIRS: RepairEvent[] = [
  {
    id: 1,
    jobId: JOB.id,
    gameId: JOB.gameId,
    attempt: 1,
    pass: 1,
    owner: 'levels',
    action: 'model-repair',
    diagnosticsBefore: [
      { code: 'PLAT_EXIT_UNREACHABLE', path: '/levels/1/exit', message: 'too far' },
    ],
    diagnosticsAfter: [
      { code: 'PLAT_EXIT_UNREACHABLE', path: '/levels/1/exit', message: 'still too far' },
    ],
    patch: [{ op: 'replace', path: '/levels/1/tiles/10', value: '...' }],
    elapsedMs: 1200,
    outcome: 'unchanged',
    at: '2026-08-27T04:54:14.000Z',
  },
  {
    id: 2,
    jobId: JOB.id,
    gameId: JOB.gameId,
    attempt: 1,
    pass: 2,
    owner: 'levels',
    action: 'terminal',
    diagnosticsBefore: [
      { code: 'PLAT_EXIT_UNREACHABLE', path: '/levels/1/exit', message: 'still too far' },
    ],
    diagnosticsAfter: [
      { code: 'PLAT_EXIT_UNREACHABLE', path: '/levels/1/exit', message: 'still too far' },
    ],
    patch: null,
    elapsedMs: 0,
    outcome: 'failed',
    at: '2026-08-27T04:54:43.000Z',
  },
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sparkade-incidents-'));
  incidents = new IncidentStore(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('generation incidents', () => {
  it('captures a human-reviewable failure without copying prompts or photos', () => {
    const incident = incidents.capture({
      outcome: 'failed',
      job: JOB,
      game: { title: 'Debug Dive', archetype: 'platformer' },
      trigger: {
        code: 'validation-failed',
        message: 'exit remained unreachable',
        stage: 'validating',
      },
      repairs: REPAIRS,
      checkpoints: [
        {
          jobId: JOB.id,
          attempt: 1,
          stage: 'levels',
          revision: 2,
          at: '2026-08-27T04:54:21.000Z',
          document: { levels: [] },
        },
      ],
      runtime: RUNTIME,
      cumulativeCostUsd: 0.02,
      at: '2026-08-27T04:54:43.000Z',
    });

    expect(incident.fingerprint).toBe('platformer:validating:PLAT_EXIT_UNREACHABLE');
    expect(incident.diagnosticCodes).toEqual(['PLAT_EXIT_UNREACHABLE']);
    expect(incident.repairs[0]).toMatchObject({
      action: 'model-repair',
      diagnosticsBefore: ['PLAT_EXIT_UNREACHABLE'],
    });
    const record = incidents.list()[0]!;
    expect(record.lifecycle.status).toBe('open');
    const json = readFileSync(join(record.directory, 'incident.json'), 'utf8');
    expect(json).not.toContain(JOB.promptText);
    expect(json).not.toContain(JOB.idempotencyKey);
    expect(json).not.toContain('photo.jpg');
    expect(json).toContain('checkpoints/j-test/attempt-1/levels-002.json');
  });

  it('preserves notes while retry and lifecycle state evolve', () => {
    const incident = incidents.capture({
      outcome: 'failed',
      job: JOB,
      game: { title: 'Debug Dive', archetype: 'platformer' },
      trigger: {
        code: 'validation-failed',
        message: 'exit remained unreachable',
        stage: 'validating',
      },
      repairs: REPAIRS,
      checkpoints: [],
      runtime: RUNTIME,
      cumulativeCostUsd: 0.02,
    });
    incidents.updateLifecycle(
      incident.id,
      { status: 'candidate-fixed', fixedBy: 'commit-123' },
      'Added an exact reachability frontier to the diagnostic.',
    );
    incidents.markRetry(JOB.id, 1, 2, 'succeeded');

    // Refreshing structured evidence must not erase human triage notes.
    incidents.capture({
      outcome: 'failed',
      job: JOB,
      game: { title: 'Debug Dive', archetype: 'platformer' },
      trigger: {
        code: 'validation-failed',
        message: 'exit remained unreachable',
        stage: 'validating',
      },
      repairs: REPAIRS,
      checkpoints: [],
      runtime: RUNTIME,
      cumulativeCostUsd: 0.02,
    });

    const record = incidents.list()[0]!;
    expect(record.lifecycle).toMatchObject({ status: 'candidate-fixed', fixedBy: 'commit-123' });
    expect(record.incident.retry).toMatchObject({ attempt: 2, outcome: 'succeeded' });
    expect(readFileSync(join(record.directory, 'notes.md'), 'utf8')).toContain(
      'Added an exact reachability frontier',
    );
  });

  it('classifies only substantive recovery actions as incidents', () => {
    expect(hasSubstantiveRepair(REPAIRS)).toBe(true);
    expect(hasSubstantiveRepair([{ ...REPAIRS[0]!, action: 'normalize' }])).toBe(false);
    expect(hasSubstantiveRepair([{ ...REPAIRS[0]!, action: 'fighter-art-fallback' }])).toBe(true);
    expect(
      hasSubstantiveRepair([{ ...REPAIRS[0]!, action: 'platformer-player-art-fallback' }]),
    ).toBe(true);
  });
});
