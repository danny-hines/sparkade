// Dev-only, paid-call Platformer Level Design Lab. It exposes the complete
// Muse Image layout -> local parser -> deterministic repair -> hydration path.
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { CompleteRequest, CompleteResponse, PlatformerLevel } from '@sparkade/shared';
import {
  PLATFORMER_LEVEL_HYDRATION_JUDGE_PROMPT_VERSION,
  buildPlatformerLevelHydrationJudgeBoard,
  buildPlatformerLevelHydrationJudgePrompt,
  buildPlatformerLevelHydrationJudgeSchema,
  normalizePlatformerLevelHydrationJudgeDecision,
  reviewPlatformerLevelHydrationGeometry,
  type PlatformerLevelHydrationGeometryReview,
  type PlatformerLevelHydrationJudgeDecision,
} from '../assets/platformer-level-hydration-judge';
import {
  PLATFORMER_LEVEL_HYDRATION_PROMPT_VERSION,
  PLATFORMER_LEVEL_LAB_PROMPT_VERSION,
  buildPlatformerLevelHydrationPrompt,
  buildPlatformerLevelLayoutPrompt,
  mockPlatformerLevelLayoutImage,
  parseAndRepairPlatformerLevelLayout,
  processPlatformerLevelHydration,
  type PlatformerLevelHydrationResult,
  type PlatformerLevelLabMetrics,
} from '../assets/platformer-level-lab';
import { costOf } from '../pipeline/cost';
import { parseModelJson } from '../pipeline/prompts';
import { stageProvider } from '../providers';
import {
  MetaImageAdapter,
  type MetaImageEditRequest,
  type MetaImageRequest,
  type MetaImageResult,
} from '../providers/meta-image';
import type { ConfigStore } from '../storage/config';
import { atomicWriteFile, ensureDir, nowIso } from '../util';

const CANDIDATE_IDS = ['L1', 'L2', 'L3'] as const;
const HYDRATION_CANDIDATE_IDS = ['H1', 'H2', 'H3'] as const;
const RUN_RETENTION_MS = 60 * 60 * 1000;

export type PlatformerLevelLabStage =
  | 'layouts'
  | 'parse'
  | 'repair'
  | 'selection'
  | 'hydrate';

export type PlatformerLevelLabEventType =
  | 'stage'
  | 'candidate'
  | 'selection'
  | 'hydration'
  | 'hydration-candidate'
  | 'hydration-judge-response'
  | 'hydration-selection'
  | 'mask'
  | 'ready'
  | 'failed';

export interface PlatformerLevelLabEvent {
  seq: number;
  runId: string;
  at: string;
  type: PlatformerLevelLabEventType;
  stage: PlatformerLevelLabStage;
  status: 'started' | 'complete' | 'rejected' | 'failed';
  message: string;
  elapsedMs?: number;
  data?: Record<string, unknown>;
}

export interface PlatformerLevelLabStatus {
  runId: string;
  status: LabRun['status'];
  concept: string;
  events: PlatformerLevelLabEvent[];
  recommendedId?: string;
  hydratedId?: string;
  hydrationMetrics?: Record<string, unknown>;
  hydrationWinnerId?: string;
  imageCalls: number;
  imageCostUsd: number;
  judgeCalls: number;
  judgeCostUsd: number | null;
  error?: string;
}

export interface DevPlatformerLevelOptions {
  imageGenerate?: (request: MetaImageRequest) => Promise<MetaImageResult>;
  imageEdit?: (request: MetaImageEditRequest) => Promise<MetaImageResult>;
  imageModel?: string;
  judge?: PlatformerLevelLabJudge;
  judgeModel?: string;
  judgeProvider?: string;
}

export interface PlatformerLevelLabJudgeInput {
  request: CompleteRequest;
  model: string;
  provider: string;
}

export type PlatformerLevelLabJudge = (
  input: PlatformerLevelLabJudgeInput,
) => Promise<CompleteResponse>;

interface LevelCandidate {
  id: string;
  level: PlatformerLevel;
  metrics: PlatformerLevelLabMetrics;
  guide: Buffer;
}

interface GeneratedHydrationCandidate {
  id: string;
  raw: Buffer;
  processed: PlatformerLevelHydrationResult;
  geometry: PlatformerLevelHydrationGeometryReview;
  urls: HydrationAssetUrls & { rawUrl: string };
}

type HydrationAssetUrls = Record<
  | 'normalizedUrl'
  | 'exactUrl'
  | 'safeUrl'
  | 'visualMaskUrl'
  | 'darkOutlineUrl'
  | 'lightOutlineUrl'
  | 'mismatchUrl',
  string
>;

interface LabRun {
  id: string;
  dir: string;
  createdAt: string;
  concept: string;
  status: 'running' | 'ready' | 'hydrating' | 'failed';
  events: PlatformerLevelLabEvent[];
  listeners: Set<(event: PlatformerLevelLabEvent) => void>;
  assets: Map<string, { path: string; file: string; mime: string }>;
  candidates: Map<string, LevelCandidate>;
  recommendedId?: string;
  hydratedId?: string;
  hydrationWinnerId?: string;
  imageCalls: number;
  imageCostUsd: number;
  judgeCalls: number;
  judgeCostUsd: number | null;
  imageModel?: string;
  judgeModel?: string;
  judgeProvider?: string;
  hydrationMetrics?: Record<string, unknown>;
  hydrationDecision?: PlatformerLevelHydrationJudgeDecision;
  error?: string;
}

export function registerDevPlatformerLevelRoutes(
  app: FastifyInstance,
  configStore: ConfigStore,
  dataDir: string,
  options: DevPlatformerLevelOptions = {},
): void {
  const runs = new Map<string, LabRun>();
  const experimentsDir = ensureDir(join(dataDir, 'experiments', 'platformer-levels'));
  const resolveRun = (runId: string): LabRun | undefined => {
    const active = runs.get(runId);
    if (active) return active;
    const restored = restorePersistedRun(experimentsDir, runId);
    if (restored) runs.set(runId, restored);
    return restored ?? undefined;
  };

  app.post('/api/dev/platformer-levels/runs', async (req, reply) => {
    const body = (req.body ?? {}) as { concept?: unknown };
    const concept = cleanInput(typeof body.concept === 'string' ? body.concept : '');
    if (!concept) return reply.code(400).send({ error: 'level concept required' });
    const createdAt = nowIso();
    const id = `${createdAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const run: LabRun = {
      id,
      dir: ensureDir(join(experimentsDir, id)),
      createdAt,
      concept,
      status: 'running',
      events: [],
      listeners: new Set(),
      assets: new Map(),
      candidates: new Map(),
      imageCalls: 0,
      imageCostUsd: 0,
      judgeCalls: 0,
      judgeCostUsd: 0,
    };
    runs.set(id, run);
    writeManifest(run);
    void executeLayoutBatch(run, configStore, options).catch((error: unknown) => {
      failRun(run, error);
    });
    setTimeout(() => runs.delete(id), RUN_RETENTION_MS).unref?.();
    return reply.code(202).send({ runId: id });
  });

  app.get('/api/dev/platformer-levels/runs/:runId', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = resolveRun(runId);
    if (run) return statusFor(run);
    return reply.code(404).send({ error: 'unknown or expired level-lab run' });
  });

  app.get('/api/dev/platformer-levels/runs/:runId/events', (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = resolveRun(runId);
    if (!run) {
      void reply.code(404).send({ error: 'unknown or expired level-lab run' });
      return;
    }
    reply.raw.writeHead(200, sseHeaders());
    const send = (event: PlatformerLevelLabEvent): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    for (const event of run.events) send(event);
    if (run.status === 'failed') {
      reply.raw.end();
      return;
    }
    run.listeners.add(send);
    const keepAlive = setInterval(() => reply.raw.write(': keepalive\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(keepAlive);
      run.listeners.delete(send);
    });
  });

  app.post('/api/dev/platformer-levels/runs/:runId/hydrate', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const body = (req.body ?? {}) as { candidateId?: unknown };
    const candidateId = typeof body.candidateId === 'string' ? body.candidateId : '';
    const run = resolveRun(runId);
    if (!run) return reply.code(404).send({ error: 'unknown or expired level-lab run' });
    if (run.status === 'running') {
      return reply.code(409).send({ error: 'layout candidates are still being generated' });
    }
    if (run.status === 'hydrating') {
      return reply.code(409).send({ error: 'a hydration is already running' });
    }
    if (run.status === 'failed') return reply.code(409).send({ error: 'level-lab run failed' });
    if (!run.candidates.has(candidateId)) {
      return reply.code(400).send({ error: 'unknown candidateId' });
    }
    if (run.candidates.get(candidateId)!.metrics.issuesAfter.length > 0) {
      return reply.code(409).send({ error: 'candidate failed local validation and cannot hydrate' });
    }
    run.status = 'hydrating';
    writeManifest(run);
    void executeHydration(run, candidateId, configStore, options).catch((error: unknown) => {
      run.status = 'ready';
      emit(run, {
        type: 'hydration',
        stage: 'hydrate',
        status: 'failed',
        message: `Hydration failed: ${errorMessage(error)}`,
        data: { candidateId },
      });
      writeManifest(run);
    });
    return reply.code(202).send({ runId, candidateId });
  });

  app.post('/api/dev/platformer-levels/runs/:runId/reprocess', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const body = (req.body ?? {}) as {
      candidateId?: unknown;
      fringe?: { topPx?: unknown; sidePx?: unknown; bottomPx?: unknown };
    };
    const candidateId = typeof body.candidateId === 'string' ? body.candidateId : '';
    const run = resolveRun(runId);
    if (!run) return reply.code(404).send({ error: 'unknown or expired level-lab run' });
    if (run.status !== 'ready') {
      return reply.code(409).send({ error: 'level-lab run is busy or failed' });
    }
    if (run.hydratedId !== candidateId) {
      return reply.code(409).send({ error: 'candidate has not been hydrated yet' });
    }
    const candidate = run.candidates.get(candidateId);
    const raw = run.assets.get('hydrated-raw');
    if (!candidate || !raw) {
      return reply.code(409).send({ error: 'hydration source is unavailable' });
    }
    const fringe = {
      topPx: numericInput(body.fringe?.topPx, 4),
      sidePx: numericInput(body.fringe?.sidePx, 1),
      bottomPx: numericInput(body.fringe?.bottomPx, 2),
    };
    const started = Date.now();
    const processed = await processPlatformerLevelHydration(
      readFileSync(raw.path),
      candidate.level,
      fringe,
    );
    const urls = saveHydrationAssets(run, candidateId, processed);
    run.hydrationMetrics = processed.metrics;
    const stamp = Date.now();
    emit(run, {
      type: 'mask',
      stage: 'hydrate',
      status: 'complete',
      message: `Updated ${candidateId} visual fringe without another model call`,
      elapsedMs: Date.now() - started,
      data: {
        candidateId,
        ...Object.fromEntries(
          Object.entries(urls).map(([key, url]) => [key, `${url}?v=${stamp}`]),
        ),
        metrics: processed.metrics,
        ...usageData(run),
      },
    });
    writeManifest(run);
    return { runId, candidateId, metrics: processed.metrics };
  });

  app.get('/api/dev/platformer-levels/runs/:runId/assets/:assetId', async (req, reply) => {
    const { runId, assetId } = req.params as { runId: string; assetId: string };
    const asset =
      runs.get(runId)?.assets.get(assetId) ?? persistedAsset(experimentsDir, runId, assetId);
    if (!asset) return reply.code(404).send({ error: 'unknown level-lab asset' });
    return reply.type(asset.mime).send(createReadStream(asset.path));
  });
}

async function executeLayoutBatch(
  run: LabRun,
  configStore: ConfigStore,
  options: DevPlatformerLevelOptions,
): Promise<void> {
  const config = configStore.get();
  const mock = process.env.SPARKADE_PROVIDER === 'mock';
  const imageConfig = config.imageGeneration;
  const imageModel = options.imageModel ?? (mock ? 'mock-image' : imageConfig.model);
  run.imageModel = imageModel;
  const adapter =
    options.imageGenerate || mock
      ? null
      : new MetaImageAdapter({
          baseUrl: imageConfig.baseUrl,
          model: imageModel,
          apiKeyEnv: imageConfig.apiKeyEnv,
          timeoutMs: imageConfig.timeoutMs,
          name: 'platformer-level-lab',
        });
  const generate = async (request: MetaImageRequest): Promise<MetaImageResult> => {
    const result = options.imageGenerate
      ? await options.imageGenerate(request)
      : mock
        ? {
            image: await mockPlatformerLevelLayoutImage(request.user?.split('-').at(-1) ?? 'L1'),
            outputFormat: 'png' as const,
            imageCount: 1,
            usage: undefined,
          }
        : await adapter!.generate(request);
    recordImageUsage(run, result.imageCount, mock ? 0 : imageConfig.pricePerImageUsd);
    return result;
  };

  emit(run, {
    type: 'stage',
    stage: 'layouts',
    status: 'started',
    message: 'Launching three Muse Image block-map candidates in parallel',
    data: { candidateIds: [...CANDIDATE_IDS], imageModel },
  });
  const tasks = CANDIDATE_IDS.map(async (candidateId) => {
    const prompt = buildPlatformerLevelLayoutPrompt(run.concept, candidateId);
    const started = Date.now();
    emit(run, {
      type: 'stage',
      stage: 'layouts',
      status: 'started',
      message: `${candidateId} generation started`,
      data: { candidateId, prompt, promptVersion: PLATFORMER_LEVEL_LAB_PROMPT_VERSION },
    });
    try {
      const result = await generate({
        prompt,
        outputFormat: 'png',
        size: 'auto',
        reasoningStrength: 'high',
        user: `${run.id}-${candidateId}`,
      });
      const rawUrl = saveAsset(run, `${candidateId}-raw`, `raw/${candidateId}.png`, result.image);
      emit(run, {
        type: 'stage',
        stage: 'parse',
        status: 'started',
        message: `${candidateId} color quantization and grid registration started`,
        data: { candidateId },
      });
      const parsed = await parseAndRepairPlatformerLevelLayout(
        result.image,
        `${run.concept.slice(0, 36)} ${candidateId}`,
      );
      const parsedUrl = saveAsset(
        run,
        `${candidateId}-parsed`,
        `parsed/${candidateId}.png`,
        parsed.parsedPng,
      );
      const repairedUrl = saveAsset(
        run,
        `${candidateId}-repaired`,
        `repaired/${candidateId}.png`,
        parsed.repairedPng,
      );
      saveAsset(run, `${candidateId}-guide`, `guide/${candidateId}.png`, parsed.guidePng);
      atomicWriteFile(
        join(run.dir, 'levels', `${candidateId}.json`),
        `${JSON.stringify(parsed.level, null, 2)}\n`,
      );
      run.candidates.set(candidateId, {
        id: candidateId,
        level: parsed.level,
        metrics: parsed.metrics,
        guide: parsed.guidePng,
      });
      emit(run, {
        type: 'candidate',
        stage: 'repair',
        status: parsed.metrics.issuesAfter.length === 0 ? 'complete' : 'rejected',
        message:
          parsed.metrics.issuesAfter.length === 0
            ? `${candidateId} parsed into a playable level`
            : `${candidateId} still has ${parsed.metrics.issuesAfter.length} validation issue(s)`,
        elapsedMs: Date.now() - started,
        data: {
          candidateId,
          rawUrl,
          parsedUrl,
          repairedUrl,
          level: parsed.level as unknown as Record<string, unknown>,
          metrics: parsed.metrics as unknown as Record<string, unknown>,
        },
      });
    } catch (error) {
      emit(run, {
        type: 'candidate',
        stage: 'repair',
        status: 'rejected',
        message: `${candidateId} could not be parsed into a level`,
        elapsedMs: Date.now() - started,
        data: { candidateId, error: errorMessage(error) },
      });
    }
  });
  await Promise.all(tasks);
  const survivors = [...run.candidates.values()].filter(
    (candidate) => candidate.metrics.issuesAfter.length === 0,
  );
  if (survivors.length === 0) throw new Error('all layout candidates failed local validation');
  survivors.sort(
    (a, b) => b.metrics.score - a.metrics.score || a.id.localeCompare(b.id),
  );
  run.recommendedId = survivors[0]!.id;
  run.status = 'ready';
  emit(run, {
    type: 'selection',
    stage: 'selection',
    status: 'complete',
    message: `${run.recommendedId} has the strongest deterministic parse and repair score`,
    data: {
      recommendedId: run.recommendedId,
      scores: Object.fromEntries(survivors.map(({ id, metrics }) => [id, metrics.score])),
    },
  });
  emit(run, {
    type: 'ready',
    stage: 'selection',
    status: 'complete',
    message: 'Candidate batch ready for playtesting and hydration',
    data: usageData(run),
  });
  writeManifest(run);
}

async function executeHydration(
  run: LabRun,
  candidateId: string,
  configStore: ConfigStore,
  options: DevPlatformerLevelOptions,
): Promise<void> {
  const candidate = run.candidates.get(candidateId);
  if (!candidate) throw new Error('candidate disappeared before hydration');
  const config = configStore.get();
  const mock = process.env.SPARKADE_PROVIDER === 'mock';
  const imageConfig = config.imageGeneration;
  const imageModel = options.imageModel ?? (mock ? 'mock-image' : imageConfig.model);
  const judgeStage = stageProvider(config, 'design');
  const judgeModel = options.judgeModel ?? judgeStage.model;
  const judgeProvider = options.judgeProvider ?? (mock ? 'mock' : judgeStage.providerName);
  run.judgeModel = judgeModel;
  run.judgeProvider = judgeProvider;
  const adapter =
    options.imageEdit || mock
      ? null
      : new MetaImageAdapter({
          baseUrl: imageConfig.baseUrl,
          model: imageModel,
          apiKeyEnv: imageConfig.apiKeyEnv,
          timeoutMs: imageConfig.timeoutMs,
          name: 'platformer-level-hydration-lab',
        });
  const prompt = buildPlatformerLevelHydrationPrompt(run.concept);
  const started = Date.now();
  emit(run, {
    type: 'hydration',
    stage: 'hydrate',
    status: 'started',
    message: `Launching three ${candidateId} hydration candidates in parallel`,
    data: {
      candidateId,
      hydrationCandidateIds: [...HYDRATION_CANDIDATE_IDS],
      prompt,
      promptVersion: PLATFORMER_LEVEL_HYDRATION_PROMPT_VERSION,
      imageModel,
      judgeModel,
      judgeProvider,
    },
  });

  const generateHydration = async (
    hydrationId: (typeof HYDRATION_CANDIDATE_IDS)[number],
  ): Promise<GeneratedHydrationCandidate | null> => {
    const candidateStarted = Date.now();
    emit(run, {
      type: 'hydration-candidate',
      stage: 'hydrate',
      status: 'started',
      message: `${hydrationId} hydration generation started`,
      data: { candidateId, hydrationId },
    });
    try {
      const request: MetaImageEditRequest = {
        prompt,
        image: candidate.guide,
        imageMimeType: 'image/png',
        imageFilename: `${candidateId}-canonical-guide.png`,
        outputFormat: 'png',
        size: 'auto',
        reasoningStrength: 'high',
        user: `${run.id}-hydrate-${candidateId}-${hydrationId}`,
      };
      const result = options.imageEdit
        ? await options.imageEdit(request)
        : mock
          ? {
              image: candidate.guide,
              outputFormat: 'png' as const,
              imageCount: 1,
              usage: undefined,
            }
          : await adapter!.edit(request);
      recordImageUsage(run, result.imageCount, mock ? 0 : imageConfig.pricePerImageUsd);
      const processed = await processPlatformerLevelHydration(result.image, candidate.level);
      const geometry = reviewPlatformerLevelHydrationGeometry(hydrationId, processed.metrics);
      const rawUrl = saveAsset(
        run,
        `hydrated-${candidateId}-${hydrationId}-raw`,
        `hydrated/${candidateId}-${hydrationId}-raw.png`,
        result.image,
      );
      const urls = saveHydrationVariantAssets(
        run,
        candidateId,
        hydrationId,
        processed,
      );
      emit(run, {
        type: 'hydration-candidate',
        stage: 'hydrate',
        status: geometry.viable ? 'complete' : 'rejected',
        message: geometry.viable
          ? `${hydrationId} passed the deterministic geometry gate`
          : `${hydrationId} missed the geometry gate: ${geometry.reasons.join('; ')}`,
        elapsedMs: Date.now() - candidateStarted,
        data: {
          candidateId,
          hydrationId,
          rawUrl,
          ...urls,
          geometry: geometry as unknown as Record<string, unknown>,
          metrics: processed.metrics,
        },
      });
      return { id: hydrationId, raw: result.image, processed, geometry, urls: { rawUrl, ...urls } };
    } catch (error) {
      emit(run, {
        type: 'hydration-candidate',
        stage: 'hydrate',
        status: 'rejected',
        message: `${hydrationId} hydration failed: ${errorMessage(error)}`,
        elapsedMs: Date.now() - candidateStarted,
        data: { candidateId, hydrationId, error: errorMessage(error) },
      });
      return null;
    }
  };

  const generated = (await Promise.all(HYDRATION_CANDIDATE_IDS.map(generateHydration))).filter(
    (value): value is GeneratedHydrationCandidate => value !== null,
  );
  if (generated.length === 0) throw new Error('all hydration candidates failed');
  const geometryRanked = [...generated].sort(
    (a, b) => b.geometry.score - a.geometry.score || a.id.localeCompare(b.id),
  );
  const viable = geometryRanked.filter(({ geometry }) => geometry.viable);
  const eligible = viable.length > 0 ? viable : geometryRanked.slice(0, Math.min(2, generated.length));
  const fallbackGate = viable.length === 0;
  if (fallbackGate) {
    emit(run, {
      type: 'hydration-selection',
      stage: 'hydrate',
      status: 'rejected',
      message: 'No candidate cleared every geometry threshold; sending the two least-bad options to Spark',
      data: {
        candidateId,
        eligibleIds: eligible.map(({ id }) => id),
        geometry: Object.fromEntries(generated.map(({ id, geometry }) => [id, geometry])),
      },
    });
  }

  const board = await buildPlatformerLevelHydrationJudgeBoard({
    guide: candidate.guide,
    candidates: eligible.map(({ id, processed, geometry }) => ({
      id,
      safeTerrain: processed.safeTerrain,
      geometry,
    })),
  });
  const judgeBoardUrl = saveAsset(
    run,
    `hydrated-${candidateId}-judge-board`,
    `hydrated/${candidateId}-judge-board.jpg`,
    board,
    'image/jpeg',
  );
  const descriptors = eligible.map(({ geometry }) => geometry);
  const judgePrompt = buildPlatformerLevelHydrationJudgePrompt(run.concept, descriptors);
  emit(run, {
    type: 'hydration-selection',
    stage: 'hydrate',
    status: 'started',
    message: `${judgeModel} aesthetic review started`,
    data: {
      candidateId,
      eligibleIds: eligible.map(({ id }) => id),
      judgeBoardUrl,
      model: judgeModel,
      provider: judgeProvider,
      promptVersion: PLATFORMER_LEVEL_HYDRATION_JUDGE_PROMPT_VERSION,
      systemPrompt: judgePrompt.system,
      userPrompt: judgePrompt.user,
    },
  });

  const judgeStarted = Date.now();
  let response: CompleteResponse;
  if (options.judge) {
    response = await options.judge({
      request: {
        system: judgePrompt.system,
        user: judgePrompt.user,
        image: board,
        jsonSchema: buildPlatformerLevelHydrationJudgeSchema(descriptors),
        maxTokens: 3000,
        temperature: 0,
        effort: 'low',
      },
      model: judgeModel,
      provider: judgeProvider,
    });
  } else if (mock) {
    response = mockHydrationJudgeResponse(descriptors);
  } else {
    if (!judgeStage.provider.capabilities.imageIn) {
      throw new Error(`judge provider "${judgeStage.providerName}" does not support image input`);
    }
    response = await judgeStage.provider.complete(
      {
        system: judgePrompt.system,
        user: judgePrompt.user,
        image: board,
        jsonSchema: judgeStage.provider.capabilities.structuredOutput
          ? buildPlatformerLevelHydrationJudgeSchema(descriptors)
          : undefined,
        maxTokens: 3000,
        temperature: 0,
        effort: 'low',
        timeoutMs: 120_000,
      },
      { model: judgeModel },
    );
  }
  const judgeCost = mock ? 0 : costOf(response.model ?? judgeModel, response.usage, config.pricing);
  const priorJudgeCost = run.judgeCalls === 0 ? 0 : run.judgeCostUsd;
  run.judgeCalls++;
  run.judgeCostUsd = priorJudgeCost === null || judgeCost === null ? null : priorJudgeCost + judgeCost;
  emit(run, {
    type: 'hydration-judge-response',
    stage: 'hydrate',
    status: 'complete',
    message: `${judgeModel} returned hydration scoring`,
    elapsedMs: Date.now() - judgeStarted,
    data: {
      candidateId,
      raw: response.text,
      usage: response.usage as unknown as Record<string, unknown>,
      costUsd: judgeCost,
      totalJudgeCostUsd: run.judgeCostUsd,
    },
  });
  const decision = normalizePlatformerLevelHydrationJudgeDecision(
    parseModelJson(response.text),
    descriptors,
  );
  const winner = eligible.find(({ id }) => id === decision.selection.candidateId) ?? eligible[0]!;
  run.hydrationDecision = decision;
  run.hydrationWinnerId = winner.id;
  emit(run, {
    type: 'hydration-selection',
    stage: 'hydrate',
    status: 'complete',
    message: `${judgeModel} selected ${winner.id}${fallbackGate ? ' from geometry fallback candidates' : ''}`,
    data: {
      candidateId,
      hydrationWinnerId: winner.id,
      judgeBoardUrl,
      fallbackGate,
      decision: decision as unknown as Record<string, unknown>,
      geometry: Object.fromEntries(generated.map(({ id, geometry }) => [id, geometry])),
    },
  });

  const rawUrl = saveAsset(
    run,
    'hydrated-raw',
    `hydrated/${candidateId}-raw.png`,
    winner.raw,
  );
  const urls = saveHydrationAssets(run, candidateId, winner.processed);
  run.hydratedId = candidateId;
  run.hydrationMetrics = winner.processed.metrics;
  run.status = 'ready';
  emit(run, {
    type: 'hydration',
    stage: 'hydrate',
    status: 'complete',
    message: `${candidateId} hydration complete with ${winner.id}`,
    elapsedMs: Date.now() - started,
    data: {
      candidateId,
      hydrationWinnerId: winner.id,
      rawUrl,
      ...urls,
      metrics: winner.processed.metrics,
      geometry: winner.geometry as unknown as Record<string, unknown>,
      decision: decision as unknown as Record<string, unknown>,
      judgeBoardUrl,
      ...usageData(run),
    },
  });
  writeManifest(run);
}

function emit(
  run: LabRun,
  event: Omit<PlatformerLevelLabEvent, 'seq' | 'runId' | 'at'>,
): PlatformerLevelLabEvent {
  const complete: PlatformerLevelLabEvent = {
    ...event,
    seq: run.events.length + 1,
    runId: run.id,
    at: nowIso(),
  };
  run.events.push(complete);
  atomicWriteFile(join(run.dir, 'events.json'), `${JSON.stringify(run.events, null, 2)}\n`);
  for (const listener of [...run.listeners]) listener(complete);
  return complete;
}

function failRun(run: LabRun, error: unknown): void {
  if (run.status === 'failed') return;
  run.status = 'failed';
  run.error = errorMessage(error);
  emit(run, {
    type: 'failed',
    stage: 'selection',
    status: 'failed',
    message: run.error,
    data: usageData(run),
  });
  writeManifest(run);
  for (const listener of [...run.listeners]) run.listeners.delete(listener);
}

function saveAsset(
  run: LabRun,
  id: string,
  file: string,
  contents: Buffer,
  mime = 'image/png',
): string {
  const path = join(run.dir, file);
  atomicWriteFile(path, contents);
  run.assets.set(id, { path, file, mime });
  return assetUrl(run.id, id);
}

function saveHydrationVariantAssets(
  run: LabRun,
  candidateId: string,
  hydrationId: string,
  processed: PlatformerLevelHydrationResult,
): HydrationAssetUrls {
  const assetPrefix = `hydrated-${candidateId}-${hydrationId}`;
  const filePrefix = `${candidateId}-${hydrationId}`;
  return saveHydrationAssetSet(run, assetPrefix, filePrefix, processed);
}

function saveHydrationAssets(
  run: LabRun,
  candidateId: string,
  processed: PlatformerLevelHydrationResult,
): HydrationAssetUrls {
  return saveHydrationAssetSet(run, 'hydrated', candidateId, processed);
}

function saveHydrationAssetSet(
  run: LabRun,
  assetPrefix: string,
  filePrefix: string,
  processed: PlatformerLevelHydrationResult,
): HydrationAssetUrls {
  return {
    normalizedUrl: saveAsset(
      run,
      `${assetPrefix}-normalized`,
      `hydrated/${filePrefix}-normalized.png`,
      processed.normalized,
    ),
    exactUrl: saveAsset(
      run,
      `${assetPrefix}-exact`,
      `hydrated/${filePrefix}-exact.png`,
      processed.exactTerrain,
    ),
    safeUrl: saveAsset(
      run,
      `${assetPrefix}-safe`,
      `hydrated/${filePrefix}-safe.png`,
      processed.safeTerrain,
    ),
    visualMaskUrl: saveAsset(
      run,
      `${assetPrefix}-visual-mask`,
      `hydrated/${filePrefix}-visual-mask.png`,
      processed.visualMask,
    ),
    darkOutlineUrl: saveAsset(
      run,
      `${assetPrefix}-outline-dark`,
      `hydrated/${filePrefix}-outline-dark.png`,
      processed.darkOutline,
    ),
    lightOutlineUrl: saveAsset(
      run,
      `${assetPrefix}-outline-light`,
      `hydrated/${filePrefix}-outline-light.png`,
      processed.lightOutline,
    ),
    mismatchUrl: saveAsset(
      run,
      `${assetPrefix}-mismatch`,
      `hydrated/${filePrefix}-mismatch.png`,
      processed.mismatch,
    ),
  };
}

function recordImageUsage(run: LabRun, count: number, pricePerImageUsd: number): void {
  run.imageCalls += count;
  run.imageCostUsd += count * pricePerImageUsd;
}

function numericInput(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function statusFor(run: LabRun): PlatformerLevelLabStatus {
  return {
    runId: run.id,
    status: run.status,
    concept: run.concept,
    events: run.events,
    recommendedId: run.recommendedId,
    hydratedId: run.hydratedId,
    hydrationWinnerId: run.hydrationWinnerId,
    hydrationMetrics: run.hydrationMetrics,
    imageCalls: run.imageCalls,
    imageCostUsd: run.imageCostUsd,
    judgeCalls: run.judgeCalls,
    judgeCostUsd: run.judgeCostUsd,
    error: run.error,
  };
}

function writeManifest(run: LabRun): void {
  atomicWriteFile(
    join(run.dir, 'manifest.json'),
    `${JSON.stringify(
      {
        runId: run.id,
        createdAt: run.createdAt,
        status: run.status,
        concept: run.concept,
        promptVersions: {
          layout: PLATFORMER_LEVEL_LAB_PROMPT_VERSION,
          hydration: PLATFORMER_LEVEL_HYDRATION_PROMPT_VERSION,
          hydrationJudge: PLATFORMER_LEVEL_HYDRATION_JUDGE_PROMPT_VERSION,
        },
        imageModel: run.imageModel,
        judgeModel: run.judgeModel,
        judgeProvider: run.judgeProvider,
        recommendedId: run.recommendedId,
        hydratedId: run.hydratedId,
        hydrationWinnerId: run.hydrationWinnerId,
        hydrationMetrics: run.hydrationMetrics,
        hydrationDecision: run.hydrationDecision,
        usage: {
          imageCalls: run.imageCalls,
          imageCostUsd: run.imageCostUsd,
          judgeCalls: run.judgeCalls,
          judgeCostUsd: run.judgeCostUsd,
          totalCostUsd:
            run.judgeCostUsd === null ? null : run.imageCostUsd + run.judgeCostUsd,
        },
        candidates: Object.fromEntries(
          [...run.candidates.values()].map(({ id, level, metrics }) => [id, { level, metrics }]),
        ),
        assets: Object.fromEntries(
          [...run.assets.entries()].map(([id, asset]) => [id, { file: asset.file, mime: asset.mime }]),
        ),
        error: run.error,
        events: run.events,
      },
      null,
      2,
    )}\n`,
  );
}

function readPersistedStatus(
  experimentsDir: string,
  runId: string,
): PlatformerLevelLabStatus | null {
  const dir = persistedRunDir(experimentsDir, runId);
  if (!dir) return null;
  const manifest = readJson<Record<string, unknown>>(join(dir, 'manifest.json'), {});
  const usage = isRecord(manifest.usage) ? manifest.usage : {};
  const status =
    manifest.status === 'running' ||
    manifest.status === 'ready' ||
    manifest.status === 'hydrating' ||
    manifest.status === 'failed'
      ? manifest.status
      : 'failed';
  return {
    runId,
    status,
    concept: typeof manifest.concept === 'string' ? manifest.concept : '',
    events: readJson<PlatformerLevelLabEvent[]>(join(dir, 'events.json'), []),
    ...(typeof manifest.recommendedId === 'string'
      ? { recommendedId: manifest.recommendedId }
      : {}),
    ...(typeof manifest.hydratedId === 'string' ? { hydratedId: manifest.hydratedId } : {}),
    ...(typeof manifest.hydrationWinnerId === 'string'
      ? { hydrationWinnerId: manifest.hydrationWinnerId }
      : {}),
    ...(isRecord(manifest.hydrationMetrics)
      ? { hydrationMetrics: manifest.hydrationMetrics }
      : {}),
    imageCalls: typeof usage.imageCalls === 'number' ? usage.imageCalls : 0,
    imageCostUsd: typeof usage.imageCostUsd === 'number' ? usage.imageCostUsd : 0,
    judgeCalls: typeof usage.judgeCalls === 'number' ? usage.judgeCalls : 0,
    judgeCostUsd: typeof usage.judgeCostUsd === 'number' ? usage.judgeCostUsd : null,
    ...(typeof manifest.error === 'string' ? { error: manifest.error } : {}),
  };
}

function restorePersistedRun(experimentsDir: string, runId: string): LabRun | null {
  const dir = persistedRunDir(experimentsDir, runId);
  if (!dir) return null;
  const manifest = readJson<Record<string, unknown>>(join(dir, 'manifest.json'), {});
  const status = readPersistedStatus(experimentsDir, runId);
  if (!status) return null;
  const manifestCandidates = isRecord(manifest.candidates) ? manifest.candidates : {};
  const candidates = new Map<string, LevelCandidate>();
  for (const [id, value] of Object.entries(manifestCandidates)) {
    if (!CANDIDATE_IDS.includes(id as (typeof CANDIDATE_IDS)[number]) || !isRecord(value)) continue;
    if (!isRecord(value.level) || !isRecord(value.metrics)) continue;
    const guide = persistedAsset(experimentsDir, runId, `${id}-guide`);
    if (!guide) continue;
    candidates.set(id, {
      id,
      level: value.level as unknown as PlatformerLevel,
      metrics: value.metrics as unknown as PlatformerLevelLabMetrics,
      guide: readFileSync(guide.path),
    });
  }
  if (candidates.size === 0 && status.status !== 'failed') return null;
  const assets = new Map<string, { path: string; file: string; mime: string }>();
  const manifestAssets = isRecord(manifest.assets) ? manifest.assets : {};
  for (const id of Object.keys(manifestAssets)) {
    const asset = persistedAsset(experimentsDir, runId, id);
    if (asset) assets.set(id, asset);
  }
  return {
    id: runId,
    dir,
    createdAt: typeof manifest.createdAt === 'string' ? manifest.createdAt : nowIso(),
    concept: status.concept,
    status:
      status.status === 'failed'
        ? 'failed'
        : candidates.size > 0
          ? 'ready'
          : 'failed',
    events: status.events,
    listeners: new Set(),
    assets,
    candidates,
    recommendedId: status.recommendedId,
    hydratedId: status.hydratedId,
    hydrationWinnerId: status.hydrationWinnerId,
    imageCalls: status.imageCalls,
    imageCostUsd: status.imageCostUsd,
    judgeCalls: status.judgeCalls,
    judgeCostUsd: status.judgeCostUsd,
    imageModel: typeof manifest.imageModel === 'string' ? manifest.imageModel : undefined,
    judgeModel: typeof manifest.judgeModel === 'string' ? manifest.judgeModel : undefined,
    judgeProvider: typeof manifest.judgeProvider === 'string' ? manifest.judgeProvider : undefined,
    hydrationMetrics: status.hydrationMetrics,
    hydrationDecision: isRecord(manifest.hydrationDecision)
      ? (manifest.hydrationDecision as unknown as PlatformerLevelHydrationJudgeDecision)
      : undefined,
    error: status.error,
  };
}

function persistedAsset(
  experimentsDir: string,
  runId: string,
  assetId: string,
): { path: string; file: string; mime: string } | null {
  if (!/^[A-Za-z0-9-]+$/.test(assetId)) return null;
  const dir = persistedRunDir(experimentsDir, runId);
  if (!dir) return null;
  const manifest = readJson<Record<string, unknown>>(join(dir, 'manifest.json'), {});
  const assets = isRecord(manifest.assets) ? manifest.assets : {};
  const record = isRecord(assets[assetId]) ? assets[assetId] : null;
  if (!record || typeof record.file !== 'string' || typeof record.mime !== 'string') return null;
  if (basename(record.file) === '' || record.file.includes('..')) return null;
  const path = resolve(dir, record.file);
  if (!path.startsWith(`${resolve(dir)}/`) || !existsSync(path)) return null;
  return { path, file: record.file, mime: record.mime };
}

function persistedRunDir(experimentsDir: string, runId: string): string | null {
  if (!/^[A-Za-z0-9-]+$/.test(runId)) return null;
  const dir = join(experimentsDir, runId);
  return existsSync(join(dir, 'manifest.json')) ? dir : null;
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function usageData(run: LabRun): Record<string, unknown> {
  return {
    imageCalls: run.imageCalls,
    imageCostUsd: run.imageCostUsd,
    judgeCalls: run.judgeCalls,
    judgeCostUsd: run.judgeCostUsd,
    totalCostUsd: run.judgeCostUsd === null ? null : run.imageCostUsd + run.judgeCostUsd,
  };
}

function mockHydrationJudgeResponse(
  candidates: readonly PlatformerLevelHydrationGeometryReview[],
): CompleteResponse {
  const selected = [...candidates].sort(
    (a, b) => b.score - a.score || a.id.localeCompare(b.id),
  )[0]!.id;
  return {
    text: JSON.stringify({
      candidateReviews: candidates.map(({ id }) => ({
        id,
        scores: {
          craftsmanship: 5,
          materialRichness: 5,
          visualCohesion: 5,
          gameplayReadability: 5,
        },
        issues: [],
        summary: 'The mock hydration is coherent and readable.',
      })),
      selection: {
        candidateId: selected,
        confidence: 0.98,
        rationale: 'The mock judge selects the strongest deterministic geometry candidate.',
      },
    }),
    usage: { input: 1000, output: 400 },
  };
}

function assetUrl(runId: string, assetId: string): string {
  return `/api/dev/platformer-levels/runs/${encodeURIComponent(runId)}/assets/${encodeURIComponent(assetId)}`;
}

function sseHeaders(): Record<string, string> {
  return {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  };
}

function cleanInput(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1200);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
