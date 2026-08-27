import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationRunner } from '../src/pipeline/runner';
import { SseHub } from '../src/pipeline/sse';
import { ConfigStore } from '../src/storage/config';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';

const originalProvider = process.env.SPARKADE_PROVIDER;
const originalMetaKey = process.env.META_API_KEY;
const roots: string[] = [];
const databases: Db[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  restoreEnv('SPARKADE_PROVIDER', originalProvider);
  restoreEnv('META_API_KEY', originalMetaKey);
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('mandatory Muse Image preflight', () => {
  it('fails before any billable text call when the Meta image key is missing', async () => {
    process.env.SPARKADE_PROVIDER = 'meta';
    delete process.env.META_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const root = mkdtempSync(join(tmpdir(), 'sparkade-image-preflight-'));
    roots.push(root);
    const db = new Db(root);
    databases.push(db);
    const runner = new GenerationRunner(
      db,
      new GameFiles(root),
      new ConfigStore(root),
      new SseHub(),
    );
    const { jobId, gameId } = runner.createJob({
      promptText: 'A tiny lighthouse adventure',
      sourceKind: 'voice',
      idempotencyKey: 'missing-image-key',
    });

    const deadline = Date.now() + 2_000;
    while (db.getJob(jobId)?.status !== 'failed' && Date.now() < deadline) await delay(10);

    expect(db.getJob(jobId)).toMatchObject({
      status: 'failed',
      error: {
        code: 'auth',
        stage: 'building-assets',
      },
    });
    expect(db.usageForGame(gameId)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
