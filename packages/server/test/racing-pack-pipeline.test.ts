// GenerationRunner mock integration for the racing ten-file pack: full
// manifest + metadata + private reference, usage-bounded caching, and loud
// failure with no silent partial success.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import {
  GENERATED_GAME_ASSET_FILES,
  type GeneratedGameAssetRole,
  type JobRecord,
  type RacingSpec,
} from '@sparkade/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  GameAssetWorkspace,
  generatedAssetForRole,
  readGameAssetManifest,
  sha256,
} from '../src/assets/manifest';
import { RACING_PACK_REQUIRED_ROLES, buildRacingPackPlan } from '../src/assets/racing-pack';
import {
  RACING_SCENERY_OBJECTS_VERSION,
  racingSceneryObjectPrompts,
} from '../src/assets/racing-scenery-pack';
import { GenerationRunner } from '../src/pipeline/runner';
import { SseHub } from '../src/pipeline/sse';
import { ConfigStore } from '../src/storage/config';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';

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
  if (originalEnv.provider === undefined) delete process.env.SPARKADE_PROVIDER;
  else process.env.SPARKADE_PROVIDER = originalEnv.provider;
  if (originalEnv.fast === undefined) delete process.env.SPARKADE_MOCK_FAST;
  else process.env.SPARKADE_MOCK_FAST = originalEnv.fast;
  if (originalEnv.concurrency === undefined) delete process.env.SPARKADE_GEN_CONCURRENCY;
  else process.env.SPARKADE_GEN_CONCURRENCY = originalEnv.concurrency;
});

afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.db.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

function createHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'sparkade-racing-pack-'));
  const db = new Db(root);
  const files = new GameFiles(root);
  const runner = new GenerationRunner(db, files, new ConfigStore(root), new SseHub());
  const harness = { root, db, files, runner };
  harnesses.push(harness);
  return harness;
}

async function waitForTerminal(db: Db, jobId: string, timeoutMs = 90_000): Promise<JobRecord> {
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

const EXPECTED_DIMS: Record<string, { width: number; height: number }> = {
  racingPanorama1: { width: 1536, height: 480 },
  racingPanorama2: { width: 1536, height: 480 },
  racingPanorama3: { width: 1536, height: 480 },
  racingCraftPlayer: { width: 192, height: 64 },
  racingCraftRival1: { width: 192, height: 64 },
  racingCraftRival2: { width: 192, height: 64 },
  racingCraftRival3: { width: 192, height: 64 },
  racingCraftRival4: { width: 192, height: 64 },
  racingSceneryAtlas: { width: 288, height: 192 },
  racingMaterialAtlas: { width: 256, height: 256 },
};

describe.sequential('mock racing pack pipeline', () => {
  it('restores approved base strips and cycles after a late motion publish failure', async () => {
    const original = GameAssetWorkspace.prototype.store;
    let fail = true;
    const spy = vi.spyOn(GameAssetWorkspace.prototype, 'store').mockImplementation(async function(this: GameAssetWorkspace, role, image, version, hash) {
      if (fail && role === 'racingCraftRival2' && version === 'racing-locomotion-v3-approved') throw new Error('synthetic late motion persistence failure');
      return original.call(this, role, image, version, hash);
    });
    try {
      const {db, files, runner} = createHarness();
      const details = 'Race with handling grip, surface ground, rider seated, propulsion human, motion pedal';
      const ids = runner.createJob({promptText:details,requestedArchetype:'racing',sourceKind:'preset',idempotencyKey:'motion-cache'});
      expect(await waitForTerminal(db,ids.jobId)).toMatchObject({status:'failed'});
      expect(files.readMeta(ids.gameId)?.status).not.toBe('ready');
      fail = false;
      const retry = runner.retryJob(ids.gameId)!;
      const terminal = await waitForTerminal(db,retry.jobId);
      expect(terminal,JSON.stringify(terminal.error)).toMatchObject({status:'done'});
      const calls = db.usageForGame(ids.gameId).filter(r=>r.stage.startsWith('image:') && !r.failed);
      for (let i=0;i<5;i++) expect(calls.filter(r=>r.stage===`image:racing-motion-${i}`)).toHaveLength(1);
      for (const role of ['racingCraftPlayer','racingCraftRival1','racingCraftRival2','racingCraftRival3','racingCraftRival4'])
        expect(calls.filter(r=>r.stage===`image:${role}`)).toHaveLength(1);
    } finally {spy.mockRestore();}
  },120_000);

  it.each([
    ['pedal', 'seated', 'human'], ['stride', 'onFoot', 'human'],
    ['push', 'standing', 'human'], ['pulse', 'none', 'magic'],
  ])('publishes a complete %s animation pack and authored forks', async (motion, rider, propulsion) => {
    const { db, files, runner } = createHarness();
    const details = `Racing with handling grip, surface ground, rider ${rider}, propulsion ${propulsion}, motion ${motion}. Include fork routes and rolling hills.`;
    const { jobId, gameId } = runner.createJob({ promptText: details, requestedArchetype: 'racing', sourceKind: 'preset',
      creationBrief: { version: 1, heroName: 'Rin', archetype: 'racing', details }, idempotencyKey: `motion-${motion}` });
    const terminal = await waitForTerminal(db, jobId);
    expect(terminal, JSON.stringify(terminal.error)).toMatchObject({status:'done'});
    const spec = files.readSpec(gameId) as RacingSpec;
    expect(spec.identity?.traversal?.motion).toBe(motion);
    expect(spec.levels.every(l => l.forks === 'split' && l.length === 3600 && l.jumps === 'none')).toBe(true);
    const dir = join(files.gameDir(gameId), 'assets');
    for (let i = 0; i < 5; i++) {
      expect(existsSync(join(dir, `.racing-base-${i}.png`))).toBe(false);
      expect(existsSync(join(dir, `.racing-motion-${i}.png`))).toBe(false);
    }
    for (const role of RACING_PACK_REQUIRED_ROLES) {
      const asset = generatedAssetForRole(dir, role)!;
      expect(asset).not.toBeNull();
      if (role.startsWith('racingCraft')) expect(asset).toMatchObject({width:192,height:192,promptVersion:'racing-locomotion-v3-approved'});
    }
  }, 90_000);

  it.each([
    ['bicycle', 'grip', 'ground', 'seated', 'human'],
    ['motorcycle', 'grip', 'ground', 'seated', 'motor'],
    ['on-foot runner', 'flow', 'ground', 'onFoot', 'human'],
    ['skateboard', 'carve', 'ground', 'standing', 'human'],
    ['invented leaf', 'flow', 'water', 'standing', 'magic'],
  ])(
    'carries a personalized %s traversal through the full generated pack',
    async (name, handling, surface, rider, propulsion) => {
      const { db, files, runner } = createHarness();
      const photo = await sharp({
        create: { width: 64, height: 64, channels: 3, background: '#ab8060' },
      })
        .jpeg()
        .toBuffer();
      const details = `Race an original ${name}; handling ${handling}, surface ${surface}, rider ${rider}, propulsion ${propulsion}. ${name === 'skateboard' ? 'Rolling hills with jump ramps.' : ''}`;
      const { jobId, gameId } = runner.createJob({
        promptText: details,
        photo,
        creationBrief: { version: 1, heroName: 'Rin', archetype: 'racing', details },
        requestedArchetype: 'racing',
        sourceKind: 'preset',
        idempotencyKey: 'mock-traversal-' + name,
      });
      const terminal = await waitForTerminal(db, jobId);
      expect(terminal, JSON.stringify(terminal.error)).toMatchObject({ status: 'done' });
      const spec = files.readSpec(gameId) as RacingSpec;
      expect(spec.identity).toMatchObject({
        pilotName: 'Rin',
        traversal: { handling, surface, rider, propulsion },
      });
      if (name === 'skateboard') {
        expect(spec.levels.every(l => l.elevation === 'rolling' && l.jumps === 'ramps')).toBe(true);
      }
      const dir = join(files.gameDir(gameId), 'assets');
      for (const role of RACING_PACK_REQUIRED_ROLES)
        expect(generatedAssetForRole(dir, role)).not.toBeNull();
      expect(generatedAssetForRole(dir, 'racingCraftPlayer')!.promptVersion).toBe(
        'racing-traversal-strip-v3-approved-v1',
      );
      if (surface === 'water')
        expect(generatedAssetForRole(dir, 'racingMaterialAtlas')!.promptVersion).toBe(
          'racing-jetski-material-tiles-v1',
        );
    },
    90_000,
  );

  it('generates a personalized jetski cup from photo, name and description', async () => {
    const { db, files, runner } = createHarness();
    const photo = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#ab8060' },
    })
      .jpeg()
      .toBuffer();
    const details = 'Jet skiing across a tropical lagoon, collect floating Tide Cells for boost';
    const { jobId, gameId } = runner.createJob({
      promptText: details,
      photo,
      creationBrief: { version: 1, heroName: 'Rin', archetype: 'racing', details },
      sourceKind: 'preset',
      requestedArchetype: 'racing',
      idempotencyKey: 'mock-jetski-personalized',
    });
    const terminal = await waitForTerminal(db, jobId);
    expect(terminal, JSON.stringify(terminal.error)).toMatchObject({ status: 'done' });
    const spec = files.readSpec(gameId) as RacingSpec;
    expect(spec.identity).toMatchObject({
      discipline: 'jetski',
      pilotName: 'Rin',
      boost: { mode: 'pickups' },
    });
    expect(spec.levels).toHaveLength(3);
    const assetsDir = join(files.gameDir(gameId), 'assets');
    for (const role of RACING_PACK_REQUIRED_ROLES)
      expect(generatedAssetForRole(assetsDir, role)).not.toBeNull();
    const player = generatedAssetForRole(assetsDir, 'racingCraftPlayer');
    expect(player!.promptVersion).toBe('racing-jetski-strip-v1-approved-v1');
  }, 90_000);

  it('publishes the complete ten-file pack with manifest, metadata, and private reference', async () => {
    const originalStorePrivate = GameAssetWorkspace.prototype.storePrivate;
    const privateStored: string[] = [];
    const privateSpy = vi
      .spyOn(GameAssetWorkspace.prototype, 'storePrivate')
      .mockImplementation(async function (
        this: GameAssetWorkspace,
        role,
        image,
        promptVersion,
        promptSha256,
      ) {
        privateStored.push(role);
        return originalStorePrivate.call(this, role, image, promptVersion, promptSha256);
      });
    const { db, files, runner } = createHarness();
    const { jobId, gameId } = runner.createJob({
      promptText: 'A dusk-ember hover kart cup through lava fields',
      sourceKind: 'surprise',
      requestedArchetype: 'racing',
      idempotencyKey: 'mock-racing-pack-complete',
    });
    expect(await waitForTerminal(db, jobId)).toMatchObject({ status: 'done' });
    const spec = files.readSpec(gameId) as RacingSpec;
    expect(spec.archetype).toBe('racing');
    expect(spec.identity?.boost.mode).toBe('pads');
    // The live provider defaults to a landscape canvas; the material
    // normalizer requires a square, unlike the mock fixture generator.
    expect(buildRacingPackPlan(spec).materials.size).toBe('1024x1024');
    // The plan advertises the exact six object prompts the generator
    // issues — no resurrected sheet prompt anywhere in the plan.
    const plan = buildRacingPackPlan(spec);
    const expectedObjects = racingSceneryObjectPrompts(spec);
    expect(plan.sceneryObjects).toHaveLength(6);
    expect(plan.sceneryObjects.map((entry) => entry.prompt)).toEqual(expectedObjects);
    for (const entry of plan.sceneryObjects) {
      expect(entry.promptVersion).toBe(RACING_SCENERY_OBJECTS_VERSION);
      expect(entry.size).toBe('1024x1024');
      expect(entry.reference).toBe('keyArt');
    }
    expect(plan.scenery.role).toBe('racingSceneryAtlas');
    expect(plan.scenery.promptVersion).toBe(RACING_SCENERY_OBJECTS_VERSION);
    expect(JSON.stringify(plan)).not.toContain('roadside-object sheet');

    const assetsDir = join(files.gameDir(gameId), 'assets');
    const manifest = readGameAssetManifest(assetsDir);
    expect(manifest).not.toBeNull();
    const roles = manifest!.assets.map((asset) => asset.role);
    for (const role of RACING_PACK_REQUIRED_ROLES) {
      expect(roles, `pack must contain ${role}`).toContain(role);
    }
    for (const role of RACING_PACK_REQUIRED_ROLES) {
      const entry = generatedAssetForRole(assetsDir, role);
      expect(entry, `${role} must be integrity-checked by its manifest`).not.toBeNull();
      const image = readFileSync(join(assetsDir, GENERATED_GAME_ASSET_FILES[role]));
      const metadata = await sharp(image).metadata();
      expect(metadata.format, `${role} must decode as PNG`).toBe('png');
      expect({ width: metadata.width, height: metadata.height }, `${role} geometry`).toEqual(
        EXPECTED_DIMS[role],
      );
      expect(metadata.width).toBe(entry!.width);
      expect(metadata.height).toBe(entry!.height);
      expect(sha256(image)).toBe(entry!.sha256);
      if (role.startsWith('racingCraft')) expect(entry!.promptVersion).toContain('-approved-v1');
    }
    // Private vehicle-first reference is stored during the build but
    // never advertised in the public manifest (publish scrubs dotfiles).
    expect(roles).not.toContain('racingCraftReference');
    expect(existsSync(join(assetsDir, '.racing-craft-reference.png'))).toBe(false);

    expect(privateStored).toContain('racingCraftReference');
    for (const role of [
      'racingLandmarkFar',
      'racingLandmarkNear',
      'racingDressingA',
      'racingDressingB',
      'racingDressingC',
      'racingBoostObject',
    ])
      expect(privateStored).toContain(role);
    expect(existsSync(join(assetsDir, '.racing-boost-object.png'))).toBe(false);
    privateSpy.mockRestore();

    expect(files.readMeta(gameId)?.racingArt).toEqual({ mode: 'generated', attempted: true });

    // Caching/accounting: each pack role generated exactly once — no
    // redundant regeneration behind the mock.
    const usage = db.usageForGame(gameId);
    for (const role of RACING_PACK_REQUIRED_ROLES.filter((role) => role !== 'racingSceneryAtlas')) {
      const rows = usage.filter((event) => event.stage === `image:${role}` && !event.failed);
      expect(rows, `${role} generated exactly once`).toHaveLength(1);
    }
    for (let slot = 1; slot <= 6; slot++)
      expect(
        usage.filter(
          (event) => event.stage === `image:racing-scenery-object-${slot}` && !event.failed,
        ),
      ).toHaveLength(1);
  }, 120_000);

  it('fails loudly when one pack role cannot persist — no partial ready game', async () => {
    const originalStore = GameAssetWorkspace.prototype.store;
    let lastRivalSettled = false;
    // Fail the initial attempt, then allow a retry to verify checkpoint reuse.
    let failScenery = true;
    const storeSpy = vi
      .spyOn(GameAssetWorkspace.prototype, 'store')
      .mockImplementation(async function (
        this: GameAssetWorkspace,
        role: GeneratedGameAssetRole,
        image: Buffer,
        promptVersion: string,
        promptSha256: string,
      ) {
        // Persistent: both the first attempt and the validation retry must
        // fail, otherwise cachedGeneratedAsset recovers and the job goes done.
        if (role === 'racingSceneryAtlas' && failScenery) {
          throw new Error('synthetic racing scenery checkpoint failure');
        }
        if (role === 'racingCraftRival4') {
          await delay(1000);
          const result = await originalStore.call(this, role, image, promptVersion, promptSha256);
          lastRivalSettled = true;
          return result;
        }
        return originalStore.call(this, role, image, promptVersion, promptSha256);
      });
    try {
      const { db, files, runner } = createHarness();
      const { jobId, gameId } = runner.createJob({
        promptText: 'A dusk-ember hover kart cup through lava fields',
        sourceKind: 'surprise',
        requestedArchetype: 'racing',
        idempotencyKey: 'mock-racing-pack-scenery-failure',
      });
      expect(await waitForTerminal(db, jobId)).toMatchObject({ status: 'failed' });
      expect(lastRivalSettled, 'a failed job must drain already-started image writes').toBe(true);
      const feed = db.generationEventsForJob(jobId);
      expect(feed.some((event) => event.kind === 'failure')).toBe(true);
      // No ready meta, no published pack: the failure stays explicit.
      expect(files.readMeta(gameId)?.status ?? 'failed').not.toBe('ready');
      expect(files.readMeta(gameId)?.racingArt).toBeUndefined();
      failScenery = false;
      const retried = runner.retryJob(gameId)!;
      expect(await waitForTerminal(db, retried.jobId)).toMatchObject({ status: 'done' });
      const playerCalls = db
        .usageForGame(gameId)
        .filter((event) => event.stage === 'image:racingCraftPlayer' && !event.failed);
      expect(
        playerCalls,
        'an unrelated failed asset must retain the reviewed player selection',
      ).toHaveLength(1);
    } finally {
      storeSpy.mockRestore();
    }
  }, 120_000);
});
