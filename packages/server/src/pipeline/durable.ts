import type { CompleteRequest, CompleteResponse, StageName } from '@sparkade/shared';
import type { Db } from '../storage/db';

/** The runner needs a job ledger, not a particular database implementation. */
export type PipelineStore = Pick<
  Db,
  | 'getJob'
  | 'getJobForGame'
  | 'getJobByIdempotencyKey'
  | 'insertJob'
  | 'updateJob'
  | 'listJobs'
  | 'getGame'
  | 'listGames'
  | 'upsertGame'
  | 'setGameStatus'
  | 'setGameCost'
  | 'resetGameForRetry'
  | 'reconcileInterruptedJobs'
  | 'jobPriceSnapshot'
  | 'jobImagePriceSnapshot'
  | 'insertUsage'
  | 'gameCost'
  | 'usageForGame'
  | 'insertRepairEvent'
  | 'repairEventsForJob'
  | 'appendGenerationEvent'
>;

export interface DurableImageRequest {
  role: string;
  label: string;
  prompt: string;
  reference?: Buffer;
  size?: string;
}

export interface DurablePipelineCalls {
  abort: AbortController;
  suspended(): boolean;
  complete(stage: StageName, request: CompleteRequest, model: string): Promise<CompleteResponse>;
  image(request: DurableImageRequest): Promise<{ image: Buffer; imageCount: number }>;
}
