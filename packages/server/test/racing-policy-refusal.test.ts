// Racing preserves provider content-policy refusals: a refused image
// (live: invented storyDefeat) must fail the racing job terminally with
// image-content-policy after exactly one image call — never rephrase into
// the policy-fallback prompt for a second attempt. Other archetypes keep
// the safe-rephrase path. Fully local: mock text plus a durable image stub
// that throws a real policy-shaped provider error on storyDefeat only.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { JobRecord } from '@sparkade/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mockGeneratedImage } from '../src/assets/game-art';
import type { DurableImageRequest, DurablePipelineCalls } from '../src/pipeline/durable';
import { GenerationRunner } from '../src/pipeline/runner';
import { SseHub } from '../src/pipeline/sse';
import { ConfigStore } from '../src/storage/config';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';
import { ProviderHttpError } from '../src/providers/base';
import { MockProvider } from '../src/providers/mock';

const originalEnv = {
  provider: process.env.SPARKADE_PROVIDER,
  fast: process.env.SPARKADE_MOCK_FAST,
  concurrency: process.env.SPARKADE_GEN_CONCURRENCY,
};

beforeAll(() => {
  process.env.SPARKADE_PROVIDER = 'mock';
  process.env.SPARKADE_MOCK_FAST = '1';
  process.env.SPARKADE_GEN_CONCURRENCY = '1';
});

afterAll(() => {
  if (originalEnv.provider === undefined) delete process.env.SPARKADE_PROVIDER;
  else process.env.SPARKADE_PROVIDER = originalEnv.provider;
  if (originalEnv.fast === undefined) delete process.env.SPARKADE_MOCK_FAST;
  else process.env.SPARKADE_MOCK_FAST = originalEnv.fast;
  if (originalEnv.concurrency === undefined) delete process.env.SPARKADE_GEN_CONCURRENCY;
  else process.env.SPARKADE_GEN_CONCURRENCY = originalEnv.concurrency;
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function waitForTerminal(db: Db, jobId: string, timeoutMs = 90_000): Promise<JobRecord> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = db.getJob(jobId);
    if (job && ['done', 'failed', 'canceled'].includes(job.status)) return job;
    if (Date.now() >= deadline) {
      throw new Error(`job ${jobId} did not finish within ${timeoutMs}ms (last: ${job?.status})`);
    }
    await delay(25);
  }
}

/** The live invented storyDefeat refusal shape: HTTP 400 content policy. */
function policyRefusal(): ProviderHttpError {
  return new ProviderHttpError(
    'image generation refused by content management policy',
    400,
    null,
    'content_policy_violation',
  );
}

describe('racing content-policy refusal', () => {
  it('fails terminally after one storyDefeat call with no fallback rephrase', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sparkade-racing-policy-'));
    roots.push(root);
    const db = new Db(root);
    const files = new GameFiles(root);
    try {
      const imageCalls: string[] = [];
      const mockText = new MockProvider('policy-refusal-test');
      const durable: DurablePipelineCalls = {
        abort: new AbortController(),
        suspended: () => false,
        complete: (_stage, request) => mockText.complete(request),
        image: async (request: DurableImageRequest) => {
          imageCalls.push(request.role);
          if (request.role === 'storyDefeat') throw policyRefusal();
          return { image: await mockGeneratedImage(request.prompt), imageCount: 1 };
        },
      };
      const runner = new GenerationRunner(
        db,
        files,
        new ConfigStore(root),
        new SseHub(),
        undefined,
        durable,
      );
      const details =
        'Racing with handling grip, surface ground, rider seated, propulsion human, motion pedal. Include fork routes and rolling hills.';
      const { jobId, gameId } = runner.createJob({
        promptText: details,
        requestedArchetype: 'racing',
        sourceKind: 'preset',
        idempotencyKey: 'policy-refusal-racing-story',
      });
      const terminal = await waitForTerminal(db, jobId);
      expect(terminal).toMatchObject({
        status: 'failed',
        error: { code: 'image-content-policy' },
      });
      // Exactly one storyDefeat image call: the fallback rephrase would
      // have issued a second call under the same role.
      expect(imageCalls.filter((role) => role === 'storyDefeat')).toHaveLength(1);
      const defeatUsage = db
        .usageForGame(gameId)
        .filter((row) => row.stage === 'image:storyDefeat');
      expect(defeatUsage).toHaveLength(1);
      expect(defeatUsage[0]).toMatchObject({ failed: true });
      expect(files.readMeta(gameId)?.status).not.toBe('ready');
    } finally {
      db.close();
    }
  }, 120_000);
});
