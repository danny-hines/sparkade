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
  fighterReference: '.fighter-player-reference.png',
  platformerReference: '.platformer-player-reference.png',
} as const;
export const PRIVATE_GENERATED_ASSET_FILENAMES = Object.freeze(
  Object.values(PRIVATE_GENERATED_ASSET_FILES),
);
type PrivateGeneratedAssetRole = keyof typeof PRIVATE_GENERATED_ASSET_FILES;

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

function isGeneratedGameAsset(value: unknown): value is GeneratedGameAsset {
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
   * delivery allowlist (currently the high-resolution fighter idle reference). */
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
