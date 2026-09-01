import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import {
  GENERATED_GAME_ASSET_FILES,
  type GameSpec,
  type GeneratedGameAssetRole,
  type JobRecord,
  type PlatformerSpec,
} from '@sparkade/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  GameAssetWorkspace,
  generatedAssetForRole,
  readGameAssetManifest,
  sha256,
} from '../src/assets/manifest';
import { GENERATED_FIGHTER_POSES } from '../src/assets/fighter-pose';
import {
  buildKeyArtPrompt,
  buildKeyArtPolicyFallbackPrompt,
  buildStoryArtPolicyFallbackPrompt,
  buildStoryArtPrompt,
} from '../src/assets/game-art';
import { GenerationRunner } from '../src/pipeline/runner';
import { SseHub } from '../src/pipeline/sse';
import { ConfigStore } from '../src/storage/config';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';

const PORTRAIT_ROLES = [
  'generatedPortrait',
  'generatedPortraitDefeat',
] as const satisfies readonly GeneratedGameAssetRole[];

const HEAD_ROLES = [
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
  'storyDefeat',
] as const satisfies readonly GeneratedGameAssetRole[];

const HSHOOTER_CRAFT_ROLES = [
  'hshooterPlayerCraft',
] as const satisfies readonly GeneratedGameAssetRole[];

const HSHOOTER_BOSS_ROLES = ['hshooterBoss'] as const satisfies readonly GeneratedGameAssetRole[];

const HSHOOTER_ENEMY_ROLES = [
  'hshooterEnemyAtlas',
] as const satisfies readonly GeneratedGameAssetRole[];

const SHOOTER_CRAFT_ROLES = [
  'shooterPlayerCraft',
] as const satisfies readonly GeneratedGameAssetRole[];

const SHOOTER_BOSS_ROLES = ['shooterBoss'] as const satisfies readonly GeneratedGameAssetRole[];

const SHOOTER_ENEMY_ROLES = [
  'shooterEnemyAtlas',
] as const satisfies readonly GeneratedGameAssetRole[];

const HSHOOTER_BACKDROP_ROLES = [
  'hshooterBackdropLevel1',
  'hshooterBackdropLevel2',
  'hshooterBackdropLevel3',
  'hshooterBackdropBoss',
] as const satisfies readonly GeneratedGameAssetRole[];

const SHOOTER_BACKDROP_ROLES = [
  'shooterBackdropLevel1',
  'shooterBackdropLevel2',
  'shooterBackdropLevel3',
  'shooterBackdropBoss',
] as const satisfies readonly GeneratedGameAssetRole[];

const FIGHTER_ROLES = [
  'fighterPlayerAtlas',
  'fighterOpponent1Atlas',
  'fighterOpponent2Atlas',
  'fighterOpponent3Atlas',
  'fighterBossAtlas',
] as const satisfies readonly GeneratedGameAssetRole[];

const FIGHTER_ARENA_ROLES = [
  'fighterArenaAtlas',
] as const satisfies readonly GeneratedGameAssetRole[];

const PLATFORMER_ROLES = [
  'platformerIdle',
  'platformerSideIdle',
  'platformerWalk1',
  'platformerWalk2',
  'platformerJump',
] as const satisfies readonly GeneratedGameAssetRole[];

const PLATFORMER_BOSS_ROLES = [
  'platformerBoss',
] as const satisfies readonly GeneratedGameAssetRole[];

const PLATFORMER_ENEMY_ROLES = [
  'platformerEnemyWalker',
  'platformerEnemyFlyer',
  'platformerEnemyShooter',
  'platformerEnemyChaser',
] as const satisfies readonly GeneratedGameAssetRole[];

const PLATFORMER_PROP_ROLES = [
  'platformerPropCollectible',
  'platformerPropHealth',
  'platformerPropPowerup',
  'platformerPropHeroProjectile',
  'platformerPropEnemyProjectile',
] as const satisfies readonly GeneratedGameAssetRole[];

const PLATFORMER_BACKDROP_ROLES = [
  'platformerBackdropLevel1',
  'platformerBackdropLevel2',
  'platformerBackdropLevel3',
  'platformerBackdropBoss',
] as const satisfies readonly GeneratedGameAssetRole[];

const ADVENTURE_ROOM_PLATE_ROLES = [
  'adventureRoomPlates',
] as const satisfies readonly GeneratedGameAssetRole[];

const ADVENTURE_BOSS_ROLES = ['adventureBoss'] as const satisfies readonly GeneratedGameAssetRole[];

const ADVENTURE_ENEMY_ROLES = [
  'adventureEnemyAtlas',
] as const satisfies readonly GeneratedGameAssetRole[];

const ADVENTURE_OBJECT_ROLES = [
  'adventureObjectAtlas',
] as const satisfies readonly GeneratedGameAssetRole[];

const ADVENTURE_PLAYER_ROLES = [
  'adventurePlayerDownIdle',
  'adventurePlayerDownWalk',
  'adventurePlayerUpIdle',
  'adventurePlayerUpWalk',
  'adventurePlayerSideIdle',
  'adventurePlayerSideWalk',
  'adventurePlayerDownMelee',
  'adventurePlayerUpMelee',
  'adventurePlayerSideMelee',
  'adventurePlayerDownSecondary',
  'adventurePlayerUpSecondary',
  'adventurePlayerSideSecondary',
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

describe('story art prompts', () => {
  it('shares one story-specific wardrobe between key art and story scenes', () => {
    const spec = JSON.parse(
      readFileSync(
        join(process.cwd(), 'packages/generation/golden/golden-platformer.json'),
        'utf8',
      ),
    ) as GameSpec;
    const wardrobe = 'a silver pressure suit with cobalt panels and magnetic boots';

    const keyArt = buildKeyArtPrompt(spec, true, wardrobe);
    const story = buildStoryArtPrompt(spec, 'intro', wardrobe);

    expect(keyArt).toContain('immutable identity truth from the neck up');
    expect(keyArt).toContain('source photo clothing below the neck is NOT identity');
    expect(keyArt).toContain(wardrobe);
    expect(keyArt).toContain('middle 60% of the image height');
    expect(keyArt).toContain('outer 20% at both the top and bottom');
    expect(story).toContain(wardrobe);
    expect(story).toContain('exact same player hero identity, costume');
  });

  it('turns the authored defeat beat into a safe, emotionally specific scene', () => {
    const spec = JSON.parse(
      readFileSync(
        join(process.cwd(), 'packages/generation/golden/golden-platformer.json'),
        'utf8',
      ),
    ) as GameSpec;
    spec.story.defeat = ['The moon gate closes and the hero worries for the village.'];

    const prompt = buildStoryArtPrompt(spec, 'defeat');

    expect(prompt).toContain('The moon gate closes and the hero worries for the village.');
    expect(prompt).toMatch(/upset, worried, disappointed, or sad/);
    expect(prompt).toContain('No wounds, gore, death');
  });

  it('keeps the H-scroll pilot and craft separate without enlarging the runtime sprite', () => {
    const spec = JSON.parse(
      readFileSync(join(process.cwd(), 'packages/generation/golden/golden-hshooter.json'), 'utf8'),
    ) as Extract<GameSpec, { archetype: 'hshooter' }>;
    const craft = spec.playerCraft!;
    const keyArt = buildKeyArtPrompt(spec, true, spec.meta.heroConcept, craft);
    const story = buildStoryArtPrompt(spec, 'intro', spec.meta.heroConcept, craft);

    expect(keyArt).toContain('TOP PANEL');
    expect(keyArt).toContain('presentation-scale identity reference');
    expect(keyArt).toContain(craft.visualConcept);
    expect(keyArt).toContain('RE-RENDER the vehicle naturally inside the scene');
    expect(keyArt).toContain('Do not paste, trace, enlarge');
    expect(keyArt).toContain('never put the pilot face, head, or body onto the vehicle');
    expect(story).toContain('presentation-scale identity reference');
    expect(story).toContain("RE-RENDER it naturally at the scene's scale");
    expect(story).toContain('Do not paste, trace, enlarge');
    expect(story).toContain("Never place the pilot's face or body onto the craft");
  });

  it('keeps the Fighter player outfit and roster aesthetic immutable across presentation art', () => {
    const spec = JSON.parse(
      readFileSync(join(process.cwd(), 'packages/generation/golden/golden-fighter.json'), 'utf8'),
    ) as Extract<GameSpec, { archetype: 'fighter' }>;
    const keyArt = buildKeyArtPrompt(spec, true, spec.meta.heroConcept);
    const story = buildStoryArtPrompt(spec, 'intro', spec.meta.heroConcept);

    expect(spec.meta.heroConcept).toBe(spec.player.visualConcept);
    expect(keyArt).toContain(spec.player.visualConcept);
    expect(story).toContain(spec.player.visualConcept);
    expect(keyArt).toContain(spec.artDirection.proportions);
    expect(story).toContain(spec.artDirection.rendering);
  });

  it('treats the selected Adventure gameplay hero as story identity and wardrobe truth', () => {
    const spec = JSON.parse(
      readFileSync(join(process.cwd(), 'packages/generation/golden/golden-adventure.json'), 'utf8'),
    ) as Extract<GameSpec, { archetype: 'adventure' }>;

    const story = buildStoryArtPrompt(spec, 'intro', spec.meta.heroConcept, undefined, true);
    const fallback = buildStoryArtPolicyFallbackPrompt(
      spec,
      'intro',
      spec.meta.heroConcept,
      undefined,
      true,
    );

    expect(story).toContain('BOTTOM PANEL is the exact selected gameplay hero');
    expect(story).toContain('head identity, head accessories, and neck-down wardrobe truth');
    expect(fallback).toContain('BOTTOM PANEL as the exact selected gameplay hero');
  });

  it('provides policy-safe presentation prompts without replaying authored danger text', () => {
    const spec = JSON.parse(
      readFileSync(
        join(process.cwd(), 'packages/generation/golden/golden-platformer.json'),
        'utf8',
      ),
    ) as GameSpec;
    spec.story.defeat = ['The vines draw you down into the abyss.'];

    const keyArt = buildKeyArtPolicyFallbackPrompt(spec, true, 'a safe expedition jacket');
    const defeat = buildStoryArtPolicyFallbackPrompt(spec, 'defeat');

    expect(keyArt).toContain('adult person');
    expect(keyArt).toContain('safe expedition jacket');
    expect(defeat).toContain('resting safely');
    expect(`${keyArt} ${defeat}`).not.toMatch(/abyss|danger|wounds|gore|death/i);
  });
});

describe.sequential('mock image asset pipeline', () => {
  it('publishes the room atlas, complete movement/combat player set, and selected boss for Adventure games', async () => {
    const { db, files, runner } = createHarness();
    const { jobId, gameId } = runner.createJob({
      promptText: 'A diver relights a drowned clockwork observatory',
      sourceKind: 'surprise',
      requestedArchetype: 'adventure',
      idempotencyKey: 'mock-adventure-room-plates',
    });

    expect(await waitForTerminal(db, jobId)).toMatchObject({ status: 'done' });
    const feed = db.generationEventsForJob(jobId);
    expect(feed[0]).toMatchObject({ kind: 'progress', stage: 'queued', attempt: 1 });
    expect(feed.some((event) => event.kind === 'decision' && event.payload?.['title'])).toBe(true);
    expect(
      feed.some(
        (event) => event.kind === 'asset' && event.payload?.['filename'] === 'story-intro.png',
      ),
    ).toBe(true);
    expect(feed.at(-1)).toMatchObject({ kind: 'complete', stage: 'done' });
    expect(files.readMeta(gameId)?.adventureRoomPlateArt).toEqual({
      mode: 'generated',
      attempted: true,
    });
    expect(files.readMeta(gameId)?.adventurePlayerArt).toEqual({
      mode: 'generated',
      attempted: true,
    });
    expect(files.readMeta(gameId)?.adventureBossArt).toEqual({
      mode: 'generated',
      attempted: true,
    });
    expect(files.readMeta(gameId)?.adventureEnemyArt).toEqual({
      mode: 'generated',
      attempted: true,
      roles: ['walker', 'flyer', 'shooter', 'chaser', 'bruiser'],
    });
    expect(files.readMeta(gameId)?.adventureObjectArt).toEqual({
      mode: 'generated',
      attempted: true,
      roles: ['key', 'item', 'npc', 'secondaryEffect', 'block', 'switchRaised', 'switchPressed'],
    });
    await expectPublishedPngs(files, gameId, [
      ...PRESENTATION_ROLES,
      ...ADVENTURE_ROOM_PLATE_ROLES,
      ...ADVENTURE_BOSS_ROLES,
      ...ADVENTURE_ENEMY_ROLES,
      ...ADVENTURE_OBJECT_ROLES,
      ...ADVENTURE_PLAYER_ROLES,
    ]);
    expect(
      generatedAssetForRole(join(files.gameDir(gameId), 'assets'), 'adventureRoomPlates'),
    ).toMatchObject({
      width: 2048,
      height: 1024,
    });
    for (const role of ADVENTURE_PLAYER_ROLES) {
      expect(generatedAssetForRole(join(files.gameDir(gameId), 'assets'), role)).toMatchObject({
        width: 112,
        height: 128,
      });
    }
    expect(
      generatedAssetForRole(join(files.gameDir(gameId), 'assets'), 'adventureBoss'),
    ).toMatchObject({
      width: 192,
      height: 224,
    });
    expect(
      generatedAssetForRole(join(files.gameDir(gameId), 'assets'), 'adventureEnemyAtlas'),
    ).toMatchObject({
      width: 480,
      height: 96,
    });
    expect(
      generatedAssetForRole(join(files.gameDir(gameId), 'assets'), 'adventureObjectAtlas'),
    ).toMatchObject({
      width: 672,
      height: 112,
    });
    const successfulImageStages = db
      .usageForGame(gameId)
      .filter((event) => event.stage.startsWith('image:') && !event.failed)
      .map(({ stage }) => stage);
    expect(successfulImageStages).toHaveLength(14);
    expect(
      successfulImageStages.filter((stage) => stage.includes('adventure-boss-board')),
    ).toHaveLength(1);
    expect(successfulImageStages.some((stage) => stage.includes('adventure-boss-retry'))).toBe(
      false,
    );
    expect(
      successfulImageStages.filter((stage) => stage.includes('adventure-player-sheet-')),
    ).toHaveLength(2);
    expect(
      successfulImageStages.filter((stage) => stage.includes('adventure-enemy-board')),
    ).toHaveLength(1);
    expect(
      successfulImageStages.filter((stage) => stage.includes('adventure-object-board')),
    ).toHaveLength(1);
    expect(
      successfulImageStages.some((stage) => stage.includes('adventure-player-downWalk-')),
    ).toBe(false);
  });

  it('uses photo identity for the Adventure player without publishing legacy heads', async () => {
    const { db, files, runner } = createHarness();
    const { jobId, gameId } = runner.createJob({
      promptText: 'A bespectacled navigator repairs a flooded moon observatory',
      sourceKind: 'surprise',
      requestedArchetype: 'adventure',
      photo: await testPhoto(),
      idempotencyKey: 'mock-photo-adventure-player',
    });

    expect(await waitForTerminal(db, jobId)).toMatchObject({ status: 'done' });
    expect(files.readMeta(gameId)?.adventurePlayerArt).toEqual({
      mode: 'generated',
      attempted: true,
    });
    await expectPublishedPngs(files, gameId, [
      ...PRESENTATION_ROLES,
      ...PORTRAIT_ROLES,
      ...ADVENTURE_ROOM_PLATE_ROLES,
      ...ADVENTURE_BOSS_ROLES,
      ...ADVENTURE_ENEMY_ROLES,
      ...ADVENTURE_OBJECT_ROLES,
      ...ADVENTURE_PLAYER_ROLES,
    ]);
    const manifest = readGameAssetManifest(join(files.gameDir(gameId), 'assets'))!;
    expect(
      manifest.assets.some(({ role }) => HEAD_ROLES.includes(role as (typeof HEAD_ROLES)[number])),
    ).toBe(false);
    const successfulImageStages = db
      .usageForGame(gameId)
      .filter((event) => event.stage.startsWith('image:') && !event.failed)
      .map(({ stage }) => stage);
    expect(successfulImageStages).toHaveLength(16);
    expect(
      successfulImageStages.filter((stage) => stage.includes('adventure-player-sheet-')),
    ).toHaveLength(2);
    const messages = db.generationEventsForJob(jobId).map((event) => event.message);
    expect(messages.indexOf('Player portrait')).toBeGreaterThan(
      messages.indexOf('Finished the generated Adventure player'),
    );
  });

  it('retries an incomplete Adventure player from healthy pose checkpoints in the same feed', async () => {
    const originalStore = GameAssetWorkspace.prototype.store;
    let failOnePoseCheckpoint = true;
    const storeSpy = vi
      .spyOn(GameAssetWorkspace.prototype, 'store')
      .mockImplementation(async function (
        this: GameAssetWorkspace,
        role,
        image,
        promptVersion,
        promptSha256,
      ) {
        if (role === 'adventurePlayerSideSecondary' && failOnePoseCheckpoint) {
          failOnePoseCheckpoint = false;
          throw new Error('synthetic Adventure pose checkpoint failure');
        }
        return originalStore.call(this, role, image, promptVersion, promptSha256);
      });
    try {
      const { db, files, runner } = createHarness();
      const { jobId, gameId } = runner.createJob({
        promptText: 'A surveyor maps a clockwork desert with a long brass staff',
        sourceKind: 'surprise',
        requestedArchetype: 'adventure',
        idempotencyKey: 'mock-adventure-partial-player-retry-cache',
      });

      expect(await waitForTerminal(db, jobId)).toMatchObject({ status: 'failed', attempt: 1 });
      await delay(50);
      const stagingManifest = readGameAssetManifest(join(files.stagingFor(jobId), 'assets'))!;
      const cachedPlayerRoles = stagingManifest.assets.filter(({ role }) =>
        ADVENTURE_PLAYER_ROLES.includes(role as (typeof ADVENTURE_PLAYER_ROLES)[number]),
      );
      expect(cachedPlayerRoles.length).toBeGreaterThan(0);
      expect(cachedPlayerRoles.length).toBeLessThan(ADVENTURE_PLAYER_ROLES.length);
      const playerImagesBeforeRetry = db
        .usageForGame(gameId)
        .filter((event) => event.stage.startsWith('image:adventure-player-') && !event.failed);

      storeSpy.mockRestore();
      expect(runner.retryJob(gameId)).toEqual({ jobId });
      expect(await waitForTerminal(db, jobId)).toMatchObject({ status: 'done', attempt: 2 });

      const playerImagesAfterRetry = db
        .usageForGame(gameId)
        .filter((event) => event.stage.startsWith('image:adventure-player-') && !event.failed);
      const retryPlayerStages = playerImagesAfterRetry
        .slice(playerImagesBeforeRetry.length)
        .map(({ stage }) => stage);
      expect(retryPlayerStages).toHaveLength(
        ADVENTURE_PLAYER_ROLES.length - cachedPlayerRoles.length,
      );
      expect(retryPlayerStages.some((stage) => /adventure-player-I\d/.test(stage))).toBe(false);
      expect(
        retryPlayerStages.some((stage) => /adventure-player-sheet-(movement|combat)/.test(stage)),
      ).toBe(false);

      const feed = db.generationEventsForJob(jobId);
      expect(feed.some((event) => event.attempt === 1 && event.kind === 'failure')).toBe(true);
      expect(
        feed.some(
          (event) =>
            event.attempt === 2 &&
            event.kind === 'progress' &&
            event.message.includes('restoring completed work'),
        ),
      ).toBe(true);
      expect(feed.at(-1)).toMatchObject({ attempt: 2, kind: 'complete', stage: 'done' });
    } finally {
      storeSpy.mockRestore();
    }
  });

  it('publishes key/story art and portraits without redundant heads when full-body art succeeds', async () => {
    const { db, files, runner } = createHarness();
    const { jobId, gameId } = runner.createJob({
      promptText: 'A brave climber restores the stars',
      sourceKind: 'surprise',
      requestedArchetype: 'platformer',
      photo: await testPhoto(),
      idempotencyKey: 'mock-photo-platformer-assets',
    });

    expect(await waitForTerminal(db, jobId)).toMatchObject({ status: 'done' });
    expect(files.readSpec(gameId)?.meta.heroConcept).toBe(
      'An indigo expedition jacket with brass fasteners, sturdy tan trousers, and dark trail boots',
    );
    expect((files.readSpec(gameId) as PlatformerSpec | null)?.movementProfile).toBe('precision');
    expect(files.readMeta(gameId)?.platformerPlayerArt).toEqual({
      mode: 'generated',
      attempted: true,
    });
    expect(files.readMeta(gameId)?.platformerBossArt).toEqual({
      mode: 'generated',
      attempted: true,
    });
    expect(files.readMeta(gameId)?.platformerEnemyArt).toEqual({
      mode: 'generated',
      attempted: true,
      generatedRoles: ['walker', 'flyer', 'shooter', 'chaser'],
    });
    expect(files.readMeta(gameId)?.platformerPropArt).toEqual({
      mode: 'generated',
      attempted: true,
      generatedRoles: ['collectible', 'health', 'powerup', 'heroProjectile', 'enemyProjectile'],
    });
    expect(files.readMeta(gameId)?.platformerBackdropArt).toEqual({
      mode: 'generated',
      attempted: true,
      generatedRoles: ['level1', 'level2', 'level3', 'boss'],
    });
    await expectPublishedPngs(files, gameId, [
      ...PRESENTATION_ROLES,
      ...PORTRAIT_ROLES,
      ...PLATFORMER_ROLES,
      ...PLATFORMER_BOSS_ROLES,
      ...PLATFORMER_ENEMY_ROLES,
      ...PLATFORMER_PROP_ROLES,
      ...PLATFORMER_BACKDROP_ROLES,
    ]);

    const manifest = readGameAssetManifest(join(files.gameDir(gameId), 'assets'))!;
    const dimensions = Object.fromEntries(
      manifest.assets.map((asset) => [asset.role, [asset.width, asset.height]]),
    );
    expect(dimensions).toMatchObject({
      keyArt: [480, 270],
      storyIntro: [420, 180],
      storyBoss: [420, 180],
      storyVictory: [420, 180],
      storyDefeat: [420, 180],
      generatedPortrait: [64, 64],
      generatedPortraitDefeat: [64, 64],
      platformerIdle: [112, 128],
      platformerSideIdle: [112, 128],
      platformerWalk1: [112, 128],
      platformerWalk2: [112, 128],
      platformerJump: [112, 128],
      platformerBoss: [192, 192],
      platformerEnemyWalker: [96, 96],
      platformerEnemyFlyer: [96, 96],
      platformerEnemyShooter: [96, 96],
      platformerEnemyChaser: [96, 96],
      platformerPropCollectible: [48, 48],
      platformerPropHealth: [48, 48],
      platformerPropPowerup: [48, 48],
      platformerPropHeroProjectile: [32, 32],
      platformerPropEnemyProjectile: [32, 32],
      platformerBackdropLevel1: [1536, 600],
      platformerBackdropLevel2: [1536, 600],
      platformerBackdropLevel3: [1536, 600],
      platformerBackdropBoss: [1536, 600],
    });
    expect(HEAD_ROLES.some((role) => role in dimensions)).toBe(false);
    expect(
      db.usageForGame(gameId).filter((event) => event.stage.startsWith('image:') && !event.failed),
    ).toHaveLength(40);
    expect(existsSync(join(files.gameDir(gameId), 'photo.jpg'))).toBe(false);
  });

  it('reuses the Spark-selected five-frame platformer set on retry after a late failure', async () => {
    const { db, files, runner } = createHarness((root) => new FailFirstPublishFiles(root));
    const { jobId, gameId } = runner.createJob({
      promptText: 'A brave climber restores the stars',
      sourceKind: 'surprise',
      requestedArchetype: 'platformer',
      photo: await testPhoto(),
      idempotencyKey: 'mock-photo-platformer-retry-cache',
    });

    const firstAttempt = await waitForTerminal(db, jobId);
    expect(firstAttempt).toMatchObject({ status: 'failed', attempt: 1 });
    expect(firstAttempt.error?.message).toContain('synthetic late publish failure');
    expect(files.readValidatedSpecCheckpoint(jobId, 1)?.spec.meta.title).toBeTruthy();
    const successfulImagesBeforeRetry = db
      .usageForGame(gameId)
      .filter((event) => event.stage.startsWith('image:') && !event.failed);
    expect(successfulImagesBeforeRetry).toHaveLength(40);

    expect(runner.retryJob(gameId)).toEqual({ jobId });
    expect(await waitForTerminal(db, jobId)).toMatchObject({ status: 'done', attempt: 2 });
    expect(files.listRawStageCheckpoints(jobId, 2).map(({ stage }) => stage)).toEqual(['design']);
    expect(files.readValidatedSpecCheckpoint(jobId, 2)?.spec.meta.title).toBeTruthy();
    const successfulImagesAfterRetry = db
      .usageForGame(gameId)
      .filter((event) => event.stage.startsWith('image:') && !event.failed);
    expect(successfulImagesAfterRetry).toHaveLength(successfulImagesBeforeRetry.length);
    await expectPublishedPngs(files, gameId, [
      ...PRESENTATION_ROLES,
      ...PORTRAIT_ROLES,
      ...PLATFORMER_ROLES,
      ...PLATFORMER_BOSS_ROLES,
      ...PLATFORMER_ENEMY_ROLES,
      ...PLATFORMER_PROP_ROLES,
      ...PLATFORMER_BACKDROP_ROLES,
    ]);
  });

  it('publishes H-scroll craft and stage art without directional gameplay heads', async () => {
    const { db, files, runner } = createHarness();
    const { jobId, gameId } = runner.createJob({
      promptText: 'A trench pilot races an alien current in a signature cobalt skiff',
      sourceKind: 'surprise',
      requestedArchetype: 'hshooter',
      photo: await testPhoto(),
      idempotencyKey: 'mock-photo-hshooter-craft-assets',
    });

    expect(await waitForTerminal(db, jobId)).toMatchObject({ status: 'done' });
    const spec = files.readSpec(gameId) as Extract<GameSpec, { archetype: 'hshooter' }>;
    expect(spec.playerCraft.visualConcept).toContain('Rift Skiff');
    expect(files.readMeta(gameId)?.hshooterPlayerCraftArt).toEqual({
      mode: 'generated',
      attempted: true,
    });
    expect(files.readMeta(gameId)?.hshooterBackdropArt).toEqual({
      mode: 'generated',
      attempted: true,
      generatedRoles: ['level1', 'level2', 'level3', 'boss'],
    });
    expect(files.readMeta(gameId)?.hshooterBossArt).toEqual({
      mode: 'generated',
      attempted: true,
    });
    expect(spec.hshooterEnemyArtVersion).toBe(1);
    expect(files.readMeta(gameId)?.hshooterEnemyArt).toEqual({
      mode: 'generated',
      attempted: true,
      roles: ['popcorn', 'weaver', 'tank', 'turret', 'kamikaze'],
    });
    await expectPublishedPngs(files, gameId, [
      ...PRESENTATION_ROLES,
      ...PORTRAIT_ROLES,
      ...HSHOOTER_CRAFT_ROLES,
      ...HSHOOTER_BOSS_ROLES,
      ...HSHOOTER_ENEMY_ROLES,
      ...HSHOOTER_BACKDROP_ROLES,
    ]);

    const craft = generatedAssetForRole(
      join(files.gameDir(gameId), 'assets'),
      'hshooterPlayerCraft',
    );
    expect(craft).toMatchObject({ width: 96, height: 64 });
    expect(
      generatedAssetForRole(join(files.gameDir(gameId), 'assets'), 'hshooterBoss'),
    ).toMatchObject({ width: 192, height: 128 });
    expect(
      generatedAssetForRole(join(files.gameDir(gameId), 'assets'), 'hshooterEnemyAtlas'),
    ).toMatchObject({ width: 480, height: 96 });
    expect(
      HSHOOTER_BACKDROP_ROLES.map((role) =>
        generatedAssetForRole(join(files.gameDir(gameId), 'assets'), role),
      ),
    ).toEqual(
      HSHOOTER_BACKDROP_ROLES.map(() => expect.objectContaining({ width: 1536, height: 600 })),
    );
    expect(
      HEAD_ROLES.some((role) => generatedAssetForRole(join(files.gameDir(gameId), 'assets'), role)),
    ).toBe(false);
    expect(existsSync(join(files.gameDir(gameId), 'assets', '.hshooter-craft-reference.png'))).toBe(
      false,
    );
    expect(
      db.usageForGame(gameId).filter((event) => event.stage.startsWith('image:') && !event.failed),
    ).toHaveLength(18);
  });

  it('publishes the selected top-down craft, boss, enemy cast, and flyover plates for vertical shooters', async () => {
    const { db, files, runner } = createHarness();
    const { jobId, gameId } = runner.createJob({
      promptText: 'A flower-shaped interceptor defends a floating garden',
      sourceKind: 'surprise',
      requestedArchetype: 'shooter',
      idempotencyKey: 'mock-shooter-generated-craft-assets',
    });

    expect(await waitForTerminal(db, jobId)).toMatchObject({ status: 'done' });
    const spec = files.readSpec(gameId) as Extract<GameSpec, { archetype: 'shooter' }>;
    expect(spec.playerCraft.visualConcept.length).toBeGreaterThan(20);
    expect(spec.shooterGameplayArtVersion).toBe(1);
    expect(files.readMeta(gameId)?.shooterPlayerCraftArt).toEqual({
      mode: 'generated',
      attempted: true,
    });
    expect(files.readMeta(gameId)?.shooterBossArt).toEqual({
      mode: 'generated',
      attempted: true,
    });
    expect(files.readMeta(gameId)?.shooterEnemyArt).toEqual({
      mode: 'generated',
      attempted: true,
      roles: ['popcorn', 'weaver', 'tank', 'turret', 'kamikaze'],
    });
    expect(files.readMeta(gameId)?.shooterBackdropArt).toEqual({
      mode: 'generated',
      attempted: true,
      generatedRoles: ['level1', 'level2', 'level3', 'boss'],
    });
    await expectPublishedPngs(files, gameId, [
      ...PRESENTATION_ROLES,
      ...SHOOTER_CRAFT_ROLES,
      ...SHOOTER_BOSS_ROLES,
      ...SHOOTER_ENEMY_ROLES,
      ...SHOOTER_BACKDROP_ROLES,
    ]);
    expect(
      generatedAssetForRole(join(files.gameDir(gameId), 'assets'), 'shooterPlayerCraft'),
    ).toMatchObject({ width: 64, height: 96 });
    expect(
      generatedAssetForRole(join(files.gameDir(gameId), 'assets'), 'shooterBoss'),
    ).toMatchObject({ width: 128, height: 192 });
    expect(
      generatedAssetForRole(join(files.gameDir(gameId), 'assets'), 'shooterEnemyAtlas'),
    ).toMatchObject({ width: 480, height: 96 });
    expect(
      SHOOTER_BACKDROP_ROLES.map((role) =>
        generatedAssetForRole(join(files.gameDir(gameId), 'assets'), role),
      ),
    ).toEqual(
      SHOOTER_BACKDROP_ROLES.map(() => expect.objectContaining({ width: 960, height: 1536 })),
    );
    expect(
      HEAD_ROLES.some((role) => generatedAssetForRole(join(files.gameDir(gameId), 'assets'), role)),
    ).toBe(false);
    expect(
      db.usageForGame(gameId).filter((event) => event.stage.startsWith('image:') && !event.failed),
    ).toHaveLength(16);
  });

  it('reuses both H-scroll craft derivatives after a late publish failure', async () => {
    const { db, files, runner } = createHarness((root) => new FailFirstPublishFiles(root));
    const { jobId, gameId } = runner.createJob({
      promptText: 'A trench pilot races an alien current in a signature cobalt skiff',
      sourceKind: 'surprise',
      requestedArchetype: 'hshooter',
      idempotencyKey: 'mock-hshooter-craft-reference-retry-cache',
    });

    const firstAttempt = await waitForTerminal(db, jobId);
    expect(firstAttempt.status).toBe('failed');
    expect(firstAttempt.error?.message).toContain('synthetic late publish failure');
    const firstImageEvents = db
      .usageForGame(gameId)
      .filter((event) => event.stage.startsWith('image:') && !event.failed);
    expect(firstImageEvents.length).toBeGreaterThan(0);
    expect(
      existsSync(join(files.stagingFor(jobId), 'assets', '.hshooter-craft-reference.png')),
    ).toBe(true);

    expect(runner.retryJob(gameId)).toEqual({ jobId });
    expect(await waitForTerminal(db, jobId)).toMatchObject({ status: 'done' });
    expect(
      db.usageForGame(gameId).filter((event) => event.stage.startsWith('image:') && !event.failed),
    ).toHaveLength(firstImageEvents.length);
    expect(
      generatedAssetForRole(join(files.gameDir(gameId), 'assets'), 'hshooterPlayerCraft'),
    ).toMatchObject({ width: 96, height: 64 });
    expect(
      generatedAssetForRole(join(files.gameDir(gameId), 'assets'), 'hshooterEnemyAtlas'),
    ).toMatchObject({ width: 480, height: 96 });
  });

  it('publishes a distinct 13-state atlas for every fighter in the five-character roster', async () => {
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
      ...PORTRAIT_ROLES,
      ...FIGHTER_ROLES,
      ...FIGHTER_ARENA_ROLES,
    ]);

    const assetsDir = join(files.gameDir(gameId), 'assets');
    const fighterEntries = FIGHTER_ROLES.map((role) => generatedAssetForRole(assetsDir, role)!);
    expect(fighterEntries).toHaveLength(5);
    expect(new Set(fighterEntries.map((entry) => entry.sha256)).size).toBe(5);
    expect(fighterEntries.every((entry) => entry.width === 384 && entry.height === 384)).toBe(true);
    const playerAtlas = readFileSync(join(assetsDir, fighterEntries[0]!.filename));
    const poseHashes = await Promise.all(
      GENERATED_FIGHTER_POSES.map(async (_pose, index) =>
        sha256(
          await sharp(playerAtlas)
            .extract({
              left: (index % 4) * 96,
              top: Math.floor(index / 4) * 96,
              width: 96,
              height: 96,
            })
            .png()
            .toBuffer(),
        ),
      ),
    );
    expect(new Set(poseHashes).size).toBe(GENERATED_FIGHTER_POSES.length);
    expect(files.readMeta(gameId)?.fighterArt).toEqual({
      mode: 'generated',
      attempted: true,
    });
    expect(files.readMeta(gameId)?.fighterArenaArt).toEqual({
      mode: 'generated',
      attempted: true,
    });
    expect(FIGHTER_ARENA_ROLES.map((role) => generatedAssetForRole(assetsDir, role))).toEqual([
      expect.objectContaining({ width: 512, height: 600 }),
    ]);
    const successfulImageStages = db
      .usageForGame(gameId)
      .filter((event) => event.stage.startsWith('image:') && !event.failed)
      .map((event) => event.stage);
    expect(successfulImageStages).toHaveLength(33);
    expect(successfulImageStages.filter((stage) => stage.includes('-sheet-'))).toHaveLength(10);
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
    expect(successfulImagesBeforeRetry).toHaveLength(33);

    expect(runner.retryJob(gameId)).toEqual({ jobId });
    expect(await waitForTerminal(db, jobId)).toMatchObject({ status: 'done', attempt: 2 });
    const successfulImagesAfterRetry = db
      .usageForGame(gameId)
      .filter((event) => event.stage.startsWith('image:') && !event.failed);
    expect(successfulImagesAfterRetry).toHaveLength(successfulImagesBeforeRetry.length);
    await expectPublishedPngs(files, gameId, [
      ...PRESENTATION_ROLES,
      ...PORTRAIT_ROLES,
      ...FIGHTER_ROLES,
      ...FIGHTER_ARENA_ROLES,
    ]);
  });

  it('checkpoints completed fighter atlases and regenerates only an unfinished roster slot', async () => {
    const originalStore = GameAssetWorkspace.prototype.store;
    let failBossOnce = true;
    const storeSpy = vi
      .spyOn(GameAssetWorkspace.prototype, 'store')
      .mockImplementation(async function (
        this: GameAssetWorkspace,
        role,
        image,
        promptVersion,
        promptSha256,
      ) {
        if (role === 'fighterBossAtlas' && failBossOnce) {
          failBossOnce = false;
          throw new Error('synthetic boss atlas checkpoint failure');
        }
        return originalStore.call(this, role, image, promptVersion, promptSha256);
      });
    try {
      const { db, files, runner } = createHarness();
      const { jobId, gameId } = runner.createJob({
        promptText: 'A checkpointed subway martial arts tournament',
        sourceKind: 'surprise',
        requestedArchetype: 'fighter',
        photo: await testPhoto(),
        idempotencyKey: 'mock-photo-fighter-partial-roster-cache',
      });

      const firstAttempt = await waitForTerminal(db, jobId);
      expect(firstAttempt).toMatchObject({ status: 'failed', attempt: 1 });
      expect(firstAttempt.error?.message).toContain('synthetic boss atlas checkpoint failure');
      const successfulBeforeRetry = db
        .usageForGame(gameId)
        .filter((event) => event.stage.startsWith('image:') && !event.failed);
      expect(successfulBeforeRetry).toHaveLength(33);

      storeSpy.mockRestore();
      expect(runner.retryJob(gameId)).toEqual({ jobId });
      expect(await waitForTerminal(db, jobId)).toMatchObject({ status: 'done', attempt: 2 });
      const successfulAfterRetry = db
        .usageForGame(gameId)
        .filter((event) => event.stage.startsWith('image:') && !event.failed);
      expect(successfulAfterRetry).toHaveLength(38);
      const retryStages = successfulAfterRetry
        .slice(successfulBeforeRetry.length)
        .map(({ stage }) => stage);
      expect(retryStages.filter((stage) => stage.includes('fighter-boss-'))).toHaveLength(5);
      expect(retryStages.some((stage) => /fighter-(player|opponent\d)-/.test(stage))).toBe(false);
      await expectPublishedPngs(files, gameId, [
        ...PRESENTATION_ROLES,
        ...PORTRAIT_ROLES,
        ...FIGHTER_ROLES,
        ...FIGHTER_ARENA_ROLES,
      ]);
    } finally {
      storeSpy.mockRestore();
    }
  });
});
