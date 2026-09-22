import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import { buildCharacterArtReference } from '../src/assets/character-reference';
import { mockGeneratedImage, normalizeKeyArt, prepareImageReference } from '../src/assets/game-art';
import { buildPlatformerIdleJudgePrompt } from '../src/assets/platformer-idle-judge';
import { buildPlatformerJumpJudgePrompt } from '../src/assets/platformer-jump-judge';
import { buildPlatformerPoseJudgePrompt } from '../src/assets/platformer-pose-judge';
import { buildFighterIdentityJudgePrompt } from '../src/assets/fighter-pose-judge';
import { GenerationRunner } from '../src/pipeline/runner';
import type { DurablePipelineCalls, DurableImageRequest } from '../src/pipeline/durable';
import { SseHub } from '../src/pipeline/sse';
import { MockProvider } from '../src/providers/mock';
import { ConfigStore } from '../src/storage/config';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';

// Capture the real pipeline's provider boundary, including cache/resume paths.
// Generation stays local; semantic prompt contracts are checked separately below.
it.each([
  ['platformer', true],
  ['platformer', false],
  ['fighter', true],
  ['fighter', false],
] as const)(
  'shares canonical character artwork through %s generation and retry (photo=%s)',
  async (archetype, hasPhoto) => {
    vi.stubEnv('SPARKADE_PROVIDER', 'mock');
    vi.stubEnv('SPARKADE_MOCK_FAST', '1');
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('No network in this test'));
    const root = mkdtempSync(join(tmpdir(), 'sparkade-character-reference-'));
    const db = new Db(root);
    const files = new GameFiles(root);
    let failPublish = true;
    const publish = files.publish.bind(files);
    vi.spyOn(files, 'publish').mockImplementation((jobId, gameId) => {
      if (failPublish) throw new Error('controlled late publish failure');
      publish(jobId, gameId);
    });
    try {
      const photo = hasPhoto
        ? await sharp({ create: { width: 80, height: 160, channels: 3, background: '#e23659' } })
            .png()
            .toBuffer()
        : undefined;
      const normalizedPhoto = photo ? await prepareImageReference(photo) : undefined;
      const calls: DurableImageRequest[] = [];
      let keyArt: Buffer | undefined;
      const text = new MockProvider('character-reference-test');
      const durable: DurablePipelineCalls = {
        abort: new AbortController(),
        suspended: () => false,
        complete: (_stage, request) => text.complete(request),
        image: async (request) => {
          calls.push(request);
          const generated = await mockGeneratedImage(request.prompt);
          if (request.role === 'keyArt') keyArt = await normalizeKeyArt(generated);
          return { image: generated, imageCount: 1 };
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
          archetype === 'platformer'
            ? 'A rooftop platforming adventure'
            : 'A rooftop martial arts tournament',
        requestedArchetype: archetype,
        sourceKind: 'preset',
        ...(photo ? { photo } : {}),
        idempotencyKey: 'character-reference',
      });
      const wait = async () => {
        const deadline = Date.now() + 90_000;
        while (!['done', 'failed', 'canceled'].includes(db.getJob(jobId)!.status)) {
          if (Date.now() > deadline) throw new Error('Pipeline did not finish');
          await delay(25);
        }
        return db.getJob(jobId)!;
      };
      const first = await wait();
      expect(first.error?.message).toContain('controlled late publish failure');
      expect(keyArt).toBeTruthy();
      const expectedReference = await buildCharacterArtReference(keyArt!, normalizedPhoto);
      const foundations = calls.filter(({ role }) =>
        archetype === 'platformer'
          ? /^platformer-I\d+$/.test(role)
          : /^fighter-player-I\d+$/.test(role),
      );
      expect(foundations.length).toBeGreaterThanOrEqual(3);
      for (const request of foundations) {
        expect(request.reference).toEqual(expectedReference);
        expect(request.prompt).toContain(
          hasPhoto
            ? 'LEFT is the exact player photo'
            : 'SOURCE KEY ART is the canonical PLAYER HERO',
        );
        expect(request.prompt).toContain('wardrobe and rendering-style truth');
        expect(calls.indexOf(request)).toBeGreaterThan(
          calls.findIndex(({ role }) => role === 'keyArt'),
        );
      }
      const portraits = calls.filter(({ role }) => ['portrait', 'portrait-defeat'].includes(role));
      expect(portraits).toHaveLength(hasPhoto ? 2 : 0);
      for (const portrait of portraits) expect(portrait.reference).toEqual(expectedReference);
      const scenes = calls.filter(({ role }) => /^story(Intro|Boss|Victory|Defeat)$/.test(role));
      expect(scenes).toHaveLength(4);
      for (const scene of scenes) expect(scene.reference).toEqual(keyArt);
      if (archetype === 'fighter') {
        const opponents = calls.filter(({ role }) => /^fighter-opponent\d-I\d+$/.test(role));
        expect(opponents).toHaveLength(9);
        for (const opponent of opponents) {
          expect(opponent.reference).toEqual(keyArt);
          expect(opponent.prompt).not.toContain('LEFT is the exact player photo');
        }
      }
      const beforeRetry = calls.length;
      failPublish = false;
      runner.retryJob(gameId);
      const retried = await wait();
      expect(retried, JSON.stringify(retried.error)).toMatchObject({ status: 'done', attempt: 2 });
      expect(calls).toHaveLength(beforeRetry);
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

it('makes gameplay review compare the artwork wardrobe and photo likeness separately', () => {
  const candidates = [{ id: 'I1' }];
  const prompts = [
    buildPlatformerIdleJudgePrompt(candidates, { sourceKind: 'character-art' }),
    buildPlatformerJumpJudgePrompt(candidates, { sourceKind: 'character-art' }),
    buildPlatformerPoseJudgePrompt([{ id: 'A1', kind: 'phase-a' }], 'character-art'),
  ];
  for (const prompt of prompts) {
    expect(prompt.system).toContain('LEFT is the exact player photo');
    expect(prompt.system).toContain('RIGHT is the canonical key-art PLAYER HERO');
    expect(prompt.system).toContain('wardrobe and rendering-style truth');
  }
  expect(buildFighterIdentityJudgePrompt([]).system).toContain(
    'For the PLAYER slot, KEY ART is the canonical wardrobe',
  );
});
