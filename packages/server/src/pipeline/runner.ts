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
  type ArchetypeId,
  type DesignDoc,
  type GameMetaFile,
  type GameSpec,
  type JobEvent,
  type JobStage,
  type LintError,
  type SparkadeConfig,
  type StageName,
} from '@sparkade/shared';
import { bakeLikeness } from '../likeness/likeness';
import { buildFaceAnalysisPrompt, buildPortraitPalette, type FaceFeatures } from '../likeness/features';
import { ProviderAuthError, ProviderHttpError, ProviderNetworkError, stageProvider } from '../providers/index';
import type { ConfigStore } from '../storage/config';
import type { Db } from '../storage/db';
import type { GameFiles } from '../storage/files';
import { costOf, type PriceSnapshot } from './cost';
import { applyPatch, PatchError, type JsonPatchOp } from './patch';
import {
  buildDesignPrompt,
  buildEntitiesPrompt,
  buildLevelsPrompt,
  buildMusicPrompt,
  buildRepairPrompt,
  parseModelJson,
  type RecentUse,
  type BuiltPrompt,
} from './prompts';
import type { SseHub } from './sse';
import {
  applySpriteFallbacks,
  normalizeTileGrids,
  securityScan,
  tooSimilar,
  validateDesignSchema,
  validateGameSchema,
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
  photo?: Buffer;
  idempotencyKey: string;
}

interface SpecParts {
  levels?: unknown;
  entities?: { sprites: unknown; boss: unknown; sfx?: unknown; backdrop?: unknown; weather?: unknown; lighting?: unknown; juice?: unknown };
  music?: unknown;
}

export class GenerationRunner {
  private queue: string[] = [];
  private activeJobId: string | null = null;
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
    return this.activeJobId !== null;
  }

  createJob(inputs: NewJobInputs): { jobId: string; gameId: string } {
    const existing = this.db.getJobByIdempotencyKey(inputs.idempotencyKey);
    if (existing) return { jobId: existing.id, gameId: existing.gameId };

    const gameId = `g-${nanoid(10).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
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
      archetype: 'platformer',
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
    this.db.setGameStatus(gameId, 'queued');
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
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.activeJobId) return;
    const jobId = this.queue.shift();
    if (!jobId) return;
    this.activeJobId = jobId;
    try {
      await this.execute(jobId);
    } finally {
      this.activeJobId = null;
      void this.pump();
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

    const emit = (stage: JobStage, detail: string, extra: Partial<Extract<JobEvent, { type: 'progress' }>> = {}) => {
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
      opts: { temperature?: number; repair?: boolean; image?: Buffer; label: string; stage: JobStage },
    ): Promise<unknown> => {
      const { provider, providerName, model } = stageProvider(config, stageName);
      let attempt = 0;
      for (;;) {
        if (abort.signal.aborted) throw new PipelineError('timeout', 'generation hit the 8 minute limit', opts.stage);
        try {
          const stageCfg = config.stages[stageName];
          const res = await provider.complete(
            {
              system: prompt.system,
              user: prompt.user,
              maxTokens: prompt.maxTokens,
              temperature: opts.temperature,
              ...(stageCfg?.reasoningEffort ? { effort: stageCfg.reasoningEffort } : {}),
              ...(prompt.timeoutMs ? { timeoutMs: prompt.timeoutMs } : {}),
              ...(provider.capabilities.structuredOutput ? { jsonSchema: prompt.jsonSchema } : {}),
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
          return parseModelJson(res.text);
        } catch (e) {
          if (abort.signal.aborted) throw new PipelineError('timeout', 'generation hit the 8 minute limit', opts.stage);
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
            const retryAfter = e instanceof ProviderHttpError && e.retryAfterS ? e.retryAfterS * 1000 : 0;
            const backoff = Math.max(retryAfter, 1000 * Math.pow(3, attempt - 1)) + Math.random() * 500;
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
      const recentUse = { heroes: [] as string[], bosses: [] as string[], backdrops: [] as string[] };
      const recentMoods: string[] = [];
      for (const g of recentGames) {
        const s = this.files.readSpec(g.id);
        if (!s) continue;
        const assign = (s.sprites?.assign ?? {}) as Record<string, string>;
        if (assign['hero']?.startsWith('lib:')) recentUse.heroes.push(assign['hero']);
        if (assign['boss']?.startsWith('lib:')) recentUse.bosses.push(assign['boss']);
        if (s.backdrop) recentUse.backdrops.push(s.backdrop);
        if (Array.isArray(s.palette) && s.palette.length === 16) recentMoods.push(nearestMood(s.palette).name);
      }

      let design = await this.designPass(callLlm, {
        promptText: job.promptText,
        hasPhoto: !!photo,
        describeInStory,
        antiCollision: existingGames,
        recentMoods,
        photo: describeInStory ? photo : undefined,
      });

      // Similarity gate: too close to an existing game → regenerate the design once.
      const collision = tooSimilar(design.title, existingGames.map((g) => g.title));
      if (collision) {
        emit('designing', 'Too similar to an existing game — redesigning…');
        design = await this.designPass(callLlm, {
          promptText: job.promptText,
          hasPhoto: !!photo,
          describeInStory,
          antiCollision: existingGames,
          recentMoods,
          photo: describeInStory ? photo : undefined,
          extraNote: `Your previous title "${design.title}" was too similar to "${collision}". Choose a clearly different title and premise.`,
        });
        if (tooSimilar(design.title, existingGames.map((g) => g.title))) {
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

      // ---- Spec passes (parallel) ----------------------------------------
      emit('writing-spec', 'Writing levels, entities and music…', { unitsDone: 0, unitsTotal: 3 });
      let unitsDone = 0;
      const tick = (what: string) => {
        unitsDone++;
        emit('writing-spec', `${what} done (${unitsDone}/3)`, { unitsDone, unitsTotal: 3 });
      };
      const parts: SpecParts = {};
      const results = await Promise.allSettled([
        callLlm('levels', buildLevelsPrompt(archetype, design), { stage: 'writing-spec', label: 'Building levels…' }).then((r) => {
          parts.levels = (r as { levels: unknown }).levels ?? r;
          tick('Levels');
        }),
        callLlm('entities', buildEntitiesPrompt(archetype, design, !!photo, recentUse), { stage: 'writing-spec', label: 'Casting entities…' }).then((r) => {
          parts.entities = r as SpecParts['entities'];
          tick('Entities');
        }),
        callLlm('music', buildMusicPrompt(archetype, design), { stage: 'writing-spec', label: 'Composing music…' }).then((r) => {
          parts.music = (r as { music: unknown }).music ?? r;
          tick('Music');
        }),
      ]);
      const firstFailure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (firstFailure) throw firstFailure.reason;

      // ---- Assemble + validate + repair ----------------------------------
      let spec = this.assemble(job.seed, archetype, design, parts);
      emit('validating', 'Checking every rule…');
      spec = await this.validateAndRepair(spec, archetype, design, callLlm, emit, !!photo, recentUse);

      // ---- Build assets + atomic publish ----------------------------------
      emit('building-assets', 'Baking sprites and saving…');
      const staging = this.files.stagingFor(jobId);
      const assetsDir = ensureDir(join(staging, 'assets'));
      if (photo) {
        // Opt-in: read the photo's true (lighting-normalized) skin/hair colours
        // and bake against a portrait palette built from them, instead of the
        // game palette (which can quantize a face to gray). Falls back cleanly.
        let likenessPalette = spec.palette;
        if (config.likeness.smartFeatures) {
          try {
            emit('building-assets', 'Reading your photo…');
            const feat = (await callLlm('design', buildFaceAnalysisPrompt(), {
              image: photo,
              label: 'Read likeness',
              stage: 'building-assets',
            })) as FaceFeatures;
            likenessPalette = buildPortraitPalette(feat);
          } catch {
            /* vision unavailable / failed → keep the game palette */
          }
        }
        const baked = await bakeLikeness(photo, likenessPalette);
        writeFileSync(join(assetsDir, 'head12.png'), baked.head12);
        writeFileSync(join(assetsDir, 'head16.png'), baked.head16);
        writeFileSync(join(assetsDir, 'portrait.png'), baked.portrait);
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
      this.db.updateJob(jobId, { status: 'done', stage: 'done', detail: 'Ready to play', finishedAt: nowIso() });
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
      this.db.updateJob(jobId, { status: 'failed', stage: 'failed', error: friendly, finishedAt: nowIso() });
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
    callLlm: (stage: StageName, prompt: BuiltPrompt, opts: { temperature?: number; repair?: boolean; image?: Buffer; label: string; stage: JobStage }) => Promise<unknown>,
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
      ...(opts.photo ? { image: opts.photo } : {}),
    });
    let errors = validateDesignSchema(raw);
    if (errors.length) {
      const retryPrompt = buildDesignPrompt({
        ...opts,
        extraNote: `Your previous output failed validation: ${errors
          .slice(0, 8)
          .map((e) => `${e.path}: ${e.message}`)
          .join('; ')}. Fix these and follow the schema exactly.`,
      });
      raw = await callLlm('design', retryPrompt, {
        label: 'Design redrafted',
        stage: 'designing',
        ...(opts.photo ? { image: opts.photo } : {}),
      });
      errors = validateDesignSchema(raw);
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

  private assemble(seed: number, archetype: ArchetypeId, design: DesignDoc, parts: SpecParts): GameSpec {
    return {
      specVersion: 1,
      archetype,
      seed,
      meta: { title: design.title, tagline: design.tagline },
      palette: design.palette,
      story: design.story,
      sprites: (parts.entities?.sprites ?? { custom: {}, assign: {} }) as GameSpec['sprites'],
      levels: (parts.levels ?? []) as never,
      boss: (parts.entities?.boss ?? {}) as never,
      music: (parts.music ?? {}) as never,
      ...(parts.entities?.sfx ? { sfx: parts.entities.sfx as GameSpec['sfx'] } : {}),
      ...(parts.entities?.backdrop ? { backdrop: parts.entities.backdrop as GameSpec['backdrop'] } : {}),
      ...(parts.entities?.weather ? { weather: parts.entities.weather as GameSpec['weather'] } : {}),
      ...(parts.entities?.lighting ? { lighting: parts.entities.lighting as GameSpec['lighting'] } : {}),
      ...(parts.entities?.juice !== undefined ? { juice: parts.entities.juice as GameSpec['juice'] } : {}),
      ...(design.difficulty ? { difficulty: design.difficulty } : {}),
      scoring: design.scoring,
    } as GameSpec;
  }

  private collectDiagnostics(spec: GameSpec, archetype: ArchetypeId): LintError[] {
    const schemaErrors = validateGameSchema(archetype, spec);
    if (schemaErrors.length) return schemaErrors;
    const scan = securityScan(spec);
    if (scan.length) return scan;
    return archetypes[archetype].lint(spec);
  }

  /** Validate → repair (≤2) → regenerate failing stages once → repair (≤2) → fail. */
  private async validateAndRepair(
    input: GameSpec,
    archetype: ArchetypeId,
    design: DesignDoc,
    callLlm: (stage: StageName, prompt: BuiltPrompt, opts: { temperature?: number; repair?: boolean; label: string; stage: JobStage }) => Promise<unknown>,
    emit: (stage: JobStage, detail: string) => void,
    hasPhoto: boolean,
    recentUse?: RecentUse,
  ): Promise<GameSpec> {
    let { spec } = applySpriteFallbacks(normalizeTileGrids(input));
    let diagnostics = this.collectDiagnostics(spec, archetype);
    if (!diagnostics.length) return spec;

    let repairsUsed = 0;
    const tryRepairs = async (budget: number): Promise<boolean> => {
      for (let i = 0; i < budget && diagnostics.length; i++) {
        repairsUsed++;
        emit('repairing', `Repair attempt ${repairsUsed}/2 — fixing ${diagnostics.length} issue(s)…`);
        const prompt = buildRepairPrompt(archetype, spec, diagnostics);
        try {
          const patch = (await callLlm('repair', prompt, {
            temperature: 0,
            repair: true,
            label: 'Patch applied',
            stage: 'repairing',
          })) as JsonPatchOp[];
          spec = applySpriteFallbacks(normalizeTileGrids(applyPatch(spec, patch))).spec;
          diagnostics = this.collectDiagnostics(spec, archetype);
        } catch (e) {
          if (e instanceof PatchError) {
            // Bad patch: count the attempt, keep the previous spec.
            continue;
          }
          throw e;
        }
      }
      return diagnostics.length === 0;
    };

    if (await tryRepairs(GENERATION.maxRepairAttemptsPerStage)) return spec;

    // One full regeneration of the stages that own the remaining errors.
    const owners = new Set<'levels' | 'entities' | 'music'>();
    for (const d of diagnostics) {
      if (d.path.startsWith('/levels')) owners.add('levels');
      else if (d.path.startsWith('/music')) owners.add('music');
      else if (d.path.startsWith('/sprites') || d.path.startsWith('/boss') || d.path.startsWith('/sfx') || d.path.startsWith('/backdrop') || d.path.startsWith('/weather')) owners.add('entities');
      else owners.add('levels'); // duration/floors and cross-cutting issues are level-shaped
    }
    emit('writing-spec', `Regenerating ${[...owners].join(' + ')}…`);
    for (const owner of owners) {
      if (owner === 'levels') {
        const r = (await callLlm('levels', buildLevelsPrompt(archetype, design), { label: 'Levels rebuilt', stage: 'writing-spec' })) as { levels: unknown };
        spec = { ...spec, levels: (r.levels ?? r) as never };
      } else if (owner === 'entities') {
        const r = (await callLlm('entities', buildEntitiesPrompt(archetype, design, hasPhoto, recentUse), { label: 'Entities recast', stage: 'writing-spec' })) as SpecParts['entities'];
        spec = { ...spec, sprites: r!.sprites as GameSpec['sprites'], boss: r!.boss as never, ...(r!.sfx ? { sfx: r!.sfx as GameSpec['sfx'] } : {}), ...(r!.backdrop ? { backdrop: r!.backdrop as GameSpec['backdrop'] } : {}), ...(r!.weather ? { weather: r!.weather as GameSpec['weather'] } : {}), ...(r!.lighting ? { lighting: r!.lighting as GameSpec['lighting'] } : {}), ...(r!.juice !== undefined ? { juice: r!.juice as GameSpec['juice'] } : {}) };
      } else {
        const r = (await callLlm('music', buildMusicPrompt(archetype, design), { label: 'Music recomposed', stage: 'writing-spec' })) as { music: unknown };
        spec = { ...spec, music: (r.music ?? r) as never };
      }
    }
    spec = applySpriteFallbacks(normalizeTileGrids(spec)).spec;
    diagnostics = this.collectDiagnostics(spec, archetype);
    if (!diagnostics.length) return spec;

    repairsUsed = 0;
    if (await tryRepairs(GENERATION.maxRepairAttemptsPerStage)) return spec;

    const summary = diagnostics
      .slice(0, 5)
      .map((d) => `[${d.code}] ${d.path}: ${d.message}`)
      .join('; ');
    throw new PipelineError('validation-failed', `the generated game kept failing validation: ${summary}`, 'validating');
  }
}
