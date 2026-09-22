import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { mockGeneratedImage } from '../src/assets/game-art';
import {
  GameAssetWorkspace,
  GeneratedAssetStorageError,
  generatedAssetForRole,
} from '../src/assets/manifest';
import { RACING_BANK_FALLBACK_VERSION } from '../src/assets/racing-bank-fallback';
import { extractRacingNeutralCell } from '../src/assets/racing-bank';
import { processGeneratedRacingCraftStrip } from '../src/assets/racing-craft';
import type { DurablePipelineCalls } from '../src/pipeline/durable';
import { GenerationRunner } from '../src/pipeline/runner';
import { SseHub } from '../src/pipeline/sse';
import { MockProvider } from '../src/providers/mock';
import { ProviderAuthError, ProviderHttpError } from '../src/providers/base';
import { ConfigStore } from '../src/storage/config';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';

it.each([
  'left-refusal',
  'right-refusal',
  'sibling-auth',
  'neutral-rejected',
  'identity-refusal',
] as const)(
  'handles rival banking refusal without repeating images, preserving required failures (%s)',
  async (mode) => {
    const previous = process.env.SPARKADE_PROVIDER;
    delete process.env.SPARKADE_PROVIDER;
    const root = mkdtempSync(join(tmpdir(), 'sparkade-bank-pipeline-'));
    const db = new Db(root),
      files = new GameFiles(root);
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('No network in this test'));
    const originalStore = GameAssetWorkspace.prototype.store;
    const siblingAuth = mode === 'sibling-auth' || mode === 'neutral-rejected';
    let retrying = false;
    let failPersist = !siblingAuth && mode !== 'identity-refusal';
    const store = vi
      .spyOn(GameAssetWorkspace.prototype, 'store')
      .mockImplementation(async function (this: GameAssetWorkspace, role, image, version, hash) {
        if (failPersist && role === 'racingCraftRival1' && version === RACING_BANK_FALLBACK_VERSION)
          throw new GeneratedAssetStorageError('controlled late persistence failure');
        return originalStore.call(this, role, image, version, hash);
      });
    try {
      const text = new MockProvider('bank-fallback');
      const calls: string[] = [];
      const reviews: string[][] = [];
      let neutral: Buffer | undefined;
      const durable: DurablePipelineCalls = {
        abort: new AbortController(),
        suspended: () => false,
        complete: async (_stage, request) => {
          if (request.system.includes('art director selecting gameplay vehicle art')) {
            const schema = request.jsonSchema as {
              properties: { slotReviews: { items: { properties: { id: { enum: string[] } } } } };
            };
            const ids = schema.properties.slotReviews.items.properties.id.enum;
            reviews.push(ids);
            const rejected: string[] = ids.filter((id) => id === 'rival1');
            return {
              text: JSON.stringify({
                slotReviews: ids.map((id) => ({
                  id,
                  concept: 5,
                  orientation: 5,
                  coherence: 5,
                  readability: 5,
                  technical: 5,
                  cameraViews: ['low-rear', 'low-rear', 'low-rear'],
                  fatalIssues: rejected.includes(id) ? ['wrong bank direction'] : [],
                  summary: 'fixture review',
                  correction: rejected.includes(id)
                    ? mode === 'neutral-rejected' && retrying
                      ? 'vehicle'
                      : 'banking'
                    : 'none',
                  guidance: 'Opposite bank directions',
                })),
                selection: {
                  accepted: !rejected.length,
                  rejectedIds: rejected,
                  rationale: 'fixture',
                  retryGuidance: 'Fix bank directions',
                },
              }),
              usage: { input: 1, output: 1 },
            };
          }
          return text.complete(request);
        },
        image: async (request) => {
          calls.push(request.role);
          if (mode === 'identity-refusal' && request.role === 'racingCraftRival1')
            throw new ProviderHttpError(
              'required identity refused',
              400,
              null,
              'content_policy_violation',
            );
          if (request.role.startsWith('racing-craft-rival1-bank-')) {
            if (siblingAuth && request.role.endsWith('bankRight'))
              throw new ProviderAuthError('sibling authentication failure');
            if (request.role.endsWith(mode === 'right-refusal' ? 'bankRight' : 'bankLeft'))
              throw new ProviderHttpError(
                'bank correction refused',
                400,
                null,
                'content_policy_violation',
              );
          }
          const image = await mockGeneratedImage(request.prompt);
          if (request.role === 'racingCraftRival1')
            neutral = await extractRacingNeutralCell(
              (await processGeneratedRacingCraftStrip(image)).png,
            );
          return { image, imageCount: 1 };
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
      const { jobId, gameId } = runner.createJob({
        promptText:
          'Race with handling carve, surface water, rider seated, propulsion motor, motion static',
        requestedArchetype: 'racing',
        sourceKind: 'preset',
        idempotencyKey: 'bank-fallback-test',
      });
      const wait = async () => {
        const deadline = Date.now() + 90_000;
        while (!['done', 'failed', 'canceled'].includes(db.getJob(jobId)!.status)) {
          if (Date.now() > deadline) throw new Error('Bank fallback pipeline did not finish');
          await delay(25);
        }
        return db.getJob(jobId)!;
      };
      const first = await wait();
      expect(first).toMatchObject({
        status: 'failed',
        error: {
          code:
            mode === 'identity-refusal' ? 'image-content-policy' : siblingAuth ? 'auth' : 'storage',
        },
      });
      expect(files.readMeta(gameId)?.status).not.toBe('ready');
      if (mode === 'identity-refusal') {
        expect(calls.filter((role) => role === 'racingCraftRival1')).toHaveLength(1);
        expect(calls.some((role) => role.includes('-bank-'))).toBe(false);
        return;
      }
      expect(calls.filter((role) => role.startsWith('racing-craft-rival1-bank-'))).toHaveLength(2);
      const before = [...calls];
      failPersist = false;
      retrying = true;
      runner.retryJob(gameId);
      const retried = await wait();
      if (mode === 'neutral-rejected') {
        expect(retried).toMatchObject({ status: 'failed', error: { code: 'image-invalid' } });
        expect(calls).toEqual(before);
        expect(files.readMeta(gameId)?.status).not.toBe('ready');
        return;
      }
      expect(retried, JSON.stringify(retried.error)).toMatchObject({ status: 'done' });
      expect(calls).toEqual(before);
      expect(calls.filter((role) => role === 'racingCraftRival1')).toHaveLength(1);
      const asset = generatedAssetForRole(
        join(files.gameDir(gameId), 'assets'),
        'racingCraftRival1',
      );
      expect(asset).toMatchObject({
        width: 64,
        height: 64,
        promptVersion: RACING_BANK_FALLBACK_VERSION,
      });
      expect(files.readMeta(gameId)?.racingArt?.banking).toEqual([
        {
          racer: 'rival1',
          status: 'neutral',
          reason: expect.stringContaining('continuous steering lean'),
        },
      ]);
      const { readFileSync } = await import('node:fs');
      expect(readFileSync(join(files.gameDir(gameId), 'assets', asset!.filename))).toEqual(neutral);
      expect(
        generatedAssetForRole(join(files.gameDir(gameId), 'assets'), 'racingCraftRival2'),
      ).toMatchObject({ width: 192, height: 64 });
      expect(reviews).toEqual([
        ['player'],
        ['rival1', 'rival2', 'rival3', 'rival4'],
        ...(mode === 'sibling-auth' ? [['rival1']] : []),
      ]);
      expect(
        readdirSync(join(files.gameDir(gameId), 'assets')).some((name) => name.startsWith('.')),
      ).toBe(false);
      expect(network).not.toHaveBeenCalled();
    } finally {
      store.mockRestore();
      network.mockRestore();
      db.close();
      rmSync(root, { recursive: true, force: true });
      if (previous === undefined) delete process.env.SPARKADE_PROVIDER;
      else process.env.SPARKADE_PROVIDER = previous;
    }
  },
  120_000,
);
