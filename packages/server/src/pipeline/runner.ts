// The durable generation job runner (one job at a time — this is a 1 GB device).
// Jobs are persisted BEFORE work starts; all output goes to staging/<jobId>/
// and is atomically renamed into games/<gameId>/ only after every gate passes.
// On boot the server reconciles: interrupted jobs become failed-retryable.
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { archetypes } from '@sparkade/archetypes';
import {
  ENGINE_VERSION,
  GENERATION,
  nearestMood,
  paletteProblems,
  SPEC_VERSION,
  stageSchema,
  type ArchetypeId,
  type DesignDoc,
  type FighterCharacter,
  type FighterSpec,
  type GameMetaFile,
  type GeneratedGameAssetRole,
  type GameSpec,
  type JobEvent,
  type JobStage,
  type LintError,
  type PartialSpec,
  type SparkadeConfig,
  type StageName,
} from '@sparkade/shared';
import {
  GENERATED_DEFEAT_PORTRAIT_PROMPT_VERSION,
  GENERATED_HEAD_PROMPT_VERSION,
  GENERATED_PORTRAIT_PROMPT_VERSION,
  describeVisibleTraits,
  generateDefeatPortrait,
  generateHeadSprites,
  generatePortrait,
  type GeneratedHeadDirection,
  type LikenessImageEdit,
} from '../likeness/portrait-gen';
import {
  ProviderAuthError,
  ProviderHttpError,
  ProviderNetworkError,
  stageProvider,
} from '../providers/index';
import { MetaImageAdapter, META_IMAGE_DEFAULT_API_KEY_ENV } from '../providers/meta-image';
import {
  buildKeyArtPrompt,
  buildKeyArtPolicyFallbackPrompt,
  buildStoryArtPrompt,
  buildStoryArtPolicyFallbackPrompt,
  KEY_ART_ASPECT_HINT,
  KEY_ART_PROMPT_VERSION,
  mockGeneratedImage,
  normalizeKeyArt,
  normalizeStoryArt,
  prepareImageReference,
  STORY_ART_ASPECT_HINT,
  STORY_ART_PROMPT_VERSION,
  type StoryArtRole,
} from '../assets/game-art';
import {
  GENERATED_FIGHTER_ATLAS_PROMPT_VERSION,
  GENERATED_FIGHTER_POSES,
  GENERATED_FIGHTER_POSE_PROMPT_VERSION,
  bestAvailableFighterPoseFallback,
  buildFighterIdentityCandidatePrompt,
  buildGeneratedFighterAtlas,
  buildFighterPosePrompt,
  prepareGeneratedFighterReference,
  processGeneratedFighterPose,
  validateGeneratedFighterAtlas,
  type GeneratedFighterPose,
} from '../assets/fighter-pose';
import {
  FIGHTER_POSE_SHEET_GROUPS,
  FIGHTER_POSE_SHEET_PROMPT_VERSION,
  actionPosesFromSheets,
  buildFighterPoseSheetPrompt,
  buildFighterPoseSheetSeed,
  recoverRejectedFighterSheetCells,
  splitGeneratedFighterPoseSheet,
  type FighterPoseSheetCellResult,
  type FighterPoseSheetGroup,
} from '../assets/fighter-pose-sheet';
import {
  FIGHTER_IDENTITY_JUDGE_PROMPT_VERSION,
  FIGHTER_POSE_JUDGE_PROMPT_VERSION,
  FIGHTER_ROSTER_PIPELINE_PROMPT_VERSION,
  FIGHTER_ROSTER_SLOTS,
  bestFighterIdentityCandidateIds,
  bestFighterPoseCandidateIds,
  buildFighterIdentityJudgeBoard,
  buildFighterIdentityJudgePrompt,
  buildFighterIdentityJudgeSchema,
  buildFighterPoseJudgeBoard,
  buildFighterPoseJudgePrompt,
  buildFighterPoseJudgeSchema,
  fighterPosesNeedingRetry,
  normalizeFighterIdentityJudgeDecision,
  normalizeFighterPoseJudgeDecision,
  type FighterIdentityCandidateDescriptor,
  type FighterPoseCandidateDescriptor,
  type FighterRosterSlot,
} from '../assets/fighter-pose-judge';
import {
  GENERATED_PLATFORMER_POSES,
  GENERATED_PLATFORMER_POSE_PROMPT_VERSION,
  prepareGeneratedPlatformerReference,
  processGeneratedPlatformerPose,
  recoverGeneratedPlatformerGreenPanel,
  validateGeneratedPlatformerPoseSet,
  type GeneratedPlatformerPose,
} from '../assets/platformer-pose';
import {
  PLATFORMER_IDLE_JUDGE_PROMPT_VERSION,
  bestPlatformerIdleCandidateId,
  buildPlatformerIdleCandidatePrompt,
  buildPlatformerIdleJudgeBoard,
  buildPlatformerIdleJudgePrompt,
  buildPlatformerIdleJudgeSchema,
  normalizePlatformerIdleJudgeDecision,
  type PlatformerIdleCandidateDescriptor,
} from '../assets/platformer-idle-judge';
import {
  PLATFORMER_PLAYER_PIPELINE_PROMPT_VERSION,
  PLATFORMER_POSE_JUDGE_PROMPT_VERSION,
  bestPlatformerPosePair,
  buildPlatformerPhaseACandidatePrompt,
  buildPlatformerPhaseBCandidatePrompt,
  buildPlatformerJumpCandidatePrompt,
  buildPlatformerPoseJudgeBoard,
  buildPlatformerPoseJudgePrompt,
  buildPlatformerPoseJudgeSchema,
  buildPlatformerSideAnchorPrompt,
  normalizePlatformerPoseJudgeDecision,
  type PlatformerPoseCandidateDescriptor,
} from '../assets/platformer-pose-judge';
import {
  PLATFORMER_BOSS_JUDGE_PROMPT_VERSION,
  PLATFORMER_BOSS_PIPELINE_PROMPT_VERSION,
  PLATFORMER_BOSS_PROMPT_VERSION,
  bestPlatformerBossCandidateId,
  buildPlatformerBossCandidatePrompt,
  buildPlatformerBossJudgeBoard,
  buildPlatformerBossJudgePrompt,
  buildPlatformerBossJudgeSchema,
  normalizePlatformerBossJudgeDecision,
  processGeneratedPlatformerBoss,
  type PlatformerBossCandidateDescriptor,
} from '../assets/platformer-boss';
import {
  GENERATED_PLATFORMER_ENEMIES,
  PLATFORMER_ENEMY_JUDGE_PROMPT_VERSION,
  PLATFORMER_ENEMY_PIPELINE_PROMPT_VERSION,
  PLATFORMER_ENEMY_PROMPT_VERSION,
  buildPlatformerEnemyCandidatePrompt,
  buildPlatformerEnemyJudgeBoard,
  buildPlatformerEnemyJudgePrompt,
  buildPlatformerEnemyJudgeSchema,
  normalizePlatformerEnemyJudgeDecision,
  processGeneratedPlatformerEnemy,
  type GeneratedPlatformerEnemy,
  type PlatformerEnemyCandidateDescriptor,
} from '../assets/platformer-enemy';
import {
  GENERATED_PLATFORMER_BACKDROPS,
  PLATFORMER_BACKDROP_ASPECT_HINT,
  PLATFORMER_BACKDROP_ASSET_ROLES,
  PLATFORMER_BACKDROP_PROMPT_VERSION,
  buildPlatformerBackdropPrompt,
  normalizePlatformerBackdrop,
  type GeneratedPlatformerBackdrop,
} from '../assets/platformer-backdrop';
import {
  GENERATED_PLATFORMER_PROPS,
  PLATFORMER_PROP_PIPELINE_PROMPT_VERSION,
  PLATFORMER_PROP_PROMPT_VERSION,
  buildPlatformerPropPrompt,
  processGeneratedPlatformerProp,
  type GeneratedPlatformerProp,
} from '../assets/platformer-prop';
import {
  GameAssetWorkspace,
  GeneratedAssetStorageError,
  imagePromptHash,
  sha256,
} from '../assets/manifest';
import type { ConfigStore } from '../storage/config';
import type { Db } from '../storage/db';
import type { GameFiles, RawStageName } from '../storage/files';
import {
  detectIncidentRuntime,
  hasSubstantiveRepair,
  IncidentStore,
  type GenerationIncident,
  type IncidentOutcome,
} from '../storage/incidents';
import { costOf, type PriceSnapshot } from './cost';
import { applyPatch, PatchError, type JsonPatchOp } from './patch';
import {
  buildDesignPrompt,
  buildEntitiesPrompt,
  buildLevelRegenerationPrompt,
  buildLevelsPrompt,
  buildMusicPrompt,
  buildRepairPrompt,
  parseModelJson,
  type RecentUse,
  type BuiltPrompt,
  type RepairOwner,
} from './prompts';
import { compileTileRunsStage, TileRunsError } from './tile-runs';
import {
  assertPatchTargetsOwner,
  diagnosticOwner,
  diagnosticSignature,
  diagnosticsForOwner,
  failingLevelIndexes,
  groupDiagnostics,
  repairMadeProgress,
} from './repair-policy';
import type { SseHub } from './sse';
import {
  applySpriteFallbacks,
  applySpriteFallbacksForRepair,
  customBossSpriteDiagnostics,
  ensureLikenessHeroBody,
  ensurePlatformerImageCharacterFallbacks,
  normalizeGeneratedSpec,
  normalizeTileGrids,
  repairPlatformerExitRoutes,
  securityScan,
  tooSimilar,
  validateDesignSchema,
  validateGameSchema,
  validateAgainst,
} from './validate';
import { ensureDir, nowIso, sleep } from '../util';

export class PipelineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly stage: JobStage = 'failed',
  ) {
    super(message);
  }
}

function isOptionalGeneratedArtProviderFailure(error: unknown): boolean {
  return (
    error instanceof PipelineError &&
    (error.code === 'image-provider-error' || error.code === 'image-content-policy')
  );
}

function isImageContentPolicyViolation(error: unknown): boolean {
  return (
    error instanceof ProviderHttpError &&
    error.status === 400 &&
    /content_policy_violation|content management policy/i.test(`${error.body} ${error.message}`)
  );
}

export interface NewJobInputs {
  promptText: string;
  sourceKind: 'voice' | 'preset' | 'surprise';
  presetId?: string;
  /** Explicit genre chosen by Surprise; authoritative over model classification. */
  requestedArchetype?: ArchetypeId;
  photo?: Buffer;
  idempotencyKey: string;
}

const FIGHTER_ROSTER_ASSET_ROLES = {
  player: 'fighterPlayerAtlas',
  opponent1: 'fighterOpponent1Atlas',
  opponent2: 'fighterOpponent2Atlas',
  opponent3: 'fighterOpponent3Atlas',
  boss: 'fighterBossAtlas',
} as const satisfies Record<FighterRosterSlot, GeneratedGameAssetRole>;

const PLATFORMER_ASSET_ROLES = {
  idle: 'platformerIdle',
  sideIdle: 'platformerSideIdle',
  walk1: 'platformerWalk1',
  walk2: 'platformerWalk2',
  jump: 'platformerJump',
} as const satisfies Record<GeneratedPlatformerPose, GeneratedGameAssetRole>;

const PLATFORMER_ENEMY_ASSET_ROLES = {
  walker: 'platformerEnemyWalker',
  flyer: 'platformerEnemyFlyer',
  shooter: 'platformerEnemyShooter',
  chaser: 'platformerEnemyChaser',
} as const satisfies Record<GeneratedPlatformerEnemy, GeneratedGameAssetRole>;

const PLATFORMER_PROP_ASSET_ROLES = {
  collectible: 'platformerPropCollectible',
  health: 'platformerPropHealth',
  powerup: 'platformerPropPowerup',
  heroProjectile: 'platformerPropHeroProjectile',
  enemyProjectile: 'platformerPropEnemyProjectile',
} as const satisfies Record<GeneratedPlatformerProp, GeneratedGameAssetRole>;

/** Surprise's structured genre is authoritative; the design model still gets
 * the instruction, but cannot silently relabel the job by returning another id. */
export function enforceRequestedArchetype(
  design: DesignDoc,
  requestedArchetype?: ArchetypeId,
): DesignDoc {
  return requestedArchetype ? { ...design, archetype: requestedArchetype } : design;
}

function dedupeDiagnostics(diagnostics: readonly LintError[]): LintError[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.code}\u0000${diagnostic.path}\u0000${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compileGeneratedLevels(
  archetype: ArchetypeId,
  output: unknown,
  requireCompact = false,
): unknown {
  if (archetype !== 'platformer' && archetype !== 'hshooter') return output;
  if (requireCompact) {
    const levels = Array.isArray(output) ? output : isRecord(output) ? output['levels'] : null;
    if (!Array.isArray(levels)) throw new TileRunsError('$.levels', 'expected an array');
    levels.forEach((level, index) => {
      if (!isRecord(level) || !Object.prototype.hasOwnProperty.call(level, 'tileRuns')) {
        throw new TileRunsError(
          `$.levels[${index}].tileRuns`,
          'compact generation output must include tileRuns instead of tiles',
        );
      }
    });
  }
  return compileTileRunsStage(archetype, output, { normalizeWidths: true });
}

function compileGeneratedLevel(archetype: ArchetypeId, level: unknown): unknown {
  if (archetype !== 'platformer' && archetype !== 'hshooter') return level;
  if (!isRecord(level) || !Object.prototype.hasOwnProperty.call(level, 'tileRuns')) {
    throw new TileRunsError(
      '$.levels[0].tileRuns',
      'compact generation output must include tileRuns instead of tiles',
    );
  }
  const compiled = compileTileRunsStage(
    archetype,
    { levels: [level] },
    { normalizeWidths: true },
  ) as { levels: unknown[] };
  return compiled.levels[0];
}

function canonicalLevelsFallback(
  archetype: ArchetypeId,
  output: unknown,
  compactError: TileRunsError,
): unknown {
  const canonical = compileGeneratedLevels(archetype, output);
  const errors = validateAgainst(
    `canonical-fallback:${archetype}:levels`,
    stageSchema(archetype, 'levels'),
    canonical,
  );
  if (errors.length) throw compactError;
  return canonical;
}

function canonicalLevelFallback(level: unknown, compactError: TileRunsError): unknown {
  if (
    isRecord(level) &&
    Array.isArray(level['tiles']) &&
    !Object.prototype.hasOwnProperty.call(level, 'tileRuns')
  ) {
    return level;
  }
  throw compactError;
}

function tileRunsDiagnostic(error: TileRunsError, levelIndex?: number): LintError {
  let pointer = error.path
    .replace(/^\$\.?/, '/')
    .replace(/\[(\d+)\]/g, '/$1')
    .replace(/\./g, '/')
    .replace(/\/{2,}/g, '/');
  if (levelIndex !== undefined) {
    pointer = pointer.replace(/^\/levels\/0(?=\/|$)/, `/levels/${levelIndex}`);
  }
  return {
    code: 'TILE_RUNS_INVALID',
    path: pointer.startsWith('/') ? pointer : '/levels',
    message: error.message,
  };
}

export function designOutputDiagnostics(raw: unknown): LintError[] {
  const schema = validateDesignSchema(raw);
  if (schema.length || !isRecord(raw)) return schema;
  // Reuse the same inert-string scan applied to the assembled game. Supplying
  // an empty sprite roster keeps design fields at their natural JSON paths.
  return securityScan({
    ...raw,
    sprites: { custom: {}, assign: {} },
  } as unknown as GameSpec);
}

/**
 * A JSON parse failure at the model's completion ceiling is usually truncation,
 * not a request that benefits from repeating the same ceiling. Grow only the
 * retry allowance, conservatively and with a hard +4k cap, so a rare malformed
 * response cannot turn into an unbounded generation bill.
 */
export function parseRetryTokenBudget(baseTokens: number, retryAttempt: number): number {
  const base = Number.isFinite(baseTokens) ? Math.max(1, Math.round(baseTokens)) : 1;
  const attempt = Number.isFinite(retryAttempt) ? Math.max(1, Math.floor(retryAttempt)) : 1;
  return Math.min(base + 4000, Math.ceil(base * (1 + attempt * 0.25)));
}

/**
 * Level geometry already gets its creative direction from the design pass.
 * Live Muse runs at temperature 1 spent 10.5k tokens and truncated, while the
 * otherwise identical temperature-0 retries completed in 6.5-7.1k tokens.
 * Keep that heavy structured stage deterministic from its first call; every
 * retry remains deterministic for all stages.
 */
export function generationTemperature(
  stage: StageName,
  retryAttempt: number,
  requested?: number,
): number | undefined {
  return retryAttempt > 0 || stage === 'levels' ? 0 : requested;
}

interface SpecParts {
  player?: unknown;
  levels?: unknown;
  entities?: {
    sprites: unknown;
    boss: unknown;
    sfx?: unknown;
    backdrop?: unknown;
    weather?: unknown;
    lighting?: unknown;
    juice?: unknown;
  };
  music?: unknown;
}

export class GenerationRunner {
  private queue: string[] = [];
  private active = new Set<string>(); // jobs currently running (up to maxConcurrent)
  private readonly maxConcurrent = Math.max(
    1,
    Number(process.env.SPARKADE_GEN_CONCURRENCY) || GENERATION.maxConcurrentJobs,
  );
  private aborts = new Map<string, AbortController>();
  private canceled = new Set<string>();
  private activeImageCalls = 0;
  private readonly maxConcurrentImageCalls = Math.max(
    1,
    Number(process.env.SPARKADE_IMAGE_CONCURRENCY) || GENERATION.maxConcurrentImageCalls,
  );
  private imageCallWaiters: Array<{
    signal: AbortSignal;
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    onAbort: () => void;
  }> = [];
  private readonly incidents: IncidentStore | null;

  constructor(
    private db: Db,
    private files: GameFiles,
    private configStore: ConfigStore,
    private hub: SseHub,
  ) {
    // A few pure semaphore tests intentionally provide a minimal file-store
    // double. Incident capture is best-effort telemetry, never a prerequisite
    // for constructing or running the generation machinery.
    this.incidents = typeof files.dir === 'string' ? new IncidentStore(files.dir) : null;
  }

  /** Called at boot: interrupted jobs -> failed-retryable (never stuck "Generating"). */
  reconcile(): void {
    this.db.reconcileInterruptedJobs();
  }

  isBusy(): boolean {
    return this.active.size > 0;
  }

  createJob(inputs: NewJobInputs): { jobId: string; gameId: string } {
    const existing = this.db.getJobByIdempotencyKey(inputs.idempotencyKey);
    if (existing) return { jobId: existing.id, gameId: existing.gameId };

    const gameId = `g-${nanoid(10)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, 'x')}`;
    const jobId = `j-${nanoid(12)}`;
    const seed = randomInt(0, 2147483647);
    const config = this.configStore.get();
    const snapshot = this.snapshotPricing(config);
    const title = inputs.promptText.slice(0, 28).trim() || 'New game';

    // Persist BEFORE any work: photo to staging, then job + game rows.
    if (inputs.photo) {
      const dir = this.files.stagingFor(jobId);
      writeFileSync(join(dir, 'photo.jpg'), inputs.photo, { mode: 0o600 });
    }
    this.db.insertJob(
      {
        id: jobId,
        gameId,
        status: 'queued',
        stage: 'queued',
        detail: 'Waiting in line',
        promptText: inputs.promptText,
        sourceKind: inputs.sourceKind,
        ...(inputs.presetId ? { presetId: inputs.presetId } : {}),
        ...(inputs.requestedArchetype ? { requestedArchetype: inputs.requestedArchetype } : {}),
        seed,
        idempotencyKey: inputs.idempotencyKey,
        hasPhoto: !!inputs.photo,
        createdAt: nowIso(),
        costSoFarUsd: 0,
        attempt: 1,
      },
      snapshot,
      {
        model: config.imageGeneration.model,
        perImageUsd: Number.isFinite(config.imageGeneration.pricePerImageUsd)
          ? Math.max(0, config.imageGeneration.pricePerImageUsd)
          : null,
      },
    );
    this.db.upsertGame({
      id: gameId,
      title,
      tagline: 'Generating…',
      archetype: inputs.requestedArchetype ?? 'platformer',
      status: 'queued',
      createdAt: nowIso(),
      golden: false,
      jobId,
      costUsd: 0,
      cover: null,
      failure: null,
      engineVersion: ENGINE_VERSION,
      archetypeVersion: '',
    });
    this.enqueue(jobId);
    return { jobId, gameId };
  }

  /** Re-run failed generation from stored inputs; cost history is preserved. */
  retryJob(gameId: string): { jobId: string } | null {
    const job = this.db.getJobForGame(gameId);
    if (!job || (job.status !== 'failed' && job.status !== 'canceled')) return null;
    this.canceled.delete(job.id);
    try {
      this.incidents?.markRetry(job.id, job.attempt, job.attempt + 1, 'running');
    } catch (error) {
      console.warn('could not update generation incident retry state:', error);
    }
    this.db.updateJob(job.id, {
      status: 'queued',
      stage: 'queued',
      detail: 'Retrying',
      error: null,
      attempt: job.attempt + 1,
    });
    // Clear only the visible preview. Durable raw checkpoints remain available
    // to the next attempt, which validates and restores every healthy completed
    // stage while regenerating the recorded failing owner. The photo and cost
    // history are preserved as before.
    this.db.resetGameForRetry(gameId, job.promptText.slice(0, 28).trim() || 'New game');
    this.files.clearPartial(job.id);
    this.enqueue(job.id);
    return { jobId: job.id };
  }

  /** Cancel a running/queued job (used by game delete). */
  cancelForGame(gameId: string): void {
    const job = this.db.getJobForGame(gameId);
    if (!job) return;
    this.canceled.add(job.id);
    this.queue = this.queue.filter((j) => j !== job.id);
    this.aborts.get(job.id)?.abort();
    if (job.status === 'queued' || job.status === 'running' || job.status === 'waiting-network') {
      this.db.updateJob(job.id, { status: 'canceled', finishedAt: nowIso() });
    }
    this.files.discardStaging(job.id);
  }

  private enqueue(jobId: string): void {
    if (!this.queue.includes(jobId)) this.queue.push(jobId);
    this.pump();
  }

  /** Start jobs until the concurrency cap is reached. Jobs run independently
   *  (isolated staging + abort + DB rows), so several proceed in parallel and
   *  their model-call waits overlap. */
  private pump(): void {
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      const jobId = this.queue.shift()!;
      this.active.add(jobId);
      void this.runOne(jobId);
    }
  }

  private async runOne(jobId: string): Promise<void> {
    try {
      await this.execute(jobId);
    } finally {
      this.active.delete(jobId);
      this.pump(); // fill the freed slot
    }
  }

  private snapshotPricing(config: SparkadeConfig): PriceSnapshot {
    return structuredClone(config.pricing);
  }

  /** FIFO semaphore shared by every running job. The slot is held only for the
   * provider request itself, never validation, local image work, or backoff. */
  private async withImageCallSlot<T>(signal: AbortSignal, call: () => Promise<T>): Promise<T> {
    const release = await this.acquireImageCallSlot(signal);
    try {
      return await call();
    } finally {
      release();
    }
  }

  private acquireImageCallSlot(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new Error('image request canceled'));
    if (this.activeImageCalls < this.maxConcurrentImageCalls) {
      this.activeImageCalls++;
      return Promise.resolve(() => this.releaseImageCallSlot());
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        signal,
        resolve,
        reject,
        onAbort: () => {
          const index = this.imageCallWaiters.indexOf(waiter);
          if (index >= 0) this.imageCallWaiters.splice(index, 1);
          signal.removeEventListener('abort', waiter.onAbort);
          reject(new Error('image request canceled'));
        },
      };
      this.imageCallWaiters.push(waiter);
      signal.addEventListener('abort', waiter.onAbort, { once: true });
    });
  }

  private releaseImageCallSlot(): void {
    for (;;) {
      const waiter = this.imageCallWaiters.shift();
      if (!waiter) {
        this.activeImageCalls--;
        return;
      }
      waiter.signal.removeEventListener('abort', waiter.onAbort);
      if (waiter.signal.aborted) {
        waiter.reject(new Error('image request canceled'));
        continue;
      }
      waiter.resolve(() => this.releaseImageCallSlot());
      return;
    }
  }

  // ------------------------------------------------------------------ execute

  private async execute(jobId: string): Promise<void> {
    const job = this.db.getJob(jobId);
    if (!job || this.canceled.has(jobId)) return;
    const gameId = job.gameId;
    const config = this.configStore.get();
    const snapshot = this.db.jobPriceSnapshot(jobId);
    const imageSnapshot = this.db.jobImagePriceSnapshot(jobId) ?? {
      model: config.imageGeneration.model,
      perImageUsd: Number.isFinite(config.imageGeneration.pricePerImageUsd)
        ? Math.max(0, config.imageGeneration.pricePerImageUsd)
        : null,
    };
    const abort = new AbortController();
    this.aborts.set(jobId, abort);
    const startedAt = Date.now();
    let slow = false;
    const softTimer = setTimeout(() => {
      slow = true;
    }, GENERATION.softBudgetMs);
    const hardTimer = setTimeout(() => abort.abort(), GENERATION.hardBudgetMs);

    const emit = (
      stage: JobStage,
      detail: string,
      extra: Partial<Extract<JobEvent, { type: 'progress' }>> = {},
    ) => {
      this.db.updateJob(jobId, { stage, detail });
      this.hub.emit({
        type: 'progress',
        jobId,
        stage,
        detail,
        elapsedMs: Date.now() - startedAt,
        costSoFarUsd: this.db.gameCost(gameId),
        slow,
        ...extra,
      });
    };

    const callLlm = async (
      stageName: StageName,
      prompt: BuiltPrompt,
      opts: {
        temperature?: number;
        repair?: boolean;
        image?: Buffer;
        reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
        checkpoint?: RawStageName;
        label: string;
        stage: JobStage;
      },
    ): Promise<unknown> => {
      const { provider, providerName, model } = stageProvider(config, stageName);
      if (opts.image && !provider.capabilities.imageIn) {
        throw new Error(`provider "${providerName}" does not support image input`);
      }
      let attempt = 0;
      let activePrompt = prompt;
      for (;;) {
        if (abort.signal.aborted)
          throw new PipelineError('timeout', 'generation hit the time limit', opts.stage);
        try {
          const stageCfg = config.stages[stageName];
          const res = await provider.complete(
            {
              system: activePrompt.system,
              user: activePrompt.user,
              maxTokens: activePrompt.maxTokens,
              temperature: generationTemperature(stageName, attempt, opts.temperature),
              ...(opts.reasoningEffort
                ? { effort: opts.reasoningEffort }
                : stageCfg?.reasoningEffort
                  ? { effort: stageCfg.reasoningEffort }
                  : {}),
              ...(activePrompt.timeoutMs ? { timeoutMs: activePrompt.timeoutMs } : {}),
              ...(provider.capabilities.structuredOutput
                ? { jsonSchema: activePrompt.jsonSchema }
                : {}),
              ...(opts.image && provider.capabilities.imageIn ? { image: opts.image } : {}),
            },
            { model, signal: abort.signal },
          );
          this.db.insertUsage({
            jobId,
            gameId,
            stage: stageName,
            model,
            provider: providerName,
            inputTokens: res.usage.input,
            outputTokens: res.usage.output,
            cachedTokens: res.usage.cachedInput ?? 0,
            costUsd: costOf(model, res.usage, snapshot),
            failed: false,
            repair: opts.repair ?? false,
          });
          emit(opts.stage, opts.label, {});
          const parsed = parseModelJson(res.text);
          if (opts.checkpoint) {
            try {
              this.files.writeRawStageCheckpoint(jobId, job.attempt, opts.checkpoint, parsed);
            } catch {
              // Checkpointing is evidence/resume infrastructure; a full disk or
              // permissions issue must not turn a valid, already-billed model
              // response into an identical provider retry.
            }
          }
          return parsed;
        } catch (e) {
          if (abort.signal.aborted)
            throw new PipelineError('timeout', 'generation hit the time limit', opts.stage);
          if (e instanceof ProviderAuthError) {
            throw new PipelineError('auth', e.message, opts.stage);
          }
          if (e instanceof ProviderNetworkError) {
            // Offline: wait rather than fail. The hard cap still bounds the job.
            this.db.updateJob(jobId, { status: 'waiting-network' });
            emit(opts.stage, 'Waiting for network…', { waitingForNetwork: true });
            await sleep(8000, abort.signal).catch(() => {
              throw new PipelineError('timeout', 'generation hit the time limit', opts.stage);
            });
            this.db.updateJob(jobId, { status: 'running' });
            continue; // network waits don't consume transient-retry budget
          }
          const transient = e instanceof ProviderHttpError && e.transient;
          const parseIssue = e instanceof Error && /JSON|parse/i.test(e.message);
          this.db.insertUsage({
            jobId,
            gameId,
            stage: stageName,
            model,
            provider: providerName,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            failed: true,
            repair: opts.repair ?? false,
          });
          if ((transient || parseIssue) && attempt < GENERATION.maxTransientRetriesPerCall) {
            attempt++;
            if (parseIssue) {
              activePrompt = {
                ...prompt,
                user: `${prompt.user}\n\nRETRY NOTE: The previous response was not valid JSON. Return one complete JSON value matching the response schema, with every string escaped and no prose or markdown.`,
                maxTokens: parseRetryTokenBudget(prompt.maxTokens, attempt),
              };
            }
            const retryAfter =
              e instanceof ProviderHttpError && e.retryAfterS ? e.retryAfterS * 1000 : 0;
            const backoff =
              Math.max(retryAfter, 1000 * Math.pow(3, attempt - 1)) + Math.random() * 500;
            emit(opts.stage, `Retrying (${attempt}/${GENERATION.maxTransientRetriesPerCall})…`);
            await sleep(backoff, abort.signal).catch(() => {
              throw new PipelineError('timeout', 'generation hit the time limit', opts.stage);
            });
            continue;
          }
          const timedOut = e instanceof ProviderHttpError && e.status === 408;
          throw new PipelineError(
            timedOut ? 'call-timeout' : transient ? 'provider-unavailable' : 'provider-error',
            e instanceof Error ? e.message : String(e),
            opts.stage,
          );
        }
      }
    };

    const mockImages = process.env.SPARKADE_PROVIDER === 'mock';
    const imageConfig = config.imageGeneration;
    const imageModel = mockImages ? 'mock-image' : imageSnapshot.model;
    // Construct lazily inside callImage's guarded try. Invalid live config must
    // become a persisted job failure, not reject execute before its outer
    // failure/finally handling has started.
    let imageAdapter: MetaImageAdapter | null = null;
    const getImageAdapter = (): MetaImageAdapter | null => {
      if (mockImages) return null;
      imageAdapter ??= new MetaImageAdapter({
        baseUrl: imageConfig.baseUrl,
        model: imageModel,
        apiKeyEnv: imageConfig.apiKeyEnv,
        timeoutMs: imageConfig.timeoutMs,
      });
      return imageAdapter;
    };
    const imagePrice = mockImages ? 0 : imageSnapshot.perImageUsd;
    const callImage = async (opts: {
      role: string;
      label: string;
      prompt: string;
      reference?: Buffer;
      size?: string;
    }): Promise<Buffer> => {
      let attempt = 0;
      for (;;) {
        if (abort.signal.aborted) {
          throw new PipelineError('timeout', 'generation hit the time limit', 'building-assets');
        }
        try {
          const adapter = getImageAdapter();
          const result = await this.withImageCallSlot(abort.signal, async () =>
            adapter
              ? opts.reference
                ? adapter.edit(
                    {
                      prompt: opts.prompt,
                      image: opts.reference,
                      imageMimeType: 'image/png',
                      imageFilename: 'reference.png',
                      outputFormat: 'png',
                      size: opts.size ?? imageConfig.size,
                      user: gameId,
                    },
                    { signal: abort.signal },
                  )
                : adapter.generate(
                    {
                      prompt: opts.prompt,
                      outputFormat: 'png',
                      size: opts.size ?? imageConfig.size,
                      user: gameId,
                    },
                    { signal: abort.signal },
                  )
              : Promise.resolve({
                  image: await mockGeneratedImage(opts.prompt),
                  imageCount: 1,
                }),
          );
          this.db.insertUsage({
            jobId,
            gameId,
            stage: `image:${opts.role}`,
            model: imageModel,
            provider: mockImages ? 'mock' : 'meta-image',
            inputTokens: 0,
            outputTokens: 0,
            costUsd:
              mockImages || imagePrice === null
                ? mockImages
                  ? 0
                  : null
                : imagePrice * result.imageCount,
            failed: false,
            repair: false,
          });
          emit('building-assets', opts.label);
          return result.image;
        } catch (error) {
          if (abort.signal.aborted) {
            throw new PipelineError('timeout', 'generation hit the time limit', 'building-assets');
          }
          if (error instanceof ProviderAuthError) {
            throw new PipelineError('auth', error.message, 'building-assets');
          }
          if (error instanceof ProviderNetworkError) {
            this.db.updateJob(jobId, { status: 'waiting-network' });
            emit('building-assets', 'Waiting for network…', { waitingForNetwork: true });
            await sleep(8000, abort.signal).catch(() => {
              throw new PipelineError(
                'timeout',
                'generation hit the time limit',
                'building-assets',
              );
            });
            this.db.updateJob(jobId, { status: 'running' });
            continue;
          }

          this.db.insertUsage({
            jobId,
            gameId,
            stage: `image:${opts.role}`,
            model: imageModel,
            provider: mockImages ? 'mock' : 'meta-image',
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            failed: true,
            repair: false,
          });
          const malformed =
            error instanceof Error &&
            /image response|base64|decoded|empty image|JSON|unexpected token|unexpected end/i.test(
              error.message,
            );
          const transient = error instanceof ProviderHttpError && error.transient;
          if ((transient || malformed) && attempt < GENERATION.maxTransientRetriesPerCall) {
            attempt++;
            const retryAfter =
              error instanceof ProviderHttpError && error.retryAfterS
                ? error.retryAfterS * 1000
                : 0;
            const backoff =
              Math.max(retryAfter, 1000 * Math.pow(3, attempt - 1)) + Math.random() * 500;
            emit(
              'building-assets',
              `Retrying ${opts.label.toLowerCase()} (${attempt}/${GENERATION.maxTransientRetriesPerCall})…`,
            );
            await sleep(backoff, abort.signal).catch(() => {
              throw new PipelineError(
                'timeout',
                'generation hit the time limit',
                'building-assets',
              );
            });
            continue;
          }
          const timedOut = error instanceof ProviderHttpError && error.status === 408;
          const contentPolicy = isImageContentPolicyViolation(error);
          throw new PipelineError(
            timedOut
              ? 'call-timeout'
              : transient
                ? 'provider-unavailable'
                : contentPolicy
                  ? 'image-content-policy'
                  : 'image-provider-error',
            error instanceof Error ? error.message : String(error),
            'building-assets',
          );
        }
      }
    };
    const recordEarlyRepairEvent = (
      owner: RepairOwner,
      action: string,
      before: readonly LintError[],
      after: readonly LintError[],
      started: number,
      outcome: string,
    ): void => {
      try {
        const pass =
          this.db
            .repairEventsForJob(jobId)
            .filter((event) => event.attempt === job.attempt && event.owner === owner)
            .reduce((max, event) => Math.max(max, event.pass), 0) + 1;
        this.db.insertRepairEvent({
          jobId,
          gameId,
          attempt: job.attempt,
          pass,
          owner,
          action,
          diagnosticsBefore: before,
          diagnosticsAfter: after,
          elapsedMs: Date.now() - started,
          outcome,
        });
      } catch {
        /* telemetry must not fail generation */
      }
    };
    const captureIncident = (
      outcome: IncidentOutcome,
      trigger: { code: string; message: string; stage: JobStage },
      completedSpec?: GameSpec,
    ): GenerationIncident | null => {
      if (!this.incidents) return null;
      try {
        const partial = this.files.readPartial(jobId);
        const game = this.db.getGame(gameId);
        const partialArchetype =
          partial?.archetype && partial.archetype in archetypes
            ? (partial.archetype as ArchetypeId)
            : undefined;
        const archetype: ArchetypeId =
          completedSpec?.archetype ??
          partialArchetype ??
          game?.archetype ??
          job.requestedArchetype ??
          'platformer';
        const title =
          completedSpec?.meta.title ??
          partial?.title ??
          (game?.tagline !== 'Generating…' ? game?.title : undefined) ??
          'Untitled generation';
        const repairs = this.db
          .repairEventsForJob(jobId)
          .filter((event) => event.attempt === job.attempt);
        return this.incidents.capture({
          outcome,
          job,
          game: { title, archetype },
          trigger,
          repairs,
          checkpoints: this.files.listRawStageCheckpoints(jobId, job.attempt),
          runtime: detectIncidentRuntime({
            engineVersion: ENGINE_VERSION,
            archetypeVersion: archetypes[archetype].version,
            provider: process.env.SPARKADE_PROVIDER ?? config.stages.design.provider,
            textModel: config.stages.design.model,
            imageModel,
          }),
          cumulativeCostUsd: this.db.gameCost(gameId),
        });
      } catch (error) {
        console.warn('could not capture generation incident:', error);
        return null;
      }
    };

    try {
      this.db.updateJob(jobId, { status: 'running', startedAt: nowIso() });
      this.db.setGameStatus(gameId, 'generating');

      // Muse Image is mandatory for every newly generated game. Validate its
      // local configuration and credential before incurring any text-model cost.
      if (!mockImages) {
        try {
          getImageAdapter();
        } catch (error) {
          throw new PipelineError(
            'image-config',
            error instanceof Error ? error.message : String(error),
            'building-assets',
          );
        }
        const imageKeyEnv = imageConfig.apiKeyEnv.trim() || META_IMAGE_DEFAULT_API_KEY_ENV;
        if (!process.env[imageKeyEnv]?.trim()) {
          throw new PipelineError(
            'auth',
            `${imageKeyEnv} is not set (required for Muse Image)`,
            'building-assets',
          );
        }
      }

      emit('designing', 'Dreaming up the design…');

      const photoPath = join(this.files.stagingFor(jobId), 'photo.jpg');
      const photo = job.hasPhoto && existsSync(photoPath) ? readFileSync(photoPath) : undefined;
      const describeInStory = config.likeness.describeInStory;

      // ---- Design pass ---------------------------------------------------
      const recentGames = this.db
        .listGames()
        .filter((g) => g.status === 'ready' && g.id !== gameId)
        .slice(0, GENERATION.antiCollisionGames);
      const existingGames = recentGames.map((g) => ({ title: g.title, tagline: g.tagline }));

      // Body-level anti-collision for the entities stage: premise variety comes
      // from titles/taglines above; cast + palette variety needs the actual picks.
      const recentUse = {
        heroes: [] as string[],
        bosses: [] as string[],
        backdrops: [] as string[],
      };
      const recentMoods: string[] = [];
      for (const g of recentGames) {
        const s = this.files.readSpec(g.id);
        if (!s) continue;
        const assign = (s.sprites?.assign ?? {}) as Record<string, string>;
        if (assign['hero']?.startsWith('lib:')) recentUse.heroes.push(assign['hero']);
        if (assign['boss']?.startsWith('lib:')) recentUse.bosses.push(assign['boss']);
        if (s.backdrop) recentUse.backdrops.push(s.backdrop);
        if (Array.isArray(s.palette) && s.palette.length === 16)
          recentMoods.push(nearestMood(s.palette).name);
      }

      const requiredArchetypeNote = job.requestedArchetype
        ? `REQUIRED ARCHETYPE: ${job.requestedArchetype}. Design every level, character, control implication, and story beat for ${job.requestedArchetype}; do not choose a different archetype.`
        : undefined;
      const recordDesignRedraft = (
        before: readonly LintError[],
        after: readonly LintError[],
        started: number,
      ) =>
        recordEarlyRepairEvent(
          'document',
          'design-redraft',
          before,
          after,
          started,
          after.length ? 'failed' : 'fixed',
        );

      const priorAttempt = job.attempt > 1 ? job.attempt - 1 : null;
      const failedOwnersByAttempt = new Map<number, Set<string>>();
      for (const event of priorAttempt ? this.db.repairEventsForJob(jobId) : []) {
        if (
          event.outcome !== 'failed' ||
          (event.action !== 'terminal' && event.action !== 'regenerate')
        ) {
          continue;
        }
        const owners = failedOwnersByAttempt.get(event.attempt) ?? new Set<string>();
        owners.add(event.owner);
        failedOwnersByAttempt.set(event.attempt, owners);
      }
      let priorDesign: unknown;
      if (priorAttempt) {
        for (let attempt = priorAttempt; attempt >= 1 && priorDesign === undefined; attempt--) {
          // A document failure invalidates the design and everything derived
          // from it; do not fall through to an even older copy of that design.
          if (failedOwnersByAttempt.get(attempt)?.has('document')) break;
          const candidates = this.files
            .listRawStageCheckpoints(jobId, attempt)
            .filter((checkpoint) => checkpoint.stage === 'design')
            .reverse();
          priorDesign = candidates.find(
            (checkpoint) => designOutputDiagnostics(checkpoint.document).length === 0,
          )?.document;
        }
      }
      let design: DesignDoc;
      if (priorDesign !== undefined) {
        design = structuredClone(priorDesign) as DesignDoc;
        emit('designing', 'Resuming the completed design…');
      } else {
        design = await this.designPass(callLlm, {
          promptText: job.promptText,
          hasPhoto: !!photo,
          describeInStory,
          antiCollision: existingGames,
          recentMoods,
          photo: describeInStory ? photo : undefined,
          extraNote: requiredArchetypeNote,
          onRepair: recordDesignRedraft,
        });
      }
      design = enforceRequestedArchetype(design, job.requestedArchetype);

      // Similarity gate: too close to an existing game → regenerate the design once.
      const collision = tooSimilar(
        design.title,
        existingGames.map((g) => g.title),
      );
      if (collision) {
        const collisionRepairStarted = Date.now();
        const collisionBefore = [
          {
            code: 'DESIGN_TOO_SIMILAR',
            path: '/title',
            message: `title was too similar to ${collision}`,
          },
        ];
        emit('designing', 'Too similar to an existing game — redesigning…');
        design = await this.designPass(callLlm, {
          promptText: job.promptText,
          hasPhoto: !!photo,
          describeInStory,
          antiCollision: existingGames,
          recentMoods,
          photo: describeInStory ? photo : undefined,
          extraNote: [
            requiredArchetypeNote,
            `Your previous title "${design.title}" was too similar to "${collision}". Choose a clearly different title and premise.`,
          ]
            .filter(Boolean)
            .join(' '),
          onRepair: recordDesignRedraft,
        });
        design = enforceRequestedArchetype(design, job.requestedArchetype);
        const repeatedCollision = tooSimilar(
          design.title,
          existingGames.map((g) => g.title),
        );
        recordEarlyRepairEvent(
          'document',
          'design-collision-redraft',
          collisionBefore,
          repeatedCollision
            ? [
                {
                  code: 'DESIGN_TOO_SIMILAR',
                  path: '/title',
                  message: `redrafted title was still too similar to ${repeatedCollision}`,
                },
              ]
            : [],
          collisionRepairStarted,
          repeatedCollision ? 'fallback' : 'fixed',
        );
        if (repeatedCollision) {
          design.title = `${design.title.slice(0, 29)} II`;
        }
      }

      // Palette legibility gate: a palette can clear the JSON schema yet be
      // unplayable (hero lost in the background, unreadable text). If the model's
      // palette fails, snap to the nearest curated mood — guaranteed legible and
      // still in the model's intended hue family — rather than shipping it.
      const palProblems = paletteProblems(design.palette);
      if (palProblems.length) {
        const mood = nearestMood(design.palette);
        emit('designing', `Palette adjusted for legibility → ${mood.name}`);
        design = { ...design, palette: [...mood.colors] };
      }
      const designMatchesResumedCheckpoint =
        priorDesign !== undefined && JSON.stringify(design) === JSON.stringify(priorDesign);

      // This revision includes deterministic archetype/palette/collision gates,
      // so retry resume picks up the actual design used by the stage passes.
      try {
        this.files.writeRawStageCheckpoint(jobId, job.attempt, 'design', design);
      } catch {
        /* see callLlm checkpoint note */
      }

      const archetype = design.archetype;
      this.db.upsertGame({
        id: gameId,
        title: design.title,
        tagline: design.tagline,
        archetype,
        status: 'generating',
        createdAt: job.createdAt,
        golden: false,
        jobId,
        costUsd: this.db.gameCost(gameId),
        cover: null,
        failure: null,
        engineVersion: ENGINE_VERSION,
        archetypeVersion: archetypes[archetype].version,
      });

      // Surface stable pieces to the generation screen the instant each pass
      // lands — palette/title now, sprites and music as they finish — so the
      // wait shows the model's real output instead of a spinner. Best-effort:
      // a failed partial write never derails generation.
      const partial: PartialSpec = {
        archetype,
        title: design.title,
        tagline: design.tagline,
        palette: [...design.palette],
      };
      const pushPartial = (patch: Partial<PartialSpec>) => {
        Object.assign(partial, patch);
        try {
          this.files.writePartial(jobId, partial);
        } catch {
          /* preview is a nicety — never fail generation over it */
        }
      };
      pushPartial({});

      let resumedValidatedSpec: GameSpec | undefined;
      if (priorAttempt && designMatchesResumedCheckpoint) {
        for (let attempt = priorAttempt; attempt >= 1; attempt--) {
          const checkpoint = this.files.readValidatedSpecCheckpoint<DesignDoc>(jobId, attempt);
          if (
            !checkpoint ||
            checkpoint.engineVersion !== ENGINE_VERSION ||
            checkpoint.specVersion !== SPEC_VERSION ||
            checkpoint.archetypeVersion !== archetypes[archetype].version ||
            JSON.stringify(checkpoint.design) !== JSON.stringify(design) ||
            checkpoint.spec.archetype !== archetype ||
            checkpoint.spec.seed !== job.seed
          ) {
            continue;
          }
          const candidate = ensureLikenessHeroBody(structuredClone(checkpoint.spec), !!photo);
          if (this.collectDiagnostics(candidate, archetype).length === 0) {
            resumedValidatedSpec = candidate;
            break;
          }
        }
      }

      let spec: GameSpec;
      if (resumedValidatedSpec) {
        spec = resumedValidatedSpec;
        pushPartial({ sprites: spec.sprites, music: spec.music });
        emit('validating', 'Restored the validated game…');
      } else {
        // ---- Spec passes (parallel) --------------------------------------
        emit('writing-spec', 'Writing levels, entities and music…', {
          unitsDone: 0,
          unitsTotal: 3,
        });
        let unitsDone = 0;
        const tick = (what: string) => {
          unitsDone++;
          emit('writing-spec', `${what} done (${unitsDone}/3)`, { unitsDone, unitsTotal: 3 });
        };
        const parts: SpecParts = {};
        const resumeStage = (stage: Exclude<RawStageName, 'design'>): unknown | undefined => {
          if (!priorAttempt || !designMatchesResumedCheckpoint) return undefined;
          for (let attempt = priorAttempt; attempt >= 1; attempt--) {
            const failedOwners = failedOwnersByAttempt.get(attempt);
            if (failedOwners?.has('document') || failedOwners?.has(stage)) continue;
            const attemptDesign = this.files.readRawStageCheckpoint(
              jobId,
              attempt,
              'design',
            )?.document;
            if (JSON.stringify(attemptDesign) !== JSON.stringify(design)) continue;
            const checkpoints = this.files
              .listRawStageCheckpoints(jobId, attempt)
              .filter((checkpoint) => checkpoint.stage === stage)
              .reverse();
            for (const checkpoint of checkpoints) {
              try {
                const candidate =
                  stage === 'levels'
                    ? compileGeneratedLevels(archetype, checkpoint.document)
                    : structuredClone(checkpoint.document);
                if (
                  validateAgainst(
                    `resume:${archetype}:${stage}`,
                    stageSchema(archetype, stage),
                    candidate,
                  ).length
                ) {
                  continue;
                }
                this.files.writeRawStageCheckpoint(jobId, job.attempt, stage, checkpoint.document);
                return candidate;
              } catch {
                continue;
              }
            }
          }
          return undefined;
        };
        const resumedLevels = resumeStage('levels');
        const resumedEntities = resumeStage('entities');
        const resumedMusic = resumeStage('music');
        const loadLevels = async (): Promise<unknown> => {
          if (resumedLevels !== undefined) return resumedLevels;
          const raw = await callLlm('levels', buildLevelsPrompt(archetype, design), {
            stage: 'writing-spec',
            checkpoint: 'levels',
            label: 'Building levels…',
          });
          try {
            return compileGeneratedLevels(archetype, raw, true);
          } catch (error) {
            if (!(error instanceof TileRunsError)) throw error;
            const diagnostic = tileRunsDiagnostic(error);
            const retryStarted = Date.now();
            try {
              const retryRaw = await callLlm(
                'levels',
                buildLevelsPrompt(archetype, design, [diagnostic]),
                {
                  stage: 'writing-spec',
                  checkpoint: 'levels',
                  label: 'Correcting compact level rows…',
                  reasoningEffort: 'minimal',
                },
              );
              let compiled: unknown;
              try {
                compiled = compileGeneratedLevels(archetype, retryRaw, true);
              } catch (retryError) {
                if (!(retryError instanceof TileRunsError)) throw retryError;
                compiled = canonicalLevelsFallback(archetype, retryRaw, retryError);
              }
              recordEarlyRepairEvent(
                'levels',
                'compile-retry',
                [diagnostic],
                [],
                retryStarted,
                'fixed',
              );
              return compiled;
            } catch (retryError) {
              const after =
                retryError instanceof TileRunsError
                  ? [tileRunsDiagnostic(retryError)]
                  : [diagnostic];
              recordEarlyRepairEvent(
                'levels',
                'compile-retry',
                [diagnostic],
                after,
                retryStarted,
                'failed',
              );
              throw retryError;
            }
          }
        };
        const results = await Promise.allSettled([
          loadLevels().then((canonical) => {
            const roster = isRecord(canonical) ? canonical : null;
            parts.levels = roster?.['levels'] ?? canonical;
            if (archetype === 'fighter') parts.player = roster?.['player'];
            tick(resumedLevels !== undefined ? 'Levels restored' : 'Levels');
          }),
          (resumedEntities !== undefined
            ? Promise.resolve(resumedEntities)
            : callLlm('entities', buildEntitiesPrompt(archetype, design, !!photo, recentUse), {
                stage: 'writing-spec',
                checkpoint: 'entities',
                label: 'Casting entities…',
              })
          ).then((r) => {
            parts.entities = r as SpecParts['entities'];
            pushPartial({ sprites: parts.entities?.sprites as PartialSpec['sprites'] });
            tick(resumedEntities !== undefined ? 'Entities restored' : 'Entities');
          }),
          (resumedMusic !== undefined
            ? Promise.resolve(resumedMusic)
            : callLlm('music', buildMusicPrompt(archetype, design), {
                stage: 'writing-spec',
                checkpoint: 'music',
                label: 'Composing music…',
              })
          ).then((r) => {
            parts.music = isRecord(r) ? (r['music'] ?? r) : r;
            pushPartial({ music: parts.music as PartialSpec['music'] });
            tick(resumedMusic !== undefined ? 'Music restored' : 'Music');
          }),
        ]);
        const firstFailure = results.find(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        if (firstFailure) throw firstFailure.reason;

        // ---- Assemble + validate + repair ----------------------------------
        spec = ensurePlatformerImageCharacterFallbacks(
          ensureLikenessHeroBody(
            this.assemble(job.seed, archetype, design, parts, !!photo),
            !!photo,
          ),
          recentUse.bosses,
        );
        emit('validating', 'Checking every rule…');
        spec = await this.validateAndRepair(
          spec,
          archetype,
          design,
          callLlm,
          emit,
          !!photo,
          recentUse,
          { jobId, gameId, attempt: job.attempt },
        );
        spec = ensureLikenessHeroBody(spec, !!photo);
      }

      spec = ensurePlatformerImageCharacterFallbacks(spec, recentUse.bosses);

      try {
        this.files.writeValidatedSpecCheckpoint(jobId, job.attempt, {
          engineVersion: ENGINE_VERSION,
          specVersion: SPEC_VERSION,
          archetypeVersion: archetypes[archetype].version,
          design,
          spec,
        });
      } catch {
        // A valid in-memory spec can still publish if checkpoint storage is
        // unavailable; a future retry will fall back to raw-stage restoration.
      }

      // ---- Build Muse Image assets + atomic publish -----------------------
      emit('building-assets', 'Painting the game art…');
      const staging = this.files.stagingFor(jobId);
      const assetsDir = ensureDir(join(staging, 'assets'));
      const assetWorkspace = new GameAssetWorkspace(assetsDir, imageModel);

      // Production personalization deliberately relies on the models' direct
      // view of the photo instead of squeezing identity through the legacy,
      // finite FaceFeatures taxonomy. Muse Image authors the hero; detailed
      // platformers also give the design-stage provider labeled review boards.
      const feat = null;

      const validationFailure = (role: string): void => {
        this.db.insertUsage({
          jobId,
          gameId,
          stage: `image-validation:${role}`,
          model: imageModel,
          provider: mockImages ? 'mock' : 'meta-image',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          failed: true,
          repair: false,
        });
      };
      const generatedResult = (image: Buffer) => ({
        image,
        usage: undefined,
        outputFormat: 'png' as const,
        imageCount: 1,
      });
      const imageEditFor =
        (role: string, label: string): LikenessImageEdit =>
        async (request) =>
          generatedResult(
            await callImage({
              role,
              label,
              prompt: request.prompt,
              reference: request.image,
              size: request.size,
            }),
          );
      const cachedGeneratedAsset = async (opts: {
        role: GeneratedGameAssetRole;
        promptVersion: string;
        prompt: string;
        policyFallbackPrompt?: string;
        label: string;
        reference?: Buffer;
        size?: string;
        normalize(image: Buffer): Promise<Buffer>;
      }): Promise<Buffer> => {
        const correctionPrompt = (prompt: string) =>
          `${prompt} RETRY CORRECTION: obey every composition, format, and no-text constraint exactly.`;
        const cachePrompts = [
          opts.prompt,
          correctionPrompt(opts.prompt),
          ...(opts.policyFallbackPrompt
            ? [opts.policyFallbackPrompt, correctionPrompt(opts.policyFallbackPrompt)]
            : []),
        ];
        for (const prompt of new Set(cachePrompts)) {
          const cached = assetWorkspace.load(
            opts.role,
            opts.promptVersion,
            imagePromptHash(prompt, opts.reference),
          );
          if (cached) return cached;
        }

        let lastError: unknown;
        let activePrompt = opts.prompt;
        let usedPolicyFallback = false;
        let usedValidationRetry = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const promptSha = imagePromptHash(activePrompt, opts.reference);
          try {
            const raw = await callImage({
              role: opts.role,
              label: opts.label,
              prompt: activePrompt,
              ...(opts.reference ? { reference: opts.reference } : {}),
              ...(opts.size ? { size: opts.size } : {}),
            });
            const normalized = await opts.normalize(raw);
            await assetWorkspace.store(opts.role, normalized, opts.promptVersion, promptSha);
            return normalized;
          } catch (error) {
            if (error instanceof PipelineError) {
              if (
                error.code === 'image-content-policy' &&
                opts.policyFallbackPrompt &&
                !usedPolicyFallback
              ) {
                lastError = error;
                usedPolicyFallback = true;
                activePrompt = opts.policyFallbackPrompt;
                emit('building-assets', `Rephrasing ${opts.label.toLowerCase()} safely…`);
                continue;
              }
              throw error;
            }
            if (error instanceof GeneratedAssetStorageError) {
              throw new PipelineError('storage', error.message, 'building-assets');
            }
            lastError = error;
            validationFailure(opts.role);
            if (!usedValidationRetry) {
              usedValidationRetry = true;
              activePrompt = correctionPrompt(activePrompt);
              emit('building-assets', `Repainting ${opts.label.toLowerCase()}…`);
              continue;
            }
            break;
          }
        }
        throw new PipelineError(
          'image-invalid',
          `${opts.label} failed validation: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
          'building-assets',
        );
      };

      const photoReference = photo ? await prepareImageReference(photo) : undefined;
      const canonicalHeroConcept = spec.meta.heroConcept ?? design.heroConcept;
      const keyArtPrompt = buildKeyArtPrompt(spec, !!photo, canonicalHeroConcept);
      const keyArtTask = cachedGeneratedAsset({
        role: 'keyArt',
        promptVersion: KEY_ART_PROMPT_VERSION,
        prompt: keyArtPrompt,
        policyFallbackPrompt: buildKeyArtPolicyFallbackPrompt(spec, !!photo, canonicalHeroConcept),
        label: 'Key art',
        ...(photoReference ? { reference: photoReference } : {}),
        size: KEY_ART_ASPECT_HINT,
        normalize: normalizeKeyArt,
      });

      const identityKey = JSON.stringify({
        portraitVersion: GENERATED_PORTRAIT_PROMPT_VERSION,
        defeatPortraitVersion: GENERATED_DEFEAT_PORTRAIT_PROMPT_VERSION,
        headVersion: GENERATED_HEAD_PROMPT_VERSION,
        features: feat,
        heroConcept: canonicalHeroConcept,
      });
      const portraitTask: Promise<Buffer | null> = photo
        ? (async () => {
            const portraitSha = imagePromptHash(
              `${GENERATED_PORTRAIT_PROMPT_VERSION}:${identityKey}`,
              photo,
            );
            let portrait = assetWorkspace.load(
              'generatedPortrait',
              GENERATED_PORTRAIT_PROMPT_VERSION,
              portraitSha,
            );
            if (!portrait) {
              let lastError: unknown;
              for (let pass = 0; pass < 2 && !portrait; pass++) {
                try {
                  portrait = await generatePortrait(
                    photo,
                    feat,
                    imageEditFor('portrait', 'Player portrait'),
                    {
                      size: '1024x1024',
                      user: gameId,
                      heroConcept: canonicalHeroConcept,
                    },
                  );
                } catch (error) {
                  if (error instanceof PipelineError) throw error;
                  lastError = error;
                  validationFailure('portrait');
                  emit('building-assets', 'Repainting the player portrait…');
                }
              }
              if (!portrait) {
                throw new PipelineError(
                  'image-invalid',
                  `Player portrait failed validation: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
                  'building-assets',
                );
              }
              await assetWorkspace.store(
                'generatedPortrait',
                portrait,
                GENERATED_PORTRAIT_PROMPT_VERSION,
                portraitSha,
              );
            }
            return portrait;
          })()
        : Promise.resolve(null);

      const portraitDefeatTask: Promise<Buffer | null> = photo
        ? (async () => {
            const defeatContext = [
              `${spec.meta.title} is a ${spec.archetype} game.`,
              spec.story.defeat.join(' '),
            ].join(' ');
            const defeatPortraitSha = imagePromptHash(
              `${GENERATED_DEFEAT_PORTRAIT_PROMPT_VERSION}:${identityKey}:${defeatContext}`,
              photo,
            );
            let portraitDefeat = assetWorkspace.load(
              'generatedPortraitDefeat',
              GENERATED_DEFEAT_PORTRAIT_PROMPT_VERSION,
              defeatPortraitSha,
            );
            if (!portraitDefeat) {
              let lastError: unknown;
              for (let pass = 0; pass < 2 && !portraitDefeat; pass++) {
                try {
                  portraitDefeat = await generateDefeatPortrait(
                    photo,
                    feat,
                    defeatContext,
                    imageEditFor('portrait-defeat', 'Defeat portrait'),
                    {
                      size: '1024x1024',
                      user: gameId,
                      heroConcept: canonicalHeroConcept,
                    },
                  );
                } catch (error) {
                  if (error instanceof PipelineError) throw error;
                  lastError = error;
                  validationFailure('portrait-defeat');
                  emit('building-assets', 'Repainting the defeat portrait…');
                }
              }
              if (!portraitDefeat) {
                throw new PipelineError(
                  'image-invalid',
                  `Defeat portrait failed validation: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
                  'building-assets',
                );
              }
              await assetWorkspace.store(
                'generatedPortraitDefeat',
                portraitDefeat,
                GENERATED_DEFEAT_PORTRAIT_PROMPT_VERSION,
                defeatPortraitSha,
              );
            }
            return portraitDefeat;
          })()
        : Promise.resolve(null);

      const headDirections = [
        {
          direction: 'front',
          role12: 'generatedHead12',
          role16: 'generatedHead16',
          label: 'front player sprite',
        },
        {
          direction: 'side',
          role12: 'generatedHead12Side',
          role16: 'generatedHead16Side',
          label: 'profile player sprite',
        },
        {
          direction: 'back',
          role12: 'generatedHead12Back',
          role16: 'generatedHead16Back',
          label: 'rear player sprite',
        },
      ] as const satisfies readonly {
        direction: GeneratedHeadDirection;
        role12: GeneratedGameAssetRole;
        role16: GeneratedGameAssetRole;
        label: string;
      }[];
      const generateHeads = async (): Promise<void> => {
        if (!photo) return;
        const headShas = Object.fromEntries(
          headDirections.map(({ direction }) => [
            direction,
            imagePromptHash(`${GENERATED_HEAD_PROMPT_VERSION}:${direction}:${identityKey}`, photo),
          ]),
        ) as Record<GeneratedHeadDirection, string>;

        await Promise.all(
          headDirections.map(async ({ direction, role12, role16, label }) => {
            const headSha = headShas[direction];
            if (
              assetWorkspace.load(role12, GENERATED_HEAD_PROMPT_VERSION, headSha) &&
              assetWorkspace.load(role16, GENERATED_HEAD_PROMPT_VERSION, headSha)
            ) {
              return;
            }
            let generatedHeads: Awaited<ReturnType<typeof generateHeadSprites>> | null = null;
            let lastError: unknown;
            for (let pass = 0; pass < 2 && !generatedHeads; pass++) {
              try {
                generatedHeads = await generateHeadSprites(
                  photo,
                  feat,
                  imageEditFor(`player-head-${direction}`, label),
                  { size: '1024x1024', user: gameId, direction },
                );
              } catch (error) {
                if (error instanceof PipelineError || error instanceof GeneratedAssetStorageError) {
                  throw error;
                }
                lastError = error;
                validationFailure(`player-head-${direction}`);
                emit('building-assets', `Repainting the ${label}…`);
              }
            }
            if (!generatedHeads) {
              throw new PipelineError(
                'image-invalid',
                `${label} failed validation: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
                'building-assets',
              );
            }
            await Promise.all([
              assetWorkspace.store(
                role12,
                generatedHeads.heads[12],
                GENERATED_HEAD_PROMPT_VERSION,
                headSha,
              ),
              assetWorkspace.store(
                role16,
                generatedHeads.heads[16],
                GENERATED_HEAD_PROMPT_VERSION,
                headSha,
              ),
            ]);
          }),
        );
      };

      const storyAssetTask = (
        role: StoryArtRole,
        assetRole: GeneratedGameAssetRole,
      ): Promise<Buffer> =>
        keyArtTask.then((keyArt) =>
          cachedGeneratedAsset({
            role: assetRole,
            promptVersion: STORY_ART_PROMPT_VERSION,
            prompt: buildStoryArtPrompt(spec, role, canonicalHeroConcept),
            policyFallbackPrompt: buildStoryArtPolicyFallbackPrompt(
              spec,
              role,
              canonicalHeroConcept,
            ),
            label: `${role} scene`,
            reference: keyArt,
            size: STORY_ART_ASPECT_HINT,
            normalize: normalizeStoryArt,
          }),
        );
      const storyAssets = {
        intro: storyAssetTask('intro', 'storyIntro'),
        boss: storyAssetTask('boss', 'storyBoss'),
        victory: storyAssetTask('victory', 'storyVictory'),
        defeat: storyAssetTask('defeat', 'storyDefeat'),
      } satisfies Record<StoryArtRole, Promise<Buffer>>;
      const storyTask = Promise.all(Object.values(storyAssets)).then(() => undefined);

      let platformerBackdropArtStatus: GameMetaFile['platformerBackdropArt'] =
        spec.archetype === 'platformer'
          ? {
              mode: 'procedural',
              attempted: true,
              reason: 'Generated platformer backgrounds did not complete',
            }
          : undefined;
      const platformerBackdropTask =
        spec.archetype === 'platformer'
          ? keyArtTask.then(async (keyArt): Promise<void> => {
              const generationStarted = Date.now();
              const generated = new Set<GeneratedPlatformerBackdrop>();
              const colors = spec.palette.join(', ');
              const sceneFor = (role: GeneratedPlatformerBackdrop) => {
                if (role === 'boss') {
                  return {
                    sceneName: 'Final arena',
                    sceneBeat: spec.meta.tagline,
                  };
                }
                const index = Number.parseInt(role.slice(-1), 10) - 1;
                return {
                  sceneName: spec.levels[index]?.name ?? `Level ${index + 1}`,
                  sceneBeat: spec.story.levelIntros[index] ?? spec.meta.tagline,
                };
              };

              emit('building-assets', 'Painting four panoramic level backgrounds in parallel…');
              await Promise.all(
                GENERATED_PLATFORMER_BACKDROPS.map(async (role) => {
                  const scene = sceneFor(role);
                  const prompt = buildPlatformerBackdropPrompt({
                    gameTitle: spec.meta.title,
                    tagline: spec.meta.tagline,
                    role,
                    ...scene,
                    backdrop: spec.backdrop ?? 'the game-specific environment shown in the key art',
                    colors,
                  });
                  try {
                    await cachedGeneratedAsset({
                      role: PLATFORMER_BACKDROP_ASSET_ROLES[role],
                      promptVersion: PLATFORMER_BACKDROP_PROMPT_VERSION,
                      prompt,
                      label:
                        role === 'boss' ? 'Boss arena background' : `${scene.sceneName} background`,
                      reference: keyArt,
                      size: PLATFORMER_BACKDROP_ASPECT_HINT,
                      normalize: normalizePlatformerBackdrop,
                    });
                    generated.add(role);
                  } catch (error) {
                    if (
                      abort.signal.aborted ||
                      error instanceof GeneratedAssetStorageError ||
                      (error instanceof PipelineError && error.code === 'storage')
                    ) {
                      throw error;
                    }
                    validationFailure(`platformer-backdrop-${role}`);
                    emit(
                      'building-assets',
                      `${scene.sceneName} background was unavailable; keeping its procedural scene`,
                    );
                  }
                }),
              );

              const generatedRoles = GENERATED_PLATFORMER_BACKDROPS.filter((role) =>
                generated.has(role),
              );
              const missingRoles = GENERATED_PLATFORMER_BACKDROPS.filter(
                (role) => !generated.has(role),
              );
              if (missingRoles.length === 0) {
                platformerBackdropArtStatus = {
                  mode: 'generated',
                  attempted: true,
                  generatedRoles,
                };
                emit('building-assets', 'Finished the panoramic platformer backgrounds');
                return;
              }

              const reason = `No valid generated background for ${missingRoles.join(', ')}`;
              platformerBackdropArtStatus = {
                mode: generatedRoles.length ? 'partial' : 'procedural',
                attempted: true,
                ...(generatedRoles.length ? { generatedRoles } : {}),
                reason,
              };
              recordEarlyRepairEvent(
                'entities',
                'platformer-backdrop-art-fallback',
                missingRoles.map((role) => ({
                  code: 'PLATFORMER_BACKDROP_ART_FALLBACK',
                  path: `/assets/platformer-backdrop/${role}`,
                  message: reason,
                })),
                [],
                generationStarted,
                'downgraded',
              );
            })
          : Promise.resolve();

      let platformerBossArtStatus: GameMetaFile['platformerBossArt'] =
        spec.archetype === 'platformer'
          ? {
              mode: 'procedural',
              attempted: true,
              reason: 'Generated platformer boss art did not complete',
            }
          : undefined;
      const platformerBossTask =
        spec.archetype === 'platformer'
          ? storyAssets.boss.then(async (storyBoss): Promise<void> => {
              const generationStarted = Date.now();
              const colors = spec.palette
                .filter((hex) => {
                  const r = Number.parseInt(hex.slice(1, 3), 16);
                  const g = Number.parseInt(hex.slice(3, 5), 16);
                  const b = Number.parseInt(hex.slice(5, 7), 16);
                  return !(g > r * 1.15 && g > b * 1.15);
                })
                .join(', ');
              try {
                const pipelineFingerprint = JSON.stringify({
                  promptVersions: {
                    candidate: PLATFORMER_BOSS_PROMPT_VERSION,
                    judge: PLATFORMER_BOSS_JUDGE_PROMPT_VERSION,
                  },
                  bossName: spec.boss.name,
                  bossIntro: spec.story.bossIntro,
                  colors,
                });
                const pipelineSha = imagePromptHash(pipelineFingerprint, storyBoss);
                const cached = assetWorkspace.load(
                  'platformerBoss',
                  PLATFORMER_BOSS_PIPELINE_PROMPT_VERSION,
                  pipelineSha,
                );
                if (cached) {
                  platformerBossArtStatus = { mode: 'generated', attempted: true };
                  emit('building-assets', 'Restored the selected platformer boss');
                  return;
                }

                interface BossCandidate {
                  id: string;
                  png: Buffer;
                }
                emit('building-assets', 'Painting three signature boss candidates…');
                const candidates = (
                  await Promise.all(
                    [1, 2, 3].map(async (index): Promise<BossCandidate | null> => {
                      const id = `B${index}`;
                      let raw: Buffer;
                      try {
                        raw = await callImage({
                          role: `platformer-boss-${id}`,
                          label: `Boss candidate ${id}`,
                          prompt: buildPlatformerBossCandidatePrompt({
                            bossName: spec.boss.name,
                            bossIntro: spec.story.bossIntro,
                            colors,
                            candidateId: id,
                          }),
                          reference: storyBoss,
                          size: '1024x1024',
                        });
                      } catch (error) {
                        if (!isOptionalGeneratedArtProviderFailure(error)) throw error;
                        validationFailure(`platformer-boss-${id}`);
                        emit(
                          'building-assets',
                          `Boss candidate ${id} was rejected; continuing the candidate pool…`,
                        );
                        return null;
                      }
                      try {
                        let processed;
                        try {
                          processed = await processGeneratedPlatformerBoss(raw);
                        } catch (initialError) {
                          const recovery = await recoverGeneratedPlatformerGreenPanel(raw);
                          if (!recovery.recovered) throw initialError;
                          processed = await processGeneratedPlatformerBoss(recovery.image);
                        }
                        return { id, png: processed.png };
                      } catch {
                        validationFailure(`platformer-boss-${id}`);
                        emit(
                          'building-assets',
                          `Boss candidate ${id} failed local sprite validation`,
                        );
                        return null;
                      }
                    }),
                  )
                ).filter((candidate): candidate is BossCandidate => candidate !== null);
                if (candidates.length === 0) {
                  throw new Error('no locally valid platformer boss candidate was available');
                }

                const descriptors: PlatformerBossCandidateDescriptor[] = candidates.map(
                  ({ id }) => ({ id }),
                );
                const board = await buildPlatformerBossJudgeBoard({
                  storyBoss,
                  candidates: candidates.map(({ id, png: processed }) => ({ id, processed })),
                });
                const judgePrompt = buildPlatformerBossJudgePrompt(descriptors);
                const mockDecision = {
                  candidateReviews: descriptors.map(({ id }) => ({
                    id,
                    scores: {
                      villainMatch: 5,
                      silhouette: 5,
                      pose: 5,
                      technical: 5,
                      gameplayReadability: 5,
                    },
                    issues: [],
                    summary: 'Mock story-faithful boss candidate.',
                  })),
                  selection: {
                    candidateId: descriptors[0]!.id,
                    confidence: 1,
                    rationale: 'Mock selection.',
                  },
                };
                let rawDecision: unknown = mockDecision;
                if (!mockImages) {
                  try {
                    rawDecision = await callLlm(
                      'design',
                      {
                        ...judgePrompt,
                        jsonSchema: buildPlatformerBossJudgeSchema(descriptors),
                        maxTokens: 2200,
                        timeoutMs: 120_000,
                      },
                      {
                        stage: 'building-assets',
                        label: 'Spark selected the signature boss',
                        image: board,
                        reasoningEffort: 'low',
                      },
                    );
                  } catch (error) {
                    if (abort.signal.aborted) throw error;
                    throw new Error(
                      `platformer boss art review failed: ${error instanceof Error ? error.message : String(error)}`,
                    );
                  }
                }
                const decision = normalizePlatformerBossJudgeDecision(rawDecision, descriptors);
                const selectedId =
                  decision.selection.candidateId || bestPlatformerBossCandidateId(decision);
                const selected = candidates.find(({ id }) => id === selectedId) ?? candidates[0]!;
                await assetWorkspace.store(
                  'platformerBoss',
                  selected.png,
                  PLATFORMER_BOSS_PIPELINE_PROMPT_VERSION,
                  pipelineSha,
                );
                platformerBossArtStatus = { mode: 'generated', attempted: true };
                emit('building-assets', `Spark selected ${selected.id} as the signature boss`);
              } catch (error) {
                if (
                  abort.signal.aborted ||
                  error instanceof GeneratedAssetStorageError ||
                  (error instanceof PipelineError && !isOptionalGeneratedArtProviderFailure(error))
                ) {
                  throw error;
                }
                await assetWorkspace.discard(['platformerBoss']);
                const reason =
                  error instanceof Error
                    ? error.message.slice(0, 240)
                    : 'Generated platformer boss failed validation';
                platformerBossArtStatus = {
                  mode: 'procedural',
                  attempted: true,
                  reason,
                };
                recordEarlyRepairEvent(
                  'entities',
                  'platformer-boss-art-fallback',
                  [
                    {
                      code: 'PLATFORMER_BOSS_ART_FALLBACK',
                      path: '/assets/platformer-boss',
                      message: reason,
                    },
                  ],
                  [],
                  generationStarted,
                  'downgraded',
                );
                emit(
                  'building-assets',
                  `Generated boss was unavailable; using the stable library boss (${reason.slice(0, 120)})`,
                );
              }
            })
          : Promise.resolve();

      let platformerEnemyArtStatus: GameMetaFile['platformerEnemyArt'] =
        spec.archetype === 'platformer'
          ? {
              mode: 'procedural',
              attempted: true,
              reason: 'Generated platformer enemy art did not complete',
            }
          : undefined;
      const platformerEnemyTask =
        spec.archetype === 'platformer'
          ? keyArtTask.then(async (keyArt): Promise<void> => {
              const generationStarted = Date.now();
              const colors = spec.palette
                .filter((hex) => {
                  const r = Number.parseInt(hex.slice(1, 3), 16);
                  const g = Number.parseInt(hex.slice(3, 5), 16);
                  const b = Number.parseInt(hex.slice(5, 7), 16);
                  return !(g > r * 1.15 && g > b * 1.15);
                })
                .join(', ');
              const concepts = Object.fromEntries(
                GENERATED_PLATFORMER_ENEMIES.map((role) => [
                  role,
                  design.cast.find((member) => member.role === role)?.concept ??
                    `A distinctive ${role} enemy from ${spec.meta.title}`,
                ]),
              ) as Record<GeneratedPlatformerEnemy, string>;
              const promptHashes = Object.fromEntries(
                GENERATED_PLATFORMER_ENEMIES.map((role) => [
                  role,
                  imagePromptHash(
                    JSON.stringify({
                      promptVersions: {
                        candidate: PLATFORMER_ENEMY_PROMPT_VERSION,
                        judge: PLATFORMER_ENEMY_JUDGE_PROMPT_VERSION,
                      },
                      gameTitle: spec.meta.title,
                      tagline: spec.meta.tagline,
                      role,
                      concept: concepts[role],
                      colors,
                    }),
                    keyArt,
                  ),
                ]),
              ) as Record<GeneratedPlatformerEnemy, string>;
              const generated = new Set<GeneratedPlatformerEnemy>();
              try {
                for (const role of GENERATED_PLATFORMER_ENEMIES) {
                  if (
                    assetWorkspace.load(
                      PLATFORMER_ENEMY_ASSET_ROLES[role],
                      PLATFORMER_ENEMY_PIPELINE_PROMPT_VERSION,
                      promptHashes[role],
                    )
                  ) {
                    generated.add(role);
                  }
                }
                if (generated.size === GENERATED_PLATFORMER_ENEMIES.length) {
                  platformerEnemyArtStatus = {
                    mode: 'generated',
                    attempted: true,
                    generatedRoles: [...GENERATED_PLATFORMER_ENEMIES],
                  };
                  emit('building-assets', 'Restored the selected platformer enemy cast');
                  return;
                }

                interface EnemyCandidate extends PlatformerEnemyCandidateDescriptor {
                  png: Buffer;
                }
                const missing = GENERATED_PLATFORMER_ENEMIES.filter((role) => !generated.has(role));
                emit(
                  'building-assets',
                  `Painting ${missing.length * 2} enemy candidates in parallel…`,
                );
                const candidates = (
                  await Promise.all(
                    missing.flatMap((role) =>
                      [1, 2].map(async (index): Promise<EnemyCandidate | null> => {
                        const id = `${role[0]!.toUpperCase()}${index}`;
                        let raw: Buffer;
                        try {
                          raw = await callImage({
                            role: `platformer-enemy-${role}-${id}`,
                            label: `${role} candidate ${id}`,
                            prompt: buildPlatformerEnemyCandidatePrompt({
                              gameTitle: spec.meta.title,
                              tagline: spec.meta.tagline,
                              role,
                              concept: concepts[role],
                              colors,
                              candidateId: id,
                            }),
                            reference: keyArt,
                            size: '1024x1024',
                          });
                        } catch (error) {
                          if (abort.signal.aborted) throw error;
                          if (!(error instanceof PipelineError)) throw error;
                          validationFailure(`platformer-enemy-${role}-${id}`);
                          emit(
                            'building-assets',
                            `${role} candidate ${id} was unavailable; continuing the cast…`,
                          );
                          return null;
                        }
                        try {
                          let processed;
                          try {
                            processed = await processGeneratedPlatformerEnemy(raw, role);
                          } catch (initialError) {
                            const recovery = await recoverGeneratedPlatformerGreenPanel(raw);
                            if (!recovery.recovered) throw initialError;
                            processed = await processGeneratedPlatformerEnemy(recovery.image, role);
                          }
                          return {
                            id,
                            role,
                            concept: concepts[role],
                            png: processed.png,
                          };
                        } catch {
                          validationFailure(`platformer-enemy-${role}-${id}`);
                          emit(
                            'building-assets',
                            `${role} candidate ${id} failed local sprite validation`,
                          );
                          return null;
                        }
                      }),
                    ),
                  )
                ).filter((candidate): candidate is EnemyCandidate => candidate !== null);

                if (candidates.length > 0) {
                  const descriptors: PlatformerEnemyCandidateDescriptor[] = candidates.map(
                    ({ id, role, concept }) => ({ id, role, concept }),
                  );
                  const board = await buildPlatformerEnemyJudgeBoard({
                    keyArt,
                    candidates: candidates.map(({ id, role, concept, png: processed }) => ({
                      id,
                      role,
                      concept,
                      processed,
                    })),
                  });
                  const judgePrompt = buildPlatformerEnemyJudgePrompt(descriptors);
                  const localDecision = {
                    candidateReviews: descriptors.map(({ id, role }) => ({
                      id,
                      role,
                      scores: {
                        conceptMatch: 5,
                        worldStyle: 5,
                        silhouette: 5,
                        roleReadability: 5,
                        technical: 5,
                      },
                      issues: [],
                      summary: 'Locally valid enemy candidate.',
                    })),
                    selections: GENERATED_PLATFORMER_ENEMIES.flatMap((role) => {
                      const candidate = descriptors.find((item) => item.role === role);
                      return candidate
                        ? [
                            {
                              role,
                              candidateId: candidate.id,
                              confidence: mockImages ? 1 : 0,
                              rationale: mockImages
                                ? 'Mock selection.'
                                : 'Spark review was unavailable; retained a locally valid candidate.',
                            },
                          ]
                        : [];
                    }),
                  };
                  let rawDecision: unknown = localDecision;
                  if (!mockImages) {
                    try {
                      rawDecision = await callLlm(
                        'design',
                        {
                          ...judgePrompt,
                          jsonSchema: buildPlatformerEnemyJudgeSchema(descriptors),
                          maxTokens: 3600,
                          timeoutMs: 120_000,
                        },
                        {
                          stage: 'building-assets',
                          label: 'Spark selected the platformer enemy cast',
                          image: board,
                          reasoningEffort: 'low',
                        },
                      );
                    } catch (error) {
                      if (abort.signal.aborted) throw error;
                      emit(
                        'building-assets',
                        'Enemy art review was unavailable; retaining locally valid candidates',
                      );
                    }
                  }
                  const decision = normalizePlatformerEnemyJudgeDecision(rawDecision, descriptors);
                  await Promise.all(
                    decision.selections.map(async ({ role, candidateId }) => {
                      const selected = candidates.find(
                        (candidate) => candidate.role === role && candidate.id === candidateId,
                      );
                      if (!selected) return;
                      await assetWorkspace.store(
                        PLATFORMER_ENEMY_ASSET_ROLES[role],
                        selected.png,
                        PLATFORMER_ENEMY_PIPELINE_PROMPT_VERSION,
                        promptHashes[role],
                      );
                      generated.add(role);
                    }),
                  );
                }

                const generatedRoles = GENERATED_PLATFORMER_ENEMIES.filter((role) =>
                  generated.has(role),
                );
                const missingRoles = GENERATED_PLATFORMER_ENEMIES.filter(
                  (role) => !generated.has(role),
                );
                if (missingRoles.length === 0) {
                  platformerEnemyArtStatus = {
                    mode: 'generated',
                    attempted: true,
                    generatedRoles,
                  };
                  emit('building-assets', 'Spark selected the complete platformer enemy cast');
                  return;
                }

                const reason = `No valid generated art for ${missingRoles.join(', ')}`;
                platformerEnemyArtStatus = {
                  mode: generatedRoles.length ? 'partial' : 'procedural',
                  attempted: true,
                  ...(generatedRoles.length ? { generatedRoles } : {}),
                  reason,
                };
                recordEarlyRepairEvent(
                  'entities',
                  'platformer-enemy-art-fallback',
                  missingRoles.map((role) => ({
                    code: 'PLATFORMER_ENEMY_ART_FALLBACK',
                    path: `/assets/platformer-enemy-${role}`,
                    message: reason,
                  })),
                  [],
                  generationStarted,
                  'downgraded',
                );
                emit(
                  'building-assets',
                  `Using stable library art for ${missingRoles.join(', ')}; the remaining enemies are generated`,
                );
              } catch (error) {
                if (
                  abort.signal.aborted ||
                  error instanceof GeneratedAssetStorageError ||
                  (error instanceof PipelineError && error.code === 'storage')
                ) {
                  throw error;
                }
                const generatedRoles = GENERATED_PLATFORMER_ENEMIES.filter((role) =>
                  generated.has(role),
                );
                const reason =
                  error instanceof Error
                    ? error.message.slice(0, 240)
                    : 'Generated platformer enemy art failed';
                platformerEnemyArtStatus = {
                  mode: generatedRoles.length ? 'partial' : 'procedural',
                  attempted: true,
                  ...(generatedRoles.length ? { generatedRoles } : {}),
                  reason,
                };
                recordEarlyRepairEvent(
                  'entities',
                  'platformer-enemy-art-fallback',
                  [
                    {
                      code: 'PLATFORMER_ENEMY_ART_FALLBACK',
                      path: '/assets/platformer-enemies',
                      message: reason,
                    },
                  ],
                  [],
                  generationStarted,
                  'downgraded',
                );
                emit(
                  'building-assets',
                  `Generated enemy cast was incomplete; using stable fallbacks where needed (${reason.slice(0, 120)})`,
                );
              }
            })
          : Promise.resolve();

      let platformerPropArtStatus: GameMetaFile['platformerPropArt'] =
        spec.archetype === 'platformer'
          ? {
              mode: 'procedural',
              attempted: true,
              reason: 'Generated platformer prop art did not complete',
            }
          : undefined;
      const platformerPropTask =
        spec.archetype === 'platformer'
          ? keyArtTask.then(async (keyArt): Promise<void> => {
              const generationStarted = Date.now();
              const colors = spec.palette
                .filter((hex) => {
                  const r = Number.parseInt(hex.slice(1, 3), 16);
                  const g = Number.parseInt(hex.slice(3, 5), 16);
                  const b = Number.parseInt(hex.slice(5, 7), 16);
                  return !(g > r * 1.15 && g > b * 1.15);
                })
                .join(', ');
              const premise = [spec.meta.tagline, ...spec.story.intro].join(' ');
              const promptHashes = Object.fromEntries(
                GENERATED_PLATFORMER_PROPS.map((role) => [
                  role,
                  imagePromptHash(
                    JSON.stringify({
                      promptVersion: PLATFORMER_PROP_PROMPT_VERSION,
                      gameTitle: spec.meta.title,
                      tagline: spec.meta.tagline,
                      premise,
                      role,
                      colors,
                    }),
                    keyArt,
                  ),
                ]),
              ) as Record<GeneratedPlatformerProp, string>;
              const generated = new Set<GeneratedPlatformerProp>();

              for (const role of GENERATED_PLATFORMER_PROPS) {
                if (
                  assetWorkspace.load(
                    PLATFORMER_PROP_ASSET_ROLES[role],
                    PLATFORMER_PROP_PIPELINE_PROMPT_VERSION,
                    promptHashes[role],
                  )
                ) {
                  generated.add(role);
                }
              }
              const missing = GENERATED_PLATFORMER_PROPS.filter((role) => !generated.has(role));
              if (missing.length === 0) {
                platformerPropArtStatus = {
                  mode: 'generated',
                  attempted: true,
                  generatedRoles: [...GENERATED_PLATFORMER_PROPS],
                };
                emit('building-assets', 'Restored the generated platformer gameplay props');
                return;
              }

              emit('building-assets', `Painting ${missing.length} gameplay props in parallel…`);
              await Promise.all(
                missing.map(async (role) => {
                  try {
                    const raw = await callImage({
                      role: `platformer-prop-${role}`,
                      label: `${role} gameplay prop`,
                      prompt: buildPlatformerPropPrompt({
                        gameTitle: spec.meta.title,
                        tagline: spec.meta.tagline,
                        premise,
                        role,
                        colors,
                      }),
                      reference: keyArt,
                      size: '1024x1024',
                    });
                    let processed;
                    try {
                      processed = await processGeneratedPlatformerProp(raw, role);
                    } catch (initialError) {
                      const recovery = await recoverGeneratedPlatformerGreenPanel(raw);
                      if (!recovery.recovered) throw initialError;
                      processed = await processGeneratedPlatformerProp(recovery.image, role);
                    }
                    await assetWorkspace.store(
                      PLATFORMER_PROP_ASSET_ROLES[role],
                      processed.png,
                      PLATFORMER_PROP_PIPELINE_PROMPT_VERSION,
                      promptHashes[role],
                    );
                    generated.add(role);
                  } catch (error) {
                    if (
                      abort.signal.aborted ||
                      error instanceof GeneratedAssetStorageError ||
                      (error instanceof PipelineError && error.code === 'storage')
                    ) {
                      throw error;
                    }
                    validationFailure(`platformer-prop-${role}`);
                    emit(
                      'building-assets',
                      `${role} prop was unavailable; keeping its stable library fallback`,
                    );
                  }
                }),
              );

              const generatedRoles = GENERATED_PLATFORMER_PROPS.filter((role) =>
                generated.has(role),
              );
              const missingRoles = GENERATED_PLATFORMER_PROPS.filter(
                (role) => !generated.has(role),
              );
              if (missingRoles.length === 0) {
                platformerPropArtStatus = {
                  mode: 'generated',
                  attempted: true,
                  generatedRoles,
                };
                emit('building-assets', 'Generated the complete platformer gameplay prop set');
                return;
              }

              const reason = `No valid generated art for ${missingRoles.join(', ')}`;
              platformerPropArtStatus = {
                mode: generatedRoles.length ? 'partial' : 'procedural',
                attempted: true,
                ...(generatedRoles.length ? { generatedRoles } : {}),
                reason,
              };
              recordEarlyRepairEvent(
                'entities',
                'platformer-prop-art-fallback',
                missingRoles.map((role) => ({
                  code: 'PLATFORMER_PROP_ART_FALLBACK',
                  path: `/assets/platformer-prop-${role}`,
                  message: reason,
                })),
                [],
                generationStarted,
                'downgraded',
              );
            })
          : Promise.resolve();

      let fighterArtStatus: GameMetaFile['fighterArt'];

      const fighterTask =
        spec.archetype === 'fighter'
          ? (async (): Promise<void> => {
                const fighterSpec = spec as FighterSpec;
                const [keyArt, bossArt] = await Promise.all([keyArtTask, storyAssets.boss]);
                const player: FighterCharacter = fighterSpec.player;
                const boss: FighterCharacter = {
                  name: fighterSpec.boss.name,
                  visualConcept: fighterSpec.boss.visualConcept,
                  build: fighterSpec.boss.build,
                  outfit: fighterSpec.boss.outfit,
                  colorSlot: fighterSpec.boss.colorSlot,
                  hp: fighterSpec.boss.hp,
                  speedScale: fighterSpec.boss.speedScale,
                  powerScale: fighterSpec.boss.powerScale,
                };
                interface RosterEntry {
                  slot: FighterRosterSlot;
                  character: FighterCharacter;
                  source: Buffer;
                  sourceKind: 'photo' | 'key-art' | 'boss-art';
                  photoIdentity: boolean;
                }
                const roster: RosterEntry[] = [
                  {
                    slot: 'player',
                    character: player,
                    source: photoReference ?? keyArt,
                    sourceKind: photoReference ? 'photo' : 'key-art',
                    photoIdentity: !!photoReference,
                  },
                  ...fighterSpec.levels.map((level, index): RosterEntry => ({
                    slot: `opponent${index + 1}` as FighterRosterSlot,
                    character: level.opponent,
                    source: keyArt,
                    sourceKind: 'key-art',
                    photoIdentity: false,
                  })),
                  {
                    slot: 'boss',
                    character: boss,
                    source: bossArt,
                    sourceKind: 'boss-art',
                    photoIdentity: false,
                  },
                ];
                if (
                  roster.length !== FIGHTER_ROSTER_SLOTS.length ||
                  !FIGHTER_ROSTER_SLOTS.every((slot, index) => roster[index]?.slot === slot)
                ) {
                  throw new Error('fighter roster does not match the five-slot atlas contract');
                }

                const conceptFor = (character: FighterCharacter): string => character.visualConcept;
                const colorsFor = (character: FighterCharacter): string =>
                  [
                    fighterSpec.palette[character.colorSlot],
                    fighterSpec.palette[Math.max(5, character.colorSlot - 1)],
                    fighterSpec.palette[13],
                    fighterSpec.palette[14],
                    fighterSpec.palette[15],
                  ]
                    .filter((color): color is string => !!color)
                    .filter((hex) => {
                      const r = Number.parseInt(hex.slice(1, 3), 16);
                      const g = Number.parseInt(hex.slice(3, 5), 16);
                      const b = Number.parseInt(hex.slice(5, 7), 16);
                      return !(g > r * 1.15 && g > b * 1.15);
                    })
                    .join(', ');
                const identity = photoReference ? describeVisibleTraits(feat) : undefined;
                const pipelineFingerprint = JSON.stringify({
                  promptVersions: {
                    identity: GENERATED_FIGHTER_POSE_PROMPT_VERSION,
                    poseSheet: FIGHTER_POSE_SHEET_PROMPT_VERSION,
                    atlas: GENERATED_FIGHTER_ATLAS_PROMPT_VERSION,
                    identityJudge: FIGHTER_IDENTITY_JUDGE_PROMPT_VERSION,
                    poseJudge: FIGHTER_POSE_JUDGE_PROMPT_VERSION,
                    pipeline: FIGHTER_ROSTER_PIPELINE_PROMPT_VERSION,
                  },
                  roster: roster.map(({ slot, character, photoIdentity }) => ({
                    slot,
                    character,
                    photoIdentity,
                  })),
                  keyArt: sha256(keyArt),
                  bossArt: sha256(bossArt),
                  photo: photoReference ? sha256(photoReference) : null,
                });
                const pipelineSha = imagePromptHash(pipelineFingerprint);
                const cached = Object.fromEntries(
                  FIGHTER_ROSTER_SLOTS.map((slot) => [
                    slot,
                    assetWorkspace.load(
                      FIGHTER_ROSTER_ASSET_ROLES[slot],
                      FIGHTER_ROSTER_PIPELINE_PROMPT_VERSION,
                      pipelineSha,
                    ),
                  ]),
                ) as Record<FighterRosterSlot, Buffer | null>;
                for (const slot of FIGHTER_ROSTER_SLOTS) {
                  const atlas = cached[slot];
                  if (!atlas) continue;
                  try {
                    await validateGeneratedFighterAtlas(atlas);
                  } catch {
                    cached[slot] = null;
                    await assetWorkspace.discard([FIGHTER_ROSTER_ASSET_ROLES[slot]]);
                  }
                }
                const pendingRoster = roster.filter((entry) => !cached[entry.slot]);
                const restoredCount = roster.length - pendingRoster.length;
                if (restoredCount > 0) {
                  emit(
                    'building-assets',
                    `Restored ${restoredCount}/5 completed fighter atlases; generating only the unfinished roster slots`,
                  );
                }
                if (pendingRoster.length === 0) {
                  fighterArtStatus = { mode: 'generated', attempted: true };
                  return;
                }

                interface IdentityCandidate extends FighterIdentityCandidateDescriptor {
                  raw: Buffer;
                  processed: Buffer;
                }
                interface PoseCandidate extends FighterPoseCandidateDescriptor {
                  processed: Buffer;
                }
                const generatedCandidate = async (opts: {
                  role: string;
                  label: string;
                  prompt: string;
                  reference: Buffer;
                }): Promise<{ raw: Buffer; processed: Buffer } | null> => {
                  let raw: Buffer;
                  try {
                    raw = await callImage({
                      role: opts.role,
                      label: opts.label,
                      prompt: opts.prompt,
                      reference: opts.reference,
                      size: '1024x1024',
                    });
                  } catch (error) {
                    if (abort.signal.aborted) throw error;
                    if (!isOptionalGeneratedArtProviderFailure(error)) throw error;
                    validationFailure(opts.role);
                    emit('building-assets', `${opts.label} was unavailable; continuing the pool…`);
                    return null;
                  }
                  try {
                    const processed = await processGeneratedFighterPose(raw, {
                      removeGreenSpill: true,
                    });
                    return { raw, processed: processed.png };
                  } catch {
                    validationFailure(opts.role);
                    emit('building-assets', `${opts.label} failed local sprite validation`);
                    return null;
                  }
                };

                emit(
                  'building-assets',
                  `Painting ${pendingRoster.length * 3} fighter identity foundations for ${pendingRoster.length} unfinished roster slot${pendingRoster.length === 1 ? '' : 's'}…`,
                );
                const identityCandidates = (
                  await Promise.all(
                    pendingRoster.flatMap((entry) =>
                      [1, 2, 3].map(async (index): Promise<IdentityCandidate | null> => {
                        const id = `${entry.slot}-I${index}`;
                        const result = await generatedCandidate({
                          role: `fighter-${id}`,
                          label: `${entry.character.name} identity ${index}`,
                          prompt: buildFighterIdentityCandidatePrompt({
                            candidateId: id,
                            name: entry.character.name,
                            visualConcept: conceptFor(entry.character),
                            build: entry.character.build,
                            outfit: entry.character.outfit,
                            colors: colorsFor(entry.character),
                            source: entry.sourceKind,
                            ...(entry.photoIdentity && identity ? { identity } : {}),
                          }),
                          reference: entry.source,
                        });
                        return result
                          ? {
                              id,
                              slot: entry.slot,
                              name: entry.character.name,
                              visualConcept: conceptFor(entry.character),
                              photoIdentity: entry.photoIdentity,
                              ...result,
                            }
                          : null;
                      }),
                    ),
                  )
                ).filter((candidate): candidate is IdentityCandidate => candidate !== null);
                for (const entry of pendingRoster) {
                  if (!identityCandidates.some((candidate) => candidate.slot === entry.slot)) {
                    throw new Error(
                      `${entry.character.name} has no locally valid identity foundation`,
                    );
                  }
                }

                const identityDescriptors: FighterIdentityCandidateDescriptor[] =
                  identityCandidates.map(({ id, slot, name, visualConcept, photoIdentity }) => ({
                    id,
                    slot,
                    name,
                    visualConcept,
                    photoIdentity,
                  }));
                const identityBoard = await buildFighterIdentityJudgeBoard({
                  ...(photoReference ? { sourcePhoto: photoReference } : {}),
                  keyArt,
                  bossArt,
                  candidates: identityCandidates,
                });
                const firstIdentityBySlot = Object.fromEntries(
                  pendingRoster.map(({ slot }) => [
                    slot,
                    identityDescriptors.find((candidate) => candidate.slot === slot)!,
                  ]),
                ) as Partial<Record<FighterRosterSlot, FighterIdentityCandidateDescriptor>>;
                const mockIdentityDecision = {
                  candidateReviews: identityDescriptors.map(({ id, slot }) => ({
                    id,
                    slot,
                    scores: { identity: 5, concept: 5, costume: 5, silhouette: 5, technical: 5 },
                    fatalIssues: [],
                    summary: 'Mock identity-safe roster foundation.',
                  })),
                  selections: pendingRoster.map(({ slot }) => ({
                    slot,
                    accepted: true,
                    candidateId: firstIdentityBySlot[slot]!.id,
                    confidence: 1,
                    rationale: 'Mock selection.',
                    retryGuidance: '',
                  })),
                  castReview: {
                    distinctiveness: 5,
                    styleConsistency: 5,
                    fatalIssues: [],
                    summary: 'Mock coherent and distinct cast.',
                  },
                };
                let rawIdentityDecision: unknown = mockIdentityDecision;
                if (!mockImages) {
                  const prompt = buildFighterIdentityJudgePrompt(identityDescriptors);
                  rawIdentityDecision = await callLlm(
                    'design',
                    {
                      ...prompt,
                      jsonSchema: buildFighterIdentityJudgeSchema(identityDescriptors),
                      maxTokens: 5200,
                      timeoutMs: 120_000,
                    },
                    {
                      stage: 'building-assets',
                      label: 'Spark selected the fighter identity foundations',
                      image: identityBoard,
                      reasoningEffort: 'low',
                    },
                  );
                }
                const identityDecision = normalizeFighterIdentityJudgeDecision(
                  rawIdentityDecision,
                  identityDescriptors,
                );
                const selectedIdentityIds = bestFighterIdentityCandidateIds(identityDecision);
                const selectedFoundations = Object.fromEntries(
                  pendingRoster.map(({ slot }) => {
                    const selected = identityCandidates.find(
                      (candidate) =>
                        candidate.slot === slot && candidate.id === selectedIdentityIds[slot],
                    );
                    if (!selected) throw new Error(`Spark did not select a ${slot} identity`);
                    return [slot, selected];
                  }),
                ) as Partial<Record<FighterRosterSlot, IdentityCandidate>>;
                emit(
                  'building-assets',
                  `Spark selected ${pendingRoster.length} fighter identit${pendingRoster.length === 1 ? 'y' : 'ies'}`,
                );

                const actionPoses = actionPosesFromSheets();
                const atlasResults = await Promise.allSettled(
                  pendingRoster.map(async (entry): Promise<readonly [FighterRosterSlot, Buffer]> => {
                    const foundation = selectedFoundations[entry.slot]!;
                    const anchor = await prepareGeneratedFighterReference(foundation.raw);
                    const generatePoseCandidate = async (
                      pose: GeneratedFighterPose,
                      suffix: string,
                      retryGuidance?: string,
                    ): Promise<PoseCandidate | null> => {
                      const id = `${entry.slot}-${pose}-${suffix}`;
                      const result = await generatedCandidate({
                        role: `fighter-${id}`,
                        label: `${entry.character.name} ${pose} ${suffix}`,
                        prompt: buildFighterPosePrompt(pose, {
                          outfit: conceptFor(entry.character),
                          colors: colorsFor(entry.character),
                          candidateId: id,
                          ...(entry.photoIdentity && identity ? { identity } : {}),
                          ...(retryGuidance ? { retryGuidance } : {}),
                        }),
                        reference: anchor,
                      });
                      return result ? { id, pose, processed: result.processed } : null;
                    };

                    const sheetSeed = await buildFighterPoseSheetSeed(anchor);
                    const generatePoseSheet = async (
                      group: FighterPoseSheetGroup,
                    ): Promise<PoseCandidate[]> => {
                      const id = `${entry.slot}-sheet-${group.id}`;
                      let raw: Buffer;
                      try {
                        raw = await callImage({
                          role: `fighter-${id}`,
                          label: `${entry.character.name} ${group.label.toLowerCase()} sheet`,
                          prompt: buildFighterPoseSheetPrompt(group, {
                            outfit: conceptFor(entry.character),
                            colors: colorsFor(entry.character),
                            candidateId: id,
                            ...(entry.photoIdentity && identity ? { identity } : {}),
                          }),
                          reference: sheetSeed,
                          size: '1024x1024',
                        });
                      } catch (error) {
                        if (abort.signal.aborted) throw error;
                        if (!isOptionalGeneratedArtProviderFailure(error)) throw error;
                        validationFailure(`fighter-${id}`);
                        emit(
                          'building-assets',
                          `${entry.character.name}'s ${group.id} sheet was unavailable; recovering its poses individually…`,
                        );
                        return [];
                      }

                      let cells: FighterPoseSheetCellResult[];
                      try {
                        cells = await splitGeneratedFighterPoseSheet(raw, group);
                      } catch {
                        validationFailure(`fighter-${id}`);
                        emit(
                          'building-assets',
                          `${entry.character.name}'s ${group.id} sheet could not be split; recovering its poses individually…`,
                        );
                        return [];
                      }
                      const valid = cells.flatMap((cell): PoseCandidate[] => {
                        if (!cell.processed) {
                          validationFailure(`fighter-${entry.slot}-${cell.pose}-sheet-cell`);
                          emit(
                            'building-assets',
                            `${entry.character.name}'s ${cell.pose} sheet cell failed local validation`,
                          );
                          return [];
                        }
                        return [
                          {
                            id: `${entry.slot}-${cell.pose}-S`,
                            pose: cell.pose,
                            processed: cell.processed,
                          },
                        ];
                      });
                      const reclaimed = cells.reduce(
                        (total, cell) => total + cell.segmentation.reclaimedBleedPixels,
                        0,
                      );
                      const excluded = cells.reduce(
                        (total, cell) => total + cell.segmentation.excludedNeighborPixels,
                        0,
                      );
                      emit(
                        'building-assets',
                        `${entry.character.name}'s ${group.id} sheet yielded ${valid.length}/6 poses${reclaimed || excluded ? ` (${reclaimed} bleed pixels reclaimed, ${excluded} neighbor pixels reassigned)` : ''}`,
                      );
                      return valid;
                    };

                    const candidates = (
                      await Promise.all(
                        FIGHTER_POSE_SHEET_GROUPS.map((group) => generatePoseSheet(group)),
                      )
                    ).flat();
                    const missing = actionPoses.filter(
                      (pose) => !candidates.some((candidate) => candidate.pose === pose),
                    );
                    if (missing.length > 0) {
                      emit(
                        'building-assets',
                        `Repainting ${missing.length} rejected ${entry.character.name} sheet cells individually, with one bounded second attempt if needed…`,
                      );
                      const recoveries = await recoverRejectedFighterSheetCells(
                        missing,
                        generatePoseCandidate,
                      );
                      candidates.push(...recoveries);
                    }
                    const unrecovered = actionPoses.filter(
                      (pose) => !candidates.some((candidate) => candidate.pose === pose),
                    );
                    const availablePoses = new Set<GeneratedFighterPose>([
                      'idle',
                      ...candidates.map(({ pose }) => pose),
                    ]);
                    const mechanicalFallbacks: Array<{
                      pose: GeneratedFighterPose;
                      sourcePose: GeneratedFighterPose;
                    }> = [];
                    for (const pose of unrecovered) {
                      const sourcePose = bestAvailableFighterPoseFallback(pose, availablePoses);
                      const processed =
                        sourcePose === 'idle'
                          ? foundation.processed
                          : candidates.find((candidate) => candidate.pose === sourcePose)?.processed;
                      if (!sourcePose || !processed) {
                        throw new Error(
                          `${entry.character.name} has no mechanically valid fallback for ${pose}`,
                        );
                      }
                      candidates.push({
                        id: `${entry.slot}-${pose}-F-${sourcePose}`,
                        pose,
                        processed,
                      });
                      mechanicalFallbacks.push({ pose, sourcePose });
                    }
                    if (mechanicalFallbacks.length > 0) {
                      emit(
                        'building-assets',
                        `${entry.character.name} kept playable fallback states after bounded recovery: ${mechanicalFallbacks.map(({ pose, sourcePose }) => `${pose}←${sourcePose}`).join(', ')}`,
                      );
                    }

                    const review = async (
                      pool: readonly PoseCandidate[],
                    ): Promise<ReturnType<typeof normalizeFighterPoseJudgeDecision>> => {
                      const descriptors: FighterPoseCandidateDescriptor[] = pool.map(
                        ({ id, pose }) => ({ id, pose }),
                      );
                      const board = await buildFighterPoseJudgeBoard({
                        fighterName: entry.character.name,
                        anchor: foundation.processed,
                        candidates: pool,
                      });
                      const firstByPose = Object.fromEntries(
                        actionPoses.map((pose) => [
                          pose,
                          descriptors.find((candidate) => candidate.pose === pose)!,
                        ]),
                      ) as Record<GeneratedFighterPose, FighterPoseCandidateDescriptor>;
                      const mockDecision = {
                        candidateReviews: descriptors.map(({ id, pose }) => ({
                          id,
                          pose,
                          scores: { identity: 5, costume: 5, pose: 5, technical: 5 },
                          fatalIssues: [],
                          summary: 'Mock identity-consistent pose.',
                        })),
                        selections: actionPoses.map((pose) => ({
                          pose,
                          candidateId: firstByPose[pose].id,
                          rationale: 'Mock selection.',
                        })),
                        setReview: {
                          accepted: true,
                          identityConsistency: 5,
                          costumeConsistency: 5,
                          scaleConsistency: 5,
                          poseReadability: 5,
                          fatalIssues: [],
                          summary: 'Mock complete pose set.',
                        },
                        retryPoses: [],
                      };
                      let rawDecision: unknown = mockDecision;
                      if (!mockImages) {
                        const prompt = buildFighterPoseJudgePrompt(
                          entry.character.name,
                          descriptors,
                          actionPoses,
                        );
                        rawDecision = await callLlm(
                          'design',
                          {
                            ...prompt,
                            jsonSchema: buildFighterPoseJudgeSchema(descriptors, actionPoses),
                            maxTokens: 6200,
                            timeoutMs: 120_000,
                          },
                          {
                            stage: 'building-assets',
                            label: `Spark reviewed ${entry.character.name}'s complete pose set`,
                            image: board,
                            reasoningEffort: 'low',
                          },
                        );
                      }
                      return normalizeFighterPoseJudgeDecision(
                        rawDecision,
                        descriptors,
                        actionPoses,
                      );
                    };

                    let decision = await review(candidates);
                    if (!decision.setReview.accepted) {
                      const retryPoses = fighterPosesNeedingRetry(decision, actionPoses, 4);
                      if (retryPoses.length > 0) {
                        emit(
                          'building-assets',
                          `Repainting ${retryPoses.length} weak ${entry.character.name} poses with Spark guidance…`,
                        );
                        const alternatives = (
                          await Promise.all(
                            retryPoses.flatMap(({ pose, guidance }) => [
                              generatePoseCandidate(pose, 'B', guidance),
                              generatePoseCandidate(pose, 'C', guidance),
                            ]),
                          )
                        ).filter((candidate): candidate is PoseCandidate => candidate !== null);
                        candidates.push(...alternatives);
                        decision = await review(candidates);
                      }
                    }
                    if (!decision.setReview.accepted) {
                      emit(
                        'building-assets',
                        `Spark still rejected ${entry.character.name}'s pose set after the bounded retry; using its highest-scoring locally valid combination`,
                      );
                    }
                    const selectedIds = bestFighterPoseCandidateIds(decision, actionPoses);
                    const selectedPoses = { idle: foundation.processed } as Record<
                      GeneratedFighterPose,
                      Buffer
                    >;
                    for (const pose of actionPoses) {
                      const selected = candidates.find(
                        (candidate) =>
                          candidate.pose === pose && candidate.id === selectedIds[pose],
                      );
                      if (!selected)
                        throw new Error(`Spark did not select ${entry.character.name} ${pose}`);
                      selectedPoses[pose] = selected.processed;
                    }
                    if (
                      mechanicalFallbacks.length === 0 &&
                      new Set(GENERATED_FIGHTER_POSES.map((pose) => sha256(selectedPoses[pose])))
                        .size !== GENERATED_FIGHTER_POSES.length
                    ) {
                      throw new Error(
                        `${entry.character.name} pose set contained duplicate states`,
                      );
                    }
                    const atlas = await buildGeneratedFighterAtlas(selectedPoses);
                    await validateGeneratedFighterAtlas(atlas);
                    await assetWorkspace.store(
                      FIGHTER_ROSTER_ASSET_ROLES[entry.slot],
                      atlas,
                      FIGHTER_ROSTER_PIPELINE_PROMPT_VERSION,
                      pipelineSha,
                    );
                    return [entry.slot, atlas] as const;
                  }),
                );
                for (const result of atlasResults) {
                  if (result.status === 'rejected') throw result.reason;
                }
                fighterArtStatus = { mode: 'generated', attempted: true };
            })()
          : Promise.resolve();

      let platformerPlayerArtStatus: GameMetaFile['platformerPlayerArt'] =
        spec.archetype === 'platformer'
          ? spec.platformerArtDensity !== 'detailed'
            ? {
                mode: 'procedural',
                attempted: false,
                reason: 'The game selected chunky source art',
              }
            : photoReference
              ? {
                  mode: 'procedural',
                  attempted: true,
                  reason: 'Generated platformer player art did not complete',
                }
              : {
                  mode: 'procedural',
                  attempted: false,
                  reason: 'No player photo was supplied',
                }
          : undefined;

      const platformerPlayerTask =
        photoReference &&
        spec.archetype === 'platformer' &&
        spec.platformerArtDensity === 'detailed'
          ? (async (): Promise<void> => {
              const generationStarted = Date.now();
              const colors = spec.palette
                .filter((hex) => {
                  const r = Number.parseInt(hex.slice(1, 3), 16);
                  const g = Number.parseInt(hex.slice(3, 5), 16);
                  const b = Number.parseInt(hex.slice(5, 7), 16);
                  return !(g > r * 1.15 && g > b * 1.15);
                })
                .join(', ');
              try {
                const pipelineFingerprint = JSON.stringify({
                  promptVersions: {
                    pose: GENERATED_PLATFORMER_POSE_PROMPT_VERSION,
                    idleJudge: PLATFORMER_IDLE_JUDGE_PROMPT_VERSION,
                    poseJudge: PLATFORMER_POSE_JUDGE_PROMPT_VERSION,
                  },
                  heroConcept: canonicalHeroConcept,
                  colors,
                });
                const pipelineSha = imagePromptHash(pipelineFingerprint, photoReference);
                const cached = Object.fromEntries(
                  GENERATED_PLATFORMER_POSES.map((pose) => [
                    pose,
                    assetWorkspace.load(
                      PLATFORMER_ASSET_ROLES[pose],
                      PLATFORMER_PLAYER_PIPELINE_PROMPT_VERSION,
                      pipelineSha,
                    ),
                  ]),
                ) as Record<GeneratedPlatformerPose, Buffer | null>;
                if (GENERATED_PLATFORMER_POSES.every((pose) => cached[pose])) {
                  const restored = cached as Record<GeneratedPlatformerPose, Buffer>;
                  await validateGeneratedPlatformerPoseSet(restored, { strictMotion: false });
                  emit('building-assets', 'Restored the selected platformer player animation');
                  platformerPlayerArtStatus = { mode: 'generated', attempted: true };
                  return;
                }

                type CandidateKind = 'idle' | 'side-anchor' | 'phase-a' | 'phase-b' | 'jump';
                interface Candidate {
                  id: string;
                  kind: CandidateKind;
                  reference: Buffer;
                  png: Buffer;
                }
                const generateCandidate = async (
                  id: string,
                  kind: CandidateKind,
                  label: string,
                  prompt: string,
                  reference: Buffer,
                ): Promise<Candidate | null> => {
                  let raw: Buffer;
                  try {
                    raw = await callImage({
                      role: `platformer-${id}`,
                      label,
                      prompt,
                      reference,
                      size: '1024x1024',
                    });
                  } catch (error) {
                    if (!isOptionalGeneratedArtProviderFailure(error)) throw error;
                    validationFailure(`platformer-${id}`);
                    emit(
                      'building-assets',
                      `${label} was rejected; continuing the candidate pool…`,
                    );
                    return null;
                  }
                  try {
                    let normalizedReference = raw;
                    let processed;
                    try {
                      processed = await processGeneratedPlatformerPose(raw);
                    } catch (initialError) {
                      const recovery = await recoverGeneratedPlatformerGreenPanel(raw);
                      if (!recovery.recovered) throw initialError;
                      normalizedReference = recovery.image;
                      processed = await processGeneratedPlatformerPose(normalizedReference);
                    }
                    return { id, kind, reference: normalizedReference, png: processed.png };
                  } catch (_error) {
                    validationFailure(`platformer-${id}`);
                    emit('building-assets', `${label} failed local sprite validation`);
                    return null;
                  }
                };

                const judge = async (
                  prompt: { system: string; user: string },
                  jsonSchema: Record<string, unknown>,
                  image: Buffer,
                  maxTokens: number,
                  label: string,
                  mockDecision: unknown,
                ): Promise<unknown> => {
                  if (mockImages) return mockDecision;
                  try {
                    return await callLlm(
                      'design',
                      {
                        ...prompt,
                        jsonSchema,
                        maxTokens,
                        timeoutMs: 120_000,
                      },
                      {
                        stage: 'building-assets',
                        label,
                        image,
                        reasoningEffort: 'low',
                      },
                    );
                  } catch (error) {
                    if (abort.signal.aborted) throw error;
                    throw new Error(
                      `platformer art review failed: ${error instanceof Error ? error.message : String(error)}`,
                    );
                  }
                };

                let idle: Candidate | undefined;
                let retryGuidance = '';
                let idleRetried = false;
                const idleRetryStarted = Date.now();
                for (let round = 1; round <= 2 && !idle; round++) {
                  emit(
                    'building-assets',
                    round === 1
                      ? 'Painting three player identity foundations…'
                      : 'Repainting the player identity foundations with Spark guidance…',
                  );
                  const offset = (round - 1) * 3;
                  const idleCandidates = (
                    await Promise.all(
                      [1, 2, 3].map((index) => {
                        const id = `I${offset + index}`;
                        return generateCandidate(
                          id,
                          'idle',
                          `Player identity candidate ${id}`,
                          buildPlatformerIdleCandidatePrompt(id, {
                            heroConcept: canonicalHeroConcept,
                            colors,
                            ...(retryGuidance ? { retryGuidance } : {}),
                          }),
                          photoReference,
                        );
                      }),
                    )
                  ).filter((candidate): candidate is Candidate => candidate !== null);
                  if (idleCandidates.length === 0) {
                    idleRetried = true;
                    retryGuidance =
                      'Return exactly one centered, uncropped adult character on a completely flat #00ff00 background.';
                    continue;
                  }
                  const descriptors: PlatformerIdleCandidateDescriptor[] = idleCandidates.map(
                    ({ id }) => ({ id }),
                  );
                  const board = await buildPlatformerIdleJudgeBoard({
                    source: photoReference,
                    candidates: idleCandidates.map(({ id, reference: raw, png: processed }) => ({
                      id,
                      raw,
                      processed,
                    })),
                  });
                  const judgePrompt = buildPlatformerIdleJudgePrompt(descriptors, {
                    heroConcept: canonicalHeroConcept,
                  });
                  const mockDecision = {
                    sourceReview: { eyewear: 'absent', summary: 'Mock source identity.' },
                    candidateReviews: descriptors.map(({ id }) => ({
                      id,
                      eyewear: 'absent',
                      eyewearMatch: true,
                      scores: {
                        identity: 5,
                        faceAndHair: 5,
                        accessories: 5,
                        costume: 5,
                        proportions: 5,
                        pose: 5,
                        technical: 5,
                      },
                      fatalIssues: [],
                      summary: 'Mock identity-safe foundation.',
                    })),
                    selection: {
                      accepted: true,
                      candidateId: descriptors[0]!.id,
                      confidence: 1,
                      rationale: 'Mock selection.',
                      retryGuidance: '',
                    },
                  };
                  const decision = normalizePlatformerIdleJudgeDecision(
                    await judge(
                      judgePrompt,
                      buildPlatformerIdleJudgeSchema(descriptors),
                      board,
                      2600,
                      'Spark selected the player identity foundation',
                      mockDecision,
                    ),
                    descriptors,
                  );
                  const selectedId = decision.selection.accepted
                    ? decision.selection.candidateId
                    : bestPlatformerIdleCandidateId(decision);
                  idle = idleCandidates.find(({ id }) => id === selectedId);
                  emit(
                    'building-assets',
                    decision.selection.accepted
                      ? `Spark selected ${selectedId} as the player identity foundation`
                      : `Spark selected ${selectedId} as the best available player identity foundation`,
                  );
                }
                if (!idle) {
                  throw new Error('no locally valid front-idle identity foundation was available');
                }
                if (idleRetried) {
                  recordEarlyRepairEvent(
                    'entities',
                    'platformer-idle-candidate-retry',
                    [
                      {
                        code: 'PLATFORMER_IDLE_FOUNDATION_REJECTED',
                        path: '/assets/platformer-player/idle',
                        message: retryGuidance.slice(0, 240),
                      },
                    ],
                    [],
                    idleRetryStarted,
                    'fixed',
                  );
                }
                const idleReference = await prepareGeneratedPlatformerReference(idle.reference);

                const sideAnchor = await generateCandidate(
                  'side-anchor',
                  'side-anchor',
                  'Player neutral side identity anchor',
                  buildPlatformerSideAnchorPrompt({ colors }),
                  idleReference,
                );
                if (!sideAnchor) {
                  throw new Error('the neutral side identity anchor failed local validation');
                }
                const sideReference = await prepareGeneratedPlatformerReference(
                  sideAnchor.reference,
                );

                emit('building-assets', 'Painting six run candidates and three jump poses…');
                const runTasks: Array<Promise<Candidate | null>> = [];
                for (let index = 1; index <= 3; index++) {
                  runTasks.push(
                    generateCandidate(
                      `A${index}`,
                      'phase-a',
                      `Player run Phase A candidate ${index}`,
                      buildPlatformerPhaseACandidatePrompt(index, { colors }),
                      sideReference,
                    ),
                    generateCandidate(
                      `B${index}`,
                      'phase-b',
                      `Player run Phase B candidate ${index}`,
                      buildPlatformerPhaseBCandidatePrompt(index, { colors }),
                      sideReference,
                    ),
                  );
                }
                const [runResults, jumpResults] = await Promise.all([
                  Promise.all(runTasks),
                  Promise.all(
                    [1, 2, 3].map((index) =>
                      generateCandidate(
                        `J${index}`,
                        'jump',
                        `Player jump candidate ${index}`,
                        buildPlatformerJumpCandidatePrompt(index, { colors }),
                        sideReference,
                      ),
                    ),
                  ),
                ]);
                const jumpCandidates = jumpResults.filter(
                  (candidate): candidate is Candidate => candidate !== null,
                );
                const jump = jumpCandidates[0]?.png ?? sideAnchor.png;
                if (jumpCandidates.length === 0) {
                  emit(
                    'building-assets',
                    'Jump candidates were unusable; keeping the generated side pose for jumping',
                  );
                }
                const runCandidates = runResults.filter(
                  (candidate): candidate is Candidate & { kind: 'phase-a' | 'phase-b' } =>
                    candidate?.kind === 'phase-a' || candidate?.kind === 'phase-b',
                );
                const descriptors: PlatformerPoseCandidateDescriptor[] = runCandidates.map(
                  ({ id, kind }) => ({ id, kind }),
                );
                if (!descriptors.some(({ kind }) => kind === 'phase-a')) {
                  throw new Error('all Phase A run candidates failed local validation');
                }
                if (!descriptors.some(({ kind }) => kind === 'phase-b')) {
                  throw new Error('all Phase B run candidates failed local validation');
                }
                const pairBoard = await buildPlatformerPoseJudgeBoard({
                  source: photoReference,
                  idle: idle.png,
                  sideAnchor: sideAnchor.png,
                  candidates: runCandidates.map(({ id, kind, png: processed }) => ({
                    id,
                    kind,
                    processed,
                  })),
                });
                const pairPrompt = buildPlatformerPoseJudgePrompt(descriptors);
                const firstA = descriptors.find(({ kind }) => kind === 'phase-a')!.id;
                const firstB = descriptors.find(({ kind }) => kind === 'phase-b')!.id;
                const mockPairDecision = {
                  anchorReview: {
                    identity: 5,
                    sideView: 5,
                    costume: 5,
                    fatalIssues: [],
                    summary: 'Mock side anchor.',
                  },
                  candidateReviews: descriptors.map(({ id, kind }) => ({
                    id,
                    kind,
                    scores: { identity: 5, costume: 5, pose: 5, technical: 5 },
                    fatalIssues: [],
                    summary: 'Mock usable run candidate.',
                  })),
                  pairReviews: descriptors
                    .filter(({ kind }) => kind === 'phase-a')
                    .flatMap(({ id: phaseAId }) =>
                      descriptors
                        .filter(({ kind }) => kind === 'phase-b')
                        .map(({ id: phaseBId }) => ({
                          phaseAId,
                          phaseBId,
                          legAlternation: 5,
                          armAlternation: 5,
                          pairConsistency: 5,
                          fatalIssues: [],
                          summary: 'Mock visibly alternating pair.',
                        })),
                    ),
                  selection: {
                    accepted: true,
                    phaseAId: firstA,
                    phaseBId: firstB,
                    confidence: 1,
                    rationale: 'Mock selection.',
                    retryGuidance: '',
                  },
                };
                const pairDecision = normalizePlatformerPoseJudgeDecision(
                  await judge(
                    pairPrompt,
                    buildPlatformerPoseJudgeSchema(descriptors),
                    pairBoard,
                    4000,
                    'Spark selected the player run animation',
                    mockPairDecision,
                  ),
                  descriptors,
                );
                const selectedPair = pairDecision.selection.accepted
                  ? pairDecision.selection
                  : bestPlatformerPosePair(pairDecision);
                if (!selectedPair) throw new Error('Spark did not return any run-pair reviews');
                const walk1 = runCandidates.find(({ id }) => id === selectedPair.phaseAId)!;
                const walk2 = runCandidates.find(({ id }) => id === selectedPair.phaseBId)!;
                emit(
                  'building-assets',
                  pairDecision.selection.accepted
                    ? `Spark selected ${walk1.id} + ${walk2.id} for the player run animation`
                    : `Spark selected ${walk1.id} + ${walk2.id} as the best available run animation`,
                );

                const generated: Record<GeneratedPlatformerPose, Buffer> = {
                  idle: idle.png,
                  sideIdle: sideAnchor.png,
                  walk1: walk1.png,
                  walk2: walk2.png,
                  jump,
                };
                await validateGeneratedPlatformerPoseSet(generated, { strictMotion: false });
                await Promise.all(
                  GENERATED_PLATFORMER_POSES.map((pose) =>
                    assetWorkspace.store(
                      PLATFORMER_ASSET_ROLES[pose],
                      generated[pose],
                      PLATFORMER_PLAYER_PIPELINE_PROMPT_VERSION,
                      pipelineSha,
                    ),
                  ),
                );
                platformerPlayerArtStatus = { mode: 'generated', attempted: true };
              } catch (error) {
                if (
                  abort.signal.aborted ||
                  (error instanceof PipelineError && !isOptionalGeneratedArtProviderFailure(error))
                ) {
                  throw error;
                }
                await Promise.all([
                  assetWorkspace.discard(Object.values(PLATFORMER_ASSET_ROLES)),
                  assetWorkspace.discardPrivate('platformerReference'),
                  assetWorkspace.discardPrivate('platformerSideReference'),
                ]);
                const reason =
                  error instanceof Error
                    ? error.message.slice(0, 240)
                    : 'Generated platformer pose set failed validation';
                platformerPlayerArtStatus = {
                  mode: 'procedural',
                  attempted: true,
                  reason,
                };
                recordEarlyRepairEvent(
                  'entities',
                  'platformer-player-art-fallback',
                  [
                    {
                      code: 'PLATFORMER_PLAYER_ART_FALLBACK',
                      path: '/assets/platformer-player',
                      message: reason,
                    },
                  ],
                  [],
                  generationStarted,
                  'downgraded',
                );
                emit(
                  'building-assets',
                  `Generated platformer player did not pass as a complete set; using the stable hero (${reason.slice(0, 120)})`,
                );
              }
            })()
          : Promise.resolve();

      const deferHeadsUntilFullBodyResult =
        !!photo &&
        (spec.archetype === 'fighter' ||
          (spec.archetype === 'platformer' && spec.platformerArtDensity === 'detailed'));
      const fullBodyTask = spec.archetype === 'fighter' ? fighterTask : platformerPlayerTask;
      const headsTask = deferHeadsUntilFullBodyResult
        ? fullBodyTask.then(async () => {
            if (
              spec.archetype === 'platformer' &&
              platformerPlayerArtStatus?.mode !== 'generated'
            ) {
              await generateHeads();
            }
          })
        : generateHeads();

      const finishingAssets = await Promise.allSettled([
        storyTask,
        platformerBackdropTask,
        platformerBossTask,
        platformerEnemyTask,
        platformerPropTask,
        fighterTask,
        platformerPlayerTask,
        portraitTask,
        portraitDefeatTask,
        headsTask,
      ]);
      const finishingFailure = finishingAssets.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (finishingFailure) throw finishingFailure.reason;
      writeFileSync(join(staging, 'game.json'), JSON.stringify(spec, null, 1));
      const stageCfg = config.stages.design;
      const meta: GameMetaFile = {
        id: gameId,
        status: 'ready',
        createdAt: job.createdAt,
        archetype,
        seed: job.seed,
        engineVersion: ENGINE_VERSION,
        archetypeVersion: archetypes[archetype].version,
        specVersion: SPEC_VERSION,
        title: spec.meta.title,
        tagline: spec.meta.tagline,
        sourcePrompt: job.promptText,
        sourceKind: job.sourceKind,
        ...(job.presetId ? { presetId: job.presetId } : {}),
        ...(job.requestedArchetype ? { requestedArchetype: job.requestedArchetype } : {}),
        hadPhoto: !!photo,
        model: stageCfg.model,
        provider: process.env.SPARKADE_PROVIDER ?? stageCfg.provider,
        costUsd: this.db.gameCost(gameId),
        costBreakdown: this.db.usageForGame(gameId),
        priceSnapshot: snapshot,
        imagePriceSnapshot: {
          model: imageModel,
          perImageUsd: mockImages ? 0 : imagePrice,
        },
        ...(fighterArtStatus ? { fighterArt: fighterArtStatus } : {}),
        ...(platformerPlayerArtStatus ? { platformerPlayerArt: platformerPlayerArtStatus } : {}),
        ...(platformerBossArtStatus ? { platformerBossArt: platformerBossArtStatus } : {}),
        ...(platformerEnemyArtStatus ? { platformerEnemyArt: platformerEnemyArtStatus } : {}),
        ...(platformerPropArtStatus ? { platformerPropArt: platformerPropArtStatus } : {}),
        ...(platformerBackdropArtStatus
          ? { platformerBackdropArt: platformerBackdropArtStatus }
          : {}),
      };
      writeFileSync(join(staging, 'meta.json'), JSON.stringify(meta, null, 2));

      if (this.canceled.has(jobId)) throw new PipelineError('canceled', 'canceled', 'failed');
      this.files.publish(jobId, gameId);

      this.db.upsertGame({
        id: gameId,
        title: spec.meta.title,
        tagline: spec.meta.tagline,
        archetype,
        status: 'ready',
        createdAt: job.createdAt,
        golden: false,
        jobId,
        costUsd: meta.costUsd,
        cover: this.files.coverFor(spec, gameId),
        failure: null,
        engineVersion: ENGINE_VERSION,
        archetypeVersion: archetypes[archetype].version,
      });
      this.db.updateJob(jobId, {
        status: 'done',
        stage: 'done',
        detail: 'Ready to play',
        finishedAt: nowIso(),
      });
      const completedRepairs = this.db
        .repairEventsForJob(jobId)
        .filter((event) => event.attempt === job.attempt);
      const recoveredIncident = hasSubstantiveRepair(completedRepairs)
        ? captureIncident(
            'recovered',
            {
              code: 'repaired-generation',
              message: `generation published after ${completedRepairs.filter((event) => event.action !== 'normalize').length} repair action(s)`,
              stage: 'validating',
            },
            spec,
          )
        : null;
      if (job.attempt > 1) {
        try {
          this.incidents?.markRetry(
            jobId,
            job.attempt - 1,
            job.attempt,
            'succeeded',
            recoveredIncident?.id,
          );
        } catch (error) {
          console.warn('could not update generation incident retry outcome:', error);
        }
      }
      this.hub.emit({
        type: 'done',
        jobId,
        gameId,
        elapsedMs: Date.now() - startedAt,
        costUsd: meta.costUsd,
      });
    } catch (e) {
      if (this.canceled.has(jobId)) {
        this.db.updateJob(jobId, { status: 'canceled', finishedAt: nowIso() });
        return;
      }
      const err =
        e instanceof PipelineError
          ? e
          : e instanceof GeneratedAssetStorageError
            ? new PipelineError('storage', e.message, 'building-assets')
            : new PipelineError('internal', e instanceof Error ? e.message : String(e));
      const friendly = {
        code: err.code,
        message: err.message.slice(0, 500),
        stage: err.stage,
      };
      this.db.updateJob(jobId, {
        status: 'failed',
        stage: 'failed',
        error: friendly,
        finishedAt: nowIso(),
      });
      this.db.setGameStatus(gameId, 'failed', { code: friendly.code, message: friendly.message });
      this.db.setGameCost(gameId, this.db.gameCost(gameId));
      const failedIncident = captureIncident('failed', friendly);
      if (job.attempt > 1) {
        try {
          this.incidents?.markRetry(
            jobId,
            job.attempt - 1,
            job.attempt,
            'failed',
            failedIncident?.id,
          );
        } catch (error) {
          console.warn('could not update generation incident retry outcome:', error);
        }
      }
      this.hub.emit({
        type: 'failed',
        jobId,
        gameId,
        code: friendly.code,
        message: friendly.message,
        stage: err.stage,
        elapsedMs: Date.now() - startedAt,
        costSoFarUsd: this.db.gameCost(gameId),
      });
    } finally {
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      this.aborts.delete(jobId);
    }
  }

  private async designPass(
    callLlm: (
      stage: StageName,
      prompt: BuiltPrompt,
      opts: {
        temperature?: number;
        repair?: boolean;
        image?: Buffer;
        reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
        checkpoint?: RawStageName;
        label: string;
        stage: JobStage;
      },
    ) => Promise<unknown>,
    opts: {
      promptText: string;
      hasPhoto: boolean;
      describeInStory: boolean;
      antiCollision: { title: string; tagline: string }[];
      recentMoods?: string[];
      photo?: Buffer;
      extraNote?: string;
      onRepair?: (
        before: readonly LintError[],
        after: readonly LintError[],
        started: number,
      ) => void;
    },
  ): Promise<DesignDoc> {
    const prompt = buildDesignPrompt(opts);
    let raw = await callLlm('design', prompt, {
      label: 'Design drafted',
      stage: 'designing',
      checkpoint: 'design',
      ...(opts.photo ? { image: opts.photo } : {}),
    });
    let errors = designOutputDiagnostics(raw);
    if (errors.length) {
      const before = errors;
      const repairStarted = Date.now();
      const retryPrompt = buildDesignPrompt({
        ...opts,
        extraNote: [
          opts.extraNote,
          `Your previous output failed validation: ${errors
            .slice(0, 8)
            .map((e) => `${e.path}: ${e.message}`)
            .join('; ')}. Fix these and follow the schema exactly.`,
        ]
          .filter(Boolean)
          .join(' '),
      });
      raw = await callLlm('design', retryPrompt, {
        label: 'Design redrafted',
        stage: 'designing',
        checkpoint: 'design',
        ...(opts.photo ? { image: opts.photo } : {}),
      });
      errors = designOutputDiagnostics(raw);
      opts.onRepair?.(before, errors, repairStarted);
      if (errors.length) {
        throw new PipelineError(
          'design-invalid',
          `the design pass failed validation twice (${errors[0]!.path}: ${errors[0]!.message})`,
          'designing',
        );
      }
    }
    return raw as DesignDoc;
  }

  private assemble(
    seed: number,
    archetype: ArchetypeId,
    design: DesignDoc,
    parts: SpecParts,
    hasPhoto: boolean,
  ): GameSpec {
    const fighterPlayer =
      archetype === 'fighter' ? (parts.player as FighterCharacter | undefined) : undefined;
    const canonicalHeroConcept = fighterPlayer?.visualConcept ?? design.heroConcept;
    return {
      specVersion: 1,
      archetype,
      seed,
      meta: {
        title: design.title,
        tagline: design.tagline,
        heroConcept: canonicalHeroConcept,
      },
      palette: design.palette,
      story: design.story,
      sprites: (parts.entities?.sprites ?? { custom: {}, assign: {} }) as GameSpec['sprites'],
      ...(archetype === 'fighter' && parts.player ? { player: parts.player } : {}),
      levels: (parts.levels ?? []) as never,
      boss: (parts.entities?.boss ?? {}) as never,
      music: (parts.music ?? {}) as never,
      ...(parts.entities?.sfx ? { sfx: parts.entities.sfx as GameSpec['sfx'] } : {}),
      ...(parts.entities?.backdrop
        ? { backdrop: parts.entities.backdrop as GameSpec['backdrop'] }
        : {}),
      ...(parts.entities?.weather
        ? { weather: parts.entities.weather as GameSpec['weather'] }
        : {}),
      ...(parts.entities?.lighting
        ? { lighting: parts.entities.lighting as GameSpec['lighting'] }
        : {}),
      ...(parts.entities?.juice !== undefined
        ? { juice: parts.entities.juice as GameSpec['juice'] }
        : {}),
      ...(design.difficulty ? { difficulty: design.difficulty } : {}),
      ...(archetype === 'platformer'
        ? {
            playerHeightTiles: 2 as const,
            platformerScale: design.platformerScale ?? ('heroic' as const),
            platformerArtDensity:
              design.platformerArtDensity ??
              (hasPhoto ? ('detailed' as const) : ('chunky' as const)),
          }
        : {}),
      ...(archetype === 'platformer' && design.feel ? { feel: design.feel } : {}),
      scoring: design.scoring,
    } as GameSpec;
  }

  private collectDiagnostics(spec: GameSpec, archetype: ArchetypeId): LintError[] {
    const schemaErrors = validateGameSchema(archetype, spec);
    const scan = securityScan(spec);
    // Semantic linters assume schema-valid input, but independent security
    // findings should not be hidden behind a schema failure. Once schema-safe,
    // collect every independent diagnostic in one pass so a malformed custom
    // boss cannot mask a broken level until the next paid repair call.
    if (schemaErrors.length) return dedupeDiagnostics([...schemaErrors, ...scan]);
    const bossSpriteErrors = customBossSpriteDiagnostics(spec);
    return dedupeDiagnostics([...scan, ...bossSpriteErrors, ...archetypes[archetype].lint(spec)]);
  }

  /**
   * Normalize deterministic defects, then repair independently-owned document
   * regions. A stalled/no-op owner immediately advances to regeneration rather
   * than spending the same prompt twice. Only failed levels are regenerated.
   */
  private async validateAndRepair(
    input: GameSpec,
    archetype: ArchetypeId,
    design: DesignDoc,
    callLlm: (
      stage: StageName,
      prompt: BuiltPrompt,
      opts: {
        temperature?: number;
        repair?: boolean;
        reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
        checkpoint?: RawStageName;
        label: string;
        stage: JobStage;
      },
    ) => Promise<unknown>,
    emit: (stage: JobStage, detail: string) => void,
    hasPhoto: boolean,
    recentUse?: RecentUse,
    repairContext?: { jobId: string; gameId: string; attempt: number },
  ): Promise<GameSpec> {
    const fallbackOptions = { recentBosses: recentUse?.bosses };
    const passByOwner = new Map<string, number>();
    if (repairContext) {
      try {
        for (const event of this.db.repairEventsForJob(repairContext.jobId)) {
          if (event.attempt !== repairContext.attempt) continue;
          passByOwner.set(event.owner, Math.max(passByOwner.get(event.owner) ?? 0, event.pass));
        }
      } catch {
        /* telemetry continuity is best-effort */
      }
    }
    const nextPass = (owner: string): number => {
      const pass = (passByOwner.get(owner) ?? 0) + 1;
      passByOwner.set(owner, pass);
      return pass;
    };
    const outcomeOf = (before: readonly LintError[], after: readonly LintError[]): string =>
      after.length === 0
        ? 'fixed'
        : after.length < before.length
          ? 'improved'
          : diagnosticSignature(after) === diagnosticSignature(before)
            ? 'unchanged'
            : after.length > before.length
              ? 'worsened'
              : 'changed';
    const record = (
      owner: string,
      action: string,
      before: readonly LintError[],
      after: readonly LintError[],
      patch: unknown,
      startedAt: number,
      outcome = outcomeOf(before, after),
    ): void => {
      if (!repairContext) return;
      try {
        this.db.insertRepairEvent({
          ...repairContext,
          pass: nextPass(owner),
          owner,
          action,
          diagnosticsBefore: before,
          diagnosticsAfter: after,
          patch,
          elapsedMs: Date.now() - startedAt,
          outcome,
        });
      } catch {
        // Telemetry must never make a playable spec fail validation.
      }
    };
    const prepareForRepair = (
      candidate: GameSpec,
    ): { spec: GameSpec; fixes: ReturnType<typeof normalizeGeneratedSpec>['fixes'] } => {
      // Normalizers intentionally operate on the richer GameSpec types, while
      // this boundary also receives schema-invalid model output. Never let a
      // missing nested array/object bypass the diagnostics and repair path by
      // throwing from a deterministic cleanup first.
      let normalized: ReturnType<typeof normalizeGeneratedSpec>;
      try {
        normalized = normalizeGeneratedSpec(candidate);
      } catch {
        normalized = { spec: candidate, fixes: [] };
      }
      try {
        return {
          spec: applySpriteFallbacksForRepair(normalized.spec, fallbackOptions),
          fixes: normalized.fixes,
        };
      } catch {
        return normalized;
      }
    };
    const applyFallbacksSafely = (candidate: GameSpec): ReturnType<typeof applySpriteFallbacks> => {
      try {
        return applySpriteFallbacks(normalizeTileGrids(candidate), fallbackOptions);
      } catch {
        // A schema-invalid owner must reach owner regeneration. Sprite/grid
        // downgrade helpers are opportunistic and cannot assume it is valid.
        return { spec: candidate, downgraded: [] };
      }
    };

    const initialDiagnostics = this.collectDiagnostics(input, archetype);
    const initialPrepareStarted = Date.now();
    const prepared = prepareForRepair(input);
    let spec = prepared.spec;
    let diagnostics = this.collectDiagnostics(spec, archetype);
    if (prepared.fixes.length || JSON.stringify(spec) !== JSON.stringify(input)) {
      const owners = new Set<RepairOwner>(
        prepared.fixes.map((fix) =>
          diagnosticOwner({ code: fix.code, path: fix.path, message: fix.message }),
        ),
      );
      const ownersToRecord: RepairOwner[] = owners.size ? [...owners] : ['entities'];
      for (const owner of ownersToRecord) {
        record(
          owner,
          'normalize',
          diagnosticsForOwner(initialDiagnostics, owner),
          diagnosticsForOwner(diagnostics, owner),
          prepared.fixes.filter(
            (fix) =>
              diagnosticsForOwner([{ code: fix.code, path: fix.path, message: fix.message }], owner)
                .length > 0,
          ),
          initialPrepareStarted,
        );
      }
    }
    if (!diagnostics.length) return spec;

    const stalledRepairOwners = new Set<RepairOwner>();
    let modelRepairCalls = 0;
    // Owner fairness without an unbounded 4 owners × 2 passes × cleanup bill.
    // Regeneration remains available after this surgical-call ceiling.
    const maxModelRepairCalls = GENERATION.maxRepairCallsPerAttempt;
    const repairBudgetAvailable = (): boolean => {
      if (!repairContext) return true;
      try {
        return (this.db.gameCost(repairContext.gameId) ?? 0) < GENERATION.repairCostBudgetUsd;
      } catch {
        // A telemetry read must not disable validation recovery.
        return true;
      }
    };
    const tryOwnerRepairs = async (owner: RepairOwner, budget: number): Promise<void> => {
      if (stalledRepairOwners.has(owner)) return;
      for (
        let i = 0;
        i < budget && modelRepairCalls < maxModelRepairCalls && repairBudgetAvailable();
        i++
      ) {
        const before = diagnosticsForOwner(diagnostics, owner);
        if (!before.length) return;
        emit('repairing', `Repairing ${owner} (${i + 1}/${budget}) — ${before.length} issue(s)…`);
        const prompt = buildRepairPrompt(archetype, spec, before, owner);
        const started = Date.now();
        try {
          modelRepairCalls++;
          const patch = (await callLlm('repair', prompt, {
            temperature: 0,
            repair: true,
            reasoningEffort: 'minimal',
            label: 'Patch applied',
            stage: 'repairing',
          })) as JsonPatchOp[];
          assertPatchTargetsOwner(patch, owner, before);
          const patched = applyPatch(spec, patch);
          if (JSON.stringify(patched) === JSON.stringify(spec)) {
            record(owner, 'model-repair', before, before, patch, started, 'unchanged');
            stalledRepairOwners.add(owner);
            return;
          }
          const nextPrepared = prepareForRepair(patched);
          const nextDiagnostics = this.collectDiagnostics(nextPrepared.spec, archetype);
          const after = diagnosticsForOwner(nextDiagnostics, owner);
          const progress = repairMadeProgress(before, after);
          record(
            owner,
            'model-repair',
            before,
            after,
            { operations: patch, normalizationFixes: nextPrepared.fixes },
            started,
            outcomeOf(before, after),
          );
          if (after.length === 0 || progress) {
            spec = nextPrepared.spec;
            diagnostics = nextDiagnostics;
          }
          if (after.length === 0) return;
          if (!progress) {
            stalledRepairOwners.add(owner);
            return;
          }
        } catch (e) {
          const recoverableProviderFailure =
            e instanceof PipelineError && ['provider-error', 'call-timeout'].includes(e.code);
          if (e instanceof PatchError || recoverableProviderFailure) {
            record(owner, 'model-repair', before, before, null, started, 'failed');
            stalledRepairOwners.add(owner);
            return;
          }
          throw e;
        }
      }
    };
    const repairOwners = async (budget: number): Promise<void> => {
      const priority: RepairOwner[] = ['document', 'entities', 'music', 'levels'];
      for (
        let round = 0;
        round < budget && modelRepairCalls < maxModelRepairCalls && repairBudgetAvailable();
        round++
      ) {
        for (const owner of priority) {
          if (modelRepairCalls >= maxModelRepairCalls || !repairBudgetAvailable()) return;
          await tryOwnerRepairs(owner, 1);
        }
      }
    };

    await repairOwners(GENERATION.maxRepairAttemptsPerStage);
    if (!diagnostics.length) return spec;

    // Authored sprite problems have now had a surgical repair opportunity.
    // Downgrade only the still-invalid art before spending on regeneration.
    const fallbackBefore = diagnostics;
    const fallbackStarted = Date.now();
    let fallbackResult = applyFallbacksSafely(spec);
    spec = fallbackResult.spec;
    diagnostics = this.collectDiagnostics(spec, archetype);
    if (fallbackResult.downgraded.length) {
      record(
        'entities',
        'fallback',
        diagnosticsForOwner(fallbackBefore, 'entities'),
        diagnosticsForOwner(diagnostics, 'entities'),
        fallbackResult.downgraded,
        fallbackStarted,
      );
    }
    const bossDowngrade = fallbackResult.downgraded.find((message) =>
      message.startsWith('assign.boss fell back'),
    );
    if (bossDowngrade) emit('validating', `Authored boss could not be repaired; ${bossDowngrade}.`);
    if (!diagnostics.length) return spec;

    // Recompute after every stage: fixing a schema-invalid owner can uncover
    // semantic diagnostics in another owner that the linter could not safely
    // inspect before. Each owner gets at most one regeneration in this pass.
    const regeneratedOwners = new Set<RepairOwner>();
    for (;;) {
      if (!repairBudgetAvailable()) break;
      const owner = (['levels', 'entities', 'music'] as const).find(
        (candidate) =>
          !regeneratedOwners.has(candidate) &&
          diagnosticsForOwner(diagnostics, candidate).length > 0,
      );
      if (!owner) break;
      regeneratedOwners.add(owner);
      const before = diagnosticsForOwner(diagnostics, owner);
      emit('writing-spec', `Regenerating ${owner}…`);
      const started = Date.now();
      try {
        if (owner === 'levels') {
          const levelCount = Array.isArray(spec.levels) ? spec.levels.length : 0;
          const indexes = failingLevelIndexes(before).filter((index) => index < levelCount);
          const onlyIndexedFailures =
            indexes.length > 0 &&
            before.every((diagnostic) =>
              indexes.some((index) => diagnostic.path.startsWith(`/levels/${index}`)),
            );
          if (onlyIndexedFailures) {
            const currentLevels = structuredClone(spec.levels) as unknown[];
            const replacements = await Promise.all(
              indexes.map(async (index) => {
                const levelDiagnostics = before.filter((diagnostic) =>
                  diagnostic.path.startsWith(`/levels/${index}`),
                );
                const requestReplacement = (issues: readonly LintError[], label: string) =>
                  callLlm(
                    'levels',
                    buildLevelRegenerationPrompt(archetype, design, index, currentLevels, issues),
                    { label, stage: 'writing-spec', reasoningEffort: 'minimal' },
                  );
                const checkpointReplacement = (document: unknown): void => {
                  try {
                    if (repairContext) {
                      this.files.writeRawStageCheckpoint(
                        repairContext.jobId,
                        repairContext.attempt,
                        'levels',
                        document,
                      );
                    }
                  } catch {
                    /* best-effort raw evidence */
                  }
                };
                let raw = await requestReplacement(levelDiagnostics, `Level ${index + 1} rebuilt`);
                checkpointReplacement(raw);
                try {
                  const level = isRecord(raw) ? (raw['level'] ?? raw) : raw;
                  return [index, compileGeneratedLevel(archetype, level)] as const;
                } catch (error) {
                  if (!(error instanceof TileRunsError)) throw error;
                  const compileDiagnostic = tileRunsDiagnostic(error, index);
                  const retryStarted = Date.now();
                  raw = await requestReplacement(
                    [...levelDiagnostics, compileDiagnostic],
                    `Level ${index + 1} rows corrected`,
                  );
                  checkpointReplacement(raw);
                  const level = isRecord(raw) ? (raw['level'] ?? raw) : raw;
                  let replacement: unknown;
                  try {
                    replacement = compileGeneratedLevel(archetype, level);
                  } catch (retryError) {
                    if (!(retryError instanceof TileRunsError)) throw retryError;
                    replacement = canonicalLevelFallback(level, retryError);
                  }
                  record(
                    'levels',
                    'compile-retry',
                    [compileDiagnostic],
                    [],
                    null,
                    retryStarted,
                    'fixed',
                  );
                  return [index, replacement] as const;
                }
              }),
            );
            const levels = structuredClone(spec.levels) as unknown[];
            for (const [index, replacement] of replacements) levels[index] = replacement;
            spec = { ...spec, levels: levels as never };
            try {
              if (repairContext) {
                this.files.writeRawStageCheckpoint(
                  repairContext.jobId,
                  repairContext.attempt,
                  'levels',
                  {
                    ...(archetype === 'fighter' && 'player' in spec ? { player: spec.player } : {}),
                    levels,
                  },
                );
              }
            } catch {
              /* best-effort canonical checkpoint */
            }
          } else {
            let raw = await callLlm('levels', buildLevelsPrompt(archetype, design, before), {
              label: 'Levels rebuilt',
              stage: 'writing-spec',
              checkpoint: 'levels',
              reasoningEffort: 'minimal',
            });
            let canonical: unknown;
            try {
              canonical = compileGeneratedLevels(archetype, raw, true);
            } catch (error) {
              if (!(error instanceof TileRunsError)) throw error;
              const compileDiagnostic = tileRunsDiagnostic(error);
              const retryStarted = Date.now();
              raw = await callLlm(
                'levels',
                buildLevelsPrompt(archetype, design, [...before, compileDiagnostic]),
                {
                  label: 'Correcting rebuilt level rows…',
                  stage: 'writing-spec',
                  checkpoint: 'levels',
                  reasoningEffort: 'minimal',
                },
              );
              try {
                canonical = compileGeneratedLevels(archetype, raw, true);
              } catch (retryError) {
                if (!(retryError instanceof TileRunsError)) throw retryError;
                canonical = canonicalLevelsFallback(archetype, raw, retryError);
              }
              record(
                'levels',
                'compile-retry',
                [compileDiagnostic],
                [],
                null,
                retryStarted,
                'fixed',
              );
            }
            const roster = isRecord(canonical) ? canonical : null;
            spec = {
              ...spec,
              ...(archetype === 'fighter' && roster?.['player']
                ? { player: roster['player'] as never }
                : {}),
              levels: (roster?.['levels'] ?? canonical) as never,
            };
          }
        } else if (owner === 'entities') {
          const raw = await callLlm(
            'entities',
            buildEntitiesPrompt(archetype, design, hasPhoto, recentUse, before),
            {
              label: 'Entities recast',
              stage: 'writing-spec',
              checkpoint: 'entities',
              reasoningEffort: 'minimal',
            },
          );
          const r = isRecord(raw) ? raw : {};
          const {
            sprites: _sprites,
            boss: _boss,
            sfx: _sfx,
            backdrop: _backdrop,
            weather: _weather,
            lighting: _lighting,
            juice: _juice,
            ...unowned
          } = spec;
          spec = {
            ...unowned,
            sprites: r['sprites'] as GameSpec['sprites'],
            boss: r['boss'] as never,
            ...(r['sfx'] ? { sfx: r['sfx'] as GameSpec['sfx'] } : {}),
            ...(r['backdrop'] ? { backdrop: r['backdrop'] as never } : {}),
            ...(r['weather'] ? { weather: r['weather'] as GameSpec['weather'] } : {}),
            ...(r['lighting'] ? { lighting: r['lighting'] as GameSpec['lighting'] } : {}),
            ...(r['juice'] !== undefined ? { juice: r['juice'] as GameSpec['juice'] } : {}),
          };
        } else {
          const raw = await callLlm('music', buildMusicPrompt(archetype, design, before), {
            label: 'Music recomposed',
            stage: 'writing-spec',
            checkpoint: 'music',
            reasoningEffort: 'minimal',
          });
          spec = { ...spec, music: (isRecord(raw) ? (raw['music'] ?? raw) : raw) as never };
        }
        const regenerated = prepareForRepair(spec);
        spec = regenerated.spec;
        diagnostics = this.collectDiagnostics(spec, archetype);
        record(
          owner,
          'regenerate',
          before,
          diagnosticsForOwner(diagnostics, owner),
          { normalizationFixes: regenerated.fixes },
          started,
        );
        stalledRepairOwners.delete(owner);
      } catch (error) {
        record(
          owner,
          'regenerate',
          before,
          before,
          { error: error instanceof Error ? error.message : String(error) },
          started,
          'failed',
        );
        throw error;
      }
    }
    if (!diagnostics.length) return spec;

    // A fresh stage gets the normal repair allowance. Productive patches keep
    // going; tryOwnerRepairs stops immediately on a no-op/stall, while the
    // per-attempt call cap and cumulative cost ceiling bound the work.
    await repairOwners(GENERATION.maxRepairAttemptsPerStage);
    if (!diagnostics.length) return spec;

    const finalFallbackBefore = diagnostics;
    const finalFallbackStarted = Date.now();
    fallbackResult = applyFallbacksSafely(spec);
    spec = fallbackResult.spec;
    diagnostics = this.collectDiagnostics(spec, archetype);
    if (fallbackResult.downgraded.length) {
      record(
        'entities',
        'fallback',
        diagnosticsForOwner(finalFallbackBefore, 'entities'),
        diagnosticsForOwner(diagnostics, 'entities'),
        fallbackResult.downgraded,
        finalFallbackStarted,
      );
    }
    const regeneratedBossDowngrade = fallbackResult.downgraded.find((message) =>
      message.startsWith('assign.boss fell back'),
    );
    if (regeneratedBossDowngrade) {
      emit('validating', `Authored boss could not be repaired; ${regeneratedBossDowngrade}.`);
    }
    if (!diagnostics.length) return spec;

    // Generated platformer topology is uniquely amenable to a safe mechanical
    // fallback: if the document is otherwise valid, lay one continuous low
    // route through each still-disconnected level. This is preferable to
    // throwing away the complete game (and all of its later image work) over a
    // map-model mistake that repeated repair prompts could not localize.
    const routeCodes = new Set(['PLAT_EXIT_UNREACHABLE', 'PLAT_NO_CHECKPOINT']);
    const routeIndexes = failingLevelIndexes(diagnostics);
    const onlyRouteTopologyDiagnostics =
      archetype === 'platformer' &&
      routeIndexes.length > 0 &&
      diagnostics.every(
        (diagnostic) =>
          routeCodes.has(diagnostic.code) &&
          routeIndexes.some(
            (index) =>
              diagnostic.path === `/levels/${index}` ||
              diagnostic.path.startsWith(`/levels/${index}/`),
          ),
      );
    if (onlyRouteTopologyDiagnostics) {
      const before = diagnostics;
      const started = Date.now();
      const routeFallback = repairPlatformerExitRoutes(spec, routeIndexes);
      if (routeFallback.fixes.length) {
        const preparedRoute = prepareForRepair(routeFallback.spec);
        spec = preparedRoute.spec;
        diagnostics = this.collectDiagnostics(spec, archetype);
        record(
          'levels',
          'fallback',
          diagnosticsForOwner(before, 'levels'),
          diagnosticsForOwner(diagnostics, 'levels'),
          { normalizationFixes: [...routeFallback.fixes, ...preparedRoute.fixes] },
          started,
        );
        emit('validating', 'Connected the remaining unreachable platformer route(s).');
      }
    }
    if (!diagnostics.length) return spec;

    for (const [owner, ownerDiagnostics] of groupDiagnostics(diagnostics)) {
      record(owner, 'terminal', ownerDiagnostics, ownerDiagnostics, null, Date.now(), 'failed');
    }

    const summary = diagnostics
      .slice(0, 5)
      .map((d) => `[${d.code}] ${d.path}: ${d.message}`)
      .join('; ');
    throw new PipelineError(
      'validation-failed',
      `the generated game kept failing validation: ${summary}`,
      'validating',
    );
  }
}
