// Dev-only Platformer Poses Lab. Runs the production Muse adapters in an
// isolated, observable experiment: photo -> three front-idle foundations ->
// Muse Spark identity selection -> shared side anchor -> three Phase A + three
// inverse Phase B candidates -> Muse Spark pair selection.
import { registerDevPlatformerActionRoutes } from './dev-platformer-actions';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { CompleteRequest, CompleteResponse } from '@sparkade/shared';
import {
  prepareGeneratedPlatformerReference,
  processGeneratedPlatformerPose,
  recoverGeneratedPlatformerGreenPanel,
} from '../assets/platformer-pose';
import {
  PLATFORMER_IDLE_JUDGE_PROMPT_VERSION,
  buildPlatformerIdleCandidatePrompt,
  buildPlatformerIdleJudgeBoard,
  buildPlatformerIdleJudgePrompt,
  buildPlatformerIdleJudgeSchema,
  normalizePlatformerIdleJudgeDecision,
  type PlatformerIdleCandidateDescriptor,
  type PlatformerIdleJudgeDecision,
} from '../assets/platformer-idle-judge';
import {
  PLATFORMER_POSE_JUDGE_PROMPT_VERSION,
  PLATFORMER_POSE_LAB_PROMPT_VERSION,
  buildPlatformerPhaseACandidatePrompt,
  buildPlatformerPhaseBCandidatePrompt,
  buildPlatformerPoseJudgeBoard,
  buildPlatformerPoseJudgePrompt,
  buildPlatformerPoseJudgeSchema,
  buildPlatformerSideAnchorPrompt,
  normalizePlatformerPoseJudgeDecision,
  type PlatformerPoseCandidateDescriptor,
  type PlatformerPoseJudgeDecision,
} from '../assets/platformer-pose-judge';
import { mockGeneratedImage } from '../assets/game-art';
import { parseModelJson } from '../pipeline/prompts';
import { costOf } from '../pipeline/cost';
import { stageProvider } from '../providers';
import {
  MetaImageAdapter,
  type MetaImageEditRequest,
  type MetaImageResult,
} from '../providers/meta-image';
import type { ConfigStore } from '../storage/config';
import { atomicWriteFile, ensureDir, nowIso } from '../util';

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const IDLE_CANDIDATES_PER_ROUND = 3;
const IDLE_MAX_ROUNDS = 2;
const CANDIDATES_PER_POSE = 3;
const RUN_RETENTION_MS = 60 * 60 * 1000;

export type PlatformerPoseLabStage =
  'source' | 'idle' | 'idle-judge' | 'side-anchor' | 'candidates' | 'judge' | 'complete';

export type PlatformerPoseLabEventType =
  | 'stage'
  | 'asset'
  | 'idle-judge-response'
  | 'idle-selection'
  | 'judge-response'
  | 'selection'
  | 'human-verdict'
  | 'done'
  | 'failed';

export interface PlatformerPoseLabEvent {
  seq: number;
  runId: string;
  at: string;
  type: PlatformerPoseLabEventType;
  stage: PlatformerPoseLabStage;
  status: 'started' | 'complete' | 'rejected' | 'failed';
  message: string;
  elapsedMs?: number;
  data?: Record<string, unknown>;
}

export interface PlatformerPoseLabJudgeInput {
  request: CompleteRequest;
  model: string;
  provider: string;
}

export interface PlatformerPoseHumanVerdict {
  accepted: boolean;
  phaseAId: string;
  phaseBId: string;
  notes: string;
  at: string;
}

export type PlatformerPoseLabJudge = (
  input: PlatformerPoseLabJudgeInput,
) => Promise<CompleteResponse>;

export interface DevPlatformerPoseOptions {
  imageEdit?: (request: MetaImageEditRequest) => Promise<MetaImageResult>;
  imageModel?: string;
  judge?: PlatformerPoseLabJudge;
  judgeModel?: string;
  judgeProvider?: string;
}

interface LabRun {
  id: string;
  dir: string;
  createdAt: string;
  heroConcept: string;
  colors: string;
  status: 'running' | 'done' | 'failed';
  events: PlatformerPoseLabEvent[];
  listeners: Set<(event: PlatformerPoseLabEvent) => void>;
  assets: Map<string, { path: string; mime: string }>;
  imageCalls: number;
  imageCostUsd: number;
  judgeCalls: number;
  judgeCostUsd: number | null;
  idleDecision?: PlatformerIdleJudgeDecision;
  decision?: PlatformerPoseJudgeDecision;
  humanVerdict?: PlatformerPoseHumanVerdict;
  models: { imageModel?: string; judgeModel?: string; judgeProvider?: string };
  error?: string;
}

interface GeneratedLabAsset {
  id: string;
  kind: 'idle' | 'side-anchor' | 'phase-a' | 'phase-b';
  raw: Buffer;
  reference: Buffer;
  processed: Buffer;
  rawUrl: string;
  recoveredUrl?: string;
  processedUrl: string;
  metrics: Awaited<ReturnType<typeof processGeneratedPlatformerPose>>['metrics'];
}

export function registerDevPlatformerPoseRoutes(
  app: FastifyInstance,
  configStore: ConfigStore,
  dataDir: string,
  options: DevPlatformerPoseOptions = {},
): void {
  registerDevPlatformerActionRoutes(app, dataDir);
  const runs = new Map<string, LabRun>();
  const experimentsDir = ensureDir(join(dataDir, 'experiments', 'platformer-poses'));

  app.post('/api/dev/platformer-poses/runs', async (req, reply) => {
    let upload: Buffer | undefined;
    let heroConcept = '';
    let colors = '';
    for await (const part of (
      req as FastifyRequest & { parts: () => AsyncIterable<Record<string, unknown>> }
    ).parts()) {
      if (part.type === 'file' && part.fieldname === 'photo') {
        upload = await (part as unknown as MultipartFile).toBuffer();
      } else if (part.type === 'field') {
        const value = String((part as { value: unknown }).value ?? '');
        if (part.fieldname === 'heroConcept') heroConcept = value;
        if (part.fieldname === 'colors') colors = value;
      }
    }
    if (!upload) return reply.code(400).send({ error: 'photo required' });
    if (upload.length > MAX_PHOTO_BYTES) return reply.code(413).send({ error: 'photo too large' });

    let source: Buffer;
    try {
      source = await sharp(upload)
        .rotate()
        .resize(1024, 1024, {
          fit: 'contain',
          withoutEnlargement: true,
          background: { r: 245, g: 245, b: 245, alpha: 1 },
        })
        .png()
        .toBuffer();
    } catch {
      return reply.code(400).send({ error: 'unsupported or invalid image' });
    }

    const createdAt = nowIso();
    const id = `${createdAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const run: LabRun = {
      id,
      dir: ensureDir(join(experimentsDir, id)),
      createdAt,
      heroConcept: cleanInput(heroConcept),
      colors: cleanInput(colors),
      status: 'running',
      events: [],
      listeners: new Set(),
      assets: new Map(),
      imageCalls: 0,
      imageCostUsd: 0,
      judgeCalls: 0,
      judgeCostUsd: null,
      models: {},
    };
    runs.set(id, run);
    saveAsset(run, 'source', 'source.png', source, 'image/png');
    emit(run, {
      type: 'asset',
      stage: 'source',
      status: 'complete',
      message: 'Source reference normalized locally',
      data: { id: 'source', label: 'Source reference', processedUrl: assetUrl(id, 'source') },
    });
    void executeRun(run, source, configStore, options).catch((error: unknown) => {
      failRun(run, error);
    });
    setTimeout(() => runs.delete(id), RUN_RETENTION_MS).unref?.();
    return reply.code(202).send({ runId: id });
  });

  app.get('/api/dev/platformer-poses/runs/:runId', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = runs.get(runId);
    if (!run) {
      const persisted = readPersistedStatus(experimentsDir, runId);
      return persisted
        ? persisted
        : reply.code(404).send({ error: 'unknown or expired pose-lab run' });
    }
    return {
      runId,
      status: run.status,
      events: run.events,
      imageCalls: run.imageCalls,
      imageCostUsd: run.imageCostUsd,
      judgeCostUsd: run.judgeCostUsd,
      idleDecision: run.idleDecision,
      decision: run.decision,
      humanVerdict: run.humanVerdict,
      error: run.error,
    };
  });

  app.post('/api/dev/platformer-poses/runs/:runId/human-verdict', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const body = req.body as {
      accepted?: unknown;
      phaseAId?: unknown;
      phaseBId?: unknown;
      notes?: unknown;
    } | null;
    if (typeof body?.accepted !== 'boolean') {
      return reply.code(400).send({ error: 'accepted must be a boolean' });
    }
    const phaseAId = body.accepted && typeof body.phaseAId === 'string' ? body.phaseAId : '';
    const phaseBId = body.accepted && typeof body.phaseBId === 'string' ? body.phaseBId : '';
    const notes = typeof body.notes === 'string' ? cleanInput(body.notes) : '';
    const run = runs.get(runId);
    const runDir = run?.dir ?? persistedRunDir(experimentsDir, runId);
    if (!runDir) return reply.code(404).send({ error: 'unknown or expired pose-lab run' });
    if (
      body.accepted &&
      (!validCandidate(run, runDir, phaseAId, 'A') || !validCandidate(run, runDir, phaseBId, 'B'))
    ) {
      return reply
        .code(400)
        .send({ error: 'accepted verdict requires known Phase A and B assets' });
    }

    const humanVerdict: PlatformerPoseHumanVerdict = {
      accepted: body.accepted,
      phaseAId,
      phaseBId,
      notes,
      at: nowIso(),
    };
    const event = run
      ? saveLiveHumanVerdict(run, humanVerdict)
      : savePersistedHumanVerdict(runId, runDir, humanVerdict);
    return { humanVerdict, event };
  });

  app.get('/api/dev/platformer-poses/runs/:runId/events', (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = runs.get(runId);
    if (!run) {
      const persisted = readPersistedStatus(experimentsDir, runId);
      if (!persisted) {
        void reply.code(404).send({ error: 'unknown or expired pose-lab run' });
        return;
      }
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      for (const event of persisted.events) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      reply.raw.end();
      return;
    }
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: PlatformerPoseLabEvent): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    for (const event of run.events) send(event);
    if (run.status !== 'running') {
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

  app.get('/api/dev/platformer-poses/runs/:runId/assets/:assetId', async (req, reply) => {
    const { runId, assetId } = req.params as { runId: string; assetId: string };
    const asset =
      runs.get(runId)?.assets.get(assetId) ?? persistedAsset(experimentsDir, runId, assetId);
    if (!asset) return reply.code(404).send({ error: 'unknown pose-lab asset' });
    return reply.type(asset.mime).send(createReadStream(asset.path));
  });
}

async function executeRun(
  run: LabRun,
  source: Buffer,
  configStore: ConfigStore,
  options: DevPlatformerPoseOptions,
): Promise<void> {
  const config = configStore.get();
  const mock = process.env.SPARKADE_PROVIDER === 'mock';
  const imageConfig = config.imageGeneration;
  const imageModel = options.imageModel ?? (mock ? 'mock-image' : imageConfig.model);
  const judgeStage = stageProvider(config, 'design');
  const judgeModel = options.judgeModel ?? judgeStage.model;
  const judgeProvider = options.judgeProvider ?? (mock ? 'mock' : judgeStage.providerName);
  const adapter =
    options.imageEdit || mock
      ? null
      : new MetaImageAdapter({
          baseUrl: imageConfig.baseUrl,
          model: imageModel,
          apiKeyEnv: imageConfig.apiKeyEnv,
          timeoutMs: imageConfig.timeoutMs,
          name: 'platformer-pose-lab',
        });
  const edit = async (request: MetaImageEditRequest): Promise<MetaImageResult> => {
    const result = options.imageEdit
      ? await options.imageEdit(request)
      : mock
        ? {
            image: await mockGeneratedImage(request.prompt),
            outputFormat: 'png' as const,
            imageCount: 1,
            usage: undefined,
          }
        : await adapter!.edit(request);
    run.imageCalls += result.imageCount;
    run.imageCostUsd += mock ? 0 : imageConfig.pricePerImageUsd * result.imageCount;
    return result;
  };
  const completeJudge = async (
    request: CompleteRequest,
    mockResponse: () => CompleteResponse,
  ): Promise<{ response: CompleteResponse; costUsd: number | null }> => {
    let response: CompleteResponse;
    if (options.judge) {
      response = await options.judge({ request, model: judgeModel, provider: judgeProvider });
    } else if (mock) {
      response = mockResponse();
    } else {
      if (!judgeStage.provider.capabilities.imageIn) {
        throw new Error(`judge provider "${judgeStage.providerName}" does not support image input`);
      }
      response = await judgeStage.provider.complete(
        {
          ...request,
          jsonSchema: judgeStage.provider.capabilities.structuredOutput
            ? request.jsonSchema
            : undefined,
          timeoutMs: 120_000,
        },
        { model: judgeModel },
      );
    }
    const costUsd = mock ? 0 : costOf(response.model ?? judgeModel, response.usage, config.pricing);
    const priorCost = run.judgeCalls === 0 ? 0 : run.judgeCostUsd;
    run.judgeCalls++;
    run.judgeCostUsd = priorCost === null || costUsd === null ? null : priorCost + costUsd;
    return { response, costUsd };
  };

  const generate = async (
    id: string,
    kind: GeneratedLabAsset['kind'],
    label: string,
    prompt: string,
    reference: Buffer,
    stage: PlatformerPoseLabStage,
  ): Promise<GeneratedLabAsset | null> => {
    const started = Date.now();
    emit(run, {
      type: 'stage',
      stage,
      status: 'started',
      message: `${label} generation started`,
      data: { id, kind, label, prompt },
    });
    let raw: Buffer;
    try {
      const result = await edit({
        prompt,
        image: reference,
        imageMimeType: 'image/png',
        imageFilename: `${id}-reference.png`,
        outputFormat: 'png',
        size: '1024x1024',
        user: run.id,
      });
      raw = result.image;
    } catch (error) {
      emit(run, {
        type: 'asset',
        stage,
        status: 'rejected',
        message: `${label} provider call failed`,
        elapsedMs: Date.now() - started,
        data: { id, kind, label, error: errorMessage(error) },
      });
      return null;
    }
    const rawUrl = saveAsset(run, `${id}-raw`, `raw/${id}.png`, raw, 'image/png');
    try {
      let referenceImage = raw;
      let recoveredUrl: string | undefined;
      let recoveryCrop: Record<string, number> | undefined;
      let processed: Awaited<ReturnType<typeof processGeneratedPlatformerPose>>;
      try {
        processed = await processGeneratedPlatformerPose(raw);
      } catch (initialError) {
        const recovery = await recoverGeneratedPlatformerGreenPanel(raw);
        if (!recovery.recovered) throw initialError;
        referenceImage = recovery.image;
        processed = await processGeneratedPlatformerPose(referenceImage);
        recoveredUrl = saveAsset(
          run,
          `${id}-recovered`,
          `recovered/${id}.png`,
          referenceImage,
          'image/png',
        );
        recoveryCrop = recovery.crop as unknown as Record<string, number>;
      }
      const processedUrl = saveAsset(
        run,
        `${id}-processed`,
        `processed/${id}.png`,
        processed.png,
        'image/png',
      );
      const asset: GeneratedLabAsset = {
        id,
        kind,
        raw,
        reference: referenceImage,
        processed: processed.png,
        rawUrl,
        ...(recoveredUrl ? { recoveredUrl } : {}),
        processedUrl,
        metrics: processed.metrics,
      };
      emit(run, {
        type: 'asset',
        stage,
        status: 'complete',
        message: recoveredUrl
          ? `${label} generated, recovered from an inset green panel, and normalized`
          : `${label} generated and normalized`,
        elapsedMs: Date.now() - started,
        data: {
          id,
          kind,
          label,
          rawUrl,
          ...(recoveredUrl ? { recoveredUrl, recoveryCrop } : {}),
          processedUrl,
          metrics: processed.metrics as unknown as Record<string, unknown>,
        },
      });
      return asset;
    } catch (error) {
      emit(run, {
        type: 'asset',
        stage,
        status: 'rejected',
        message: `${label} failed local normalization`,
        elapsedMs: Date.now() - started,
        data: { id, kind, label, rawUrl, error: errorMessage(error) },
      });
      return null;
    }
  };

  const judgeIdleCandidates = async (
    candidates: readonly GeneratedLabAsset[],
    round: number,
  ): Promise<PlatformerIdleJudgeDecision> => {
    const descriptors: PlatformerIdleCandidateDescriptor[] = candidates.map(({ id }) => ({ id }));
    const board = await buildPlatformerIdleJudgeBoard({
      source,
      candidates: candidates.map(({ id, reference: raw, processed }) => ({ id, raw, processed })),
    });
    const boardId = `idle-judge-board-${round}`;
    const boardUrl = saveAsset(run, boardId, `${boardId}.jpg`, board, 'image/jpeg');
    emit(run, {
      type: 'asset',
      stage: 'idle-judge',
      status: 'complete',
      message: `Front-idle round ${round} identity review board assembled locally`,
      data: {
        id: boardId,
        kind: 'idle-judge-board',
        label: `Front-idle identity review board · round ${round}`,
        processedUrl: boardUrl,
        round,
      },
    });
    const prompt = buildPlatformerIdleJudgePrompt(descriptors, {
      heroConcept: run.heroConcept,
    });
    const schema = buildPlatformerIdleJudgeSchema(descriptors);
    emit(run, {
      type: 'stage',
      stage: 'idle-judge',
      status: 'started',
      message: `${judgeModel} front-idle identity review started`,
      data: {
        model: judgeModel,
        provider: judgeProvider,
        promptVersion: PLATFORMER_IDLE_JUDGE_PROMPT_VERSION,
        candidateIds: descriptors.map(({ id }) => id),
        systemPrompt: prompt.system,
        userPrompt: prompt.user,
        round,
      },
    });
    const started = Date.now();
    const { response, costUsd } = await completeJudge(
      {
        system: prompt.system,
        user: prompt.user,
        image: board,
        jsonSchema: schema,
        maxTokens: 2600,
        temperature: 0,
        effort: 'low',
      },
      () => mockIdleJudgeResponse(descriptors),
    );
    emit(run, {
      type: 'idle-judge-response',
      stage: 'idle-judge',
      status: 'complete',
      message: `${judgeModel} returned the front-idle identity scoring response`,
      elapsedMs: Date.now() - started,
      data: {
        raw: response.text,
        usage: response.usage as unknown as Record<string, unknown>,
        costUsd,
        totalJudgeCostUsd: run.judgeCostUsd,
        round,
      },
    });
    const decision = normalizePlatformerIdleJudgeDecision(
      parseModelJson(response.text),
      descriptors,
    );
    run.idleDecision = decision;
    emit(run, {
      type: 'idle-selection',
      stage: 'idle-judge',
      status: decision.selection.accepted ? 'complete' : 'rejected',
      message: decision.selection.accepted
        ? `Muse Spark selected ${decision.selection.candidateId} as the identity foundation`
        : `Muse Spark rejected front-idle round ${round}`,
      data: { decision: decision as unknown as Record<string, unknown>, round },
    });
    return decision;
  };

  let idle: GeneratedLabAsset | undefined;
  let retryGuidance = '';
  for (let round = 1; round <= IDLE_MAX_ROUNDS && !idle; round++) {
    emit(run, {
      type: 'stage',
      stage: 'idle',
      status: 'started',
      message:
        round === 1
          ? 'Launching three front-idle identity candidates in parallel'
          : 'Launching one bounded front-idle retry batch in parallel',
      data: { candidateCount: IDLE_CANDIDATES_PER_ROUND, round, retryGuidance },
    });
    const offset = (round - 1) * IDLE_CANDIDATES_PER_ROUND;
    const tasks: Array<Promise<GeneratedLabAsset | null>> = [];
    for (let index = 1; index <= IDLE_CANDIDATES_PER_ROUND; index++) {
      const id = `I${offset + index}`;
      tasks.push(
        generate(
          id,
          'idle',
          `Front idle candidate ${id}`,
          buildPlatformerIdleCandidatePrompt(id, {
            ...(run.heroConcept ? { heroConcept: run.heroConcept } : {}),
            ...(run.colors ? { colors: run.colors } : {}),
            ...(retryGuidance ? { retryGuidance } : {}),
          }),
          source,
          'idle',
        ),
      );
    }
    const survivors = (await Promise.all(tasks)).filter(
      (candidate): candidate is GeneratedLabAsset => candidate !== null,
    );
    emit(run, {
      type: 'stage',
      stage: 'idle',
      status: survivors.length > 0 ? 'complete' : 'rejected',
      message: `${survivors.length} of ${IDLE_CANDIDATES_PER_ROUND} front-idle candidates passed local validation`,
      data: { acceptedCandidateIds: survivors.map(({ id }) => id), round },
    });
    if (survivors.length === 0) {
      retryGuidance =
        'Return exactly one centered, uncropped adult character on a completely flat #00ff00 background. Keep the arms closer to the torso so the full-height sprite retains its scale.';
      if (round === IDLE_MAX_ROUNDS) {
        throw new Error('all front idle candidates failed local validation after two rounds');
      }
      continue;
    }
    const idleDecision = await judgeIdleCandidates(survivors, round);
    if (idleDecision.selection.accepted) {
      idle = survivors.find(({ id }) => id === idleDecision.selection.candidateId);
    }
    retryGuidance =
      idleDecision.selection.retryGuidance ||
      'Preserve the source identity exactly and remove all facial, accessory, anatomy, and framing artifacts.';
    if (!idle && round === IDLE_MAX_ROUNDS) {
      throw new Error('Muse Spark rejected every front idle identity candidate after two rounds');
    }
  }
  if (!idle) throw new Error('no front idle identity foundation was selected');
  const idleReference = await prepareGeneratedPlatformerReference(idle.reference);

  const sideAnchor = await generate(
    'side-anchor',
    'side-anchor',
    'Shared right-facing identity anchor',
    buildPlatformerSideAnchorPrompt({ ...(run.colors ? { colors: run.colors } : {}) }),
    idleReference,
    'side-anchor',
  );
  if (!sideAnchor) throw new Error('the shared side anchor did not pass local validation');
  const sideReference = await prepareGeneratedPlatformerReference(sideAnchor.reference);

  emit(run, {
    type: 'stage',
    stage: 'candidates',
    status: 'started',
    message: 'Launching three Phase A and three inverse Phase B candidates in parallel',
    data: { candidateCount: CANDIDATES_PER_POSE * 2 },
  });
  const candidateTasks: Array<Promise<GeneratedLabAsset | null>> = [];
  for (let index = 1; index <= CANDIDATES_PER_POSE; index++) {
    candidateTasks.push(
      generate(
        `A${index}`,
        'phase-a',
        `Phase A candidate A${index}`,
        buildPlatformerPhaseACandidatePrompt(index, {
          ...(run.colors ? { colors: run.colors } : {}),
        }),
        sideReference,
        'candidates',
      ),
      generate(
        `B${index}`,
        'phase-b',
        `Phase B candidate B${index}`,
        buildPlatformerPhaseBCandidatePrompt(index, {
          ...(run.colors ? { colors: run.colors } : {}),
        }),
        sideReference,
        'candidates',
      ),
    );
  }
  const candidates = (await Promise.all(candidateTasks)).filter(
    (candidate): candidate is GeneratedLabAsset => candidate !== null,
  );
  const descriptors: PlatformerPoseCandidateDescriptor[] = candidates
    .filter(
      (candidate): candidate is GeneratedLabAsset & { kind: 'phase-a' | 'phase-b' } =>
        candidate.kind === 'phase-a' || candidate.kind === 'phase-b',
    )
    .map(({ id, kind }) => ({ id, kind }));
  if (!descriptors.some(({ kind }) => kind === 'phase-a')) {
    throw new Error('all Phase A candidates failed local validation');
  }
  if (!descriptors.some(({ kind }) => kind === 'phase-b')) {
    throw new Error('all Phase B candidates failed local validation');
  }
  emit(run, {
    type: 'stage',
    stage: 'candidates',
    status: 'complete',
    message: `${descriptors.length} of ${CANDIDATES_PER_POSE * 2} candidates passed local validation`,
    data: { acceptedCandidateIds: descriptors.map(({ id }) => id) },
  });

  const board = await buildPlatformerPoseJudgeBoard({
    source,
    idle: idle.processed,
    sideAnchor: sideAnchor.processed,
    candidates: candidates
      .filter(
        (candidate): candidate is GeneratedLabAsset & { kind: 'phase-a' | 'phase-b' } =>
          candidate.kind === 'phase-a' || candidate.kind === 'phase-b',
      )
      .map(({ id, kind, processed }) => ({ id, kind, processed })),
  });
  const boardUrl = saveAsset(run, 'judge-board', 'judge-board.jpg', board, 'image/jpeg');
  emit(run, {
    type: 'asset',
    stage: 'judge',
    status: 'complete',
    message: 'Labeled semantic review board assembled locally',
    data: { id: 'judge-board', label: 'Muse Spark review board', processedUrl: boardUrl },
  });

  const judgePrompt = buildPlatformerPoseJudgePrompt(descriptors);
  const judgeSchema = buildPlatformerPoseJudgeSchema(descriptors);
  emit(run, {
    type: 'stage',
    stage: 'judge',
    status: 'started',
    message: `${judgeModel} semantic review started`,
    data: {
      model: judgeModel,
      provider: judgeProvider,
      promptVersion: PLATFORMER_POSE_JUDGE_PROMPT_VERSION,
      candidateIds: descriptors.map(({ id }) => id),
      systemPrompt: judgePrompt.system,
      userPrompt: judgePrompt.user,
    },
  });

  const judgeStarted = Date.now();
  const { response, costUsd } = await completeJudge(
    {
      system: judgePrompt.system,
      user: judgePrompt.user,
      image: board,
      jsonSchema: judgeSchema,
      maxTokens: 4000,
      temperature: 0,
      effort: 'low',
    },
    () => mockJudgeResponse(descriptors),
  );
  emit(run, {
    type: 'judge-response',
    stage: 'judge',
    status: 'complete',
    message: `${judgeModel} returned its complete scoring response`,
    elapsedMs: Date.now() - judgeStarted,
    data: {
      raw: response.text,
      usage: response.usage as unknown as Record<string, unknown>,
      costUsd,
      totalJudgeCostUsd: run.judgeCostUsd,
    },
  });
  const decision = normalizePlatformerPoseJudgeDecision(parseModelJson(response.text), descriptors);
  run.decision = decision;
  emit(run, {
    type: 'selection',
    stage: 'judge',
    status: decision.selection.accepted ? 'complete' : 'rejected',
    message: decision.selection.accepted
      ? `Muse Spark selected ${decision.selection.phaseAId} + ${decision.selection.phaseBId}`
      : 'Muse Spark rejected every candidate pair',
    data: { decision: decision as unknown as Record<string, unknown> },
  });

  run.status = 'done';
  emit(run, {
    type: 'done',
    stage: 'complete',
    status: 'complete',
    message: decision.selection.accepted
      ? 'Pose experiment completed with an accepted animation pair'
      : 'Pose experiment completed without an acceptable pair',
    data: {
      imageCalls: run.imageCalls,
      imageCostUsd: run.imageCostUsd,
      judgeCostUsd: run.judgeCostUsd,
      totalCostUsd: run.judgeCostUsd === null ? null : run.imageCostUsd + run.judgeCostUsd,
      experimentDir: run.dir,
    },
  });
  writeManifest(run, { imageModel, judgeModel, judgeProvider });
}

function emit(
  run: LabRun,
  event: Omit<PlatformerPoseLabEvent, 'seq' | 'runId' | 'at'>,
): PlatformerPoseLabEvent {
  const complete: PlatformerPoseLabEvent = {
    ...event,
    seq: run.events.length + 1,
    runId: run.id,
    at: nowIso(),
  };
  run.events.push(complete);
  atomicWriteFile(join(run.dir, 'events.json'), `${JSON.stringify(run.events, null, 2)}\n`);
  for (const listener of [...run.listeners]) listener(complete);
  if (complete.type === 'done' || complete.type === 'failed') {
    for (const listener of [...run.listeners]) run.listeners.delete(listener);
  }
  return complete;
}

function failRun(run: LabRun, error: unknown): void {
  if (run.status !== 'running') return;
  run.status = 'failed';
  run.error = errorMessage(error);
  emit(run, {
    type: 'failed',
    stage: 'complete',
    status: 'failed',
    message: run.error,
    data: { imageCalls: run.imageCalls, imageCostUsd: run.imageCostUsd },
  });
  writeManifest(run, {});
}

function saveAsset(
  run: LabRun,
  assetId: string,
  filename: string,
  contents: Buffer,
  mime: string,
): string {
  const path = join(run.dir, filename);
  atomicWriteFile(path, contents);
  run.assets.set(assetId, { path, mime });
  return assetUrl(run.id, assetId);
}

function assetUrl(runId: string, assetId: string): string {
  return `/api/dev/platformer-poses/runs/${encodeURIComponent(runId)}/assets/${encodeURIComponent(assetId)}`;
}

function writeManifest(
  run: LabRun,
  models: { imageModel?: string; judgeModel?: string; judgeProvider?: string },
): void {
  run.models = { ...run.models, ...models };
  atomicWriteFile(
    join(run.dir, 'manifest.json'),
    `${JSON.stringify(
      {
        runId: run.id,
        createdAt: run.createdAt,
        status: run.status,
        promptVersions: {
          lab: PLATFORMER_POSE_LAB_PROMPT_VERSION,
          idleJudge: PLATFORMER_IDLE_JUDGE_PROMPT_VERSION,
          judge: PLATFORMER_POSE_JUDGE_PROMPT_VERSION,
        },
        models: run.models,
        inputs: { heroConcept: run.heroConcept, colors: run.colors },
        usage: {
          imageCalls: run.imageCalls,
          imageCostUsd: run.imageCostUsd,
          judgeCalls: run.judgeCalls,
          judgeCostUsd: run.judgeCostUsd,
        },
        idleDecision: run.idleDecision,
        decision: run.decision,
        humanVerdict: run.humanVerdict,
        error: run.error,
        events: run.events,
      },
      null,
      2,
    )}\n`,
  );
}

function persistedRunDir(experimentsDir: string, runId: string): string | null {
  if (!/^[A-Za-z0-9-]+$/.test(runId)) return null;
  const dir = join(experimentsDir, runId);
  return existsSync(join(dir, 'manifest.json')) ? dir : null;
}

function readPersistedStatus(
  experimentsDir: string,
  runId: string,
): {
  runId: string;
  status: 'running' | 'done' | 'failed';
  events: PlatformerPoseLabEvent[];
  imageCalls: number;
  imageCostUsd: number;
  judgeCostUsd: number | null;
  idleDecision?: PlatformerIdleJudgeDecision;
  decision?: PlatformerPoseJudgeDecision;
  humanVerdict?: PlatformerPoseHumanVerdict;
  error?: string;
} | null {
  const dir = persistedRunDir(experimentsDir, runId);
  if (!dir) return null;
  const manifest = readJsonFile<Record<string, unknown>>(join(dir, 'manifest.json'), {});
  const usage =
    manifest.usage && typeof manifest.usage === 'object'
      ? (manifest.usage as Record<string, unknown>)
      : {};
  const status =
    manifest.status === 'running' || manifest.status === 'failed' ? manifest.status : 'done';
  return {
    runId,
    status,
    events: readJsonFile<PlatformerPoseLabEvent[]>(join(dir, 'events.json'), []),
    imageCalls: typeof usage.imageCalls === 'number' ? usage.imageCalls : 0,
    imageCostUsd: typeof usage.imageCostUsd === 'number' ? usage.imageCostUsd : 0,
    judgeCostUsd: typeof usage.judgeCostUsd === 'number' ? usage.judgeCostUsd : null,
    ...(manifest.idleDecision && typeof manifest.idleDecision === 'object'
      ? { idleDecision: manifest.idleDecision as unknown as PlatformerIdleJudgeDecision }
      : {}),
    ...(manifest.decision && typeof manifest.decision === 'object'
      ? { decision: manifest.decision as unknown as PlatformerPoseJudgeDecision }
      : {}),
    ...(manifest.humanVerdict && typeof manifest.humanVerdict === 'object'
      ? { humanVerdict: manifest.humanVerdict as unknown as PlatformerPoseHumanVerdict }
      : {}),
    ...(typeof manifest.error === 'string' ? { error: manifest.error } : {}),
  };
}

function persistedAsset(
  experimentsDir: string,
  runId: string,
  assetId: string,
): { path: string; mime: string } | null {
  const dir = persistedRunDir(experimentsDir, runId);
  if (!dir || !/^[A-Za-z0-9-]+$/.test(assetId)) return null;
  let path: string;
  let mime: string;
  if (assetId === 'source') {
    path = join(dir, 'source.png');
    mime = 'image/png';
  } else if (assetId === 'judge-board') {
    path = join(dir, 'judge-board.jpg');
    mime = 'image/jpeg';
  } else if (/^idle-judge-board-\d+$/.test(assetId)) {
    path = join(dir, `${assetId}.jpg`);
    mime = 'image/jpeg';
  } else {
    const match = /^(.+)-(raw|processed|recovered)$/.exec(assetId);
    if (!match) return null;
    path = join(dir, match[2]!, `${match[1]!}.png`);
    mime = 'image/png';
  }
  return existsSync(path) ? { path, mime } : null;
}

function validCandidate(
  run: LabRun | undefined,
  runDir: string,
  candidateId: string,
  prefix: 'A' | 'B',
): boolean {
  return (
    new RegExp(`^${prefix}\\d+$`).test(candidateId) &&
    (run?.assets.has(`${candidateId}-processed`) === true ||
      existsSync(join(runDir, 'processed', `${candidateId}.png`)))
  );
}

function humanVerdictEvent(
  runId: string,
  seq: number,
  verdict: PlatformerPoseHumanVerdict,
): PlatformerPoseLabEvent {
  return {
    seq,
    runId,
    at: verdict.at,
    type: 'human-verdict',
    stage: 'complete',
    status: verdict.accepted ? 'complete' : 'rejected',
    message: verdict.accepted
      ? `Human selected ${verdict.phaseAId} + ${verdict.phaseBId}`
      : 'Human rejected every candidate pair',
    data: { humanVerdict: verdict as unknown as Record<string, unknown> },
  };
}

function saveLiveHumanVerdict(
  run: LabRun,
  humanVerdict: PlatformerPoseHumanVerdict,
): PlatformerPoseLabEvent {
  run.humanVerdict = humanVerdict;
  const complete = humanVerdictEvent(run.id, 0, humanVerdict);
  const event = emit(run, {
    type: complete.type,
    stage: complete.stage,
    status: complete.status,
    message: complete.message,
    data: complete.data,
  });
  atomicWriteFile(
    join(run.dir, 'human-verdict.json'),
    `${JSON.stringify(humanVerdict, null, 2)}\n`,
  );
  writeManifest(run, {});
  return event;
}

function savePersistedHumanVerdict(
  runId: string,
  runDir: string,
  humanVerdict: PlatformerPoseHumanVerdict,
): PlatformerPoseLabEvent {
  const events = readJsonFile<PlatformerPoseLabEvent[]>(join(runDir, 'events.json'), []);
  const event = humanVerdictEvent(runId, events.length + 1, humanVerdict);
  events.push(event);
  atomicWriteFile(join(runDir, 'events.json'), `${JSON.stringify(events, null, 2)}\n`);
  atomicWriteFile(join(runDir, 'human-verdict.json'), `${JSON.stringify(humanVerdict, null, 2)}\n`);
  const manifest = readJsonFile<Record<string, unknown>>(join(runDir, 'manifest.json'), {});
  atomicWriteFile(
    join(runDir, 'manifest.json'),
    `${JSON.stringify({ ...manifest, humanVerdict, events }, null, 2)}\n`,
  );
  return event;
}

function readJsonFile<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function cleanInput(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1200);
}

function mockIdleJudgeResponse(
  candidates: readonly PlatformerIdleCandidateDescriptor[],
): CompleteResponse {
  const selected = candidates[0]?.id ?? '';
  return {
    text: JSON.stringify({
      sourceReview: {
        eyewear: 'absent',
        summary: 'The mock source has no eyewear and establishes one consistent adult identity.',
      },
      candidateReviews: candidates.map(({ id }) => ({
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
        summary: `The mock ${id} foundation preserves the source identity.`,
      })),
      selection: {
        accepted: Boolean(selected),
        candidateId: selected,
        confidence: 0.98,
        rationale: 'The selected mock foundation is identity-safe and technically clean.',
        retryGuidance: '',
      },
    }),
    usage: { input: 900, output: 350 },
  };
}

function mockJudgeResponse(
  candidates: readonly PlatformerPoseCandidateDescriptor[],
): CompleteResponse {
  const phaseA = candidates.find(({ kind }) => kind === 'phase-a')?.id ?? '';
  const phaseB = candidates.find(({ kind }) => kind === 'phase-b')?.id ?? '';
  return {
    text: JSON.stringify({
      anchorReview: {
        identity: 5,
        sideView: 5,
        costume: 5,
        fatalIssues: [],
        summary: 'The mock side anchor is coherent with the mock identity.',
      },
      candidateReviews: candidates.map(({ id, kind }) => ({
        id,
        kind,
        scores: { identity: 5, costume: 5, pose: 5, technical: 5 },
        fatalIssues: [],
        summary: `The mock ${kind} candidate is usable.`,
      })),
      pairReviews: candidates
        .filter(({ kind }) => kind === 'phase-a')
        .flatMap(({ id: phaseAId }) =>
          candidates
            .filter(({ kind }) => kind === 'phase-b')
            .map(({ id: phaseBId }) => ({
              phaseAId,
              phaseBId,
              legAlternation: 5,
              armAlternation: 5,
              pairConsistency: 5,
              fatalIssues: [],
              summary: 'The mock pair visibly alternates.',
            })),
        ),
      selection: {
        accepted: Boolean(phaseA && phaseB),
        phaseAId: phaseA,
        phaseBId: phaseB,
        confidence: 0.98,
        rationale: 'The mock pair clearly reverses the leading leg between opposing contacts.',
        retryGuidance: '',
      },
    }),
    usage: { input: 1200, output: 500 },
  };
}
