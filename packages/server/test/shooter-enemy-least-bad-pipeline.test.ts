// Vertical popcorn replacements failed their silhouette rule in about a
// quarter of local vertical-shooter jobs, and every such job died even though
// processed near-miss sprites existed. Pin both shooters: when every candidate
// for a role misses only its shape rule, the cast judge ships the least bad.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import { mockGeneratedImage } from '../src/assets/game-art';
import { generatedAssetForRole } from '../src/assets/manifest';
import { hshooterEnemyBoardCellRect } from '../src/assets/hshooter-enemy';
import type { DurablePipelineCalls } from '../src/pipeline/durable';
import { GenerationRunner } from '../src/pipeline/runner';
import { SseHub } from '../src/pipeline/sse';
import { MockProvider } from '../src/providers/mock';
import { ConfigStore } from '../src/storage/config';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';

/** A single-subject sprite whose proportions break the role's silhouette rule. */
async function wrongShape(width: number, height: number, size: number): Promise<Buffer> {
  const subject = await sharp({ create: { width, height, channels: 3, background: '#302b46' } })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: '#00ff00' } })
    .composite([{ input: subject, left: Math.floor((size - width) / 2), top: Math.floor((size - height) / 2) }])
    .png()
    .toBuffer();
}

it.each(['shooter', 'hshooter'] as const)(
  'ships the closest %s popcorn when every candidate misses its silhouette rule',
  async (archetype) => {
    const previous = process.env.SPARKADE_PROVIDER;
    delete process.env.SPARKADE_PROVIDER;
    const root = mkdtempSync(join(tmpdir(), 'sparkade-shooter-least-bad-'));
    const db = new Db(root),
      files = new GameFiles(root);
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('No network in this test'));
    // Vertical popcorn must be taller than wide; H-scroll popcorn wider than tall.
    const [w, h] = archetype === 'shooter' ? [72, 30] : [30, 72];
    try {
      const text = new MockProvider(`least-bad-${archetype}-enemy`);
      const images: string[] = [];
      const judged: string[][] = [];
      const durable: DurablePipelineCalls = {
        abort: new AbortController(),
        suspended: () => false,
        complete: async (_stage, request) => {
          const schema = request.jsonSchema as
            | { title?: string; properties?: { candidateReviews?: { items: { properties: { id: { enum: string[] } } } } } }
            | undefined;
          const ids = schema?.properties?.candidateReviews?.items.properties.id.enum;
          if (ids && /enemy cast/i.test(`${schema?.title ?? ''} ${request.system}`)) judged.push(ids);
          return text.complete(request);
        },
        image: async (request) => {
          images.push(request.role);
          if (request.role === `${archetype}-enemy-board`) {
            const board = await sharp(await mockGeneratedImage(request.prompt))
              .resize(1024, 1024, { fit: 'cover' })
              .png()
              .toBuffer();
            // Both popcorn cells (board indexes 0 and 1) miss the shape rule.
            const cells = await Promise.all(
              [0, 1].map(async (index) => {
                const rect = hshooterEnemyBoardCellRect(index);
                return {
                  input: await sharp(await wrongShape(w * 2, h * 2, 256))
                    .resize(rect.width, rect.height, { fit: 'fill' })
                    .png()
                    .toBuffer(),
                  left: rect.left,
                  top: rect.top,
                };
              }),
            );
            return { image: await sharp(board).composite(cells).png().toBuffer(), imageCount: 1 };
          }
          if (request.role === `${archetype}-enemy-replacement-popcorn`)
            return { image: await wrongShape(w * 8, h * 8, 1024), imageCount: 1 };
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
        promptText: 'A moon garden game',
        requestedArchetype: archetype,
        sourceKind: 'preset',
        idempotencyKey: `least-bad-${archetype}-enemy`,
      });
      const deadline = Date.now() + 90_000;
      while (!['done', 'failed', 'canceled'].includes(db.getJob(jobId)!.status)) {
        if (Date.now() > deadline) throw new Error('Shooter least-bad pipeline did not finish');
        await delay(25);
      }
      const job = db.getJob(jobId)!;
      expect(job, JSON.stringify(job.error)).toMatchObject({ status: 'done' });
      // One board and exactly one popcorn replacement: no extra repair calls.
      expect(images.filter((role) => role === `${archetype}-enemy-board`)).toHaveLength(1);
      expect(images.filter((role) => role.startsWith(`${archetype}-enemy-replacement-`))).toEqual([
        `${archetype}-enemy-replacement-popcorn`,
      ]);
      // The judge saw all three popcorn near-misses and nothing else for that role.
      expect(judged).toHaveLength(1);
      expect(judged[0]!.filter((id) => id.startsWith('popcorn'))).toHaveLength(3);
      const meta = files.readMeta(gameId)!;
      expect(meta[archetype === 'shooter' ? 'shooterEnemyArt' : 'hshooterEnemyArt']).toMatchObject({
        mode: 'generated',
        roles: ['popcorn', 'weaver', 'tank', 'turret', 'kamikaze'],
      });
      expect(
        generatedAssetForRole(
          join(files.gameDir(gameId), 'assets'),
          archetype === 'shooter' ? 'shooterEnemyAtlas' : 'hshooterEnemyAtlas',
        ),
      ).toMatchObject({ width: 96 * 5, height: 96 });
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
      db.close();
      rmSync(root, { recursive: true, force: true });
      if (previous === undefined) delete process.env.SPARKADE_PROVIDER;
      else process.env.SPARKADE_PROVIDER = previous;
    }
  },
  120_000,
);
