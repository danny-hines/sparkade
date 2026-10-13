import type { SegmentationMaskRecord } from '@meta-sam/parser';
import type { CompleteRequest, CompleteResponse, StageName } from '@sparkade/shared';
import type { Db } from '../storage/db';

/** Control flow for one branch reaching an unfinished external dependency. */
export class PipelineSuspended extends Error {
  readonly code = 'suspended';
  constructor() {
    super('Waiting for cloud steps');
    this.name = 'PipelineSuspended';
  }
}

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

export interface DurableSegmentRequest {
  role: string;
  concept: string;
  /** PNG sent to SAM 3.1. */
  image: Buffer;
}

export interface DurablePipelineCalls {
  abort: AbortController;
  suspended(): boolean;
  complete(stage: StageName, request: CompleteRequest, model: string): Promise<CompleteResponse>;
  image(request: DurableImageRequest): Promise<{ image: Buffer; imageCount: number }>;
  /** SAM 3.1 concept segmentation. Hosts without it skip optional
   * segmentation steps. */
  segment?(request: DurableSegmentRequest): Promise<{ masks: SegmentationMaskRecord[] }>;
}
