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

  private path(key: string): string {
    const digest = createHash('sha256').update(key).digest('hex');
    return join(this.directory, `${digest}.bin`);
  }

  read<T>(key: string): T | undefined {
    const path = this.path(key);
    if (existsSync(path)) {
      try {
        return deserialize(inflateSync(readFileSync(path))) as T;
      } catch {
        // Corrupt/mismatched local artifacts are recomputed from durable input.
      }
    }
    return undefined;
  }

  write<T>(key: string, value: T): void {
    atomicWriteFile(this.path(key), deflateSync(serialize(value)));
  }

  async getOrCompute<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const saved = this.read<T>(key);
    if (saved !== undefined) return saved;
    const result = await compute();
    // A rejected candidate may become available on an explicit job retry.
    if (result !== null) this.write(key, result);
    return result;
  }
}
