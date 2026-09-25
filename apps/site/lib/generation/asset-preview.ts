import { GENERATED_GAME_ASSET_FILES } from '@sparkade/shared';
import { isGeneratedGameAsset, sha256 } from '@sparkade/server/assets/manifest';
import { readCheckpointFile, type StoredCheckpoint } from './checkpoints';
import { readPrivate } from './storage';
import type { GenerationRow } from './store';

const publicFilenames = new Set<string>(Object.values(GENERATED_GAME_ASSET_FILES));

/** Match the kiosk server's manifest and checksum rules without restoring the whole job. */
export async function readGenerationAssetPreview(
  row: Pick<GenerationRow, 'id' | 'state' | 'checkpoint'>,
  filename: string,
): Promise<Buffer | null> {
  if (!publicFilenames.has(filename) || !row.checkpoint) return null;
  const checkpoint = await readPrivate<StoredCheckpoint>(row.checkpoint);
  const directories = [`staging/${row.id}/assets`];
  // The last pipeline pass moves files before the final bundle is published.
  if (row.state.job?.gameId) directories.push(`games/${row.state.job.gameId}/assets`);
  for (const directory of directories) {
    const raw = await readCheckpointFile(checkpoint, `${directory}/manifest.json`);
    if (!raw) continue;
    const manifest = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as {
      version?: unknown;
      assets?: unknown;
    } | null;
    if (
      manifest?.version !== 1 ||
      !Array.isArray(manifest.assets) ||
      !manifest.assets.every(isGeneratedGameAsset)
    )
      return null;
    const asset = manifest.assets.find((entry) => entry.filename === filename);
    if (!asset) continue;
    const data = await readCheckpointFile(checkpoint, `${directory}/${filename}`);
    if (!data) return null;
    const bytes = Buffer.from(data, 'base64');
    return sha256(bytes) === asset.sha256 ? bytes : null;
  }
  return null;
}
