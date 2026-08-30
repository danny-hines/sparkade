import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  registerDevFighterPoseRoutes,
  type FighterPoseLabJudgeInput,
} from '../src/api/dev-fighter-poses';
import { GENERATED_FIGHTER_POSES } from '../src/assets/fighter-pose';
import { fighterPoseSheetCellRect } from '../src/assets/fighter-pose-sheet';
import { mockGeneratedImage } from '../src/assets/game-art';
import type { MetaImageEditRequest } from '../src/providers/meta-image';
import { ConfigStore } from '../src/storage/config';

const ACTION_POSES = GENERATED_FIGHTER_POSES.filter((pose) => pose !== 'idle');

describe('dev fighter poses lab', () => {
  let app: ReturnType<typeof Fastify>;
  let dir: string;
  let imagePrompts: string[];
  let imageRequests: MetaImageEditRequest[];
  let judgeInputs: FighterPoseLabJudgeInput[];
  let rejectFirstPoseReview: boolean;
  let damageOneSheetCell: boolean;
  let leakOneSheetCell: boolean;
  let poseJudgeCalls: number;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sparkade-fighter-poses-'));
    imagePrompts = [];
    imageRequests = [];
    judgeInputs = [];
    rejectFirstPoseReview = false;
    damageOneSheetCell = false;
    leakOneSheetCell = false;
    poseJudgeCalls = 0;
    app = Fastify();
    await app.register(multipart);
    registerDevFighterPoseRoutes(app, new ConfigStore(dir), dir, {
      imageModel: 'muse-image-fighter-lab-test',
      judgeModel: 'muse-spark-fighter-lab-test',
      judgeProvider: 'meta-test',
      imageEdit: async (request) => {
        imageRequests.push(request);
        imagePrompts.push(request.prompt);
        let image = await mockGeneratedImage(request.prompt);
        if (
          damageOneSheetCell &&
          request.prompt.includes('FIGHTER POSE SHEET CONTRACT: mobility')
        ) {
          damageOneSheetCell = false;
          const rect = fighterPoseSheetCellRect(0);
          const blank = await sharp({
            create: {
              width: rect.width,
              height: rect.height,
              channels: 4,
              background: { r: 0, g: 255, b: 0, alpha: 1 },
            },
          })
            .png()
            .toBuffer();
          image = await sharp(image)
            .composite([{ input: blank, left: rect.left, top: rect.top }])
            .png()
            .toBuffer();
        }
        if (leakOneSheetCell && request.prompt.includes('FIGHTER POSE SHEET CONTRACT: mobility')) {
          leakOneSheetCell = false;
          const rect = fighterPoseSheetCellRect(0);
          const artifact = await sharp({
            create: {
              width: 20,
              height: 80,
              channels: 4,
              background: { r: 225, g: 55, b: 180, alpha: 1 },
            },
          })
            .png()
            .toBuffer();
          image = await sharp(image)
            .composite([
              {
                input: artifact,
                left: rect.left + rect.width - 20,
                top: rect.top + 200,
              },
            ])
            .png()
            .toBuffer();
        }
        return {
          image,
          usage: { generated_images: 1 },
          outputFormat: 'png',
          imageCount: 1,
        };
      },
      judge: async (input) => {
        judgeInputs.push(input);
        if (input.request.system.includes('roster art director')) {
          return {
            text: JSON.stringify({
              candidateReviews: ['I1', 'I2', 'I3'].map((id) => ({
                id,
                slot: 'player',
                scores: { identity: 5, concept: 5, costume: 5, silhouette: 5, technical: 5 },
                fatalIssues: [],
                summary: `${id} preserves the photographed person`,
              })),
              selections: [
                {
                  slot: 'player',
                  accepted: true,
                  candidateId: 'I2',
                  confidence: 0.97,
                  rationale: 'Best likeness and costume construction.',
                  retryGuidance: '',
                },
              ],
              castReview: {
                distinctiveness: 5,
                styleConsistency: 5,
                fatalIssues: [],
                summary: 'One strong photographed avatar.',
              },
            }),
            usage: { input: 900, output: 400 },
          };
        }

        poseJudgeCalls++;
        const posePattern = ACTION_POSES.join('|');
        const candidates = [
          ...input.request.user.matchAll(new RegExp(`([A-Za-z0-9-]+)=(${posePattern})`, 'g')),
        ].map((match) => ({ id: match[1]!, pose: match[2]! }));
        const rejected = rejectFirstPoseReview && poseJudgeCalls === 1;
        return {
          text: JSON.stringify({
            candidateReviews: candidates.map(({ id, pose }) => ({
              id,
              pose,
              scores: {
                identity: 5,
                costume: 5,
                pose: rejected && pose === 'airKick' ? 2 : 5,
                technical: 5,
              },
              fatalIssues:
                rejected && pose === 'airKick' ? ['The attack does not read airborne.'] : [],
              summary:
                rejected && pose === 'airKick'
                  ? 'Keep both feet off the floor and extend the front leg.'
                  : `${pose} remains the same fighter`,
            })),
            selections: ACTION_POSES.map((pose) => {
              const matching = candidates.filter((candidate) => candidate.pose === pose);
              return {
                pose,
                candidateId: matching.at(-1)?.id ?? '',
                rationale: 'Strongest readable state.',
              };
            }),
            setReview: {
              accepted: !rejected,
              identityConsistency: 5,
              costumeConsistency: 5,
              scaleConsistency: 5,
              poseReadability: rejected ? 3 : 5,
              fatalIssues: rejected ? ['airKick is grounded.'] : [],
              summary: rejected
                ? 'Retry only the air kick.'
                : 'Complete identity-consistent combat set.',
            },
            retryPoses: rejected
              ? [
                  {
                    pose: 'airKick',
                    guidance:
                      'Keep both feet clearly airborne and extend the front leg at chest height.',
                  },
                ]
              : [],
          }),
          usage: { input: 1500, output: 650 },
        };
      },
    });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists identity candidates, Spark evidence, every combat state, and the final atlas', async () => {
    const photo = await sharp({
      create: { width: 180, height: 240, channels: 3, background: '#8b5d42' },
    })
      .jpeg()
      .toBuffer();
    const { boundary, payload } = multipartBody(
      {
        name: 'MICA',
        visualConcept:
          'A compact rooftop boxer in a cropped indigo jacket, brass wrist wraps, cream trousers, and red high-top shoes.',
        build: 'nimble',
        outfit: 'boxer',
        colors: '#334d8f, #d69d41, #f1e5c7',
      },
      photo,
    );
    const started = await app.inject({
      method: 'POST',
      url: '/api/dev/fighter-poses/runs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(started.statusCode).toBe(202);
    const runId = (started.json() as { runId: string }).runId;
    const status = await waitForTerminal(app, runId);

    expect(status.status).toBe('done');
    expect(status.generationMode).toBe('sheets');
    expect(imagePrompts).toHaveLength(5);
    expect(
      imagePrompts.filter((prompt) => prompt.includes('identity-foundation sprite')),
    ).toHaveLength(3);
    expect(
      imagePrompts.filter((prompt) => prompt.includes('FIGHTER POSE SHEET CONTRACT:')),
    ).toHaveLength(2);
    expect(imagePrompts.filter((prompt) => prompt.includes('jumping punch'))).toHaveLength(1);
    expect(imagePrompts.filter((prompt) => prompt.includes('jumping kick'))).toHaveLength(1);
    expect(
      imageRequests
        .filter(({ prompt }) => prompt.includes('FIGHTER POSE SHEET CONTRACT:'))
        .every(({ reasoningStrength }) => reasoningStrength === 'high'),
    ).toBe(true);
    expect(judgeInputs).toHaveLength(2);
    expect(judgeInputs.every((input) => input.request.image instanceof Buffer)).toBe(true);
    expect(status.identityDecision?.selections[0]).toMatchObject({
      accepted: true,
      candidateId: 'I2',
    });
    expect(status.poseDecision?.setReview).toMatchObject({ accepted: true });
    expect(
      status.events.find((event) => event.stage === 'atlas' && event.type === 'asset'),
    ).toBeTruthy();
    expect(status.events.at(-1)).toMatchObject({ type: 'done', status: 'complete' });

    const experimentDir = join(dir, 'experiments', 'fighter-poses', runId);
    expect(existsSync(join(experimentDir, 'source.png'))).toBe(true);
    expect(existsSync(join(experimentDir, 'raw', 'I2.png'))).toBe(true);
    expect(existsSync(join(experimentDir, 'pose-sheet-seed.png'))).toBe(true);
    expect(existsSync(join(experimentDir, 'raw', 'sheet-mobility.png'))).toBe(true);
    expect(existsSync(join(experimentDir, 'raw', 'sheet-attacks.png'))).toBe(true);
    expect(existsSync(join(experimentDir, 'processed', 'airKick-S.png'))).toBe(true);
    expect(existsSync(join(experimentDir, 'identity-judge-board.jpg'))).toBe(true);
    expect(existsSync(join(experimentDir, 'pose-judge-board-1.jpg'))).toBe(true);
    const atlasPath = join(experimentDir, 'fighter-atlas.png');
    await expect(sharp(atlasPath).metadata()).resolves.toMatchObject({
      format: 'png',
      width: 384,
      height: 384,
    });

    const manifest = JSON.parse(readFileSync(join(experimentDir, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({
      status: 'done',
      inputs: { name: 'MICA', build: 'nimble', outfit: 'boxer', generationMode: 'sheets' },
      imageCalls: 5,
      judgeCalls: 2,
      models: {
        imageModel: 'muse-image-fighter-lab-test',
        judgeModel: 'muse-spark-fighter-lab-test',
      },
      identityDecision: { selections: [{ candidateId: 'I2' }] },
      poseDecision: { setReview: { accepted: true } },
    });

    const atlasResponse = await app.inject({
      method: 'GET',
      url: `/api/dev/fighter-poses/runs/${encodeURIComponent(runId)}/assets/atlas`,
    });
    expect(atlasResponse.statusCode).toBe(200);
    expect(atlasResponse.headers['content-type']).toBe('image/png');

    const verdict = await app.inject({
      method: 'POST',
      url: `/api/dev/fighter-poses/runs/${encodeURIComponent(runId)}/human-verdict`,
      payload: { accepted: true, notes: 'Identity and costume remain stable across attacks.' },
    });
    expect(verdict.statusCode).toBe(200);
    expect(verdict.json()).toMatchObject({ humanVerdict: { accepted: true } });
    expect(existsSync(join(experimentDir, 'human-verdict.json'))).toBe(true);

    const restoredApp = Fastify();
    await restoredApp.register(multipart);
    registerDevFighterPoseRoutes(restoredApp, new ConfigStore(dir), dir);
    const restored = await restoredApp.inject({
      method: 'GET',
      url: `/api/dev/fighter-poses/runs/${encodeURIComponent(runId)}`,
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      status: 'done',
      humanVerdict: { accepted: true },
    });
    await restoredApp.close();
  }, 30_000);

  it('bounds Spark-guided retries to the rejected pose and reviews the expanded pool again', async () => {
    rejectFirstPoseReview = true;
    const photo = await sharp({
      create: { width: 180, height: 240, channels: 3, background: '#8b5d42' },
    })
      .jpeg()
      .toBuffer();
    const { boundary, payload } = multipartBody({}, photo);
    const started = await app.inject({
      method: 'POST',
      url: '/api/dev/fighter-poses/runs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    const runId = (started.json() as { runId: string }).runId;
    const status = await waitForTerminal(app, runId);

    expect(status.status).toBe('done');
    expect(imagePrompts).toHaveLength(7);
    expect(
      imagePrompts.filter((prompt) =>
        prompt.includes(
          'Keep both feet clearly airborne and extend the front leg at chest height.',
        ),
      ),
    ).toHaveLength(2);
    expect(judgeInputs).toHaveLength(3);
    expect(poseJudgeCalls).toBe(2);
    expect(status.poseDecision?.setReview).toMatchObject({ accepted: true });
    expect(
      status.events.filter(
        (event) => event.stage === 'pose-judge' && event.type === 'judge-response',
      ),
    ).toHaveLength(2);
    expect(
      existsSync(join(dir, 'experiments', 'fighter-poses', runId, 'processed', 'airKick-B.png')),
    ).toBe(true);
    expect(
      existsSync(join(dir, 'experiments', 'fighter-poses', runId, 'processed', 'airKick-C.png')),
    ).toBe(true);
  }, 30_000);

  it('recovers only a locally invalid sheet cell as an isolated pose', async () => {
    damageOneSheetCell = true;
    const photo = await sharp({
      create: { width: 180, height: 240, channels: 3, background: '#8b5d42' },
    })
      .jpeg()
      .toBuffer();
    const { boundary, payload } = multipartBody({}, photo);
    const started = await app.inject({
      method: 'POST',
      url: '/api/dev/fighter-poses/runs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    const runId = (started.json() as { runId: string }).runId;
    const status = await waitForTerminal(app, runId);

    expect(status.status).toBe('done');
    expect(imagePrompts).toHaveLength(6);
    expect(
      imagePrompts.filter((prompt) =>
        prompt.includes('The grouped sheet cell failed deterministic extraction.'),
      ),
    ).toHaveLength(1);
    expect(status.events).toContainEqual(
      expect.objectContaining({ type: 'asset', stage: 'poses', status: 'rejected' }),
    );
    expect(
      existsSync(join(dir, 'experiments', 'fighter-poses', runId, 'processed', 'walk-A2.png')),
    ).toBe(true);
  }, 30_000);

  it('removes an unambiguous leaked island without spending a recovery call', async () => {
    leakOneSheetCell = true;
    const photo = await sharp({
      create: { width: 180, height: 240, channels: 3, background: '#8b5d42' },
    })
      .jpeg()
      .toBuffer();
    const { boundary, payload } = multipartBody({}, photo);
    const started = await app.inject({
      method: 'POST',
      url: '/api/dev/fighter-poses/runs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    const runId = (started.json() as { runId: string }).runId;
    const status = await waitForTerminal(app, runId);

    expect(status.status).toBe('done');
    expect(imagePrompts).toHaveLength(5);
    expect(
      status.events.some(
        (event) =>
          event.type === 'asset' &&
          event.stage === 'poses' &&
          event.status === 'complete' &&
          event.message.includes('1 leaked foreground island removed'),
      ),
    ).toBe(true);
    expect(
      existsSync(join(dir, 'experiments', 'fighter-poses', runId, 'processed', 'walk-S.png')),
    ).toBe(true);
    expect(
      existsSync(join(dir, 'experiments', 'fighter-poses', runId, 'processed', 'walk-A2.png')),
    ).toBe(false);
  }, 30_000);

  it('retains the isolated-pose path as an explicit comparison baseline', async () => {
    const photo = await sharp({
      create: { width: 180, height: 240, channels: 3, background: '#8b5d42' },
    })
      .jpeg()
      .toBuffer();
    const { boundary, payload } = multipartBody({ generationMode: 'individual' }, photo);
    const started = await app.inject({
      method: 'POST',
      url: '/api/dev/fighter-poses/runs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    const runId = (started.json() as { runId: string }).runId;
    const status = await waitForTerminal(app, runId);

    expect(status.status).toBe('done');
    expect(status.generationMode).toBe('individual');
    expect(imagePrompts).toHaveLength(15);
    expect(
      imagePrompts.filter((prompt) => prompt.includes('FIGHTER POSE SHEET CONTRACT:')),
    ).toHaveLength(0);
    expect(
      existsSync(join(dir, 'experiments', 'fighter-poses', runId, 'processed', 'airKick-A.png')),
    ).toBe(true);
  }, 30_000);
});

async function waitForTerminal(
  app: ReturnType<typeof Fastify>,
  runId: string,
): Promise<{
  status: string;
  generationMode: 'sheets' | 'individual';
  events: Array<{ type: string; stage: string; status: string; message: string }>;
  identityDecision?: { selections: Array<{ accepted: boolean; candidateId: string }> };
  poseDecision?: { setReview: { accepted: boolean } };
}> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/dev/fighter-poses/runs/${encodeURIComponent(runId)}`,
    });
    const body = response.json() as Awaited<ReturnType<typeof waitForTerminal>>;
    if (body.status !== 'running') return body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('fighter pose lab did not reach a terminal state');
}

function multipartBody(
  fields: Record<string, string>,
  photo: Buffer,
): { boundary: string; payload: Buffer } {
  const boundary = 'sparkade-fighter-pose-lab-boundary';
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
