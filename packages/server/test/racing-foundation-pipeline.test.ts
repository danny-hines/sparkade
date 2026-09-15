// Exercise live gate routing using entirely local provider doubles. In
// particular, a rival identity repaint must process one rear image and
// preserve the other approvals, then publish six real fixture frames.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { mockGeneratedImage } from '../src/assets/game-art';
import { generatedAssetForRole } from '../src/assets/manifest';
import type { DurablePipelineCalls } from '../src/pipeline/durable';
import { GenerationRunner } from '../src/pipeline/runner';
import { SseHub } from '../src/pipeline/sse';
import { MockProvider } from '../src/providers/mock';
import { ConfigStore } from '../src/storage/config';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';

it.each([true, false])('repairs only the rejected foundation and honors motion approval (%s)', async (motionAccepted) => {
  const previousProvider = process.env.SPARKADE_PROVIDER;
  const previousFast = process.env.SPARKADE_MOCK_FAST;
  delete process.env.SPARKADE_PROVIDER; // exercise semantic gates, not the mock bypass
  process.env.SPARKADE_MOCK_FAST = '1';
  const root = mkdtempSync(join(tmpdir(), 'sparkade-foundation-gates-'));
  const db = new Db(root);
  const files = new GameFiles(root);
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in this test'));
  try {
    const text = new MockProvider('foundation-test');
    const imageRoles: string[] = [];
    const foundationReviews: string[][] = [];
    let rejectedOnce = false;
    const durable: DurablePipelineCalls = {
      abort: new AbortController(), suspended: () => false,
      complete: async (_stage, request) => {
        if (request.system.includes('art director selecting gameplay identity art')) {
          const schema = request.jsonSchema as { properties: { slotReviews: { items: { properties: { id: { enum: string[] } } } } } };
          const ids = schema.properties.slotReviews.items.properties.id.enum;
          foundationReviews.push(ids);
          const rejected = !rejectedOnce && ids.includes('rival2') ? ['rival2'] : [];
          if (rejected.length) rejectedOnce = true;
          return { text: JSON.stringify({
            slotReviews: ids.map(id => ({ id, fatalIssues: rejected.includes(id) ? ['side-facing rear'] : [],
              summary: 'controlled fixture verdict', guidance: rejected.includes(id) ? 'Face directly away' : '' })),
            selection: { accepted: !rejected.length, rejectedIds: rejected, rationale: 'fixture', retryGuidance: 'Face directly away' },
          }), usage: { input: 1, output: 1 } };
        }
        if (request.system.startsWith('Review this racing motion atlas.'))
          return { text: JSON.stringify({ accepted: motionAccepted, reason: 'fixture motion verdict' }), usage: { input: 1, output: 1 } };
        return text.complete(request);
      },
      image: async request => {
        imageRoles.push(request.role);
        return { image: await mockGeneratedImage(request.prompt), imageCount: 1 };
      },
    };
    const runner = new GenerationRunner(db, files, new ConfigStore(root), new SseHub(), undefined, durable);
    const { jobId, gameId } = runner.createJob({
      promptText: 'Race with handling grip, surface ground, rider seated, propulsion human, motion pedal',
      requestedArchetype: 'racing', sourceKind: 'preset', idempotencyKey: 'foundation-repaint',
    });
    const deadline = Date.now() + 90_000;
    while (!['done', 'failed', 'canceled'].includes(db.getJob(jobId)!.status)) {
      if (Date.now() > deadline) throw new Error('Foundation pipeline did not complete');
      await delay(25);
    }
    const job = db.getJob(jobId)!;
    if (!motionAccepted) {
      expect(job).toMatchObject({ status: 'failed', error: { code: 'image-invalid' } });
      expect(job.error!.message).toContain('fixture motion verdict');
      expect(files.readMeta(gameId)?.status).not.toBe('ready');
      expect(imageRoles.filter(role => role === 'racing-motion-0')).toHaveLength(2);
      expect(imageRoles.filter(role => role === 'racing-motion-1')).toHaveLength(0);
      expect(network).not.toHaveBeenCalled();
      return;
    }
    expect(job, JSON.stringify(job.error)).toMatchObject({ status: 'done' });
    expect(foundationReviews).toEqual([['player'], ['rival1', 'rival2', 'rival3', 'rival4'], ['rival2']]);
    for (const role of ['racingCraftPlayer', 'racingCraftRival1', 'racingCraftRival3', 'racingCraftRival4'])
      expect(imageRoles.filter(value => value === role)).toHaveLength(1);
    expect(imageRoles.filter(value => value === 'racingCraftRival2')).toHaveLength(2);
    expect(imageRoles.some(role => role.includes('-bank-'))).toBe(false);
    for (let i = 0; i < 5; i++) {
      expect(imageRoles.filter(role => role === `racing-motion-${i}`)).toHaveLength(1);
      const role = i ? `racingCraftRival${i}` as 'racingCraftRival1' : 'racingCraftPlayer';
      expect(generatedAssetForRole(join(files.gameDir(gameId), 'assets'), role)).toMatchObject({ width: 192, height: 192 });
    }
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore(); db.close(); rmSync(root, { recursive: true, force: true });
    if (previousProvider === undefined) delete process.env.SPARKADE_PROVIDER;
    else process.env.SPARKADE_PROVIDER = previousProvider;
    if (previousFast === undefined) delete process.env.SPARKADE_MOCK_FAST;
    else process.env.SPARKADE_MOCK_FAST = previousFast;
  }
}, 120_000);
