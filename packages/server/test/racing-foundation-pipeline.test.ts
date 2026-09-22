// Exercise live gate routing using entirely local provider doubles. In
// particular, a rival identity repaint must process one rear image and
// preserve the other approvals, then publish six real fixture frames.
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { buildPortraitIdentityReference } from '../src/likeness/portrait-reference';
import { mockGeneratedImage, prepareImageReference, normalizeKeyArt } from '../src/assets/game-art';
import { generatedAssetForRole, GameAssetWorkspace, GeneratedAssetStorageError } from '../src/assets/manifest';
import type { DurablePipelineCalls } from '../src/pipeline/durable';
import { GenerationRunner } from '../src/pipeline/runner';
import { SseHub } from '../src/pipeline/sse';
import { MockProvider } from '../src/providers/mock';
import { ProviderHttpError, ProviderNetworkError } from '../src/providers/base';
import { ConfigStore } from '../src/storage/config';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';

it.each(['accepted', 'rejected', 'refused', 'offline', 'review-offline', 'review-malformed', 'missing-cap', 'wrong-outfit', 'stride-recovery', 'stride-failure', 'player-refusal'] as const)('preserves required foundations and durable optional motion across a late failure (%s)', async (mode) => {
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
    if (failPublish && role === 'racingCraftRival4' && version === 'racing-locomotion-v5-approved')
      throw new GeneratedAssetStorageError('controlled late persistence failure');
    return originalStore.call(this, role, image, version, hash);
  });
  try {
    const text = new MockProvider('foundation-test');
    const imageRoles: string[] = [];
    const foundationReviews: string[][] = [];
    const photo = ['missing-cap', 'wrong-outfit', 'stride-recovery', 'stride-failure', 'player-refusal'].includes(mode)
      ? await sharp({ create: { width: 80, height: 160, channels: 3, background: '#ed3b52' } }).png().toBuffer()
      : undefined;
    const rejectsPlayer = mode === 'missing-cap' || mode === 'wrong-outfit';
    const expectedPhoto = photo ? await prepareImageReference(photo) : undefined;
    let portraitReference: Buffer | undefined;
    let characterReference: Buffer | undefined;
    let rejectedPlayerOnce = false;
    let rejectedOnce = false;
    let rejectedMotionSubject = '';
    let playerMotionSubject = '';
    let playerMotionReviews = 0;
    let allowPlayerMotion = false;
    const durable: DurablePipelineCalls = {
      abort: new AbortController(), suspended: () => false,
      complete: async (_stage, request) => {
        if (request.system.includes('art director selecting gameplay identity art')) {
          const schema = request.jsonSchema as { properties: { slotReviews: { items: { properties: { id: { enum: string[] } } } } } };
          const ids = schema.properties.slotReviews.items.properties.id.enum;
          foundationReviews.push(ids);
          if (photo && ids.includes('player')) {
            expect(request.user).toContain('missing photographed cap is fatal');
            expect(request.image).toBeTruthy();
            const sourcePixel = await sharp(request.image!).extract({ left: 384, top: 250, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
            expect([...sourcePixel]).toEqual([237, 59, 82]);
          } else if (!ids.includes('player')) {
            expect(request.user).not.toContain('PLAYER CHARACTER IDENTITY CHECK');
          }
          const rejected = rejectsPlayer && !rejectedPlayerOnce && ids.includes('player')
            ? ['player'] : !rejectedOnce && ids.includes('rival2') ? ['rival2'] : [];
          if (rejected.includes('player')) rejectedPlayerOnce = true;
          if (rejected.includes('rival2')) rejectedOnce = true;
          return { text: JSON.stringify({
            slotReviews: ids.map(id => ({ id, cameraViews: ['low-rear'], fatalIssues: rejected.includes(id) ? [id === 'player' ? mode === 'wrong-outfit' ? 'green striped shirt instead of coral-pink singlet' : 'missing photographed cap' : 'side-facing rear'] : [],
              summary: 'controlled fixture verdict', guidance: rejected.includes(id) ? id === 'player' ? mode === 'wrong-outfit' ? 'Match the coral-pink singlet in the character artwork' : 'Restore the cap from the photo' : 'Face directly away' : '' })),
            selection: { accepted: !rejected.length, rejectedIds: rejected, rationale: 'fixture', retryGuidance: 'Face directly away' },
          }), usage: { input: 1, output: 1 } };
        }
        if (mode === 'review-malformed' && !!rejectedMotionSubject && request.user.startsWith(`Subject: ${rejectedMotionSubject}. Art direction:`) && request.system.startsWith('Review this racing motion atlas.'))
          return {text:'invalid JSON',usage:{input:1,output:1}};
        if (mode === 'review-offline' && !!rejectedMotionSubject && request.user.startsWith(`Subject: ${rejectedMotionSubject}. Art direction:`) && request.system.startsWith('Review this racing motion atlas.'))
          throw new ProviderNetworkError('review offline');
        if (request.system.startsWith('Review this racing motion atlas.') && playerMotionSubject && request.user.startsWith(`Subject: ${playerMotionSubject}. Art direction:`)) {
          playerMotionReviews++;
          const accepted = allowPlayerMotion || (mode !== 'stride-failure' && (mode !== 'stride-recovery' || playerMotionReviews > 1));
          return { text: JSON.stringify({ accepted, reason: accepted ? 'Coherent stride' : 'Repeated frozen poses' }), usage: { input: 1, output: 1 } };
        }
        if (request.system.startsWith('Review this racing motion atlas.'))
          return { text: JSON.stringify({ accepted: mode !== 'rejected' || !request.user.startsWith(`Subject: ${rejectedMotionSubject}. Art direction:`), reason: 'fixture motion verdict' }), usage: { input: 1, output: 1 } };
        const response = await text.complete(request);
        if (mode === 'wrong-outfit') {
          const parsed = JSON.parse(response.text);
          if (parsed.heroConcept) {
            parsed.heroConcept = 'Coral-pink singlet with white trim, navy shorts, white socks and mint running shoes';
            response.text = JSON.stringify(parsed);
          }
        }
        return response;
      },
      image: async request => {
        imageRoles.push(request.role);
        if (request.role === 'racingCraftPlayer') {
          expect(characterReference).toBeTruthy();
          expect(request.reference).toEqual(characterReference);
          expect(request.prompt).toContain('CANONICAL CHARACTER ART');
          expect(imageRoles.indexOf('keyArt')).toBeLessThan(imageRoles.indexOf('racingCraftPlayer'));
          if (photo) expect(request.prompt).toContain('PLAYER PHOTO IDENTITY');
          if (mode === 'wrong-outfit') expect(request.prompt).toContain('Coral-pink singlet');
        }
        if (request.role.startsWith('racingCraftRival')) {
          expect(request.reference).toBeUndefined();
          expect(request.prompt).not.toContain('PLAYER PHOTO IDENTITY');
        }
        if (photo && ['portrait', 'portrait-defeat'].includes(request.role)) {
          expect(imageRoles).toContain('keyArt');
          expect(request.prompt).toContain('RIGHT is the canonical key art');
          expect(request.reference).not.toEqual(expectedPhoto);
          expect(request.reference).not.toEqual(photo);
          expect(request.reference).toEqual(characterReference);
          if (portraitReference) expect(request.reference).toEqual(portraitReference);
          portraitReference = request.reference;
        }
        if (request.role === 'racing-motion-0') {
          playerMotionSubject = request.prompt.match(/Subject: (.*?)\. Art direction:/)![1]!;
          if (mode === 'player-refusal') throw new ProviderHttpError('refused', 400, null, 'content_policy_violation');
        }
        if (request.role.startsWith('racing-motion-0-frame-')) {
          const frame = Number(request.role.split('-').at(-1));
          const sheet = await mockGeneratedImage('RACING LOCOMOTION SHEET:');
          const meta = await sharp(sheet).metadata();
          const width = meta.width! / 3, height = meta.height! / 2;
          return { image: await sharp(sheet).extract({ left: (frame % 3) * width, top: Math.floor(frame / 3) * height, width, height }).png().toBuffer(), imageCount: 1 };
        }
        if (request.role === 'racing-motion-1') rejectedMotionSubject = request.prompt.match(/Subject: (.*?)\. Art direction:/)![1]!;
        if (mode === 'refused' && request.role === 'racing-motion-1')
          throw new ProviderHttpError('refused', 400, null, 'content_policy_violation');
        if (mode === 'offline' && request.role === 'racing-motion-1')
          throw new ProviderNetworkError('offline');
        const generated = await mockGeneratedImage(request.prompt);
        if (request.role === 'keyArt') {
          const keyArt = await normalizeKeyArt(generated);
          characterReference = expectedPhoto ? await buildPortraitIdentityReference(expectedPhoto, keyArt) : keyArt;
        }
        return { image: generated, imageCount: 1 };
      },
    };
    const runner = new GenerationRunner(db, files, new ConfigStore(root), new SseHub(), undefined, durable);
    const { jobId, gameId } = runner.createJob({
      promptText: photo
        ? 'Race with handling flow, surface ground, rider onFoot, propulsion human, motion stride'
        : 'Race with handling grip, surface ground, rider seated, propulsion human, motion pedal',
      ...(photo ? { photo } : {}),
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
    const firstAttempt = await wait();
    expect(firstAttempt).toMatchObject({ status: 'failed' });
    const recoveryCalls = imageRoles.filter(role => role.startsWith('racing-motion-0-frame-'));
    expect(recoveryCalls).toHaveLength(mode === 'stride-recovery' || mode === 'stride-failure' ? 6 : 0);
    if (mode === 'stride-failure' || mode === 'player-refusal') {
      expect(firstAttempt.error?.code).toBe(mode === 'player-refusal' ? 'image-content-policy' : 'image-invalid');
      expect(firstAttempt.error?.message).toContain('Player run cycle did not pass');
      expect(files.readMeta(gameId)?.status).not.toBe('ready');
      expect(network).not.toHaveBeenCalled();
      if (mode === 'stride-failure') {
        const before = [...imageRoles];
        allowPlayerMotion = true;
        failPublish = false;
        runner.retryJob(gameId);
        expect(await wait()).toMatchObject({ status: 'done' });
        expect(imageRoles.slice(before.length)).toEqual(['racing-motion-0']);
        expect(files.readMeta(gameId)?.racingArt?.motion?.[0]).toMatchObject({ racer: 'player', status: 'animated' });
      }
      return;
    }
    expect(files.readMeta(gameId)?.status).not.toBe('ready');
    const callsBeforeRetry = [...imageRoles];
    failPublish = false;
    runner.retryJob(gameId);
    const job = await wait();
    expect(imageRoles).toEqual(callsBeforeRetry);
    expect(job, JSON.stringify(job.error)).toMatchObject({ status: 'done' });
    expect(foundationReviews).toEqual([['player'], ...(rejectsPlayer ? [['player']] : []), ['rival1', 'rival2', 'rival3', 'rival4'], ['rival2']]);
    for (const role of ['racingCraftPlayer', 'racingCraftRival1', 'racingCraftRival3', 'racingCraftRival4'])
      expect(imageRoles.filter(value => value === role)).toHaveLength(rejectsPlayer && role === 'racingCraftPlayer' ? 2 : 1);
    if (photo) {
      expect(portraitReference).toBeTruthy();
      expect(imageRoles.filter(role => ['portrait', 'portrait-defeat'].includes(role))).toHaveLength(2);
    }
    expect(imageRoles.filter(value => value === 'racingCraftRival2')).toHaveLength(2);
    expect(imageRoles.some(role => role.includes('-bank-'))).toBe(false);
    for (let i = 0; i < 5; i++) {
      expect(imageRoles.filter(role => role === `racing-motion-${i}`)).toHaveLength(i === 1 && mode === 'rejected' ? 2 : 1);
      const role = i ? `racingCraftRival${i}` as 'racingCraftRival1' : 'racingCraftPlayer';
      const neutral = i === 1 && ['rejected', 'refused', 'offline', 'review-offline', 'review-malformed'].includes(mode);
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
