import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import {
  ENGINE_VERSION,
  SPEC_VERSION,
  type CloudGameBundle,
  type CloudGenerationSnapshot,
  type GameSpec,
} from '@sparkade/shared';
import { archetypes } from '@sparkade/archetypes';
import { defaultConfig } from '../../server/src/storage/config';
import {
  PortalRuntime,
  validatePortalBundle,
  type NativeCall,
  type PortalBootstrap,
  type PortalState,
} from '../src/portal-runtime';

function fixture() {
  const spec = JSON.parse(
    readFileSync('packages/generation/golden/golden-shooter.json', 'utf8'),
  ) as GameSpec;
  const meta: CloudGameBundle['meta'] = {
    id: 'g-test',
    status: 'ready',
    createdAt: '2026-09-20T00:00:00Z',
    archetype: spec.archetype,
    seed: spec.seed,
    engineVersion: ENGINE_VERSION,
    archetypeVersion: archetypes[spec.archetype].version,
    specVersion: SPEC_VERSION,
    title: 'Portal Test',
    tagline: 'Offline',
    sourcePrompt: 'a game',
    sourceKind: 'preset',
    hadPhoto: false,
    model: 'test',
    provider: 'mock',
    costUsd: 0,
    costBreakdown: [],
    priceSnapshot: {},
  };
  const bundle: CloudGameBundle = { spec, meta, manifest: { version: 1, assets: [] } };
  const snapshot: CloudGenerationSnapshot = {
    game: { ...meta, golden: false, jobId: 'j-test', cover: null, failure: null },
    job: {
      id: 'j-test',
      gameId: 'g-test',
      status: 'done',
      stage: 'done',
      detail: 'Ready',
      attempt: 1,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      finishedAt: meta.createdAt,
      promptText: 'A test game',
      sourceKind: 'preset',
      seed: spec.seed,
      idempotencyKey: 'portal-test',
      hasPhoto: false,
      costSoFarUsd: 0,
      error: undefined,
    },
    events: [],
  };
  return { snapshot, bundle };
}
async function setup() {
  const { snapshot, bundle } = fixture();
  let disk: PortalState | null = null;
  let installed: CloudGameBundle | null = null;
  let installFails = false;
  let blockInstall: Promise<void> | null = null;
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const native: NativeCall = async <T>(
    operation: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    calls.push({ operation, args: structuredClone(args) });
    let result: unknown = {};
    if (operation === 'state.load') result = structuredClone(disk);
    if (operation === 'state.save') disk = structuredClone(args.state) as PortalState;
    if (operation === 'cloud') {
      const path = String(args.path);
      if (path === '/v1/sync')
        result = { status: 200, body: JSON.stringify({ cursor: 1, jobs: [snapshot] }) };
      else if (path.endsWith('/bundle')) result = { status: 200, body: JSON.stringify(bundle) };
      else if (path === '/v1/transcribe')
        result = { status: 200, body: JSON.stringify({ text: 'My actual speech' }) };
      else throw new Error(`Unexpected cloud call ${path}`);
    }
    if (operation === 'game.install') {
      if (blockInstall) await blockInstall;
      if (installFails) throw new Error('Connection interrupted');
      installed = structuredClone(args.bundle) as CloudGameBundle;
    }
    if (operation === 'game.read') result = installed;
    if (operation === 'game.remove') installed = null;
    return result as T;
  };
  const config = defaultConfig();
  const bootstrap: PortalBootstrap = {
    version: 'test',
    buildCommit: null,
    settings: config,
    games: [],
  };
  const create = async () => {
    const r = new PortalRuntime(native, bootstrap, async () => {
      throw new Error('No golden fixture');
    });
    await r.initialize();
    return r;
  };
  return {
    runtime: await create(),
    create,
    calls,
    snapshot,
    bundle,
    failInstall: (value: boolean) => {
      installFails = value;
    },
    blockInstall: (promise: Promise<void>) => {
      blockInstall = promise;
    },
    getDisk: () => disk,
    getInstalled: () => installed,
  };
}

it('persists independent device settings and scores across offline restarts', async () => {
  const first = await setup(),
    second = await setup();
  await first.runtime.handle('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ input: { gamepad: { b9: 'START' } } }),
  });
  const rebooted = await first.create();
  expect((await (await rebooted.handle('/api/settings')).json()).input.gamepad).toEqual({
    b9: 'START',
  });
  expect((await (await second.runtime.handle('/api/settings')).json()).input.gamepad).toEqual({});
  expect(first.calls.filter((c) => c.operation === 'cloud')).toHaveLength(0);
});
it('does not announce a cloud-complete game as playable until installation commits', async () => {
  const test = await setup();
  let release!: () => void;
  test.blockInstall(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const events: string[] = [];
  test.runtime.subscribe('j-test', (event) => events.push(event.type));
  await test.runtime.sync();
  expect((await (await test.runtime.handle('/api/games')).json())[0].status).toBe('generating');
  expect(events).not.toContain('done');
  release();
  await test.runtime.settled();
  expect(events).toContain('done');
  const restarted = await test.create();
  expect((await (await restarted.handle('/api/games/g-test')).json()).spec).toEqual(
    test.bundle.spec,
  );
});
it('retries a failed download without creating or regenerating a cloud job', async () => {
  const test = await setup();
  test.failInstall(true);
  await test.runtime.sync();
  await test.runtime.settled();
  expect((await (await test.runtime.handle('/api/games')).json())[0].status).toBe('failed');
  test.failInstall(false);
  await test.runtime.handle('/api/games/g-test/retry', { method: 'POST' });
  await test.runtime.settled();
  expect((await (await test.runtime.handle('/api/games')).json())[0].status).toBe('ready');
  expect(
    test.calls.some((c) => c.args.path === '/v1/jobs' || String(c.args.path).endsWith('/retry')),
  ).toBe(false);
});
it('does not resurrect a game deleted during its download, including after reboot', async () => {
  const test = await setup();
  let release!: () => void;
  test.blockInstall(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  await test.runtime.sync();
  await vi.waitFor(() => expect(test.calls.some((c) => c.operation === 'game.install')).toBe(true));
  await test.runtime.handle('/api/games/g-test', { method: 'DELETE' });
  release();
  await test.runtime.settled();
  const restarted = await test.create();
  await restarted.sync();
  await restarted.settled();
  expect(await (await restarted.handle('/api/games')).json()).toEqual([]);
  expect(test.getInstalled()).toBeNull();
});
it('uses the real cloud transcription operation and returns its text', async () => {
  const test = await setup();
  const form = new FormData();
  form.append('audio', new Blob(['recording'], { type: 'audio/webm' }), 'recording.webm');
  expect(
    await (await test.runtime.handle('/api/transcribe', { method: 'POST', body: form })).json(),
  ).toEqual({ text: 'My actual speech' });
  expect(test.calls.find((c) => c.operation === 'cloud')?.args).toMatchObject({
    path: '/v1/transcribe',
    method: 'POST',
    form: { file: { name: 'audio', mime: 'audio/webm' } },
  });
});
it('rejects incompatible bundles, asset path traversal and duplicate assets', () => {
  const { bundle } = fixture();
  expect(() => validatePortalBundle(bundle, 'g-test')).not.toThrow();
  expect(() =>
    validatePortalBundle(
      { ...bundle, meta: { ...bundle.meta, engineVersion: '999.0.0' } },
      'g-test',
    ),
  ).toThrow(/update/);
  const asset = {
    role: 'keyArt' as const,
    filename: 'key-art.png' as const,
    mimeType: 'image/png' as const,
    width: 480,
    height: 320,
    model: 'test',
    promptVersion: 'v1',
    promptSha256: 'a'.repeat(64),
    sha256: 'b'.repeat(64),
  };
  expect(() =>
    validatePortalBundle({ ...bundle, manifest: { version: 1, assets: [asset] } }, 'g-test'),
  ).not.toThrow();
  expect(() =>
    validatePortalBundle({ ...bundle, manifest: { version: 1, assets: [asset, asset] } }, 'g-test'),
  ).toThrow(/manifest/);
  expect(() =>
    validatePortalBundle(
      {
        ...bundle,
        manifest: { version: 1, assets: [{ ...asset, filename: '../secret' as 'key-art.png' }] },
      },
      'g-test',
    ),
  ).toThrow(/manifest/);
});
