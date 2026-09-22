import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { atomicWriteFile } from '../util';
import { GeneratedAssetStorageError, imagePromptHash, sha256 } from './manifest';
import type { RacingPackEntry } from './racing-pack';

export const RACING_BANK_FALLBACK_VERSION = 'racing-bank-neutral-v1';
export const RACING_BANK_FALLBACK_REASON =
  'The image provider declined a banking correction. The approved neutral sprite uses continuous steering lean.';

export function racingBankFallbackKey(entry: RacingPackEntry, model: string): string {
  return imagePromptHash(JSON.stringify([model, entry.role, entry.promptVersion, entry.prompt]));
}

export interface RacingBankFallback {
  reason: string;
  /** Absent until a roster review has accepted this rival's neutral identity. */
  neutral?: Buffer;
}

/** Private job checkpoints, outside the published pack. A refusal is recorded
 * before its sibling edit drains; its accepted neutral is then saved atomically
 * in the same document. Restoring never reissues a refused banking request.
 * Corrupt records fail closed rather than silently spending another image call. */
export class RacingBankFallbackStore {
  constructor(private readonly directory: string) {}

  private path(key: string): string {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid racing bank fallback key');
    return join(this.directory, `${key}.json`);
  }

  async load(key: string): Promise<RacingBankFallback | null> {
    const path = this.path(key);
    if (!existsSync(path)) return null;
    try {
      const record = JSON.parse(readFileSync(path, 'utf8'));
      if (
        record.version !== RACING_BANK_FALLBACK_VERSION ||
        record.key !== key ||
        record.outcome !== 'refused' ||
        typeof record.reason !== 'string' ||
        !record.reason
      )
        throw new Error('Invalid refusal record');
      if (record.neutral === undefined && record.sha256 === undefined)
        return { reason: record.reason };
      if (typeof record.neutral !== 'string') throw new Error('Invalid neutral image');
      const neutral = Buffer.from(record.neutral, 'base64');
      if (sha256(neutral) !== record.sha256) throw new Error('Neutral image checksum mismatch');
      await validateNeutral(neutral);
      return { reason: record.reason, neutral };
    } catch (error) {
      throw new GeneratedAssetStorageError(
        'Cannot restore refused rival banking correction',
        error,
      );
    }
  }

  async recordRefusal(key: string, providerMessage: string): Promise<void> {
    // Both concurrent bank edits may refuse. Preserve the first record and any
    // completed neutral approval rather than overwriting it with a partial one.
    if (existsSync(this.path(key))) {
      await this.load(key);
      return;
    }
    this.write(key, {
      version: RACING_BANK_FALLBACK_VERSION,
      key,
      outcome: 'refused',
      reason: RACING_BANK_FALLBACK_REASON,
      providerMessage,
    });
  }

  async approveNeutral(key: string, neutral: Buffer): Promise<RacingBankFallback> {
    try {
      await validateNeutral(neutral);
      const saved = await this.load(key);
      if (!saved) throw new Error('Neutral fallback requires a recorded provider refusal');
      const record = JSON.parse(readFileSync(this.path(key), 'utf8'));
      this.write(key, { ...record, neutral: neutral.toString('base64'), sha256: sha256(neutral) });
      return { reason: saved.reason, neutral };
    } catch (error) {
      if (error instanceof GeneratedAssetStorageError) throw error;
      throw new GeneratedAssetStorageError('Cannot persist approved rival neutral', error);
    }
  }

  private write(key: string, record: unknown): void {
    try {
      atomicWriteFile(this.path(key), `${JSON.stringify(record)}\n`);
    } catch (error) {
      throw new GeneratedAssetStorageError('Cannot persist rival banking refusal', error);
    }
  }
}

async function validateNeutral(png: Buffer): Promise<void> {
  const meta = await sharp(png).metadata();
  if (meta.format !== 'png' || meta.width !== 64 || meta.height !== 64 || !meta.hasAlpha)
    throw new Error('Rival neutral must be a transparent 64x64 PNG');
}
