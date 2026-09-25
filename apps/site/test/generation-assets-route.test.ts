import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signGenerationToken } from '@sparkade/generation/service-auth';
import { JobState } from '@sparkade/server/pipeline/job-state';
import type { StoredCheckpoint } from '../lib/generation/checkpoints';

const mocks = vi.hoisted(() => ({
  getJob: vi.fn(),
  readPrivate: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('../lib/generation/store', () => ({ getJob: mocks.getJob }));
vi.mock('../lib/generation/storage', () => ({ readPrivate: mocks.readPrivate }));
vi.mock('workflow/api', () => ({ start: vi.fn() }));
vi.mock('../workflows/generate-game', () => ({ generateGameWorkflow: vi.fn() }));

import { GET } from '../app/api/generation/v1/[...path]/route';

const secret = 'test-preview-generation-secret-at-least-32';
const principal = {
  owner: 'kiosk:preview-test',
  kioskId: 'preview-test',
  name: 'Preview test kiosk',
  defaultFeedVisibility: 'unlisted' as const,
};
const jobId = 'j-preview-test';
const gameId = 'g-preview-test';
const filename = 'adventure-player-up-idle.png';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=',
  'base64',
);
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const asset = {
  role: 'adventurePlayerUpIdle',
  filename,
  mimeType: 'image/png',
  width: 1,
  height: 1,
  model: 'muse-image-1.0',
  promptVersion: 'test-v1',
  promptSha256: hash('test prompt'),
  sha256: hash(png),
};
const manifest = Buffer.from(JSON.stringify({ version: 1, assets: [asset] })).toString('base64');
let checkpoint: StoredCheckpoint;

async function request(name = filename, owner = principal.owner, authenticated = true) {
  const token = signGenerationToken({ ...principal, owner }, 'generation', secret);
  return GET(
    new NextRequest(
      `https://sparkade.dev/api/generation/v1/jobs/${jobId}/assets/${encodeURIComponent(name)}`,
      {
        headers: authenticated ? { authorization: `Bearer ${token}` } : {},
      },
    ),
    { params: Promise.resolve({ path: ['jobs', jobId, 'assets', name] }) },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('SPARKADE_GENERATION_BACKEND', 'vercel');
  vi.stubEnv('SPARKADE_GENERATION_SECRET', secret);
  vi.stubGlobal('fetch', mocks.fetch);
  checkpoint = {
    state: new JobState().state,
    files: {
      [`staging/${jobId}/assets/manifest.json`]: manifest,
      [`staging/${jobId}/assets/${filename}`]: png.toString('base64'),
    },
  };
  mocks.getJob.mockResolvedValue({
    id: jobId,
    owner: principal.owner,
    status: 'running',
    attempt: 1,
    checkpoint: 'private-checkpoint',
    bundle: null,
    state: { job: { id: jobId, gameId } },
  });
  mocks.readPrivate.mockImplementation(async (url) => {
    if (url === 'private-checkpoint') return checkpoint;
    throw new Error('Unexpected storage read');
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('kiosk generation asset previews', () => {
  it('serves a completed asset while the rest of the game is still generating', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('loads a preview from an integrity-checked checkpoint pack', async () => {
    const data = png.toString('base64');
    const path = `staging/${jobId}/assets/${filename}`;
    delete checkpoint.files[path];
    checkpoint.fileRefs = {
      [path]: { pack: 'private-image-pack', sha256: hash(data), bytes: png.length },
    };
    mocks.readPrivate.mockImplementation(async (url) => {
      if (url === 'private-checkpoint') return checkpoint;
      if (url === 'private-image-pack') return { [hash(data)]: data };
      throw new Error('Unexpected storage read');
    });
    const response = await request();
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(mocks.readPrivate).toHaveBeenCalledWith('private-image-pack');
  });

  it('keeps previews available after staging files move for publication', async () => {
    const row = await mocks.getJob();
    row.status = 'publishing';
    checkpoint.files = {
      [`games/${gameId}/assets/manifest.json`]: manifest,
      [`games/${gameId}/assets/${filename}`]: png.toString('base64'),
    };
    const response = await request();
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  });

  it('does not cache an unavailable preview and serves it on a later request', async () => {
    delete checkpoint.files[`staging/${jobId}/assets/${filename}`];
    const response = await request();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    checkpoint.files[`staging/${jobId}/assets/${filename}`] = png.toString('base64');
    expect((await request()).status).toBe(200);
  });

  it.each(['manifest', 'image', 'checksum'])(
    'rejects an absent or mismatched %s',
    async (missing) => {
      if (missing === 'manifest') delete checkpoint.files[`staging/${jobId}/assets/manifest.json`];
      if (missing === 'image') delete checkpoint.files[`staging/${jobId}/assets/${filename}`];
      if (missing === 'checksum')
        checkpoint.files[`staging/${jobId}/assets/${filename}`] =
          Buffer.from('wrong bytes').toString('base64');
      expect((await request()).status).toBe(404);
    },
  );

  it.each([
    'photo.jpg',
    '.adventure-enemy-board.png',
    '../photo.jpg',
    'manifest.json',
    'unknown.png',
  ])('does not expose private or unknown files (%s)', async (name) => {
    checkpoint.files[`staging/${jobId}/assets/${name}`] = png.toString('base64');
    expect((await request(name)).status).toBe(404);
    expect(mocks.readPrivate).not.toHaveBeenCalled();
  });

  it('returns not found when a checkpoint has expired', async () => {
    const row = await mocks.getJob();
    row.checkpoint = '';
    expect((await request()).status).toBe(404);
    expect(mocks.readPrivate).not.toHaveBeenCalled();
  });

  it('requires an authenticated session belonging to the job owner', async () => {
    expect((await request(filename, principal.owner, false)).status).toBe(401);
    expect((await request(filename, 'kiosk:another-device')).status).toBe(404);
    expect(mocks.readPrivate).not.toHaveBeenCalled();
  });

  it('continues serving final bundle assets for installed kiosk downloads', async () => {
    const row = await mocks.getJob();
    row.status = 'done';
    row.bundle = 'final-bundle';
    const url = 'https://public.example/adventure-player-up-idle.png';
    mocks.readPrivate.mockResolvedValue({
      bundle: { manifest: { version: 1, assets: [asset] } },
      assets: { [filename]: url },
    });
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array(png)));
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(mocks.fetch).toHaveBeenCalledWith(url);
    expect(mocks.readPrivate).toHaveBeenCalledExactlyOnceWith('final-bundle');
  });
});
