import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import * as objects from '../src/assets/adventure-object';
import { mockGeneratedImage } from '../src/assets/game-art';
import { GenerationRunner } from '../src/pipeline/runner';
import type { DurablePipelineCalls } from '../src/pipeline/durable';
import { SseHub } from '../src/pipeline/sse';
import { MockProvider } from '../src/providers/mock';
import { ConfigStore } from '../src/storage/config';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';

it.each(['portrait', 'missing'] as const)(
  'repairs only an Adventure NPC (%s), then reuses the atlas on retry',
  async (mode) => {
    vi.stubEnv('SPARKADE_PROVIDER', 'mock');
    vi.stubEnv('SPARKADE_MOCK_FAST', '1');
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('No network in tests'));
    const root = mkdtempSync(join(tmpdir(), 'sparkade-npc-pipeline-'));
    const db = new Db(root),
      files = new GameFiles(root);
    let failPublish = true;
    const publish = files.publish.bind(files);
    vi.spyOn(files, 'publish').mockImplementation((jobId, gameId) => {
      if (failPublish) throw new Error('controlled late publish failure');
      publish(jobId, gameId);
    });
    const normalize = objects.normalizeAdventureObjectJudgeDecision;
    const split = objects.splitGeneratedAdventureObjectBoard;
    if (mode === 'portrait') {
      vi.spyOn(objects, 'normalizeAdventureObjectJudgeDecision').mockImplementation(
        (value, candidates) => {
          const decision = normalize(value, candidates);
          if (!candidates.some(({ role }) => role === 'key')) return decision;
          // Simulate the live judge recognizing a bust in both NPC cells.
          return normalize(
            {
              ...decision,
              candidateReviews: decision.candidateReviews.map((review) =>
                review.role === 'npc'
                  ? {
                      ...review,
                      npcComplete: false,
                      issues: ['Portrait bust without legs or feet'],
                    }
                  : review,
              ),
            },
            candidates,
          );
        },
      );
    } else {
      vi.spyOn(objects, 'splitGeneratedAdventureObjectBoard').mockImplementation(async (board) => {
        const result = await split(board);
        return { ...result, candidates: result.candidates.filter(({ role }) => role !== 'npc') };
      });
    }
    try {
      const imageRoles: string[] = [];
      const text = new MockProvider('npc-test');
      let rawNpc: Buffer;
      const durable: DurablePipelineCalls = {
        abort: new AbortController(),
        suspended: () => false,
        complete: (_stage, request) => {
          if (
            (request.jsonSchema as { title?: string })?.title ===
            'Adventure themed gameplay-object selection'
          ) {
            expect(request.system).toContain('NPC STRUCTURE GATE');
            expect(request.image).toBeTruthy();
            return Promise.resolve({
              text: JSON.stringify({
                candidateReviews: [
                  {
                    id: 'npc-repair-1',
                    role: 'npc',
                    npcComplete: true,
                    scores: {
                      conceptMatch: 5,
                      worldStyle: 5,
                      silhouette: 5,
                      gameplayReadability: 5,
                      technical: 5,
                    },
                    issues: [],
                    summary: 'Complete grounded body',
                  },
                ],
                selections: [
                  {
                    role: 'npc',
                    candidateId: 'npc-repair-1',
                    confidence: 1,
                    rationale: 'Full body',
                  },
                ],
                setSummary: 'Accepted NPC',
              }),
              usage: { input: 1, output: 1 },
            });
          }
          return text.complete(request);
        },
        image: async (request) => {
          imageRoles.push(request.role);
          if (request.role === 'adventure-npc-repair-1') {
            expect(request.prompt).toContain('two full legs');
            expect(request.reference).toBeTruthy();
            return { image: rawNpc, imageCount: 1 };
          }
          const image = await mockGeneratedImage(request.prompt);
          if (request.role === 'adventure-object-board') {
            const { left, top, width, height } = objects.adventureObjectCellRect(4);
            rawNpc = await sharp(image).extract({ left, top, width, height }).png().toBuffer();
          }
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
        promptText: 'An adventure through a frozen archive',
        requestedArchetype: 'adventure',
        sourceKind: 'preset',
        idempotencyKey: 'npc-body',
      });
      const wait = async () => {
        const deadline = Date.now() + 90_000;
        while (!['done', 'failed', 'canceled'].includes(db.getJob(jobId)!.status)) {
          if (Date.now() > deadline) throw new Error('NPC pipeline timeout');
          await delay(25);
        }
        return db.getJob(jobId)!;
      };
      expect((await wait()).error?.message).toContain('controlled late publish failure');
      expect(imageRoles.filter((role) => role.startsWith('adventure-npc-'))).toEqual([
        'adventure-npc-repair-1',
      ]);
      expect(imageRoles.filter((role) => role === 'adventure-object-board')).toHaveLength(1);
      const before = imageRoles.length;
      failPublish = false;
      runner.retryJob(gameId);
      const retried = await wait();
      expect(retried, JSON.stringify(retried.error)).toMatchObject({ status: 'done', attempt: 2 });
      expect(imageRoles).toHaveLength(before);
      expect(files.readMeta(gameId)?.adventureObjectArt?.mode).toBe('generated');
      expect(network).not.toHaveBeenCalled();
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  },
  120_000,
);
