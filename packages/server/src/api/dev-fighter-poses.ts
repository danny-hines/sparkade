// Dev-only Fighter Poses Lab. It runs one photographed avatar through the
// production identity foundation -> complete pose review -> targeted retry ->
// atlas path without creating or publishing a full game.
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import type { CompleteRequest, CompleteResponse } from '@sparkade/shared';
import { mockGeneratedImage } from '../assets/game-art';
import {
  GENERATED_FIGHTER_ATLAS_PROMPT_VERSION,
  GENERATED_FIGHTER_POSE_PROMPT_VERSION,
  buildFighterIdentityCandidatePrompt,
  buildFighterPosePrompt,
  buildGeneratedFighterAtlas,
  prepareGeneratedFighterReference,
  processGeneratedFighterPose,
  validateGeneratedFighterAtlas,
  type GeneratedFighterPose,
} from '../assets/fighter-pose';
import {
  FIGHTER_IDENTITY_JUDGE_PROMPT_VERSION,
  FIGHTER_POSE_JUDGE_PROMPT_VERSION,
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
  type FighterIdentityJudgeDecision,
  type FighterPoseCandidateDescriptor,
  type FighterPoseJudgeDecision,
} from '../assets/fighter-pose-judge';
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
const RUN_RETENTION_MS = 60 * 60 * 1000;
const MAX_RETRY_POSES = 4;

export type FighterPoseGenerationMode = 'sheets' | 'individual';

export type FighterPoseLabStage =
  | 'source'
  | 'foundations'
  | 'identity-judge'
  | 'poses'
  | 'pose-judge'
  | 'retry'
  | 'atlas'
  | 'complete';

export interface FighterPoseLabEvent {
  seq: number;
  runId: string;
  at: string;
  type: 'stage' | 'asset' | 'judge-response' | 'selection' | 'human-verdict' | 'done' | 'failed';
  stage: FighterPoseLabStage;
  status: 'started' | 'complete' | 'rejected' | 'failed';
  message: string;
  elapsedMs?: number;
  data?: Record<string, unknown>;
}

export interface FighterPoseLabJudgeInput {
  request: CompleteRequest;
  model: string;
  provider: string;
}

export type FighterPoseLabJudge = (input: FighterPoseLabJudgeInput) => Promise<CompleteResponse>;

export interface DevFighterPoseOptions {
  imageEdit?: (request: MetaImageEditRequest) => Promise<MetaImageResult>;
  imageModel?: string;
  judge?: FighterPoseLabJudge;
  judgeModel?: string;
  judgeProvider?: string;
}

interface LabAsset {
  id: string;
  pose?: GeneratedFighterPose;
  raw: Buffer;
  processed: Buffer;
}

interface LabRun {
  id: string;
  dir: string;
  createdAt: string;
  status: 'running' | 'done' | 'failed';
  inputs: {
    name: string;
    visualConcept: string;
    build: string;
    outfit: string;
    colors: string;
    generationMode: FighterPoseGenerationMode;
  };
  events: FighterPoseLabEvent[];
  listeners: Set<(event: FighterPoseLabEvent) => void>;
  assets: Map<string, { path: string; filename: string; mime: string }>;
  imageCalls: number;
  imageCostUsd: number;
  judgeCalls: number;
  judgeCostUsd: number | null;
  models: { imageModel?: string; judgeModel?: string; judgeProvider?: string };
  identityDecision?: FighterIdentityJudgeDecision;
  poseDecision?: FighterPoseJudgeDecision;
  humanVerdict?: { accepted: boolean; notes: string; at: string };
  error?: string;
}

export function registerDevFighterPoseRoutes(
  app: FastifyInstance,
  configStore: ConfigStore,
  dataDir: string,
  options: DevFighterPoseOptions = {},
): void {
  const runs = new Map<string, LabRun>();
  const experimentsDir = ensureDir(join(dataDir, 'experiments', 'fighter-poses'));

  app.post('/api/dev/fighter-poses/runs', async (req, reply) => {
    let upload: Buffer | undefined;
    const fields: Record<string, string> = {};
    for await (const part of (
      req as FastifyRequest & { parts: () => AsyncIterable<Record<string, unknown>> }
    ).parts()) {
      if (part.type === 'file' && part.fieldname === 'photo') {
        upload = await (part as unknown as MultipartFile).toBuffer();
      } else if (part.type === 'field') {
        fields[String(part.fieldname)] = cleanInput(
          String((part as { value: unknown }).value ?? ''),
        );
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
      status: 'running',
      inputs: {
        name: fields.name || 'PLAYER',
        visualConcept:
          fields.visualConcept ||
          'A distinctive adult arcade fighter with a memorable costume, footwear, and silhouette.',
        build: ['nimble', 'balanced', 'heavy'].includes(fields.build ?? '')
          ? fields.build!
          : 'balanced',
        outfit: ['gi', 'boxer', 'wrestler', 'street', 'robe', 'armor'].includes(fields.outfit ?? '')
          ? fields.outfit!
          : 'street',
        colors: fields.colors || '#315a9c, #e8b35d, #f4f0dc',
        generationMode: fields.generationMode === 'individual' ? 'individual' : 'sheets',
      },
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
      message: 'Source photo normalized locally',
      data: { id: 'source', label: 'Source photo', processedUrl: assetUrl(id, 'source') },
    });
    void executeRun(run, source, configStore, options).catch((error: unknown) =>
      failRun(run, error),
    );
    setTimeout(() => runs.delete(id), RUN_RETENTION_MS).unref?.();
    return reply.code(202).send({ runId: id });
  });

  app.get('/api/dev/fighter-poses/runs/:runId', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = runs.get(runId);
    const status = run ? statusOf(run) : readPersistedStatus(experimentsDir, runId);
    return status ?? reply.code(404).send({ error: 'unknown or expired fighter-pose run' });
  });

  app.get('/api/dev/fighter-poses/runs/:runId/events', (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = runs.get(runId);
    const persisted = run ? null : readPersistedStatus(experimentsDir, runId);
    if (!run && !persisted) {
      void reply.code(404).send({ error: 'unknown or expired fighter-pose run' });
      return;
    }
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: FighterPoseLabEvent): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    for (const event of run?.events ?? persisted!.events) send(event);
    if (!run || run.status !== 'running') {
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

  app.get('/api/dev/fighter-poses/runs/:runId/assets/:assetId', async (req, reply) => {
    const { runId, assetId } = req.params as { runId: string; assetId: string };
    const asset =
      runs.get(runId)?.assets.get(assetId) ?? persistedAsset(experimentsDir, runId, assetId);
    if (!asset) return reply.code(404).send({ error: 'unknown fighter-pose asset' });
    return reply.type(asset.mime).send(createReadStream(asset.path));
  });

  app.post('/api/dev/fighter-poses/runs/:runId/human-verdict', async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const body = req.body as { accepted?: unknown; notes?: unknown } | null;
    if (typeof body?.accepted !== 'boolean') {
      return reply.code(400).send({ error: 'accepted must be a boolean' });
    }
    const run = runs.get(runId);
    const dir = run?.dir ?? persistedRunDir(experimentsDir, runId);
    if (!dir) return reply.code(404).send({ error: 'unknown or expired fighter-pose run' });
    const verdict = {
      accepted: body.accepted,
      notes: typeof body.notes === 'string' ? cleanInput(body.notes) : '',
      at: nowIso(),
    };
    if (run) {
      run.humanVerdict = verdict;
      emit(run, {
        type: 'human-verdict',
        stage: 'complete',
        status: verdict.accepted ? 'complete' : 'rejected',
        message: verdict.accepted
          ? 'Human approved the fighter atlas'
          : 'Human rejected the fighter atlas',
        data: { humanVerdict: verdict },
      });
    } else {
      const manifest = readJson<Record<string, unknown>>(join(dir, 'manifest.json'), {});
      const events = readJson<FighterPoseLabEvent[]>(join(dir, 'events.json'), []);
      const event: FighterPoseLabEvent = {
        seq: events.length + 1,
        runId,
        at: verdict.at,
        type: 'human-verdict',
        stage: 'complete',
        status: verdict.accepted ? 'complete' : 'rejected',
        message: verdict.accepted
          ? 'Human approved the fighter atlas'
          : 'Human rejected the fighter atlas',
        data: { humanVerdict: verdict },
      };
      events.push(event);
      atomicWriteFile(join(dir, 'events.json'), `${JSON.stringify(events, null, 2)}\n`);
      atomicWriteFile(
        join(dir, 'manifest.json'),
        `${JSON.stringify({ ...manifest, humanVerdict: verdict, events }, null, 2)}\n`,
      );
    }
    atomicWriteFile(join(dir, 'human-verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);
    return { humanVerdict: verdict };
  });
}

async function executeRun(
  run: LabRun,
  source: Buffer,
  configStore: ConfigStore,
  options: DevFighterPoseOptions,
): Promise<void> {
  const config = configStore.get();
  const mock = process.env.SPARKADE_PROVIDER === 'mock';
  const imageConfig = config.imageGeneration;
  const imageModel = options.imageModel ?? (mock ? 'mock-image' : imageConfig.model);
  const judgeStage = stageProvider(config, 'design');
  const judgeModel = options.judgeModel ?? judgeStage.model;
  const judgeProvider = options.judgeProvider ?? (mock ? 'mock' : judgeStage.providerName);
  run.models = { imageModel, judgeModel, judgeProvider };
  const adapter =
    options.imageEdit || mock
      ? null
      : new MetaImageAdapter({
          baseUrl: imageConfig.baseUrl,
          model: imageModel,
          apiKeyEnv: imageConfig.apiKeyEnv,
          timeoutMs: imageConfig.timeoutMs,
          name: 'fighter-pose-lab',
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
  const judge = async (
    request: CompleteRequest,
    mockResponse: CompleteResponse,
  ): Promise<CompleteResponse> => {
    const response = options.judge
      ? await options.judge({ request, model: judgeModel, provider: judgeProvider })
      : mock
        ? mockResponse
        : await judgeStage.provider.complete(
            {
              ...request,
              jsonSchema: judgeStage.provider.capabilities.structuredOutput
                ? request.jsonSchema
                : undefined,
              timeoutMs: 120_000,
            },
            { model: judgeModel },
          );
    const cost = mock ? 0 : costOf(judgeModel, response.usage, config.pricing);
    const prior = run.judgeCalls === 0 ? 0 : run.judgeCostUsd;
    run.judgeCalls++;
    run.judgeCostUsd = prior === null || cost === null ? null : prior + cost;
    return response;
  };

  const generate = async (
    id: string,
    label: string,
    prompt: string,
    reference: Buffer,
    stage: FighterPoseLabStage,
    pose?: GeneratedFighterPose,
  ): Promise<LabAsset | null> => {
    const started = Date.now();
    emit(run, {
      type: 'stage',
      stage,
      status: 'started',
      message: `${label} generation started`,
      data: { id, label, pose, prompt },
    });
    let raw: Buffer;
    try {
      raw = (
        await edit({
          prompt,
          image: reference,
          imageMimeType: 'image/png',
          imageFilename: `${id}-reference.png`,
          outputFormat: 'png',
          size: '1024x1024',
          user: run.id,
        })
      ).image;
    } catch (error) {
      emit(run, {
        type: 'asset',
        stage,
        status: 'rejected',
        message: `${label} provider call failed`,
        elapsedMs: Date.now() - started,
        data: { id, label, pose, error: errorMessage(error) },
      });
      return null;
    }
    const rawUrl = saveAsset(run, `${id}-raw`, `raw/${id}.png`, raw, 'image/png');
    try {
      const processed = await processGeneratedFighterPose(raw, { removeGreenSpill: true });
      const processedUrl = saveAsset(
        run,
        `${id}-processed`,
        `processed/${id}.png`,
        processed.png,
        'image/png',
      );
      emit(run, {
        type: 'asset',
        stage,
        status: 'complete',
        message: `${label} generated and normalized`,
        elapsedMs: Date.now() - started,
        data: {
          id,
          label,
          pose,
          rawUrl,
          processedUrl,
          metrics: processed.metrics as unknown as Record<string, unknown>,
        },
      });
      return { id, pose, raw, processed: processed.png };
    } catch (error) {
      emit(run, {
        type: 'asset',
        stage,
        status: 'rejected',
        message: `${label} failed local normalization`,
        elapsedMs: Date.now() - started,
        data: { id, label, pose, rawUrl, error: errorMessage(error) },
      });
      return null;
    }
  };

  const generateSheet = async (
    group: FighterPoseSheetGroup,
    reference: Buffer,
  ): Promise<LabAsset[]> => {
    const id = `sheet-${group.id}`;
    const label = `${group.label} sheet`;
    const prompt = buildFighterPoseSheetPrompt(group, {
      outfit: run.inputs.visualConcept,
      colors: run.inputs.colors,
      candidateId: id,
    });
    const started = Date.now();
    emit(run, {
      type: 'stage',
      stage: 'poses',
      status: 'started',
      message: `${label} generation started`,
      data: { id, label, poses: group.poses, prompt, reasoningStrength: 'high' },
    });
    let raw: Buffer;
    try {
      raw = (
        await edit({
          prompt,
          image: reference,
          imageMimeType: 'image/png',
          imageFilename: 'fighter-pose-sheet-seed.png',
          outputFormat: 'png',
          size: '1024x1024',
          user: run.id,
          reasoningStrength: 'high',
        })
      ).image;
    } catch (error) {
      emit(run, {
        type: 'asset',
        stage: 'poses',
        status: 'rejected',
        message: `${label} provider call failed`,
        elapsedMs: Date.now() - started,
        data: { id, label, poses: group.poses, error: errorMessage(error) },
      });
      return [];
    }
    const rawUrl = saveAsset(run, `${id}-raw`, `raw/${id}.png`, raw, 'image/png');
    emit(run, {
      type: 'asset',
      stage: 'poses',
      status: 'complete',
      message: `${label} generated; splitting six fixed cells locally`,
      elapsedMs: Date.now() - started,
      data: { id, label, poses: group.poses, rawUrl },
    });

    let cells: FighterPoseSheetCellResult[];
    try {
      cells = await splitGeneratedFighterPoseSheet(raw, group);
    } catch (error) {
      emit(run, {
        type: 'asset',
        stage: 'poses',
        status: 'rejected',
        message: `${label} could not be decoded or split; recovering its poses individually`,
        elapsedMs: Date.now() - started,
        data: { id, label, poses: group.poses, rawUrl, error: errorMessage(error) },
      });
      return [];
    }
    const valid: LabAsset[] = [];
    for (const cell of cells) {
      const cellRawUrl = saveAsset(
        run,
        `${cell.id}-raw`,
        `raw/cells/${cell.id}.png`,
        cell.raw,
        'image/png',
      );
      if (!cell.processed) {
        emit(run, {
          type: 'asset',
          stage: 'poses',
          status: 'rejected',
          message: `${cell.pose} sheet cell failed local normalization`,
          data: {
            id: cell.id,
            label: `${cell.pose} sheet cell`,
            pose: cell.pose,
            rawUrl: cellRawUrl,
            rect: cell.rect as unknown as Record<string, unknown>,
            segmentation: cell.segmentation as unknown as Record<string, unknown>,
            error: cell.error,
          },
        });
        continue;
      }
      const processedUrl = saveAsset(
        run,
        `${cell.id}-processed`,
        `processed/${cell.id}.png`,
        cell.processed,
        'image/png',
      );
      const cleanup: string[] = [];
      if (cell.segmentation.excludedNeighborPixels > 0) {
        cleanup.push(`${cell.segmentation.excludedNeighborPixels} neighbor-owned pixels excluded`);
      }
      if (cell.segmentation.reclaimedBleedPixels > 0) {
        cleanup.push(`${cell.segmentation.reclaimedBleedPixels} owned bleed pixels reclaimed`);
      }
      if (cell.metrics?.discardedComponentCount && cell.metrics.discardedComponentCount > 0) {
        cleanup.push(
          `${cell.metrics.discardedComponentCount} leaked foreground island${cell.metrics.discardedComponentCount === 1 ? '' : 's'} removed`,
        );
      }
      emit(run, {
        type: 'asset',
        stage: 'poses',
        status: 'complete',
        message: cleanup.length
          ? `${cell.pose} sheet cell split and normalized; ${cleanup.join('; ')} locally`
          : `${cell.pose} sheet cell split and normalized locally`,
        data: {
          id: cell.id,
          label: `${cell.pose} sheet cell`,
          pose: cell.pose,
          rawUrl: cellRawUrl,
          processedUrl,
          rect: cell.rect as unknown as Record<string, unknown>,
          metrics: cell.metrics as unknown as Record<string, unknown>,
          segmentation: cell.segmentation as unknown as Record<string, unknown>,
          discardedComponentCount: cell.metrics?.discardedComponentCount ?? 0,
          reclaimedBleedPixels: cell.segmentation.reclaimedBleedPixels,
          excludedNeighborPixels: cell.segmentation.excludedNeighborPixels,
        },
      });
      valid.push({ id: cell.id, pose: cell.pose, raw: cell.raw, processed: cell.processed });
    }
    return valid;
  };

  emit(run, {
    type: 'stage',
    stage: 'foundations',
    status: 'started',
    message: 'Launching three fighter identity foundations in parallel',
    data: { candidateCount: 3 },
  });
  const foundations = (
    await Promise.all(
      [1, 2, 3].map((index) => {
        const id = `I${index}`;
        return generate(
          id,
          `Identity foundation ${id}`,
          buildFighterIdentityCandidatePrompt({
            candidateId: id,
            name: run.inputs.name,
            visualConcept: run.inputs.visualConcept,
            build: run.inputs.build,
            outfit: run.inputs.outfit,
            colors: run.inputs.colors,
            source: 'photo',
          }),
          source,
          'foundations',
          'idle',
        );
      }),
    )
  ).filter((asset): asset is LabAsset => asset !== null);
  if (foundations.length === 0) throw new Error('all identity foundations failed local validation');

  const identityDescriptors: FighterIdentityCandidateDescriptor[] = foundations.map(({ id }) => ({
    id,
    slot: 'player',
    name: run.inputs.name,
    visualConcept: run.inputs.visualConcept,
    photoIdentity: true,
  }));
  const identityBoard = await buildFighterIdentityJudgeBoard({
    sourcePhoto: source,
    candidates: foundations.map((asset) => ({
      ...identityDescriptors.find(({ id }) => id === asset.id)!,
      raw: asset.raw,
      processed: asset.processed,
    })),
  });
  const identityBoardUrl = saveAsset(
    run,
    'identity-judge-board',
    'identity-judge-board.jpg',
    identityBoard,
    'image/jpeg',
  );
  emit(run, {
    type: 'asset',
    stage: 'identity-judge',
    status: 'complete',
    message: 'Identity review board assembled locally',
    data: {
      id: 'identity-judge-board',
      label: 'Identity review board',
      processedUrl: identityBoardUrl,
    },
  });
  const identityPrompt = buildFighterIdentityJudgePrompt(identityDescriptors);
  const identityMock: CompleteResponse = {
    text: JSON.stringify({
      candidateReviews: identityDescriptors.map(({ id, slot }) => ({
        id,
        slot,
        scores: { identity: 5, concept: 5, costume: 5, silhouette: 5, technical: 5 },
        fatalIssues: [],
        summary: 'Mock identity-safe foundation.',
      })),
      selections: [
        {
          slot: 'player',
          accepted: true,
          candidateId: identityDescriptors[0]!.id,
          confidence: 1,
          rationale: 'Mock selection.',
          retryGuidance: '',
        },
      ],
      castReview: {
        distinctiveness: 5,
        styleConsistency: 5,
        fatalIssues: [],
        summary: 'Mock avatar.',
      },
    }),
    usage: { input: 900, output: 400 },
  };
  const identityResponse = await judge(
    {
      ...identityPrompt,
      image: identityBoard,
      jsonSchema: buildFighterIdentityJudgeSchema(identityDescriptors),
      maxTokens: 3000,
      temperature: 0,
      effort: 'low',
    },
    identityMock,
  );
  emit(run, {
    type: 'judge-response',
    stage: 'identity-judge',
    status: 'complete',
    message: `${judgeModel} returned identity scoring`,
    data: {
      raw: identityResponse.text,
      systemPrompt: identityPrompt.system,
      userPrompt: identityPrompt.user,
    },
  });
  const identityDecision = normalizeFighterIdentityJudgeDecision(
    parseModelJson(identityResponse.text),
    identityDescriptors,
  );
  run.identityDecision = identityDecision;
  const selectedFoundationId = bestFighterIdentityCandidateIds(identityDecision).player;
  const foundation = foundations.find(({ id }) => id === selectedFoundationId);
  if (!foundation) throw new Error('Spark did not select an identity foundation');
  emit(run, {
    type: 'selection',
    stage: 'identity-judge',
    status: identityDecision.selections[0]?.accepted ? 'complete' : 'rejected',
    message: `Spark selected ${foundation.id} as the downstream identity anchor`,
    data: {
      selectedId: foundation.id,
      decision: identityDecision as unknown as Record<string, unknown>,
    },
  });

  const anchor = await prepareGeneratedFighterReference(foundation.raw);
  const actionPoses = actionPosesFromSheets();
  let initial: LabAsset[];
  if (run.inputs.generationMode === 'sheets') {
    const sheetSeed = await buildFighterPoseSheetSeed(anchor);
    const sheetSeedUrl = saveAsset(
      run,
      'pose-sheet-seed',
      'pose-sheet-seed.png',
      sheetSeed,
      'image/png',
    );
    emit(run, {
      type: 'asset',
      stage: 'poses',
      status: 'complete',
      message: 'Deterministic 3×2 identity seed board assembled locally',
      data: {
        id: 'pose-sheet-seed',
        label: 'Pose sheet identity seed',
        processedUrl: sheetSeedUrl,
      },
    });
    initial = (
      await Promise.all(FIGHTER_POSE_SHEET_GROUPS.map((group) => generateSheet(group, sheetSeed)))
    ).flat();
    const missing = actionPoses.filter(
      (pose) => !initial.some((candidate) => candidate.pose === pose),
    );
    if (missing.length > 0) {
      emit(run, {
        type: 'stage',
        stage: 'retry',
        status: 'started',
        message: `Repairing ${missing.length} locally rejected sheet cells with up to two isolated attempts each`,
        data: { retryPoses: missing, reason: 'sheet-cell-normalization' },
      });
      const recoveries = await recoverRejectedFighterSheetCells(
        missing,
        (pose, suffix, guidance) =>
          generate(
            `${pose}-${suffix}`,
            `${pose} sheet-cell recovery ${suffix}`,
            buildFighterPosePrompt(pose, {
              outfit: run.inputs.visualConcept,
              colors: run.inputs.colors,
              candidateId: `${pose}-${suffix}`,
              retryGuidance: guidance,
            }),
            anchor,
            'retry',
            pose,
          ),
      );
      initial.push(...recoveries);
    }
  } else {
    initial = (
      await Promise.all(
        actionPoses.map(async (pose) => {
          const first = await generate(
            `${pose}-A`,
            `${pose} candidate A`,
            buildFighterPosePrompt(pose, {
              outfit: run.inputs.visualConcept,
              colors: run.inputs.colors,
              candidateId: `${pose}-A`,
            }),
            anchor,
            'poses',
            pose,
          );
          return (
            first ??
            generate(
              `${pose}-A2`,
              `${pose} recovery candidate`,
              buildFighterPosePrompt(pose, {
                outfit: run.inputs.visualConcept,
                colors: run.inputs.colors,
                candidateId: `${pose}-A2`,
                retryGuidance:
                  'Return one complete uncropped silhouette on uniform #00ff00 and make the requested pose unmistakable.',
              }),
              anchor,
              'poses',
              pose,
            )
          );
        }),
      )
    ).filter((asset): asset is LabAsset => asset !== null);
  }
  if (initial.length !== actionPoses.length)
    throw new Error('one or more action poses failed locally');

  const review = async (
    pool: readonly LabAsset[],
    round: number,
  ): Promise<FighterPoseJudgeDecision> => {
    const descriptors: FighterPoseCandidateDescriptor[] = pool.map(({ id, pose }) => ({
      id,
      pose: pose!,
    }));
    const board = await buildFighterPoseJudgeBoard({
      fighterName: run.inputs.name,
      anchor: foundation.processed,
      candidates: pool.map(({ id, pose, processed }) => ({ id, pose: pose!, processed })),
    });
    const boardId = `pose-judge-board-${round}`;
    const boardUrl = saveAsset(run, boardId, `${boardId}.jpg`, board, 'image/jpeg');
    emit(run, {
      type: 'asset',
      stage: 'pose-judge',
      status: 'complete',
      message: `Pose review board ${round} assembled locally`,
      data: { id: boardId, label: `Pose review board ${round}`, processedUrl: boardUrl },
    });
    const prompt = buildFighterPoseJudgePrompt(run.inputs.name, descriptors, actionPoses);
    const firstByPose = Object.fromEntries(
      actionPoses.map((pose) => [pose, descriptors.find((candidate) => candidate.pose === pose)!]),
    ) as Record<GeneratedFighterPose, FighterPoseCandidateDescriptor>;
    const mockResponse: CompleteResponse = {
      text: JSON.stringify({
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
          summary: 'Mock complete set.',
        },
        retryPoses: [],
      }),
      usage: { input: 1500, output: 650 },
    };
    const response = await judge(
      {
        ...prompt,
        image: board,
        jsonSchema: buildFighterPoseJudgeSchema(descriptors, actionPoses),
        maxTokens: 6200,
        temperature: 0,
        effort: 'low',
      },
      mockResponse,
    );
    emit(run, {
      type: 'judge-response',
      stage: 'pose-judge',
      status: 'complete',
      message: `${judgeModel} returned pose-set scoring round ${round}`,
      data: { raw: response.text, systemPrompt: prompt.system, userPrompt: prompt.user, round },
    });
    return normalizeFighterPoseJudgeDecision(
      parseModelJson(response.text),
      descriptors,
      actionPoses,
    );
  };

  const candidates = [...initial];
  let poseDecision = await review(candidates, 1);
  if (!poseDecision.setReview.accepted) {
    const retryPoses = fighterPosesNeedingRetry(poseDecision, actionPoses, MAX_RETRY_POSES);
    emit(run, {
      type: 'stage',
      stage: 'retry',
      status: retryPoses.length ? 'started' : 'rejected',
      message: retryPoses.length
        ? `Generating two Spark-guided alternatives for ${retryPoses.length} weak poses`
        : 'Spark rejected the set without requesting a useful retry',
      data: { retryPoses },
    });
    const alternatives = (
      await Promise.all(
        retryPoses.flatMap(({ pose, guidance }) =>
          ['B', 'C'].map((suffix) =>
            generate(
              `${pose}-${suffix}`,
              `${pose} retry ${suffix}`,
              buildFighterPosePrompt(pose, {
                outfit: run.inputs.visualConcept,
                colors: run.inputs.colors,
                candidateId: `${pose}-${suffix}`,
                retryGuidance: guidance,
              }),
              anchor,
              'retry',
              pose,
            ),
          ),
        ),
      )
    ).filter((asset): asset is LabAsset => asset !== null);
    candidates.push(...alternatives);
    if (alternatives.length > 0) poseDecision = await review(candidates, 2);
  }
  run.poseDecision = poseDecision;
  const selectedIds = bestFighterPoseCandidateIds(poseDecision, actionPoses);
  const selected = { idle: foundation.processed } as Record<GeneratedFighterPose, Buffer>;
  for (const pose of actionPoses) {
    const asset = candidates.find(
      (candidate) => candidate.pose === pose && candidate.id === selectedIds[pose],
    );
    if (!asset) throw new Error(`Spark did not select ${pose}`);
    selected[pose] = asset.processed;
  }
  const atlas = await buildGeneratedFighterAtlas(selected);
  await validateGeneratedFighterAtlas(atlas);
  const atlasUrl = saveAsset(run, 'atlas', 'fighter-atlas.png', atlas, 'image/png');
  emit(run, {
    type: 'selection',
    stage: 'atlas',
    status: poseDecision.setReview.accepted ? 'complete' : 'rejected',
    message: poseDecision.setReview.accepted
      ? 'Spark accepted the complete pose combination'
      : 'Atlas uses Spark’s best locally valid combination after the bounded retry',
    data: { selectedIds, decision: poseDecision as unknown as Record<string, unknown>, atlasUrl },
  });
  emit(run, {
    type: 'asset',
    stage: 'atlas',
    status: 'complete',
    message: 'Final 13-state runtime atlas packed locally',
    data: { id: 'atlas', label: 'Final fighter atlas', processedUrl: atlasUrl },
  });

  run.status = 'done';
  emit(run, {
    type: 'done',
    stage: 'complete',
    status: 'complete',
    message: 'Fighter pose experiment completed',
    data: {
      generationMode: run.inputs.generationMode,
      imageCalls: run.imageCalls,
      imageCostUsd: run.imageCostUsd,
      judgeCostUsd: run.judgeCostUsd,
    },
  });
}

function emit(
  run: LabRun,
  event: Omit<FighterPoseLabEvent, 'seq' | 'runId' | 'at'>,
): FighterPoseLabEvent {
  const complete: FighterPoseLabEvent = {
    seq: run.events.length + 1,
    runId: run.id,
    at: nowIso(),
    ...event,
  };
  run.events.push(complete);
  for (const listener of run.listeners) listener(complete);
  writeRunFiles(run);
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
  });
}

function saveAsset(
  run: LabRun,
  id: string,
  filename: string,
  contents: Buffer,
  mime: string,
): string {
  const path = join(run.dir, filename);
  atomicWriteFile(path, contents);
  run.assets.set(id, { path, filename, mime });
  writeRunFiles(run);
  return assetUrl(run.id, id);
}

function assetUrl(runId: string, assetId: string): string {
  return `/api/dev/fighter-poses/runs/${encodeURIComponent(runId)}/assets/${encodeURIComponent(assetId)}`;
}

function statusOf(run: LabRun) {
  return {
    runId: run.id,
    status: run.status,
    generationMode: run.inputs.generationMode,
    events: run.events,
    imageCalls: run.imageCalls,
    imageCostUsd: run.imageCostUsd,
    judgeCalls: run.judgeCalls,
    judgeCostUsd: run.judgeCostUsd,
    identityDecision: run.identityDecision,
    poseDecision: run.poseDecision,
    humanVerdict: run.humanVerdict,
    error: run.error,
  };
}

function writeRunFiles(run: LabRun): void {
  atomicWriteFile(join(run.dir, 'events.json'), `${JSON.stringify(run.events, null, 2)}\n`);
  atomicWriteFile(
    join(run.dir, 'manifest.json'),
    `${JSON.stringify(
      {
        ...statusOf(run),
        createdAt: run.createdAt,
        inputs: run.inputs,
        promptVersions: {
          pose: GENERATED_FIGHTER_POSE_PROMPT_VERSION,
          poseSheet: FIGHTER_POSE_SHEET_PROMPT_VERSION,
          atlas: GENERATED_FIGHTER_ATLAS_PROMPT_VERSION,
          identityJudge: FIGHTER_IDENTITY_JUDGE_PROMPT_VERSION,
          poseJudge: FIGHTER_POSE_JUDGE_PROMPT_VERSION,
        },
        models: run.models,
        assets: Object.fromEntries(
          [...run.assets.entries()].map(([id, asset]) => [
            id,
            { filename: asset.filename, mime: asset.mime },
          ]),
        ),
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

function readPersistedStatus(experimentsDir: string, runId: string) {
  const dir = persistedRunDir(experimentsDir, runId);
  if (!dir) return null;
  const manifest = readJson<Record<string, unknown>>(join(dir, 'manifest.json'), {});
  const inputs =
    manifest.inputs && typeof manifest.inputs === 'object'
      ? (manifest.inputs as Record<string, unknown>)
      : {};
  return {
    runId,
    status:
      manifest.status === 'failed' || manifest.status === 'running' ? manifest.status : 'done',
    generationMode: inputs.generationMode === 'individual' ? 'individual' : 'sheets',
    events: readJson<FighterPoseLabEvent[]>(join(dir, 'events.json'), []),
    imageCalls: typeof manifest.imageCalls === 'number' ? manifest.imageCalls : 0,
    imageCostUsd: typeof manifest.imageCostUsd === 'number' ? manifest.imageCostUsd : 0,
    judgeCalls: typeof manifest.judgeCalls === 'number' ? manifest.judgeCalls : 0,
    judgeCostUsd: typeof manifest.judgeCostUsd === 'number' ? manifest.judgeCostUsd : null,
    identityDecision: manifest.identityDecision,
    poseDecision: manifest.poseDecision,
    humanVerdict: manifest.humanVerdict,
    error: typeof manifest.error === 'string' ? manifest.error : undefined,
  };
}

function persistedAsset(
  experimentsDir: string,
  runId: string,
  assetId: string,
): { path: string; filename: string; mime: string } | null {
  if (!/^[A-Za-z0-9-]+$/.test(assetId)) return null;
  const dir = persistedRunDir(experimentsDir, runId);
  if (!dir) return null;
  const manifest = readJson<Record<string, unknown>>(join(dir, 'manifest.json'), {});
  const assets =
    manifest.assets && typeof manifest.assets === 'object'
      ? (manifest.assets as Record<string, unknown>)
      : {};
  const entry = assets[assetId];
  if (!entry || typeof entry !== 'object') return null;
  const filename = (entry as Record<string, unknown>).filename;
  const mime = (entry as Record<string, unknown>).mime;
  if (
    typeof filename !== 'string' ||
    !/^[A-Za-z0-9/_-]+\.(png|jpg)$/.test(filename) ||
    (mime !== 'image/png' && mime !== 'image/jpeg')
  ) {
    return null;
  }
  const path = join(dir, filename);
  return existsSync(path) ? { path, filename, mime } : null;
}

function readJson<T>(path: string, fallback: T): T {
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
