// A racer whose bounded repairs end still rejected must not fail the game.
// The live SEA Portal+ hover-board job failed three attempts on the player
// strip; a board rival would have failed the roster next. Pin the pipeline:
// Muse ranks each racer's reviewed candidates once, the pick publishes (a
// rear-only player as a 64px neutral on static cups), meta records it, and
// an unrelated late failure retries without new vehicle images or picks.
import { mkdtempSync, rmSync } from 'node:fs';
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
import { RACING_LEAST_BAD_REAR_REASON } from '../src/assets/racing-least-bad';
import type { DurablePipelineCalls } from '../src/pipeline/durable';
import { GenerationRunner } from '../src/pipeline/runner';
import { SseHub } from '../src/pipeline/sse';
import { MockProvider } from '../src/providers/mock';
import { ConfigStore } from '../src/storage/config';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';

it.each(['static', 'foundation'] as const)(
  'ships least-bad racers instead of failing, and restores them on retry (%s)',
  async (cup) => {
    const previous = process.env.SPARKADE_PROVIDER;
    delete process.env.SPARKADE_PROVIDER;
    const root = mkdtempSync(join(tmpdir(), 'sparkade-least-bad-pipeline-'));
    const db = new Db(root),
      files = new GameFiles(root);
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('No network in this test'));
    const leastBadRequests: { user: string; ids: string[]; image: boolean }[] = [];
    let failLate = true;
    const originalStore = GameAssetWorkspace.prototype.store;
    const store = vi
      .spyOn(GameAssetWorkspace.prototype, 'store')
      .mockImplementation(async function (this: GameAssetWorkspace, role, image, version, hash) {
        // An unrelated storage failure after both picks: the retry must
        // restore them rather than repaint or re-rank any racer.
        if (failLate && leastBadRequests.length === 2 && role === 'racingCraftRival4') {
          failLate = false;
          throw new GeneratedAssetStorageError('controlled late persistence failure');
        }
        return originalStore.call(this, role, image, version, hash);
      });
    try {
      const text = new MockProvider(`least-bad-${cup}`);
      const images: string[] = [];
      const durable: DurablePipelineCalls = {
        abort: new AbortController(),
        suspended: () => false,
        complete: async (_stage, request) => {
          const review = request.system.includes('art director selecting gameplay vehicle art');
          const foundationReview = request.system.includes('art director selecting gameplay identity art');
          if (review || foundationReview) {
            const schema = request.jsonSchema as {
              properties: { slotReviews: { items: { properties: { id: { enum: string[] } } } } };
            };
            const ids = schema.properties.slotReviews.items.properties.id.enum;
            // The player and one rival never pass, whatever is repainted.
            const rejected: string[] = ids.filter((id) => id === 'player' || id === 'rival2');
            return {
              text: JSON.stringify({
                slotReviews: ids.map((id) => ({
                  id,
                  ...(review
                    ? {
                        concept: 4,
                        orientation: 2,
                        coherence: 3,
                        readability: 3,
                        technical: 3,
                        correction: rejected.includes(id) ? 'vehicle' : 'none',
                      }
                    : {}),
                  // The player's banks fail the camera check, so its pick
                  // must ship rear-only; rival2's banks pass, so they may ship.
                  cameraViews: !review
                    ? ['low-rear']
                    : id === 'player'
                      ? ['low-rear', 'side', 'side']
                      : ['low-rear', 'low-rear', 'low-rear'],
                  fatalIssues: rejected.includes(id) ? ['sideways deck in bank cells'] : [],
                  summary: 'fixture review',
                  guidance: rejected.includes(id) ? `Keep ${id} pointing away while leaning` : '',
                })),
                selection: {
                  accepted: !rejected.length,
                  rejectedIds: rejected,
                  rationale: 'fixture',
                  retryGuidance: 'Keep the board pointing away',
                },
              }),
              usage: { input: 1, output: 1 },
            };
          }
          if (request.system.includes('choosing which rejected gameplay racer sprite ships')) {
            const schema = request.jsonSchema as { properties: { choice: { enum: string[] } } };
            leastBadRequests.push({
              user: request.user,
              ids: schema.properties.choice.enum,
              image: !!request.image,
            });
            // The player's pick always happens before rivals are painted.
            const player = leastBadRequests.length === 1;
            return {
              text: JSON.stringify(
                player
                  ? { choice: 'B', ...(cup === 'static' ? { rearOnly: false } : {}), rationale: 'B keeps the truest rear' }
                  : { choice: 'A', ...(cup === 'static' ? { rearOnly: false } : {}), rationale: 'A leans believably' },
              ),
              usage: { input: 1, output: 1 },
            };
          }
          if (request.system.startsWith('Review this racing motion atlas.'))
            return {
              text: JSON.stringify({ accepted: true, reason: 'fixture motion verdict' }),
              usage: { input: 1, output: 1 },
            };
          return text.complete(request);
        },
        image: async (request) => {
          images.push(request.role);
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
      const { jobId, gameId } = runner.createJob({
        promptText:
          cup === 'static'
            ? 'Race with handling carve, surface water, rider seated, propulsion motor, motion static'
            : 'Race with handling grip, surface ground, rider seated, propulsion human, motion pedal',
        requestedArchetype: 'racing',
        sourceKind: 'preset',
        idempotencyKey: `least-bad-${cup}`,
      });
      const wait = async () => {
        const deadline = Date.now() + 90_000;
        while (!['done', 'failed', 'canceled'].includes(db.getJob(jobId)!.status)) {
          if (Date.now() > deadline) throw new Error('Least-bad pipeline did not finish');
          await delay(25);
        }
        return db.getJob(jobId)!;
      };
      expect(await wait()).toMatchObject({ status: 'failed', error: { code: 'storage' } });
      // One initial + one repaint per rejected racer, then exactly one pick
      // each over the reviewed candidates with their own rejections. Mock
      // rival repaints can be pixel-identical; identical candidates collapse.
      expect(images.filter((role) => role === 'racingCraftPlayer')).toHaveLength(2);
      expect(images.filter((role) => role === 'racingCraftRival2')).toHaveLength(2);
      for (const rival of ['racingCraftRival1', 'racingCraftRival3', 'racingCraftRival4'])
        expect(images.filter((role) => role === rival)).toHaveLength(1);
      const rivalIds = leastBadRequests[1]!.ids;
      expect(leastBadRequests.map(({ ids }) => ids)).toEqual([['A', 'B'], rivalIds]);
      expect(rivalIds.length).toBeGreaterThanOrEqual(1);
      expect(leastBadRequests.every(({ image }) => image)).toBe(true);
      expect(leastBadRequests[0]!.user).toContain('A was rejected for: Keep player pointing away while leaning');
      expect(leastBadRequests[0]!.user).toContain('B was rejected for: Keep player pointing away while leaning');
      expect(leastBadRequests[1]!.user).toContain('A was rejected for: Keep rival2 pointing away while leaning');
      expect(leastBadRequests[0]!.user.includes('rearOnly')).toBe(cup === 'static');

      const before = [...images];
      runner.retryJob(gameId);
      const retried = await wait();
      expect(retried, JSON.stringify(retried.error)).toMatchObject({ status: 'done' });
      expect(images.slice(before.length).filter((role) => role.startsWith('racingCraft'))).toEqual([]);
      expect(leastBadRequests).toHaveLength(2);

      const meta = files.readMeta(gameId)!;
      expect(meta.status).toBe('ready');
      expect(meta.racingArt?.leastBad).toEqual([
        {
          racer: 'player',
          candidate: 1,
          candidates: 2,
          rearOnly: cup === 'static',
          // Muse asked to keep the player's banks; the gate's camera evidence wins.
          rationale:
            cup === 'static'
              ? 'B keeps the truest rear. Its bank cells failed the rear-camera gate, so only its rear ships.'
              : 'B keeps the truest rear',
        },
        { racer: 'rival2', candidate: 0, candidates: rivalIds.length, rearOnly: false, rationale: 'A leans believably' },
      ]);
      const assets = join(files.gameDir(gameId), 'assets');
      if (cup === 'static') {
        // The rear-only player publishes one 64px neutral with engine lean;
        // the rival keeps its generated banks under the approval key.
        expect(generatedAssetForRole(assets, 'racingCraftPlayer')).toMatchObject({ width: 64, height: 64 });
        expect(generatedAssetForRole(assets, 'racingCraftRival2')).toMatchObject({
          width: 192,
          height: 64,
          promptVersion: expect.stringMatching(/-approved-v1$/),
        });
        expect(meta.racingArt?.banking).toEqual([
          { racer: 'player', status: 'neutral', reason: RACING_LEAST_BAD_REAR_REASON },
        ]);
      } else {
        expect(meta.racingArt?.banking).toBeUndefined();
        expect(meta.racingArt?.motion?.map(({ racer }) => racer)).toEqual([
          'player',
          'rival1',
          'rival2',
          'rival3',
          'rival4',
        ]);
      }
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
  180_000,
);
