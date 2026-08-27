import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import {
  GENERATED_GAME_ASSET_FILES,
  type GeneratedGameAssetRole,
  type JobRecord,
} from '@sparkade/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { generatedAssetForRole, readGameAssetManifest, sha256 } from '../src/assets/manifest';
import { GENERATED_FIGHTER_POSES } from '../src/assets/fighter-pose';
import { GenerationRunner } from '../src/pipeline/runner';
import { SseHub } from '../src/pipeline/sse';
import { ConfigStore } from '../src/storage/config';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';

const LIKENESS_ROLES = [
  'generatedPortrait',
  'generatedHead12',
  'generatedHead12Side',
  'generatedHead12Back',
  'generatedHead16',
  'generatedHead16Side',
  'generatedHead16Back',
] as const satisfies readonly GeneratedGameAssetRole[];

const PRESENTATION_ROLES = [
  'keyArt',
  'storyIntro',
  'storyBoss',
  'storyVictory',
] as const satisfies readonly GeneratedGameAssetRole[];

const FIGHTER_ROLES = [
  'fighterIdle',
  'fighterWalk',
  'fighterCrouch',
  'fighterJump',
  'fighterPunchHigh',
  'fighterPunchLow',
  'fighterKickHigh',
  'fighterKickLow',
  'fighterBlock',
  'fighterHit',
  'fighterKo',
] as const satisfies readonly GeneratedGameAssetRole[];

interface Harness {
  root: string;
  db: Db;
  files: GameFiles;
  runner: GenerationRunner;
}

const harnesses: Harness[] = [];
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
  restoreEnv('SPARKADE_PROVIDER', originalEnv.provider);
  restoreEnv('SPARKADE_MOCK_FAST', originalEnv.fast);
  restoreEnv('SPARKADE_GEN_CONCURRENCY', originalEnv.concurrency);
});

afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.db.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function createHarness(filesFactory?: (root: string) => GameFiles): Harness {
  const root = mkdtempSync(join(tmpdir(), 'sparkade-image-pipeline-'));
  const db = new Db(root);
  const files = filesFactory?.(root) ?? new GameFiles(root);
  const runner = new GenerationRunner(db, files, new ConfigStore(root), new SseHub());
  const harness = { root, db, files, runner };
  harnesses.push(harness);
  return harness;
}

async function testPhoto(): Promise<Buffer> {
  const face = await sharp({
    create: { width: 256, height: 256, channels: 4, background: '#7b4d34' },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 96, height: 72, channels: 4, background: '#241a18' },
        })
          .png()
          .toBuffer(),
        left: 80,
        top: 24,
      },
    ])
    .png()
    .toBuffer();
  return face;
}

async function waitForTerminal(db: Db, jobId: string, timeoutMs = 30_000): Promise<JobRecord> {
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

async function expectPublishedPngs(
  files: GameFiles,
  gameId: string,
  expectedRoles: readonly GeneratedGameAssetRole[],
): Promise<void> {
  const assetsDir = join(files.gameDir(gameId), 'assets');
  const manifest = readGameAssetManifest(assetsDir);
  expect(manifest).not.toBeNull();
  expect(manifest!.assets.map((asset) => asset.role).sort()).toEqual([...expectedRoles].sort());

  for (const role of expectedRoles) {
    const entry = generatedAssetForRole(assetsDir, role);
    expect(entry, `${role} must be integrity-checked by its manifest`).not.toBeNull();
    const image = readFileSync(join(assetsDir, GENERATED_GAME_ASSET_FILES[role]));
    const metadata = await sharp(image).metadata();
    expect(metadata.format, `${role} must decode as PNG`).toBe('png');
    expect(metadata.width).toBe(entry!.width);
    expect(metadata.height).toBe(entry!.height);
    expect(sha256(image)).toBe(entry!.sha256);
  }
}

class FailFirstPublishFiles extends GameFiles {
  private shouldFail = true;

  override publish(jobId: string, gameId: string): void {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error('synthetic late publish failure');
    }
    super.publish(jobId, gameId);
  }
}

describe.sequential('mock image asset pipeline', () => {
  it('publishes decodable key/story art, a portrait, and all directional head pairs', async () => {
    const { db, files, runner } = createHarness();
    const { jobId, gameId } = runner.createJob({
      promptText: 'A brave climber restores the stars',
      sourceKind: 'surprise',
      requestedArchetype: 'platformer',
      photo: await testPhoto(),
      idempotencyKey: 'mock-photo-platformer-assets',
    });

    expect(await waitForTerminal(db, jobId)).toMatchObject({ status: 'done' });
    await expectPublishedPngs(files, gameId, [...PRESENTATION_ROLES, ...LIKENESS_ROLES]);

    const manifest = readGameAssetManifest(join(files.gameDir(gameId), 'assets'))!;
    const dimensions = Object.fromEntries(
      manifest.assets.map((asset) => [asset.role, [asset.width, asset.height]]),
    );
    expect(dimensions).toMatchObject({
      keyArt: [480, 270],
      storyIntro: [420, 180],
      storyBoss: [420, 180],
      storyVictory: [420, 180],
      generatedPortrait: [64, 64],
      generatedHead12: [12, 12],
      generatedHead12Side: [12, 12],
      generatedHead12Back: [12, 12],
      generatedHead16: [16, 16],
      generatedHead16Side: [16, 16],
      generatedHead16Back: [16, 16],
    });
    expect(
      db.usageForGame(gameId).filter((event) => event.stage.startsWith('image:') && !event.failed),
    ).toHaveLength(8);
    expect(existsSync(join(files.gameDir(gameId), 'photo.jpg'))).toBe(false);
  });

  it('publishes the complete, distinct 11-pose generated fighter set', async () => {
    const { db, files, runner } = createHarness();
    const { jobId, gameId } = runner.createJob({
      promptText: 'A rooftop martial arts tournament at sunset',
      sourceKind: 'surprise',
      requestedArchetype: 'fighter',
      photo: await testPhoto(),
      idempotencyKey: 'mock-photo-fighter-assets',
    });

    expect(await waitForTerminal(db, jobId)).toMatchObject({ status: 'done' });
    await expectPublishedPngs(files, gameId, [
      ...PRESENTATION_ROLES,
      ...LIKENESS_ROLES,
      ...FIGHTER_ROLES,
    ]);

    const assetsDir = join(files.gameDir(gameId), 'assets');
    const fighterEntries = FIGHTER_ROLES.map((role) => generatedAssetForRole(assetsDir, role)!);
    expect(FIGHTER_ROLES).toHaveLength(GENERATED_FIGHTER_POSES.length);
    expect(new Set(fighterEntries.map((entry) => entry.sha256)).size).toBe(
      GENERATED_FIGHTER_POSES.length,
    );
    expect(fighterEntries.every((entry) => entry.width === 64 && entry.height === 64)).toBe(true);
    expect(files.readMeta(gameId)?.fighterArt).toEqual({
      mode: 'generated',
      attempted: true,
    });
  });

  it('reuses the complete fighter image set on retry after a late failure', async () => {
    const { db, files, runner } = createHarness((root) => new FailFirstPublishFiles(root));
    const { jobId, gameId } = runner.createJob({
      promptText: 'A moonlit castle martial arts tournament',
      sourceKind: 'surprise',
      requestedArchetype: 'fighter',
      photo: await testPhoto(),
      idempotencyKey: 'mock-photo-fighter-retry-cache',
    });

    const firstAttempt = await waitForTerminal(db, jobId);
    expect(firstAttempt).toMatchObject({ status: 'failed', attempt: 1 });
    expect(firstAttempt.error?.message).toContain('synthetic late publish failure');
    const successfulImagesBeforeRetry = db
      .usageForGame(gameId)
      .filter((event) => event.stage.startsWith('image:') && !event.failed);
    expect(successfulImagesBeforeRetry).toHaveLength(19);

    expect(runner.retryJob(gameId)).toEqual({ jobId });
    expect(await waitForTerminal(db, jobId)).toMatchObject({ status: 'done', attempt: 2 });
    const successfulImagesAfterRetry = db
      .usageForGame(gameId)
      .filter((event) => event.stage.startsWith('image:') && !event.failed);
    expect(successfulImagesAfterRetry).toHaveLength(successfulImagesBeforeRetry.length);
    await expectPublishedPngs(files, gameId, [
      ...PRESENTATION_ROLES,
      ...LIKENESS_ROLES,
      ...FIGHTER_ROLES,
    ]);
  });
});
