import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import type { ShooterSpec } from '@sparkade/shared';
import { mockGeneratedImage } from '../src/assets/game-art';
import { GenerationRunner } from '../src/pipeline/runner';
import type { DurablePipelineCalls } from '../src/pipeline/durable';
import { SseHub } from '../src/pipeline/sse';
import { MockProvider } from '../src/providers/mock';
import { ConfigStore } from '../src/storage/config';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';

const PLAN =
  /BOSS PHASE PLAN[^:]*: boss\.phases must use exactly these patterns in this order: ([a-z →]+)\./;

it('plans each shooter boss against the cabinet’s delivered boss history', async () => {
  vi.stubEnv('SPARKADE_PROVIDER', 'mock');
  vi.stubEnv('SPARKADE_MOCK_FAST', '1');
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in tests'));
  const root = mkdtempSync(join(tmpdir(), 'sparkade-boss-variety-'));
  const db = new Db(root),
    files = new GameFiles(root);
  try {
    const text = new MockProvider('boss-variety');
    const entitiesPrompts: string[] = [];
    const designPrompts: string[] = [];
    const durable: DurablePipelineCalls = {
      abort: new AbortController(),
      suspended: () => false,
      complete: (stage, request) => {
        if (stage === 'entities') entitiesPrompts.push(request.user);
        if (stage === 'design' && request.user.includes('PLAYER REQUEST'))
          designPrompts.push(request.user);
        return text.complete(request);
      },
      image: async (request) => ({
        image: await mockGeneratedImage(request.prompt),
        imageCount: 1,
      }),
    };
    const runner = new GenerationRunner(
      db,
      files,
      new ConfigStore(root),
      new SseHub(),
      undefined,
      durable,
    );
    const generate = async (key: string) => {
      const { jobId, gameId } = runner.createJob({
        promptText: 'A vertical shooter over a storm harbor',
        requestedArchetype: 'shooter',
        sourceKind: 'preset',
        idempotencyKey: key,
      });
      const deadline = Date.now() + 90_000;
      while (!['done', 'failed', 'canceled'].includes(db.getJob(jobId)!.status)) {
        if (Date.now() > deadline) throw new Error('boss variety pipeline timeout');
        await delay(25);
      }
      const job = db.getJob(jobId)!;
      expect(job.status, JSON.stringify(job.error)).toBe('done');
      return files.readSpec(gameId)!;
    };

    const first = (await generate('boss-variety-1')) as ShooterSpec;
    const delivered = first.boss.phases.map((p) => p.pattern);
    await generate('boss-variety-2');

    expect(entitiesPrompts).toHaveLength(2);
    expect(entitiesPrompts[0]).toMatch(PLAN);
    const secondPlan = entitiesPrompts[1]!.match(PLAN)?.[1]?.split(' → ');
    expect(secondPlan).toBeDefined();
    expect(secondPlan![0]).not.toBe(delivered[0]);
    expect(designPrompts.at(-1)).toContain(`(boss: ${first.boss.name})`);
    expect(designPrompts.at(-1)).toContain(`"boss":"${delivered.join('>')}"`);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  }
}, 200_000);
