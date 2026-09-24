import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import * as enemies from '../src/assets/adventure-enemy';
import * as objects from '../src/assets/adventure-object';
import { mockGeneratedImage } from '../src/assets/game-art';
import { GenerationRunner } from '../src/pipeline/runner';
import type { DurablePipelineCalls } from '../src/pipeline/durable';
import { SseHub } from '../src/pipeline/sse';
import { MockProvider } from '../src/providers/mock';
import { ConfigStore } from '../src/storage/config';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';

type Scenario = {
  name: string;
  /** Board kind whose split drops every cell for `role`. */
  board: 'enemy' | 'object';
  role: string;
  /** Whether the isolated replacements come back valid. */
  replacementsValid: boolean;
  expectStatus: 'done' | 'failed';
  expectReplacements: number;
  expectError?: string;
};

const scenarios: Scenario[] = [
  {
    name: 'repaints a missing bruiser as two isolated candidates',
    board: 'enemy',
    role: 'bruiser',
    replacementsValid: true,
    expectStatus: 'done',
    expectReplacements: 2,
  },
  {
    name: 'fails only after both bruiser replacements are rejected',
    board: 'enemy',
    role: 'bruiser',
    replacementsValid: false,
    expectStatus: 'failed',
    expectReplacements: 2,
    expectError: 'no valid bruiser after 2 isolated replacements',
  },
  {
    name: 'repaints a missing pushable block',
    board: 'object',
    role: 'block',
    replacementsValid: true,
    expectStatus: 'done',
    expectReplacements: 2,
  },
  {
    name: 'never repaints one pressure-plate state alone',
    board: 'object',
    role: 'switchPressed',
    replacementsValid: true,
    expectStatus: 'failed',
    expectReplacements: 0,
    expectError: 'no valid switchPressed',
  },
];

it.each(scenarios)(
  '$name',
  async ({ board, role, replacementsValid, expectStatus, expectReplacements, expectError }) => {
    vi.stubEnv('SPARKADE_PROVIDER', 'mock');
    vi.stubEnv('SPARKADE_MOCK_FAST', '1');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in tests'));
    const root = mkdtempSync(join(tmpdir(), 'sparkade-role-replacement-'));
    const db = new Db(root),
      files = new GameFiles(root);
    const reason = `${role} candidate is too small (20x20)`;
    const dropRole = <T extends { candidates: { role: string; id: string }[] }>(result: T) => ({
      ...result,
      candidates: result.candidates.filter((candidate) => candidate.role !== role),
      failures: [
        ...(result as unknown as { failures: { id: string; role: string; reason: string }[] })
          .failures,
        { id: `${role}-1`, role, reason },
        { id: `${role}-2`, role, reason },
      ],
    });
    if (board === 'enemy') {
      const split = enemies.splitGeneratedAdventureEnemyBoard;
      vi.spyOn(enemies, 'splitGeneratedAdventureEnemyBoard').mockImplementation(
        async (image) => dropRole(await split(image)) as Awaited<ReturnType<typeof split>>,
      );
    } else {
      const split = objects.splitGeneratedAdventureObjectBoard;
      vi.spyOn(objects, 'splitGeneratedAdventureObjectBoard').mockImplementation(
        async (image) => dropRole(await split(image)) as Awaited<ReturnType<typeof split>>,
      );
    }
    try {
      const text = new MockProvider('role-replacement');
      const replacementPrompts: string[] = [];
      const boards: Record<string, Buffer> = {};
      const cellFor = async (kind: 'enemy' | 'object') => {
        const roles: readonly string[] =
          kind === 'enemy'
            ? enemies.GENERATED_ADVENTURE_ENEMIES
            : objects.GENERATED_ADVENTURE_OBJECTS;
        const index = roles.indexOf(role) * 2;
        const rect =
          kind === 'enemy'
            ? enemies.adventureEnemyBoardCellRect(index)
            : objects.adventureObjectCellRect(index);
        const { left, top, width, height } = rect;
        return sharp(boards[kind]!).extract({ left, top, width, height }).png().toBuffer();
      };
      const durable: DurablePipelineCalls = {
        abort: new AbortController(),
        suspended: () => false,
        complete: (_stage, request) => text.complete(request),
        image: async (request) => {
          if (request.role.startsWith(`adventure-${board}-replacement-`)) {
            replacementPrompts.push(request.prompt);
            const image = replacementsValid
              ? await cellFor(board)
              : await sharp({
                  create: { width: 64, height: 64, channels: 3, background: '#00ff00' },
                })
                  .png()
                  .toBuffer();
            return { image, imageCount: 1 };
          }
          const image = await mockGeneratedImage(request.prompt);
          if (request.role === 'adventure-enemy-board') boards.enemy = image;
          if (request.role === 'adventure-object-board') boards.object = image;
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
        promptText: 'An adventure through a lighthouse full of brass crabs',
        requestedArchetype: 'adventure',
        sourceKind: 'preset',
        idempotencyKey: `role-replacement-${board}-${role}-${replacementsValid}`,
      });
      const deadline = Date.now() + 90_000;
      while (!['done', 'failed', 'canceled'].includes(db.getJob(jobId)!.status)) {
        if (Date.now() > deadline) throw new Error('role replacement pipeline timeout');
        await delay(25);
      }
      const job = db.getJob(jobId)!;
      expect(job.status, JSON.stringify(job.error)).toBe(expectStatus);
      if (expectError) expect(job.error?.message).toContain(expectError);
      expect(replacementPrompts).toHaveLength(expectReplacements);
      for (const prompt of replacementPrompts) {
        expect(prompt).toContain('create exactly ONE complete isolated');
        expect(prompt).toContain(`CORRECTION FROM LOCAL VALIDATION: ${reason}`);
      }
      if (expectReplacements) {
        expect(new Set(replacementPrompts).size).toBe(expectReplacements);
        const event = db
          .repairEventsForJob(jobId)
          .find((e) => e.action === `adventure-${board}-role-replacement`);
        expect(event?.outcome).toBe(expectStatus === 'done' ? 'fixed' : 'failed');
        expect(event?.diagnosticsBefore.map((d) => d.message)).toContain(reason);
      }
      if (expectStatus === 'done') {
        const meta = files.readMeta(gameId)!;
        const art = board === 'enemy' ? meta.adventureEnemyArt : meta.adventureObjectArt;
        expect(art?.mode).toBe('generated');
      }
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  },
  120_000,
);
