import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerDevPlatformerPoseRoutes } from '../src/api/dev-platformer-poses';
import { mockGeneratedImage } from '../src/assets/game-art';
import { ConfigStore } from '../src/storage/config';
import type { PlatformerPoseLabJudgeInput } from '../src/api/dev-platformer-poses';

describe('dev platformer poses lab', () => {
  let app: ReturnType<typeof Fastify>;
  let dir: string;
  let imagePrompts: string[];
  let judgeInputs: PlatformerPoseLabJudgeInput[];
  let rejectFirstIdleBatch: boolean;
  let idleJudgeCalls: number;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sparkade-platformer-poses-'));
    imagePrompts = [];
    judgeInputs = [];
    rejectFirstIdleBatch = false;
    idleJudgeCalls = 0;
    app = Fastify();
    await app.register(multipart);
    registerDevPlatformerPoseRoutes(app, new ConfigStore(dir), dir, {
      imageModel: 'muse-image-lab-test',
      judgeModel: 'muse-spark-lab-test',
      judgeProvider: 'meta-test',
      imageEdit: async (request) => {
        imagePrompts.push(request.prompt);
        return {
          image: await mockGeneratedImage(request.prompt),
          usage: { generated_images: 1 },
          outputFormat: 'png',
          imageCount: 1,
        };
      },
      judge: async (input) => {
        judgeInputs.push(input);
        if (input.request.system.includes('front-idle identity-foundation review board')) {
          idleJudgeCalls++;
          const candidateIds = input.request.user.match(/I\d+/g) ?? [];
          const reject = rejectFirstIdleBatch && idleJudgeCalls === 1;
          return {
            text: JSON.stringify({
              sourceReview: {
                eyewear: 'absent',
                summary: 'same mock adult without eyewear',
              },
              candidateReviews: candidateIds.map((id) => ({
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
                summary: `${id} preserves the source identity`,
              })),
              selection: {
                accepted: !reject,
                candidateId: reject ? '' : (candidateIds[1] ?? candidateIds[0] ?? ''),
                confidence: 0.96,
                rationale: reject
                  ? 'the first mock batch has eye artifacts'
                  : 'best mock identity foundation',
                retryGuidance: reject ? 'remove the invented dark frames around the eyes' : '',
              },
            }),
            usage: { input: 900, output: 350 },
          };
        }
        const reviews = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'].map((id) => ({
          id,
          kind: id.startsWith('A') ? 'phase-a' : 'phase-b',
          scores: { identity: 5, costume: 5, pose: 5, technical: 5 },
          fatalIssues: [],
          summary: `${id} passes`,
        }));
        return {
          text: JSON.stringify({
            anchorReview: {
              identity: 5,
              sideView: 5,
              costume: 5,
              fatalIssues: [],
              summary: 'same mock character',
            },
            candidateReviews: reviews,
            pairReviews: ['A1', 'A2', 'A3'].flatMap((phaseAId) =>
              ['B1', 'B2', 'B3'].map((phaseBId) => ({
                phaseAId,
                phaseBId,
                legAlternation: 5,
                armAlternation: phaseAId === 'A2' && phaseBId === 'B3' ? 4 : 3,
                pairConsistency: 5,
                fatalIssues: [],
                summary: `${phaseAId} + ${phaseBId} passes`,
              })),
            ),
            selection: {
              accepted: true,
              phaseAId: 'A2',
              phaseBId: 'B3',
              confidence: 0.94,
              rationale: 'best mock pair',
              retryGuidance: '',
            },
          }),
          usage: { input: 1500, output: 600 },
        };
      },
    });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('streams and persists every generation, Spark score, and selected pair', async () => {
    const photo = await sharp({
      create: { width: 180, height: 240, channels: 3, background: '#8b5d42' },
    })
      .jpeg()
      .toBuffer();
    const { boundary, payload } = multipartBody(
      {
        heroConcept: 'dark shirt and tan pants',
        colors: '#202538, #c88d52',
      },
      photo,
    );
    const started = await app.inject({
      method: 'POST',
      url: '/api/dev/platformer-poses/runs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(started.statusCode).toBe(202);
    const runId = (started.json() as { runId: string }).runId;
    const status = await waitForTerminal(app, runId);

    expect(status.status).toBe('done');
    expect(imagePrompts).toHaveLength(10);
    expect(imagePrompts.filter((prompt) => prompt.includes('FRONT-FACING idle pose'))).toHaveLength(
      3,
    );
    expect(imagePrompts.filter((prompt) => prompt.includes('neutral standing pose'))).toHaveLength(
      1,
    );
    expect(imagePrompts.filter((prompt) => prompt.includes('run-cycle PHASE A'))).toHaveLength(3);
    expect(imagePrompts.filter((prompt) => prompt.includes('run-cycle PHASE B'))).toHaveLength(3);
    expect(imagePrompts.filter((prompt) => prompt.includes('CAMERA-SIDE (near) LEG'))).toHaveLength(
      6,
    );
    expect(judgeInputs).toHaveLength(2);
    expect(judgeInputs[0]?.request.image).toBeInstanceOf(Buffer);
    await expect(sharp(judgeInputs[0]!.request.image!).metadata()).resolves.toMatchObject({
      width: 1760,
      height: 1180,
      format: 'jpeg',
    });
    expect(judgeInputs[0]?.request.system).toContain('SOURCE PHOTO is the only identity truth');
    expect(judgeInputs[0]?.request.system).toContain('wrinkles');
    expect(judgeInputs[1]?.request.image).toBeInstanceOf(Buffer);
    await expect(sharp(judgeInputs[1]!.request.image!).metadata()).resolves.toMatchObject({
      width: 1720,
      height: 1420,
      format: 'jpeg',
    });
    expect(judgeInputs[1]?.request.system).toContain('SOURCE PHOTO is identity truth');
    expect(judgeInputs[1]?.request.system).toContain('every labeled A+B comparison cell');
    expect(status.events.some((event) => event.type === 'idle-judge-response')).toBe(true);
    expect(status.events.find((event) => event.type === 'idle-selection')?.data).toMatchObject({
      decision: { selection: { accepted: true, candidateId: 'I2' } },
    });
    expect(status.events.some((event) => event.type === 'judge-response')).toBe(true);
    expect(status.events.find((event) => event.type === 'selection')?.data).toMatchObject({
      decision: {
        selection: {
          accepted: true,
          phaseAId: 'A2',
          phaseBId: 'B3',
          legAlternation: 5,
        },
      },
    });
    expect(status.events.at(-1)).toMatchObject({ type: 'done', status: 'complete' });

    const experimentDir = join(dir, 'experiments', 'platformer-poses', runId);
    expect(existsSync(join(experimentDir, 'source.png'))).toBe(true);
    expect(existsSync(join(experimentDir, 'raw', 'I2.png'))).toBe(true);
    expect(existsSync(join(experimentDir, 'raw', 'A1.png'))).toBe(true);
    expect(existsSync(join(experimentDir, 'processed', 'B3.png'))).toBe(true);
    expect(existsSync(join(experimentDir, 'idle-judge-board-1.jpg'))).toBe(true);
    expect(existsSync(join(experimentDir, 'judge-board.jpg'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(experimentDir, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({
      status: 'done',
      models: { imageModel: 'muse-image-lab-test', judgeModel: 'muse-spark-lab-test' },
      usage: { imageCalls: 10, judgeCalls: 2 },
      idleDecision: { selection: { candidateId: 'I2' } },
      decision: { selection: { phaseAId: 'A2', phaseBId: 'B3', legAlternation: 5 } },
    });

    const verdictResponse = await app.inject({
      method: 'POST',
      url: `/api/dev/platformer-poses/runs/${encodeURIComponent(runId)}/human-verdict`,
      payload: {
        accepted: true,
        phaseAId: 'A1',
        phaseBId: 'B3',
        notes: 'Legs and arms both visibly reverse.',
      },
    });
    expect(verdictResponse.statusCode).toBe(200);
    expect(verdictResponse.json()).toMatchObject({
      humanVerdict: { accepted: true, phaseAId: 'A1', phaseBId: 'B3' },
      event: { type: 'human-verdict', status: 'complete' },
    });
    expect(existsSync(join(experimentDir, 'human-verdict.json'))).toBe(true);
    const updatedManifest = JSON.parse(readFileSync(join(experimentDir, 'manifest.json'), 'utf8'));
    expect(updatedManifest).toMatchObject({
      models: { imageModel: 'muse-image-lab-test', judgeModel: 'muse-spark-lab-test' },
      humanVerdict: { accepted: true, phaseAId: 'A1', phaseBId: 'B3' },
    });
    expect(updatedManifest.events.at(-1)).toMatchObject({
      type: 'human-verdict',
      message: 'Human selected A1 + B3',
    });

    const restoredApp = Fastify();
    await restoredApp.register(multipart);
    registerDevPlatformerPoseRoutes(restoredApp, new ConfigStore(dir), dir);
    const restoredStatus = await restoredApp.inject({
      method: 'GET',
      url: `/api/dev/platformer-poses/runs/${encodeURIComponent(runId)}`,
    });
    expect(restoredStatus.statusCode).toBe(200);
    expect(restoredStatus.json()).toMatchObject({
      status: 'done',
      humanVerdict: { accepted: true, phaseAId: 'A1', phaseBId: 'B3' },
    });
    const restoredBoard = await restoredApp.inject({
      method: 'GET',
      url: `/api/dev/platformer-poses/runs/${encodeURIComponent(runId)}/assets/judge-board`,
    });
    expect(restoredBoard.statusCode).toBe(200);
    expect(restoredBoard.headers['content-type']).toBe('image/jpeg');
    await restoredApp.close();
  }, 30_000);

  it('runs one bounded idle retry batch using Spark guidance', async () => {
    rejectFirstIdleBatch = true;
    const photo = await sharp({
      create: { width: 180, height: 240, channels: 3, background: '#8b5d42' },
    })
      .jpeg()
      .toBuffer();
    const { boundary, payload } = multipartBody({}, photo);
    const started = await app.inject({
      method: 'POST',
      url: '/api/dev/platformer-poses/runs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    const runId = (started.json() as { runId: string }).runId;
    const status = await waitForTerminal(app, runId);

    expect(status.status).toBe('done');
    expect(imagePrompts).toHaveLength(13);
    expect(
      imagePrompts.filter((prompt) => prompt.includes('RETRY CORRECTION FROM THE ART DIRECTOR')),
    ).toHaveLength(3);
    expect(imagePrompts.find((prompt) => prompt.includes('labeled I4'))).toContain(
      'remove the invented dark frames around the eyes',
    );
    expect(judgeInputs).toHaveLength(3);
    const idleSelections = status.events.filter((event) => event.type === 'idle-selection');
    expect(idleSelections).toHaveLength(2);
    expect(idleSelections[0]).toMatchObject({ status: 'rejected' });
    expect(idleSelections[1]?.data).toMatchObject({
      decision: { selection: { accepted: true, candidateId: 'I5' } },
    });
    const experimentDir = join(dir, 'experiments', 'platformer-poses', runId);
    expect(existsSync(join(experimentDir, 'idle-judge-board-2.jpg'))).toBe(true);
  }, 30_000);
});

async function waitForTerminal(
  app: ReturnType<typeof Fastify>,
  runId: string,
): Promise<{
  status: string;
  events: Array<{ type: string; status: string; data?: Record<string, unknown> }>;
}> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/dev/platformer-poses/runs/${encodeURIComponent(runId)}`,
    });
    const body = response.json() as {
      status: string;
      events: Array<{ type: string; status: string; data?: Record<string, unknown> }>;
    };
    if (body.status !== 'running') return body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('pose lab did not reach a terminal state');
}

function multipartBody(
  fields: Record<string, string>,
  photo: Buffer,
): {
  boundary: string;
  payload: Buffer;
} {
  const boundary = 'sparkade-platformer-pose-lab-boundary';
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="player.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ),
    photo,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { boundary, payload: Buffer.concat(chunks) };
}
