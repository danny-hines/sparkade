import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationRunner } from '../src/pipeline/runner';
import { JobState } from '../src/pipeline/job-state';
import { GameFiles } from '../src/storage/files';
import { defaultConfig } from '../src/storage/config';
import { SseHub } from '../src/pipeline/sse';
import {
  advancePipeline,
  collectFiles,
  restoreFiles,
  type PassCheckpoint,
  type ProviderResult,
} from '../src/pipeline/durable-pass';
import { executeProviderTask, providerUsageEvent } from '../src/pipeline/durable-provider';
import { validateBundle } from '../src/cloud/generation-client';
import type { CloudGameBundle } from '@sparkade/shared';

afterEach(() => vi.unstubAllEnvs());
describe('durable generation passes', () => {
  it.each(['hshooter', 'platformer'] as const)(
    'generates %s across fresh filesystems without repeating completed provider calls',
    async (archetype) => {
      vi.stubEnv('SPARKADE_PROVIDER', 'mock');
      const config = defaultConfig();
      const dir = mkdtempSync(join(tmpdir(), 'sparkade-durable-test-'));
      const db = new JobState();
      let checkpoint: PassCheckpoint;
      try {
        const runner = new GenerationRunner(
          db,
          new GameFiles(dir),
          { get: () => config },
          new SseHub(),
        );
        runner.createJob(
          {
            promptText: 'A moon garden space mission',
            sourceKind: 'voice',
            requestedArchetype: archetype,
            idempotencyKey: 'durable-test',
          },
          { defer: true },
        );
        checkpoint = { state: db.state, files: collectFiles(dir) };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      const responses: Record<string, ProviderResult> = {};
      let passes = 0,
        calls = 0;
      for (; passes < 40; passes++) {
        const output = await advancePipeline(
          JSON.parse(JSON.stringify(checkpoint)),
          responses,
          config,
        );
        checkpoint = output;
        expect(output.state.job?.status).not.toBe('failed');
        if (output.state.job?.status === 'done') break;
        expect(output.pending.length).toBeGreaterThan(0);
        for (const request of output.pending) {
          expect(responses[request.id]).toBeUndefined();
          responses[request.id] = await executeProviderTask(
            request,
            config,
            output.state.job!.gameId,
          );
          const event = providerUsageEvent(
            request,
            responses[request.id]!,
            checkpoint.state,
            checkpoint.state.job!.attempt,
          );
          checkpoint.state.usage.push(event);
          calls++;
        }
      }
      expect(passes).toBeGreaterThan(2);
      expect(checkpoint.state.job?.status).toBe('done');
      const base = `games/${checkpoint.state.job!.gameId}/`;
      const read = (p: string) =>
        JSON.parse(Buffer.from(checkpoint.files[base + p]!, 'base64').toString());
      const bundle: CloudGameBundle = {
        spec: read('game.json'),
        meta: read('meta.json'),
        manifest: read('assets/manifest.json'),
      };
      expect(() => validateBundle(bundle, checkpoint.state.job!.gameId)).not.toThrow();
      expect(bundle.manifest.assets.length).toBeGreaterThan(5);
      expect(checkpoint.state.usage.filter((u) => u.requestId).length).toBe(calls);
    },
    120_000,
  );
  it('rejects paths escaping a restored checkpoint', () => {
    expect(() => restoreFiles('/tmp/sparkade-test', { '../escape': 'eA==' })).toThrow(
      'Invalid checkpoint path',
    );
  });
});
