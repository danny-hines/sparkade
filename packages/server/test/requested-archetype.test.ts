import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { DesignDoc } from '@sparkade/shared';
import { registerRoutes } from '../src/api/routes';
import { buildDesignPrompt } from '../src/pipeline/prompts';
import { enforceRequestedArchetype } from '../src/pipeline/runner';
import { Db } from '../src/storage/db';

const cleanup: (() => void | Promise<void>)[] = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

async function apiHarness(): Promise<{
  app: ReturnType<typeof Fastify>;
  calls: Record<string, unknown>[];
}> {
  const app = Fastify();
  await app.register(multipart);
  const calls: Record<string, unknown>[] = [];
  registerRoutes(app, {
    db: {} as never,
    files: {} as never,
    configStore: {} as never,
    runner: {
      createJob(input: Record<string, unknown>) {
        calls.push(input);
        return { jobId: 'j-test', gameId: 'g-test' };
      },
    } as never,
    hub: {} as never,
    version: 'test',
    instanceId: 'test-instance',
    port: 0,
  });
  cleanup.push(() => void app.close());
  return { app, calls };
}

describe('requested archetype API', () => {
  it('accepts a known archetype and passes the structured value to the runner', async () => {
    const { app, calls } = await apiHarness();
    const boundary = 'sparkade-requested-archetype-test';
    const fields = {
      promptText: 'Surprise me',
      sourceKind: 'surprise',
      requestedArchetype: 'fighter',
      idempotencyKey: 'ik-valid',
    };
    const payload =
      Object.entries(fields)
        .map(
          ([name, value]) =>
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        )
        .join('') + `--${boundary}--\r\n`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(202);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      sourceKind: 'surprise',
      requestedArchetype: 'fighter',
      creationBrief: {
        version: 1,
        archetype: 'fighter',
        details: 'Surprise me',
      },
    });
  });

  it('rejects unknown archetypes before creating a job', async () => {
    const { app, calls } = await apiHarness();
    const response = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        promptText: 'Surprise me',
        sourceKind: 'surprise',
        requestedArchetype: 'kart-racer',
        idempotencyKey: 'ik-invalid',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'requestedArchetype is invalid' });
    expect(calls).toEqual([]);
  });

  it('leaves ordinary voice jobs unchanged when no archetype was requested', async () => {
    const { app, calls } = await apiHarness();
    const response = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        promptText: 'A game about a lighthouse',
        sourceKind: 'voice',
        idempotencyKey: 'ik-voice',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty('requestedArchetype');
  });

  it('accepts an authoritative engine for voice creation and builds a guided brief', async () => {
    const { app, calls } = await apiHarness();
    const response = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        promptText: 'A game about a lighthouse',
        sourceKind: 'voice',
        requestedArchetype: 'platformer',
        heroName: 'Nova',
        details: 'Escaping a neon zombie wasteland',
        idempotencyKey: 'ik-mismatched-source',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(calls[0]).toMatchObject({
      sourceKind: 'voice',
      requestedArchetype: 'platformer',
      creationBrief: {
        version: 1,
        heroName: 'Nova',
        archetype: 'platformer',
        details: 'Escaping a neon zombie wasteland',
      },
    });
  });

  it('builds a partial guided brief while leaving engine selection to Muse', async () => {
    const { app, calls } = await apiHarness();
    const response = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        promptText: 'Nova explores a strange crystal ocean',
        sourceKind: 'voice',
        heroName: 'Nova',
        details: 'Explore a strange crystal ocean',
        idempotencyKey: 'ik-auto-type',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(calls[0]).not.toHaveProperty('requestedArchetype');
    expect(calls[0]).toMatchObject({
      creationBrief: {
        version: 1,
        heroName: 'Nova',
        details: 'Explore a strange crystal ocean',
      },
    });
    expect(calls[0]?.creationBrief).not.toHaveProperty('archetype');
  });
});

describe('requested archetype persistence', () => {
  it('migrates legacy databases and preserves the selection across job updates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sparkade-archetype-test-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

    // Schema immediately before requested_archetype was introduced.
    const legacy = new DatabaseSync(join(dir, 'sparkade.db'));
    legacy.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT 'queued',
        detail TEXT NOT NULL DEFAULT '',
        prompt_text TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        preset_id TEXT,
        seed INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        has_photo INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error_json TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        price_snapshot_json TEXT NOT NULL DEFAULT '{}'
      );
    `);
    legacy.close();

    const db = new Db(dir);
    cleanup.push(() => db.close());
    const jobColumns = db.db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[];
    expect(jobColumns.some((column) => column.name === 'requested_archetype')).toBe(true);
    expect(jobColumns.some((column) => column.name === 'creation_brief_json')).toBe(true);
    expect(jobColumns.some((column) => column.name === 'image_price_snapshot_json')).toBe(true);

    db.insertJob(
      {
        id: 'j-surprise',
        gameId: 'g-surprise',
        status: 'queued',
        stage: 'queued',
        detail: 'Waiting in line',
        promptText: 'Surprise me',
        sourceKind: 'surprise',
        requestedArchetype: 'adventure',
        creationBrief: {
          version: 1,
          heroName: 'Mira',
          archetype: 'adventure',
          details: 'Recover the songs stolen from a moonlit forest',
        },
        seed: 42,
        idempotencyKey: 'ik-surprise',
        hasPhoto: false,
        createdAt: new Date().toISOString(),
        costSoFarUsd: 0,
        attempt: 1,
      },
      {},
      { model: 'muse-image-1.0', perImageUsd: 0.01 },
    );

    expect(db.getJob('j-surprise')?.requestedArchetype).toBe('adventure');
    expect(db.getJob('j-surprise')?.creationBrief).toEqual({
      version: 1,
      heroName: 'Mira',
      archetype: 'adventure',
      details: 'Recover the songs stolen from a moonlit forest',
    });
    expect(db.jobImagePriceSnapshot('j-surprise')).toEqual({
      model: 'muse-image-1.0',
      perImageUsd: 0.01,
    });
    db.updateJob('j-surprise', { status: 'failed', attempt: 2 });
    expect(db.getJob('j-surprise')?.requestedArchetype).toBe('adventure');
    expect(db.getJobByIdempotencyKey('ik-surprise')?.requestedArchetype).toBe('adventure');
  });
});

describe('requested archetype enforcement', () => {
  it('overrides a conflicting model classification without changing ordinary designs', () => {
    const modelDesign = { archetype: 'fighter', title: 'Wrong Shape' } as DesignDoc;
    expect(enforceRequestedArchetype(modelDesign, 'adventure').archetype).toBe('adventure');
    expect(enforceRequestedArchetype(modelDesign)).toBe(modelDesign);
  });
});

describe('guided creation design prompt', () => {
  it('makes the approved hero name, engine, and details explicit and authoritative', () => {
    const prompt = buildDesignPrompt({
      promptText: 'Nova fights off invading aliens',
      hasPhoto: true,
      describeInStory: false,
      antiCollision: [],
      creationBrief: {
        version: 1,
        heroName: 'Nova',
        archetype: 'shooter',
        details: 'Fighting off invading aliens above a crystal ocean',
      },
    });

    expect(prompt.user).toContain('APPROVED CREATION BRIEF (authoritative)');
    expect(prompt.user).toContain('HERO NAME: Nova');
    expect(prompt.user).toContain('GAME TYPE: shooter');
    expect(prompt.user).toContain('Fighting off invading aliens above a crystal ocean');
    expect(prompt.user).toContain('Preserve the supplied hero name exactly');
  });

  it('leaves omitted guided fields as explicit Muse decisions', () => {
    const prompt = buildDesignPrompt({
      promptText: 'Nova explores a strange crystal ocean',
      hasPhoto: false,
      describeInStory: false,
      antiCollision: [],
      creationBrief: { version: 1, heroName: 'Nova' },
    });

    expect(prompt.user).toContain('HERO NAME: Nova');
    expect(prompt.user).toContain('GAME TYPE: (Muse decides)');
    expect(prompt.user).toContain('ADDITIONAL DETAILS: (Muse decides)');
    expect(prompt.user).toContain('Choose the archetype that best fits');
    expect(prompt.user).toContain('Invent an original story');
  });
});
