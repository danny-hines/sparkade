// A refused racing key art or story scene gets exactly one family-safe
// rephrase, like every other archetype, instead of ending the game (live:
// invented storyDefeat). A second refusal still fails terminally with
// image-content-policy. Fully local: mock text plus a durable image stub that
// throws a real policy-shaped provider error on storyDefeat.
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
  it.each([
    ['rephrases once and finishes', 1, 'done'],
    ['fails terminally when the rephrase is refused too', 2, 'failed'],
  ] as const)('%s', async (_name, refusals, status) => {
    const root = mkdtempSync(join(tmpdir(), 'sparkade-racing-policy-'));
    roots.push(root);
    const db = new Db(root);
    const files = new GameFiles(root);
    try {
      const imageCalls: string[] = [];
      const defeatPrompts: string[] = [];
      const mockText = new MockProvider('policy-refusal-test');
      const durable: DurablePipelineCalls = {
        abort: new AbortController(),
        suspended: () => false,
        complete: (_stage, request) => mockText.complete(request),
        image: async (request: DurableImageRequest) => {
          imageCalls.push(request.role);
          if (request.role === 'storyDefeat') {
            defeatPrompts.push(request.prompt);
            if (defeatPrompts.length <= refusals) throw policyRefusal();
          }
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
        idempotencyKey: `policy-refusal-racing-story-${refusals}`,
      });
      const terminal = await waitForTerminal(db, jobId);
      // Exactly two storyDefeat calls: the original and one family-safe rephrase.
      expect(imageCalls.filter((role) => role === 'storyDefeat')).toHaveLength(2);
      expect(defeatPrompts[1]).not.toBe(defeatPrompts[0]);
      expect(defeatPrompts[1]).toContain('resting safely after a difficult challenge');
      if (status === 'done') {
        expect(terminal, JSON.stringify(terminal.error)).toMatchObject({ status: 'done' });
        expect(files.readMeta(gameId)?.status).toBe('ready');
      } else {
        expect(terminal).toMatchObject({ status: 'failed', error: { code: 'image-content-policy' } });
        expect(files.readMeta(gameId)?.status).not.toBe('ready');
      }
    } finally {
      db.close();
    }
  }, 120_000);
});
