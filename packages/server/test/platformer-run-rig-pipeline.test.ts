import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudGameBundle } from '@sparkade/shared';
import { RUN_RIG_CONCEPTS } from '../src/assets/platformer-run-rig';
import {
  advancePipeline,
  collectFiles,
  type PassCheckpoint,
  type ProviderResult,
} from '../src/pipeline/durable-pass';
import { executeProviderTask } from '../src/pipeline/durable-provider';
import { JobState } from '../src/pipeline/job-state';
import { GenerationRunner } from '../src/pipeline/runner';
import { SseHub } from '../src/pipeline/sse';
import { defaultConfig } from '../src/storage/config';
import { GameFiles } from '../src/storage/files';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('rig run in-betweens in cloud generation', () => {
  it.each(['no limbs found', 'SAM failing'] as const)(
    'asks SAM once per concept across passes and still finishes the game (%s)',
    async (mode) => {
      vi.stubEnv('SPARKADE_PROVIDER', 'mock');
      vi.stubEnv('SPARKADE_MOCK_FAST', '1');
      vi.stubEnv('SPARKADE_PLATFORMER_RUN_RIG', '1');
      const config = defaultConfig();
      const dir = mkdtempSync(join(tmpdir(), 'sparkade-run-rig-'));
      const db = new JobState();
      let checkpoint: PassCheckpoint;
      try {
        new GenerationRunner(db, new GameFiles(dir), { get: () => config }, new SseHub()).createJob(
          {
            promptText: 'A moon garden courier sprinting between rooftops',
            sourceKind: 'voice',
            requestedArchetype: 'platformer',
            idempotencyKey: `run-rig-${mode}`,
          },
          { defer: true },
        );
        checkpoint = { state: db.state, files: collectFiles(dir) };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      const responses: Record<string, ProviderResult> = {};
      const segmentCalls: string[] = [];
      for (let pass = 0; pass < 40; pass++) {
        const output = await advancePipeline(
          JSON.parse(JSON.stringify(checkpoint)),
          async (id) => responses[id],
          config,
        );
        checkpoint = output;
        expect(output.state.job?.status).not.toBe('failed');
        if (output.state.job?.status === 'done') break;
        for (const request of output.pending) {
          if (request.kind === 'segment') {
            segmentCalls.push(request.id);
            if (mode === 'SAM failing') {
              responses[request.id] = { kind: 'error', status: 500, message: 'SAM unavailable' };
              continue;
            }
          }
          responses[request.id] = await executeProviderTask(
            request,
            config,
            output.state.job!.gameId,
          );
        }
      }
      expect(checkpoint.state.job?.status).toBe('done');
      // Both contact frames, every concept, each asked once across all passes.
      expect(segmentCalls).toHaveLength(2 * RUN_RIG_CONCEPTS.length);
      expect(new Set(segmentCalls).size).toBe(segmentCalls.length);
      const base = `games/${checkpoint.state.job!.gameId}/`;
      const manifest = JSON.parse(
        Buffer.from(checkpoint.files[`${base}assets/manifest.json`]!, 'base64').toString(),
      ) as CloudGameBundle['manifest'];
      // Pixel shift everywhere means nothing to store: the player computes it.
      expect(manifest.assets.map((a) => a.role)).toContain('platformerWalk1');
      expect(manifest.assets.map((a) => a.role)).not.toContain('platformerRunMid1');
      expect(manifest.assets.map((a) => a.role)).not.toContain('platformerRunMid2');
    },
    120_000,
  );
});
