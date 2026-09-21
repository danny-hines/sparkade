import type { GameRow } from '../storage/db';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import type {
  CompleteRequest,
  CompleteResponse,
  GameSpec,
  SparkadeConfig,
  StageName,
} from '@sparkade/shared';
import { GenerationRunner } from './runner';
import { JobState, type PipelineState } from './job-state';
import { GameFiles } from '../storage/files';
import { SseHub } from './sse';
import { ProviderAuthError, ProviderHttpError } from '../providers/base';
import { PipelineSuspended, type DurableImageRequest } from './durable';

export type ProviderTask =
  | {
      id: string;
      kind: 'text';
      stage: StageName;
      model: string;
      request: Omit<CompleteRequest, 'image'> & { image?: string };
    }
  | {
      id: string;
      kind: 'image';
      request: Omit<DurableImageRequest, 'reference'> & { reference?: string };
    };
export type ProviderResult =
  | { kind: 'text'; response: CompleteResponse }
  | { kind: 'image'; image: string; imageCount: number }
  | { kind: 'error'; message: string; status: number };
export interface PassCheckpoint {
  history?: Array<{ game: GameRow; spec: GameSpec }>;
  state: PipelineState;
  files: Record<string, string>;
}

export function collectFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), name + '/');
      else if (entry.isFile()) files[name] = readFileSync(join(dir, entry.name)).toString('base64');
    }
  };
  walk(root, '');
  return files;
}

export function restoreFiles(root: string, files: Record<string, string>) {
  for (const [path, data] of Object.entries(files)) {
    if (path.startsWith('/') || path.split('/').some((p) => p === '..' || !p))
      throw new Error('Invalid checkpoint path');
    const dest = join(root, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, Buffer.from(data, 'base64'), { mode: 0o600 });
  }
}

/** Run deterministic processing until it needs external work. Missing requests
 * suspend together, allowing independent image calls to become parallel durable
 * steps. Only completed provider responses enter this pass; no network calls or
 * SQLite database are used. Every pass starts in a fresh temporary directory. */
export async function advancePipeline(
  checkpoint: PassCheckpoint,
  responses: Record<string, ProviderResult> | ((id: string) => Promise<ProviderResult | undefined>),
  config: SparkadeConfig,
): Promise<PassCheckpoint & { pending: ProviderTask[] }> {
  const root = mkdtempSync(join(tmpdir(), 'sparkade-pass-'));
  const db = new JobState(structuredClone(checkpoint.state));
  const abort = new AbortController();
  const pending = new Map<string, ProviderTask>();
  const occurrences = new Map<string, number>();
  const request = async (
    task:
      | Omit<Extract<ProviderTask, { kind: 'text' }>, 'id'>
      | Omit<Extract<ProviderTask, { kind: 'image' }>, 'id'>,
  ) => {
    const base = createHash('sha256').update(JSON.stringify(task)).digest('hex');
    const count = occurrences.get(base) ?? 0;
    occurrences.set(base, count + 1);
    const id = `${base}-${count}`;
    const result = typeof responses === 'function' ? await responses(id) : responses[id];
    if (result) {
      if (result.kind === 'error') {
        if (result.status === 401 || result.status === 403)
          throw new ProviderAuthError(result.message);
        throw new ProviderHttpError(result.message, result.status, null, '');
      }
      return { id, result };
    }
    pending.set(id, { ...task, id } as ProviderTask);
    // Suspend just this branch. Siblings finish processing and discover their
    // own dependencies before the runner's structured join saves the pass.
    throw new PipelineSuspended();
  };
  try {
    restoreFiles(root, checkpoint.files);
    const gameFiles = new GameFiles(root);
    const localSpec = gameFiles.readSpec.bind(gameFiles);
    gameFiles.readSpec = (id) =>
      checkpoint.history?.find((h) => h.game.id === id)?.spec ?? localSpec(id);
    const runner = new GenerationRunner(
      db,
      gameFiles,
      { get: () => config },
      new SseHub(),
      () => checkpoint.history?.map((h) => h.game) ?? [],
      {
        abort,
        suspended: () => pending.size > 0,
        complete: async (stage, req, model) => {
          const { id, result } = await request({
            kind: 'text',
            stage,
            model,
            request: { ...req, image: req.image?.toString('base64') },
          });
          if (result.kind !== 'text') throw new Error('Unexpected response type');
          return { ...result.response, durableRequestId: `${db.state.job!.attempt}:${id}` };
        },
        image: async (req) => {
          const { id, result } = await request({
            kind: 'image',
            request: { ...req, reference: req.reference?.toString('base64') },
          });
          if (result.kind !== 'image') throw new Error('Unexpected response type');
          return {
            image: Buffer.from(result.image, 'base64'),
            imageCount: result.imageCount,
            durableRequestId: `${db.state.job!.attempt}:${id}`,
          };
        },
      },
    );
    const job = db.state.job;
    if (!job) throw new Error('Missing job');
    await runner.execute(job.id);
    return {
      history: checkpoint.history,
      state: db.state,
      files: collectFiles(root),
      pending: [...pending.values()],
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
