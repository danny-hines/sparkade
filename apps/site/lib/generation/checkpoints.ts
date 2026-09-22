import { createHash } from 'node:crypto';
import type { PassCheckpoint } from '@sparkade/server/pipeline/durable-pass';
import { readPrivate, writePrivate } from './storage';

interface FileReference {
  pack: string;
  sha256: string;
  bytes: number;
}

/** Large files live in immutable, content-addressed packs. Small JSON files stay
 * inline. Legacy checkpoints with only inline files remain readable. */
export interface StoredCheckpoint extends PassCheckpoint {
  fileRefs?: Record<string, FileReference>;
}

type FilePack = Record<string, string>;
const INLINE_LIMIT = 16 * 1024;
const PACK_LIMIT = 4 * 1024 * 1024;
const CACHE_LIMIT = 64 * 1024 * 1024;
const packs = new Map<string, { value: FilePack; bytes: number }>();
let cacheBytes = 0;
const digest = (data: string) => createHash('sha256').update(data).digest('hex');

function cachePack(url: string, value: FilePack) {
  const bytes = Object.values(value).reduce((n, data) => n + data.length, 0);
  if (bytes > CACHE_LIMIT) return;
  const old = packs.get(url);
  if (old) cacheBytes -= old.bytes;
  packs.delete(url);
  packs.set(url, { value, bytes });
  cacheBytes += bytes;
  while (cacheBytes > CACHE_LIMIT) {
    const first = packs.keys().next().value!;
    cacheBytes -= packs.get(first)!.bytes;
    packs.delete(first);
  }
}

async function readPack(url: string): Promise<FilePack> {
  const cached = packs.get(url);
  if (cached) {
    packs.delete(url);
    packs.set(url, cached);
    return cached.value;
  }
  const value = await readPrivate<FilePack>(url);
  if (
    !value ||
    Object.entries(value).some(([hash, data]) => typeof data !== 'string' || digest(data) !== hash)
  )
    throw new Error('Generation checkpoint pack failed integrity validation');
  cachePack(url, value);
  return value;
}

function checkedFile(pack: FilePack, reference: FileReference): string {
  const data = pack[reference.sha256];
  if (typeof data !== 'string' || digest(data) !== reference.sha256)
    throw new Error('Generation checkpoint file failed integrity validation');
  return data;
}

/** A preview/photo endpoint can load one file without downloading the game. */
export async function readCheckpointFile(checkpoint: StoredCheckpoint, path: string) {
  const inline = checkpoint.files[path];
  if (inline !== undefined) return inline;
  const reference = checkpoint.fileRefs?.[path];
  return reference ? checkedFile(await readPack(reference.pack), reference) : undefined;
}

export async function readCheckpoint(
  path: string,
  include: (name: string) => boolean = () => true,
): Promise<StoredCheckpoint> {
  const checkpoint = await readPrivate<StoredCheckpoint>(path);
  const files = Object.fromEntries(
    Object.entries(checkpoint.files).filter(([name]) => include(name)),
  );
  const byPack = new Map<string, Array<[string, FileReference]>>();
  for (const entry of Object.entries(checkpoint.fileRefs ?? {})) {
    if (!include(entry[0])) continue;
    const entries = byPack.get(entry[1].pack) ?? [];
    entries.push(entry);
    byPack.set(entry[1].pack, entries);
  }
  const entries = [...byPack];
  for (let offset = 0; offset < entries.length; offset += 8) {
    await Promise.all(
      entries.slice(offset, offset + 8).map(async ([url, refs]) => {
        const pack = await readPack(url);
        for (const [name, ref] of refs) files[name] = checkedFile(pack, ref);
      }),
    );
  }
  return { ...checkpoint, files };
}

export async function writeCheckpoint(
  path: string,
  checkpoint: PassCheckpoint,
  previous?: StoredCheckpoint,
) {
  const files: Record<string, string> = {};
  const fileRefs: Record<string, FileReference> = {};
  const known = new Map(Object.values(previous?.fileRefs ?? {}).map((ref) => [ref.sha256, ref]));
  const pending = new Map<string, { data: string; names: string[] }>();
  let fileBytes = 0,
    reusedBytes = 0;
  // Rebuild the manifest from the current filesystem so deletions stay deleted.
  // Hash-based reuse also handles staging -> published file renames.
  for (const [name, data] of Object.entries(checkpoint.files)) {
    const bytes = Buffer.byteLength(data, 'base64');
    fileBytes += bytes;
    if (data.length <= INLINE_LIMIT) {
      files[name] = data;
      continue;
    }
    const sha256 = digest(data);
    const prior = known.get(sha256);
    if (prior) {
      fileRefs[name] = prior;
      reusedBytes += bytes;
    } else {
      const entry = pending.get(sha256) ?? { data, names: [] };
      entry.names.push(name);
      pending.set(sha256, entry);
    }
  }
  const batches: Array<Array<[string, { data: string; names: string[] }]>> = [];
  let size = 0;
  for (const entry of [...pending].sort(([a], [b]) => a.localeCompare(b))) {
    if (!batches.length || size + entry[1].data.length > PACK_LIMIT) {
      batches.push([]);
      size = 0;
    }
    batches.at(-1)!.push(entry);
    size += entry[1].data.length;
  }
  let uploadedBytes = 0;
  const directory = path.slice(0, path.lastIndexOf('/'));
  for (let offset = 0; offset < batches.length; offset += 4) {
    await Promise.all(
      batches.slice(offset, offset + 4).map(async (batch) => {
        const pack = Object.fromEntries(batch.map(([hash, entry]) => [hash, entry.data]));
        const encoded = JSON.stringify(pack);
        const url = await writePrivate(`${directory}/files/${digest(encoded)}.json`, pack);
        uploadedBytes += Buffer.byteLength(encoded);
        cachePack(url, pack);
        for (const [sha256, entry] of batch) {
          for (const name of entry.names)
            fileRefs[name] = { pack: url, sha256, bytes: Buffer.byteLength(entry.data, 'base64') };
        }
      }),
    );
  }
  const stored: StoredCheckpoint = {
    state: checkpoint.state,
    history: checkpoint.history,
    files,
    fileRefs,
  };
  const manifestBytes = Buffer.byteLength(JSON.stringify(stored));
  const url = await writePrivate(path, stored);
  return {
    url,
    metrics: {
      fileBytes,
      reusedBytes,
      uploadedBytes: uploadedBytes + manifestBytes,
      manifestBytes,
      newPacks: batches.length,
    },
  };
}
