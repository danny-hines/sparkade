// Validation for a generated game's asset manifest, shared by every reader
// (Pi server, cloud bundle installs, the Portal shell). Entries for roles this
// build knows are validated strictly. Well-formed entries for roles a newer
// build added are skipped rather than rejecting the whole game, so adding an
// asset role never breaks games on kiosks that have not updated yet.
import { GENERATED_GAME_ASSET_FILES, type GeneratedGameAssetRole } from './constants';
import type { GeneratedGameAsset } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SHA256 = /^[a-f0-9]{64}$/;

/** An entry for a role this build knows, with every field valid. */
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
    SHA256.test(value.promptSha256) &&
    typeof value.sha256 === 'string' &&
    SHA256.test(value.sha256)
  );
}

/** A well-formed entry for a role this build doesn't know (added later). Its
 * filename can never collide with a known role's file. */
export function isForeignGameAsset(value: unknown): boolean {
  if (!isRecord(value) || typeof value.role !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(value.role))
    return false;
  if (Object.prototype.hasOwnProperty.call(GENERATED_GAME_ASSET_FILES, value.role)) return false;
  return (
    typeof value.filename === 'string' &&
    /^[a-z0-9][a-z0-9-]{0,95}\.png$/.test(value.filename) &&
    !Object.values(GENERATED_GAME_ASSET_FILES).includes(value.filename as never) &&
    value.mimeType === 'image/png' &&
    typeof value.sha256 === 'string' &&
    SHA256.test(value.sha256)
  );
}

/** The entries this build knows, skipping newer builds' roles; null when any
 * entry is malformed or a filename repeats. */
export function knownGameAssets(assets: unknown): GeneratedGameAsset[] | null {
  if (!Array.isArray(assets)) return null;
  const known: GeneratedGameAsset[] = [];
  const filenames = new Set<string>();
  for (const asset of assets) {
    if (isGeneratedGameAsset(asset)) known.push(asset);
    else if (!isForeignGameAsset(asset)) return null;
    const filename = (asset as { filename: string }).filename;
    if (filenames.has(filename)) return null;
    filenames.add(filename);
  }
  return known;
}
