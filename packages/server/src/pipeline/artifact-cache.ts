import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import { deflateSync, inflateSync } from 'node:zlib';
import { atomicWriteFile } from '../util';

/** Private, versioned intermediate artifacts; never part of the game manifest.
 * Persist only successful computations, including their Buffer values, so a
 * replay can reuse normalized candidates without fetching/reprocessing PNGs. */
export class ArtifactCache {
  constructor(private readonly directory: string) {}

  async getOrCompute<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const digest = createHash('sha256').update(key).digest('hex');
    const path = join(this.directory, `${digest}.bin`);
    if (existsSync(path)) {
      try {
        return deserialize(inflateSync(readFileSync(path))) as T;
      } catch {
        // Corrupt/mismatched local artifacts are recomputed from durable input.
      }
    }
    const result = await compute();
    atomicWriteFile(path, deflateSync(serialize(result)));
    return result;
  }
}
