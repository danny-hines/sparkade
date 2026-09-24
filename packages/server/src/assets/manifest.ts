import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  GENERATED_GAME_ASSET_FILES,
  type GameAssetManifest,
  type GeneratedGameAsset,
  type GeneratedGameAssetRole,
} from '@sparkade/shared';
import { atomicWriteFile, ensureDir, readJson } from '../util';

export const GAME_ASSET_MANIFEST_FILE = 'manifest.json';
const PRIVATE_GENERATED_ASSET_FILES = {
  platformerReference: '.platformer-player-reference.png',
  platformerSideReference: '.platformer-player-side-reference.png',
  hshooterCraftReference: '.hshooter-craft-reference.png',
  shooterCraftReference: '.shooter-craft-reference.png',
  racingCraftReference: '.racing-craft-reference.png',
  racingBase0: '.racing-base-0.png',
  racingBase1: '.racing-base-1.png',
  racingBase2: '.racing-base-2.png',
  racingBase3: '.racing-base-3.png',
  racingBase4: '.racing-base-4.png',
  racingMotion0: '.racing-motion-0.png',
  racingMotion1: '.racing-motion-1.png',
  racingMotion2: '.racing-motion-2.png',
  racingMotion3: '.racing-motion-3.png',
  racingMotion4: '.racing-motion-4.png',
  racingLandmarkFar: '.racing-landmark-far.png',
  racingLandmarkNear: '.racing-landmark-near.png',
  racingDressingA: '.racing-dressing-a.png',
  racingDressingB: '.racing-dressing-b.png',
  racingDressingC: '.racing-dressing-c.png',
  racingBoostObject: '.racing-boost-object.png',
  adventureEnemyBoard: '.adventure-enemy-board.png',
  adventureObjectBoard: '.adventure-object-board.png',
  adventureEnemyReplacementWalker1: '.adventure-enemy-replacement-walker-1.png',
  adventureEnemyReplacementWalker2: '.adventure-enemy-replacement-walker-2.png',
  adventureEnemyReplacementFlyer1: '.adventure-enemy-replacement-flyer-1.png',
  adventureEnemyReplacementFlyer2: '.adventure-enemy-replacement-flyer-2.png',
  adventureEnemyReplacementShooter1: '.adventure-enemy-replacement-shooter-1.png',
  adventureEnemyReplacementShooter2: '.adventure-enemy-replacement-shooter-2.png',
  adventureEnemyReplacementChaser1: '.adventure-enemy-replacement-chaser-1.png',
  adventureEnemyReplacementChaser2: '.adventure-enemy-replacement-chaser-2.png',
  adventureEnemyReplacementBruiser1: '.adventure-enemy-replacement-bruiser-1.png',
  adventureEnemyReplacementBruiser2: '.adventure-enemy-replacement-bruiser-2.png',
  adventureObjectReplacementKey1: '.adventure-object-replacement-key-1.png',
  adventureObjectReplacementKey2: '.adventure-object-replacement-key-2.png',
  adventureObjectReplacementItem1: '.adventure-object-replacement-item-1.png',
  adventureObjectReplacementItem2: '.adventure-object-replacement-item-2.png',
  adventureObjectReplacementSecondaryEffect1:
    '.adventure-object-replacement-secondary-effect-1.png',
  adventureObjectReplacementSecondaryEffect2:
    '.adventure-object-replacement-secondary-effect-2.png',
  adventureObjectReplacementBlock1: '.adventure-object-replacement-block-1.png',
  adventureObjectReplacementBlock2: '.adventure-object-replacement-block-2.png',
  hshooterEnemyBoard: '.hshooter-enemy-board.png',
  hshooterEnemyReplacementPopcorn: '.hshooter-enemy-replacement-popcorn.png',
  hshooterEnemyReplacementWeaver: '.hshooter-enemy-replacement-weaver.png',
  hshooterEnemyReplacementTank: '.hshooter-enemy-replacement-tank.png',
  hshooterEnemyReplacementTurret: '.hshooter-enemy-replacement-turret.png',
  hshooterEnemyReplacementKamikaze: '.hshooter-enemy-replacement-kamikaze.png',
  shooterEnemyBoard: '.shooter-enemy-board.png',
  shooterEnemyReplacementPopcorn: '.shooter-enemy-replacement-popcorn.png',
  shooterEnemyReplacementWeaver: '.shooter-enemy-replacement-weaver.png',
  shooterEnemyReplacementTank: '.shooter-enemy-replacement-tank.png',
  shooterEnemyReplacementTurret: '.shooter-enemy-replacement-turret.png',
  shooterEnemyReplacementKamikaze: '.shooter-enemy-replacement-kamikaze.png',
} as const;
export const PRIVATE_GENERATED_ASSET_FILENAMES = Object.freeze(
  Object.values(PRIVATE_GENERATED_ASSET_FILES),
);
export type PrivateGeneratedAssetRole = keyof typeof PRIVATE_GENERATED_ASSET_FILES;

/**
 * Retry-only terminal outcomes for optional per-racer racing motion, keyed
 * to the approved base plus prompt and locomotion version. A later unrelated
 * retry restores the recorded refusal/failure instead of rerolling the
 * animation. Never part of the public manifest; scrubbed at publication.
 */
const PRIVATE_MOTION_OUTCOME_FILES = {
  racingMotionOutcome0: '.racing-motion-0.terminal.json',
  racingMotionOutcome1: '.racing-motion-1.terminal.json',
  racingMotionOutcome2: '.racing-motion-2.terminal.json',
  racingMotionOutcome3: '.racing-motion-3.terminal.json',
  racingMotionOutcome4: '.racing-motion-4.terminal.json',
} as const;
export type PrivateMotionOutcomeRole = keyof typeof PRIVATE_MOTION_OUTCOME_FILES;
export const PRIVATE_MOTION_OUTCOME_FILENAMES = Object.freeze(
  Object.values(PRIVATE_MOTION_OUTCOME_FILES),
);
export const RACING_MOTION_OUTCOME_ROLES: readonly PrivateMotionOutcomeRole[] = [
  'racingMotionOutcome0',
  'racingMotionOutcome1',
  'racingMotionOutcome2',
  'racingMotionOutcome3',
  'racingMotionOutcome4',
];

interface PrivateGeneratedAssetMeta {
  model: string;
  promptVersion: string;
  promptSha256: string;
  sha256: string;
}

export class GeneratedAssetStorageError extends Error {
  constructor(
    message: string,
    readonly storageCause?: unknown,
  ) {
    super(message);
    this.name = 'GeneratedAssetStorageError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isGeneratedGameAsset(value: unknown): value is GeneratedGameAsset {
  if (!isRecord(value) || typeof value.role !== 'string') return false;
  if (!Object.prototype.hasOwnProperty.call(GENERATED_GAME_ASSET_FILES, value.role)) return false;
  const role = value.role as GeneratedGameAssetRole;
  return (
    value.filename === GENERATED_GAME_ASSET_FILES[role] &&
    value.mimeType === 'image/png' &&
    Number.isSafeInteger(value.width) &&
    Number(value.width) > 0 &&
    Number.isSafeInteger(value.height) &&
    Number(value.height) > 0 &&
    typeof value.model === 'string' &&
    value.model.length > 0 &&
    typeof value.promptVersion === 'string' &&
    value.promptVersion.length > 0 &&
    typeof value.promptSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.promptSha256) &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256)
  );
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Hash both the authored instruction and its image reference (when any). */
export function imagePromptHash(prompt: string, reference?: Buffer): string {
  const hash = createHash('sha256').update(prompt).update('\0');
  if (reference) hash.update(reference);
  return hash.digest('hex');
}

export function readGameAssetManifest(assetsDir: string): GameAssetManifest | null {
  const manifest = readJson<unknown>(join(assetsDir, GAME_ASSET_MANIFEST_FILE));
  if (
    !isRecord(manifest) ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.assets) ||
    !manifest.assets.every(isGeneratedGameAsset)
  ) {
    return null;
  }
  return manifest as unknown as GameAssetManifest;
}

/**
 * Durable per-job image workspace. Every successful image is written before its
 * manifest entry, so an interrupted or retried job can reuse only complete,
 * integrity-checked output and never pay for the same image twice.
 */
export class GameAssetWorkspace {
  readonly dir: string;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    assetsDir: string,
    private readonly model: string,
    private readonly onStored?: (asset: GeneratedGameAsset) => void,
  ) {
    this.dir = ensureDir(assetsDir);
  }

  load(role: GeneratedGameAssetRole, promptVersion: string, promptSha256: string): Buffer | null {
    const expectedFilename = GENERATED_GAME_ASSET_FILES[role];
    const entry = readGameAssetManifest(this.dir)?.assets.find(
      (asset) =>
        asset.role === role &&
        asset.filename === expectedFilename &&
        asset.model === this.model &&
        asset.promptVersion === promptVersion &&
        asset.promptSha256 === promptSha256,
    );
    if (!entry) return null;
    const path = join(this.dir, expectedFilename);
    if (!existsSync(path)) return null;
    const image = readFileSync(path);
    return sha256(image) === entry.sha256 ? image : null;
  }

  /** Load a retry-only generated artifact that must never enter the public
   * delivery allowlist. */
  loadPrivate(
    role: PrivateGeneratedAssetRole,
    promptVersion: string,
    promptSha256: string,
  ): Buffer | null {
    const filename = PRIVATE_GENERATED_ASSET_FILES[role];
    const meta = readJson<PrivateGeneratedAssetMeta>(join(this.dir, `${filename}.json`));
    if (
      !meta ||
      meta.model !== this.model ||
      meta.promptVersion !== promptVersion ||
      meta.promptSha256 !== promptSha256
    ) {
      return null;
    }
    const path = join(this.dir, filename);
    if (!existsSync(path)) return null;
    const image = readFileSync(path);
    return sha256(image) === meta.sha256 ? image : null;
  }

  async storePrivate(
    role: PrivateGeneratedAssetRole,
    image: Buffer,
    promptVersion: string,
    promptSha256: string,
  ): Promise<void> {
    const metadata = await sharp(image).metadata();
    if (metadata.format !== 'png' || !metadata.width || !metadata.height) {
      throw new Error(`private generated asset ${role} must be a decodable PNG`);
    }
    const filename = PRIVATE_GENERATED_ASSET_FILES[role];
    const meta: PrivateGeneratedAssetMeta = {
      model: this.model,
      promptVersion,
      promptSha256,
      sha256: sha256(image),
    };
    const commit = async (): Promise<void> => {
      atomicWriteFile(join(this.dir, filename), image);
      atomicWriteFile(join(this.dir, `${filename}.json`), `${JSON.stringify(meta, null, 2)}\n`);
    };
    const pending = this.writeTail.then(commit, commit);
    this.writeTail = pending.catch(() => {});
    try {
      await pending;
    } catch (error) {
      throw new GeneratedAssetStorageError(
        `could not persist private generated asset ${role}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /** Load a terminal optional-motion outcome recorded by an earlier attempt. */
  loadMotionOutcome(role: PrivateMotionOutcomeRole): string | null {
    const path = join(this.dir, PRIVATE_MOTION_OUTCOME_FILES[role]);
    if (!existsSync(path)) return null;
    try {
      return readFileSync(path, 'utf8');
    } catch (error) {
      throw new GeneratedAssetStorageError(`could not read private motion outcome ${role}`, error);
    }
  }

  /** Persist a terminal optional-motion outcome for later unrelated retries. */
  async storeMotionOutcome(role: PrivateMotionOutcomeRole, document: string): Promise<void> {
    const filename = PRIVATE_MOTION_OUTCOME_FILES[role];
    const commit = async (): Promise<void> => {
      atomicWriteFile(join(this.dir, filename), document);
    };
    const pending = this.writeTail.then(commit, commit);
    this.writeTail = pending.catch(() => {});
    try {
      await pending;
    } catch (error) {
      throw new GeneratedAssetStorageError(
        `could not persist private motion outcome ${role}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /** Remove a private retry artifact after a set-level validation failure. */
  async discardPrivate(role: PrivateGeneratedAssetRole): Promise<void> {
    const filename = PRIVATE_GENERATED_ASSET_FILES[role];
    const commit = async (): Promise<void> => {
      const metaPath = join(this.dir, `${filename}.json`);
      if (existsSync(metaPath)) unlinkSync(metaPath);
      const imagePath = join(this.dir, filename);
      if (existsSync(imagePath)) unlinkSync(imagePath);
    };
    const pending = this.writeTail.then(commit, commit);
    this.writeTail = pending.catch(() => {});
    try {
      await pending;
    } catch (error) {
      throw new GeneratedAssetStorageError(
        `could not discard private generated asset ${role}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /** Atomically stop declaring a rejected generated set before deleting bytes. */
  async discard(roles: readonly GeneratedGameAssetRole[]): Promise<void> {
    const roleSet = new Set(roles);
    const commit = async (): Promise<void> => {
      const current = readGameAssetManifest(this.dir) ?? { version: 1 as const, assets: [] };
      const assets = current.assets.filter((asset) => !roleSet.has(asset.role));
      atomicWriteFile(
        join(this.dir, GAME_ASSET_MANIFEST_FILE),
        `${JSON.stringify({ version: 1, assets } satisfies GameAssetManifest, null, 2)}\n`,
      );
      for (const role of roles) {
        const path = join(this.dir, GENERATED_GAME_ASSET_FILES[role]);
        if (existsSync(path)) unlinkSync(path);
      }
    };
    const pending = this.writeTail.then(commit, commit);
    this.writeTail = pending.catch(() => {});
    try {
      await pending;
    } catch (error) {
      throw new GeneratedAssetStorageError(
        `could not discard rejected generated assets: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  async store(
    role: GeneratedGameAssetRole,
    image: Buffer,
    promptVersion: string,
    promptSha256: string,
  ): Promise<GeneratedGameAsset> {
    const metadata = await sharp(image).metadata();
    if (metadata.format !== 'png' || !metadata.width || !metadata.height) {
      throw new Error(`generated asset ${role} must be a decodable PNG`);
    }
    const filename = GENERATED_GAME_ASSET_FILES[role];
    const entry: GeneratedGameAsset = {
      role,
      filename,
      mimeType: 'image/png',
      width: metadata.width,
      height: metadata.height,
      model: this.model,
      promptVersion,
      promptSha256,
      sha256: sha256(image),
    };

    // Image calls finish concurrently; serialize only the tiny filesystem commit
    // so two manifest read-modify-writes cannot drop one another's entries.
    const commit = async (): Promise<void> => {
      // The binary lands first. A crash before the atomic manifest update leaves
      // an unreferenced file, which is safe and will simply be regenerated.
      atomicWriteFile(join(this.dir, filename), image);
      const current = readGameAssetManifest(this.dir) ?? { version: 1 as const, assets: [] };
      const assets = current.assets.filter((asset) => asset.role !== role);
      assets.push(entry);
      assets.sort((a, b) => a.role.localeCompare(b.role));
      atomicWriteFile(
        join(this.dir, GAME_ASSET_MANIFEST_FILE),
        `${JSON.stringify({ version: 1, assets } satisfies GameAssetManifest, null, 2)}\n`,
      );
    };
    const pending = this.writeTail.then(commit, commit);
    this.writeTail = pending.catch(() => {});
    try {
      await pending;
    } catch (error) {
      throw new GeneratedAssetStorageError(
        `could not persist generated asset ${role}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
    this.onStored?.(entry);
    return entry;
  }
}

/** Read one exact manifest-declared asset and verify its published bytes. */
export function generatedAssetForRole(
  assetsDir: string,
  role: GeneratedGameAssetRole,
): GeneratedGameAsset | null {
  const filename = GENERATED_GAME_ASSET_FILES[role];
  const entry = readGameAssetManifest(assetsDir)?.assets.find(
    (asset) => asset.role === role && asset.filename === filename,
  );
  if (!entry) return null;
  const path = join(assetsDir, filename);
  if (!existsSync(path)) return null;
  return sha256(readFileSync(path)) === entry.sha256 ? entry : null;
}

/** Resolve and verify only the requested public filename (the serving hot path). */
export function generatedAssetForFilename(
  assetsDir: string,
  filename: string,
): GeneratedGameAsset | null {
  const match = (
    Object.entries(GENERATED_GAME_ASSET_FILES) as Array<
      [GeneratedGameAssetRole, (typeof GENERATED_GAME_ASSET_FILES)[GeneratedGameAssetRole]]
    >
  ).find(([, expected]) => expected === filename);
  return match ? generatedAssetForRole(assetsDir, match[0]) : null;
}

/** Only exact, integrity-checked generated filenames can be served. */
export function generatedAssetNames(assetsDir: string): Set<string> {
  return new Set(
    (Object.keys(GENERATED_GAME_ASSET_FILES) as GeneratedGameAssetRole[])
      .map((role) => generatedAssetForRole(assetsDir, role)?.filename)
      .filter((filename): filename is string => !!filename),
  );
}
