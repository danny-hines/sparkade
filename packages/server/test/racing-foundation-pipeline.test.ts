// Exercise live gate routing using entirely local provider doubles. In
// particular, a rival identity repaint must process one rear image and
// preserve the other approvals, then publish six real fixture frames.
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { mockGeneratedImage } from '../src/assets/game-art';
import { generatedAssetForRole, GameAssetWorkspace, GeneratedAssetStorageError } from '../src/assets/manifest';
import type { DurablePipelineCalls } from '../src/pipeline/durable';
import { GenerationRunner } from '../src/pipeline/runner';
import { SseHub } from '../src/pipeline/sse';
import { MockProvider } from '../src/providers/mock';
import { ProviderHttpError, ProviderNetworkError } from '../src/providers/base';
import { ConfigStore } from '../src/storage/config';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';

it.each(['accepted', 'rejected', 'refused', 'offline', 'review-offline', 'review-malformed'] as const)('preserves required foundations and durable optional motion across a late failure (%s)', async (mode) => {
  const previousProvider = process.env.SPARKADE_PROVIDER;
  const previousFast = process.env.SPARKADE_MOCK_FAST;
  delete process.env.SPARKADE_PROVIDER; // exercise semantic gates, not the mock bypass
  process.env.SPARKADE_MOCK_FAST = '1';
  const root = mkdtempSync(join(tmpdir(), 'sparkade-foundation-gates-'));
  const db = new Db(root);
  const files = new GameFiles(root);
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in this test'));
  const originalStore = GameAssetWorkspace.prototype.store;
  let failPublish = true;
  const store = vi.spyOn(GameAssetWorkspace.prototype, 'store').mockImplementation(async function(this: GameAssetWorkspace, role, image, version, hash) {
    if (failPublish && role === 'racingCraftRival4' && version === 'racing-locomotion-v4-approved')
      throw new GeneratedAssetStorageError('controlled late persistence failure');
    return originalStore.call(this, role, image, version, hash);
  });
  try {
    const text = new MockProvider('foundation-test');
    const imageRoles: string[] = [];
    const foundationReviews: string[][] = [];
    let rejectedOnce = false;
    let rejectedMotionSubject = '';
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
            slotReviews: ids.map(id => ({ id, cameraViews: ['low-rear'], fatalIssues: rejected.includes(id) ? ['side-facing rear'] : [],
              summary: 'controlled fixture verdict', guidance: rejected.includes(id) ? 'Face directly away' : '' })),
            selection: { accepted: !rejected.length, rejectedIds: rejected, rationale: 'fixture', retryGuidance: 'Face directly away' },
          }), usage: { input: 1, output: 1 } };
        }
        if (mode === 'review-malformed' && !!rejectedMotionSubject && request.user.startsWith(`Subject: ${rejectedMotionSubject}. Art direction:`) && request.system.startsWith('Review this racing motion atlas.'))
          return {text:'invalid JSON',usage:{input:1,output:1}};
        if (mode === 'review-offline' && !!rejectedMotionSubject && request.user.startsWith(`Subject: ${rejectedMotionSubject}. Art direction:`) && request.system.startsWith('Review this racing motion atlas.'))
          throw new ProviderNetworkError('review offline');
        if (request.system.startsWith('Review this racing motion atlas.'))
          return { text: JSON.stringify({ accepted: mode !== 'rejected' || !request.user.startsWith(`Subject: ${rejectedMotionSubject}. Art direction:`), reason: 'fixture motion verdict' }), usage: { input: 1, output: 1 } };
        return text.complete(request);
      },
      image: async request => {
        imageRoles.push(request.role);
        if (request.role === 'racing-motion-1') rejectedMotionSubject = request.prompt.match(/Subject: (.*?)\. Art direction:/)![1]!;
        if (mode === 'refused' && request.role === 'racing-motion-1')
          throw new ProviderHttpError('refused', 400, null, 'content_policy_violation');
        if (mode === 'offline' && request.role === 'racing-motion-1')
          throw new ProviderNetworkError('offline');
        return { image: await mockGeneratedImage(request.prompt), imageCount: 1 };
      },
    };
    const runner = new GenerationRunner(db, files, new ConfigStore(root), new SseHub(), undefined, durable);
    const { jobId, gameId } = runner.createJob({
      promptText: 'Race with handling grip, surface ground, rider seated, propulsion human, motion pedal',
      requestedArchetype: 'racing', sourceKind: 'preset', idempotencyKey: 'foundation-repaint',
    });
    const wait = async () => {
      const deadline = Date.now() + 90_000;
      while (!['done', 'failed', 'canceled'].includes(db.getJob(jobId)!.status)) {
        if (Date.now() > deadline) throw new Error('Foundation pipeline did not complete');
        await delay(25);
      }
      return db.getJob(jobId)!;
    };
    expect(await wait()).toMatchObject({ status: 'failed' });
    expect(files.readMeta(gameId)?.status).not.toBe('ready');
    const callsBeforeRetry = [...imageRoles];
    failPublish = false;
    runner.retryJob(gameId);
    const job = await wait();
    expect(imageRoles).toEqual(callsBeforeRetry);
    expect(job, JSON.stringify(job.error)).toMatchObject({ status: 'done' });
    expect(foundationReviews).toEqual([['player'], ['rival1', 'rival2', 'rival3', 'rival4'], ['rival2']]);
    for (const role of ['racingCraftPlayer', 'racingCraftRival1', 'racingCraftRival3', 'racingCraftRival4'])
      expect(imageRoles.filter(value => value === role)).toHaveLength(1);
    expect(imageRoles.filter(value => value === 'racingCraftRival2')).toHaveLength(2);
    expect(imageRoles.some(role => role.includes('-bank-'))).toBe(false);
    for (let i = 0; i < 5; i++) {
      expect(imageRoles.filter(role => role === `racing-motion-${i}`)).toHaveLength(i === 1 && mode === 'rejected' ? 2 : 1);
      const role = i ? `racingCraftRival${i}` as 'racingCraftRival1' : 'racingCraftPlayer';
      const neutral = i === 1 && mode !== 'accepted';
      expect(generatedAssetForRole(join(files.gameDir(gameId), 'assets'), role)).toMatchObject(neutral ? { width: 64, height: 64 } : { width: 192, height: 192 });
      expect(files.readMeta(gameId)?.racingArt?.motion?.[i]).toMatchObject({ racer: i ? `rival${i}` : 'player', status: neutral ? 'neutral' : 'animated' });
      if (neutral) expect(files.readMeta(gameId)?.racingArt?.motion?.[i]?.reason).toBeTruthy();
    }
    expect(readdirSync(join(files.gameDir(gameId), 'assets')).some(f => f.startsWith('.'))).toBe(false);
    expect(network).not.toHaveBeenCalled();
  } finally {
    store.mockRestore(); network.mockRestore(); db.close(); rmSync(root, { recursive: true, force: true });
    if (previousProvider === undefined) delete process.env.SPARKADE_PROVIDER;
    else process.env.SPARKADE_PROVIDER = previousProvider;
    if (previousFast === undefined) delete process.env.SPARKADE_MOCK_FAST;
    else process.env.SPARKADE_MOCK_FAST = previousFast;
  }
}, 120_000);
