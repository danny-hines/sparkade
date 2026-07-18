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
  type GameMetaFile,
  type GameSpec,
  type JobEvent,
  type JobStage,
  type LintError,
  type PartialSpec,
  type SparkadeConfig,
  type StageName,
} from '@sparkade/shared';
import { bakeLikeness, likenessAssetBuffers, type LikenessArtifacts } from '../likeness/likeness';
import { drawAvatarLikeness } from '../likeness/avatar';
import { generatePortrait } from '../likeness/portrait-gen';
import {
  buildFaceAnalysisPrompt,
  buildPortraitPalette,
  normalizeFaceFeatures,
  type FaceFeatures,
} from '../likeness/features';
import {
  ProviderAuthError,
  ProviderHttpError,
  ProviderNetworkError,
  stageProvider,
} from '../providers/index';
import type { ConfigStore } from '../storage/config';
import type { Db } from '../storage/db';
import type { GameFiles, RawStageName } from '../storage/files';
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
  normalizeGeneratedSpec,
  normalizeTileGrids,
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

export interface NewJobInputs {
  promptText: string;
  sourceKind: 'voice' | 'preset' | 'surprise';
  presetId?: string;
  /** Explicit genre chosen by Surprise; authoritative over model classification. */
  requestedArchetype?: ArchetypeId;
  photo?: Buffer;
  idempotencyKey: string;
}

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

  constructor(
    private db: Db,
    private files: GameFiles,
    private configStore: ConfigStore,
    private hub: SseHub,
  ) {}

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

  // ------------------------------------------------------------------ execute

  private async execute(jobId: string): Promise<void> {
    const job = this.db.getJob(jobId);
    if (!job || this.canceled.has(jobId)) return;
    const gameId = job.gameId;
    const config = this.configStore.get();
    const snapshot = this.db.jobPriceSnapshot(jobId);
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
          throw new PipelineError('timeout', 'generation hit the 8 minute limit', opts.stage);
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
            throw new PipelineError('timeout', 'generation hit the 8 minute limit', opts.stage);
          if (e instanceof ProviderAuthError) {
            throw new PipelineError('auth', e.message, opts.stage);
          }
          if (e instanceof ProviderNetworkError) {
            // Offline: wait rather than fail. The hard cap still bounds the job.
            this.db.updateJob(jobId, { status: 'waiting-network' });
            emit(opts.stage, 'Waiting for network…', { waitingForNetwork: true });
            await sleep(8000, abort.signal).catch(() => {
              throw new PipelineError('timeout', 'generation hit the 8 minute limit', opts.stage);
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
              throw new PipelineError('timeout', 'generation hit the 8 minute limit', opts.stage);
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

    try {
      this.db.updateJob(jobId, { status: 'running', startedAt: nowIso() });
      this.db.setGameStatus(gameId, 'generating');
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
        });
      }
      design = enforceRequestedArchetype(design, job.requestedArchetype);

      // Similarity gate: too close to an existing game → regenerate the design once.
      const collision = tooSimilar(
        design.title,
        existingGames.map((g) => g.title),
      );
      if (collision) {
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
        });
        design = enforceRequestedArchetype(design, job.requestedArchetype);
        if (
          tooSimilar(
            design.title,
            existingGames.map((g) => g.title),
          )
        ) {
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

      // ---- Spec passes (parallel) ----------------------------------------
      emit('writing-spec', 'Writing levels, entities and music…', { unitsDone: 0, unitsTotal: 3 });
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
          const attemptDesign = this.files.readRawStageCheckpoint(jobId, attempt, 'design')?.document;
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
            recordEarlyRepairEvent('levels', 'compile-retry', [diagnostic], [], retryStarted, 'fixed');
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
      const firstFailure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (firstFailure) throw firstFailure.reason;

      // ---- Assemble + validate + repair ----------------------------------
      let spec = ensureLikenessHeroBody(this.assemble(job.seed, archetype, design, parts), !!photo);
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

      // ---- Build assets + atomic publish ----------------------------------
      emit('building-assets', 'Baking sprites and saving…');
      const staging = this.files.stagingFor(jobId);
      const assetsDir = ensureDir(join(staging, 'assets'));
      if (photo) {
        // Opt-in: read the photo's true (lighting-normalized) skin/hair colours
        // and bake against a portrait palette built from them, instead of the
        // game palette (which can quantize a face to gray). Falls back cleanly.
        let feat: FaceFeatures | null = null;
        if (config.likeness.smartFeatures) {
          try {
            emit('building-assets', 'Reading your photo…');
            feat = normalizeFaceFeatures(
              await callLlm('design', buildFaceAnalysisPrompt(), {
                image: photo,
                temperature: 0,
                label: 'Read likeness',
                stage: 'building-assets',
              }),
            );
          } catch {
            /* vision unavailable / failed → photo bake against the game palette */
          }
        }
        // Each context uses the style that reads best at its size:
        //  - "avatar": DRAWN pixel face for the in-game sprite heads (clean at
        //    12/16px), + the pixel-PHOTO bake for the big story-card portrait
        //    (a downscaled photo muds at sprite size but reads at 64px, where a
        //    drawn avatar would look MS-Paint-ish). A hybrid, best of both.
        //  - "photo": the real photo quantized everywhere (rich portrait palette
        //    + light dither when feat is available, else game palette + strong).
        let baked: LikenessArtifacts;
        if (config.likeness.style === 'avatar' && feat) {
          const [avatar, photoBake] = await Promise.all([
            drawAvatarLikeness(feat),
            bakeLikeness(photo, buildPortraitPalette(feat), 10),
          ]);
          // Experimental: an image model may repaint the story-card portrait
          // (off by default). Any failure keeps the pixel-photo bake.
          let portrait = photoBake.portrait;
          const pg = config.likeness.portraitGen;
          if (pg?.enabled) {
            try {
              emit('building-assets', 'Painting your portrait…');
              portrait = await generatePortrait(photo, feat, pg);
            } catch {
              /* image model unavailable / failed → keep the pixel-photo portrait */
            }
          }
          // Keep every generated head view while substituting the photo-based
          // story portrait. Older renderers simply omit the optional views.
          baked = { ...avatar, portrait };
        } else {
          baked = await bakeLikeness(
            photo,
            feat ? buildPortraitPalette(feat) : spec.palette,
            feat ? 10 : 30,
          );
        }
        for (const [filename, buffer] of likenessAssetBuffers(baked)) {
          writeFileSync(join(assetsDir, filename), buffer);
        }
      }
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
  ): GameSpec {
    return {
      specVersion: 1,
      archetype,
      seed,
      meta: { title: design.title, tagline: design.tagline },
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
      ...(archetype === 'platformer' ? { playerHeightTiles: 2 as const } : {}),
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
    const applyFallbacksSafely = (
      candidate: GameSpec,
    ): ReturnType<typeof applySpriteFallbacks> => {
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
    const maxModelRepairCalls = 5;
    const tryOwnerRepairs = async (owner: RepairOwner, budget: number): Promise<void> => {
      if (stalledRepairOwners.has(owner)) return;
      for (let i = 0; i < budget && modelRepairCalls < maxModelRepairCalls; i++) {
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
      for (let round = 0; round < budget && modelRepairCalls < maxModelRepairCalls; round++) {
        for (const owner of priority) {
          if (modelRepairCalls >= maxModelRepairCalls) return;
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
        if (
          onlyIndexedFailures &&
          (indexes.length < levelCount || levelCount === 1)
        ) {
          const currentLevels = structuredClone(spec.levels) as unknown[];
          const replacements = await Promise.all(
            indexes.map(async (index) => {
              const levelDiagnostics = before.filter((diagnostic) =>
                diagnostic.path.startsWith(`/levels/${index}`),
              );
              const requestReplacement = (issues: readonly LintError[], label: string) =>
                callLlm(
                  'levels',
                  buildLevelRegenerationPrompt(
                    archetype,
                    design,
                    index,
                    currentLevels,
                    issues,
                  ),
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
              let raw = await requestReplacement(
                levelDiagnostics,
                `Level ${index + 1} rebuilt`,
              );
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
                record('levels', 'compile-retry', [compileDiagnostic], [], null, retryStarted, 'fixed');
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
            record('levels', 'compile-retry', [compileDiagnostic], [], null, retryStarted, 'fixed');
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

    // A fresh stage gets one surgical cleanup. A second attempt is deliberately
    // avoided here: if a regeneration plus one patch still cannot satisfy the
    // same owner, historical data shows another identical repair is poor value.
    await repairOwners(1);
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
