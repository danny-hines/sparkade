import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGolden } from '@sparkade/generation';
import {
  signGenerationToken,
  verifyGenerationToken,
  type GenerationPrincipal,
} from '@sparkade/generation/service-auth';
import { createGenerationService, cloudGenerationHistory } from '../src/generation-service/service';
import { GenerationRunner } from '../src/pipeline/runner';
import { CloudGenerationClient, validateBundle } from '../src/cloud/generation-client';
import { Db } from '../src/storage/db';
import { GameFiles } from '../src/storage/files';
import { SseHub } from '../src/pipeline/sse';
import { createHash } from 'node:crypto';
import type { CloudGameBundle, CloudGenerationSnapshot } from '@sparkade/shared';

const secret = 'unit-test-generation-secret-32-characters';
const alice: GenerationPrincipal = {
  owner: 'kiosk:alice',
  kioskId: 'alice',
  name: 'Alice',
  defaultFeedVisibility: 'unlisted',
};
const bob: GenerationPrincipal = { ...alice, owner: 'kiosk:bob', kioskId: 'bob' };
const input = {
  promptText: 'A moon garden adventure',
  sourceKind: 'voice',
  idempotencyKey: 'request-1',
  requestedArchetype: 'platformer',
};
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup.length = 0;
  vi.unstubAllEnvs();
});
function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'sparkade-cloud-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
class PausedRunner extends GenerationRunner {
  starts: string[] = [];
  override startJob(id: string): void {
    this.starts.push(id);
  }
}
async function setup(dir = directory()) {
  const service = await createGenerationService({
    dir,
    secret,
    portalOrigin: 'https://portal.example',
    publish: false,
    runnerFactory: (db, files, config, hub) => new PausedRunner(db, files, config, hub),
  });
  cleanup.push(async () => {
    await service.app.close();
  });
  return service;
}
const auth = (principal = alice) => ({
  authorization: `Bearer ${signGenerationToken(principal, 'generation', secret)}`,
});

describe('cloud generation boundary', () => {
  it('separates session and publication audiences, expires sessions, and rejects tampering', () => {
    const token = signGenerationToken(alice, 'generation', secret, 1000);
    expect(verifyGenerationToken(token, 'generation', secret, 1001)).toEqual(alice);
    expect(verifyGenerationToken(token, 'publication', secret, 1001)).toBeNull();
    expect(verifyGenerationToken(token, 'generation', secret, 301000)).toBeNull();
    expect(verifyGenerationToken(token + 'bad', 'generation', secret, 1001)).toBeNull();
  });

  it('accepts 20 jobs durably, scopes idempotency and denies every other owner route', async () => {
    const service = await setup();
    const { app, db, runner } = service;
    const unauthorized = await app.inject({ method: 'POST', url: '/v1/jobs', payload: input });
    expect(unauthorized.statusCode).toBe(401);
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/v1/jobs',
          headers: auth(),
          payload: { ...input, idempotencyKey: `request-${index}` },
        }),
      ),
    );
    expect(responses.every((r) => r.statusCode === 202)).toBe(true);
    expect(db.listJobs()).toHaveLength(20);
    expect((runner as PausedRunner).starts).toHaveLength(20);
    const first = responses[1]!.json<CloudGenerationSnapshot>();
    const repeat = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: auth(),
      payload: input,
    });
    expect(repeat.json().job.id).toBe(first.job.id);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/jobs',
          headers: auth(),
          payload: { ...input, promptText: 'different' },
        })
      ).statusCode,
    ).toBe(409);
    const other = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: auth(bob),
      payload: input,
    });
    expect(other.json().job.id).not.toBe(first.job.id);
    expect(
      cloudGenerationHistory(db, first.job.id).some((game) => game.id === other.json().game.id),
    ).toBe(false);
    expect(cloudGenerationHistory(db, first.job.id)).toHaveLength(20);
    for (const [method, suffix] of [
      ['GET', ''],
      ['POST', '/retry'],
      ['POST', '/cancel'],
      ['GET', '/bundle'],
      ['GET', '/partial'],
      ['GET', '/assets/key-art.png'],
    ] as const) {
      expect(
        (
          await app.inject({
            method,
            url: `/v1/jobs/${first.job.id}${suffix}`,
            headers: auth(bob),
            ...(method === 'POST' ? { payload: {} } : {}),
          })
        ).statusCode,
      ).toBe(404);
    }
    const sync = await app.inject({
      method: 'POST',
      url: '/v1/sync',
      headers: auth(),
      payload: { cursor: 0 },
    });
    expect(sync.json().jobs).toHaveLength(20);
    const next = await app.inject({
      method: 'POST',
      url: '/v1/sync',
      headers: auth(),
      payload: {
        cursor: sync.json().cursor,
        watching: { [first.job.id]: first.events.at(-1)?.id ?? 0, [other.json().job.id]: 0 },
      },
    });
    expect(next.json().jobs).toHaveLength(1);
    expect(next.json().jobs[0].events).toHaveLength(0);
  });

  it('recovers the durable queue after closing and reopening the service', async () => {
    const dir = directory();
    const service = await setup(dir);
    const response = await service.app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: auth(),
      payload: input,
    });
    const id = response.json().job.id;
    await service.app.close();
    cleanup.pop();
    const reopened = await setup(dir);
    expect(reopened.db.getJob(id)?.status).toBe('queued');
    expect((reopened.runner as PausedRunner).starts).toContain(id);
    const retry = await reopened.app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: auth(),
      payload: input,
    });
    expect(retry.json().job.id).toBe(id);
  });

  it('resumes interrupted work within its retry budget and leaves ordinary failures paused', async () => {
    const service = await setup();
    const first = await service.app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: auth(),
      payload: input,
    });
    const id = first.json().job.id;
    service.db.updateJob(id, { status: 'running', attempt: 2 });
    const retry = vi.spyOn(service.runner, 'retryJob').mockImplementation((gameId) => {
      const job = service.db.getJobForGame(gameId)!;
      service.db.updateJob(job.id, { status: 'queued', attempt: job.attempt + 1 });
      return { jobId: job.id };
    });
    service.runner.recoverCloudJobs();
    expect(retry).toHaveBeenCalledOnce();
    expect(service.db.getJob(id)?.attempt).toBe(3);
    service.db.updateJob(id, { status: 'running' });
    service.runner.recoverCloudJobs();
    expect(retry).toHaveBeenCalledOnce();
    expect(service.db.getJob(id)?.status).toBe('failed');
    expect(service.db.getJob(id)?.error?.code).toBe('interrupted');
    service.runner.recoverCloudJobs();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('rediscovers a lost submission and installs only complete, checksum-verified output', async () => {
    const service = await setup();
    const response = await service.app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: auth(),
      payload: input,
    });
    const remote = response.json<CloudGenerationSnapshot>();
    const localDir = directory();
    const localDb = new Db(localDir);
    cleanup.push(() => localDb.close());
    const localFiles = new GameFiles(localDir);
    const hub = new SseHub();
    await service.app.listen({ host: '127.0.0.1', port: 0 });
    const origin = service.app.listeningOrigin;
    let corruptDownload = true;
    const fetchImpl: typeof fetch = async (url, init) =>
      String(url).includes('/api/generation/session')
        ? Response.json({
            origin,
            token: signGenerationToken(alice, 'generation', secret),
            expiresAt: Date.now() + 300_000,
          })
        : corruptDownload && String(url).includes('/assets/')
          ? new Response('truncated download')
          : fetch(url, init);
    const client = new CloudGenerationClient(
      'https://portal.example',
      () => 'device-token',
      localDb,
      localFiles,
      hub,
      fetchImpl,
    );
    cleanup.push(() => client.stop());
    await client.sync();
    expect(localDb.listJobs()).toHaveLength(1);
    localDb.reconcileInterruptedJobs();
    expect(localDb.getJob(remote.job.id)?.status).toBe('queued');
    const gameDir = service.files.gameDir(remote.game.id);
    mkdirSync(join(gameDir, 'assets'), { recursive: true });
    const bytes = Buffer.from('test asset bytes');
    const manifest = {
      version: 1,
      assets: [
        {
          role: 'keyArt',
          filename: 'key-art.png',
          mimeType: 'image/png',
          width: 1,
          height: 1,
          model: 'mock',
          promptVersion: 'v1',
          promptSha256: 'a'.repeat(64),
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      ],
    };
    const spec = loadGolden('platformer');
    const meta = {
      id: remote.game.id,
      status: 'ready',
      engineVersion: '1.0.0',
      archetypeVersion: '1.0.0',
      specVersion: 1,
      archetype: 'platformer',
      title: spec.meta.title,
      tagline: spec.meta.tagline,
      createdAt: remote.game.createdAt,
      costUsd: 0,
    };
    writeFileSync(join(gameDir, 'game.json'), JSON.stringify(spec));
    writeFileSync(join(gameDir, 'meta.json'), JSON.stringify(meta));
    writeFileSync(join(gameDir, 'assets', 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(gameDir, 'assets', 'key-art.png'), bytes);
    service.db.updateJob(remote.job.id, { status: 'done', stage: 'done' });
    service.db.setGameStatus(remote.game.id, 'ready');
    const events: string[] = [];
    hub.subscribe(remote.job.id, (e) => events.push(e.type));
    await client.sync();
    await client.settled();
    expect(localDb.getGame(remote.game.id)?.status).toBe('failed');
    expect(localFiles.readSpec(remote.game.id)).toBeNull();
    expect(client.state(remote.job.id)?.installError).toMatch(/checksum/);
    corruptDownload = false;
    await client.retryJob(remote.game.id);
    await client.settled();
    expect(localDb.getGame(remote.game.id)?.status).toBe('ready');
    expect(localFiles.readSpec(remote.game.id)?.meta.title).toBe(spec.meta.title);
    expect(client.state(remote.job.id)?.installed).toBe(true);
    expect(events.at(-1)).toBe('done');
    await client.sync();
    expect(events.filter((event) => event === 'done')).toHaveLength(1);
    expect(service.db.getJob(remote.job.id)?.attempt).toBe(1);
    // Deleting locally never lets a later cloud sync resurrect the game.
    await client.cancelForGame(remote.game.id);
    localDb.deleteGame(remote.game.id);
    await client.sync();
    expect(localDb.getGame(remote.game.id)).toBeNull();
  });

  it('runs the real mock pipeline in the worker and produces a downloadable game', async () => {
    vi.stubEnv('SPARKADE_PROVIDER', 'mock');
    vi.stubEnv('SPARKADE_MOCK_FAST', '1');
    vi.stubEnv('SPARKADE_GEN_CONCURRENCY', '1');
    const service = await createGenerationService({
      dir: directory(),
      secret,
      portalOrigin: 'https://portal.example',
      publish: false,
    });
    cleanup.push(async () => {
      await service.app.close();
    });
    const response = await service.app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: auth(),
      payload: { ...input, requestedArchetype: 'hshooter' },
    });
    expect(response.statusCode).toBe(202);
    const jobId = response.json().job.id;
    await vi.waitFor(() => expect(['done', 'failed']).toContain(service.db.getJob(jobId)?.status), {
      timeout: 60_000,
      interval: 50,
    });
    const job = service.db.getJob(jobId)!;
    expect(job.error).toBeUndefined();
    expect(job.status).toBe('done');
    const bundle = await service.app.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}/bundle`,
      headers: auth(),
    });
    expect(bundle.statusCode).toBe(200);
    expect(() => validateBundle(bundle.json(), job.gameId)).not.toThrow();
    const artifacts = bundle.json<CloudGameBundle>().manifest.assets;
    expect(artifacts.length).toBeGreaterThan(5);
    for (const asset of artifacts) {
      const downloaded = await service.app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}/assets/${asset.filename}`,
        headers: auth(),
      });
      expect(downloaded.statusCode).toBe(200);
      expect(createHash('sha256').update(downloaded.rawPayload).digest('hex')).toBe(asset.sha256);
    }
  }, 65_000);

  it('rejects traversal manifests and incompatible engines before touching files', () => {
    const bundle = {
      meta: {
        id: 'g-test',
        status: 'ready',
        engineVersion: '99.0.0',
        archetypeVersion: '1.0.0',
        specVersion: 1,
        archetype: 'platformer',
      },
      spec: loadGolden('platformer'),
      manifest: { version: 1, assets: [] },
    } as unknown as CloudGameBundle;
    expect(() => validateBundle(bundle, 'g-test')).toThrow(/update/);
    bundle.meta.engineVersion = '1.0.0';
    bundle.manifest.assets = [
      { role: 'keyArt', filename: '../escape', sha256: 'a'.repeat(64) },
    ] as CloudGameBundle['manifest']['assets'];
    expect(() => validateBundle(bundle, 'g-test')).toThrow(/manifest/);
  });
});
