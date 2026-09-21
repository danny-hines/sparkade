import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
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
  it.each(['hshooter', 'platformer', 'shooter', 'adventure', 'fighter', 'racing'] as const)(
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
      let deferredMusic: string | undefined;
      let sawArtWhileMusicPending = false;
      let deferredBackdrop: string | undefined;
      let sawHeroWhileBackdropPending = false;
      const propRequests: string[] = [];
      for (; passes < 40; passes++) {
        const output = await advancePipeline(
          JSON.parse(JSON.stringify(checkpoint)),
          async (id) => responses[id],
          config,
        );
        checkpoint = output;
        expect(output.state.job?.status).not.toBe('failed');
        if (output.state.job?.status === 'done') break;
        expect(output.pending.length).toBeGreaterThan(0);
        if (deferredMusic && !responses[deferredMusic]) {
          expect(output.pending.some((request) => request.kind === 'image')).toBe(true);
          sawArtWhileMusicPending = true;
        }
        if (
          deferredBackdrop &&
          !responses[deferredBackdrop] &&
          output.pending.some(
            (r) => r.kind === 'image' && r.request.role === 'platformer-side-anchor',
          )
        )
          sawHeroWhileBackdropPending = true;
        for (const request of output.pending) {
          expect(responses[request.id]).toBeUndefined();
          if (
            archetype === 'platformer' &&
            request.kind === 'text' &&
            request.stage === 'music' &&
            !deferredMusic
          ) {
            deferredMusic = request.id;
            continue;
          }
          if (
            archetype === 'platformer' &&
            request.kind === 'image' &&
            request.request.role.startsWith('platformerBackdrop') &&
            !deferredBackdrop
          )
            deferredBackdrop = request.id;
          if (request.id === deferredBackdrop && !sawHeroWhileBackdropPending) continue;
          responses[request.id] = await executeProviderTask(
            request,
            config,
            output.state.job!.gameId,
          );
          if (
            archetype === 'platformer' &&
            request.kind === 'image' &&
            request.request.role.startsWith('platformer-prop-')
          ) {
            propRequests.push(request.request.role);
            const result = responses[request.id]!;
            if (request.request.role === 'platformer-prop-board' && result.kind === 'image') {
              // Deliberately erase health. All other crops must survive replay;
              // only health should require another paid image request.
              const empty = await sharp({
                create: { width: 512, height: 512, channels: 4, background: '#00ff00' },
              })
                .png()
                .toBuffer();
              result.image = (
                await sharp(Buffer.from(result.image, 'base64'))
                  .composite([{ input: empty, left: 512, top: 0 }])
                  .png()
                  .toBuffer()
              ).toString('base64');
            }
          }
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
      if (archetype === 'platformer') {
        expect(sawArtWhileMusicPending).toBe(true);
        expect(sawHeroWhileBackdropPending).toBe(true);
        expect(propRequests).toEqual(['platformer-prop-board', 'platformer-prop-health']);
      }
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
