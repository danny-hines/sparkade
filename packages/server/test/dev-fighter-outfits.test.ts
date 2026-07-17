import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FIGHTER_OUTFIT_IDS,
  cloneFighterOutfitRig,
  cloneFighterOutfitRigs,
  type FighterOutfitRigMap,
} from '@sparkade/archetypes';
import {
  fighterOutfitRevision,
  registerDevFighterOutfitRoutes,
} from '../src/api/dev-fighter-outfits';

interface SourceDocument {
  version: 1;
  outfits: FighterOutfitRigMap;
}

function sourceDocument(): SourceDocument {
  return { version: 1, outfits: cloneFighterOutfitRigs() };
}

describe('dev fighter outfit source API', () => {
  let dir: string;
  let sourcePath: string;
  let app: ReturnType<typeof Fastify>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sparkade-fighter-outfits-'));
    sourcePath = join(dir, 'outfits.json');
    writeFileSync(sourcePath, `${JSON.stringify(sourceDocument(), null, 2)}\n`);
    app = Fastify();
    registerDevFighterOutfitRoutes(app, { sourcePath });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const rawSource = (): string => readFileSync(sourcePath, 'utf8');

  it('loads all six rigs and hashes the exact source bytes', async () => {
    // Whitespace is part of the optimistic-concurrency revision.
    const compact = JSON.stringify(sourceDocument());
    writeFileSync(sourcePath, compact);

    const response = await app.inject({ method: 'GET', url: '/api/dev/fighter/outfits' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      file: 'packages/archetypes/src/fighter/outfits.json',
      version: 1,
      revision: createHash('sha256').update(compact).digest('hex'),
    });
    expect(Object.keys(response.json().outfits)).toEqual([...FIGHTER_OUTFIT_IDS]);
  });

  it('atomically replaces one rig, preserves the other five, and returns the new revision', async () => {
    const before = sourceDocument();
    writeFileSync(sourcePath, `${JSON.stringify(before, null, 2)}\n`);
    const revision = fighterOutfitRevision(rawSource());
    const style = cloneFighterOutfitRig(before.outfits.gi);
    style.hands.shape = 'square';
    style.hands.radius = 3.25;
    style.feet.shape = 'shoe';
    style.feet.lengthAdd = 2.5;

    const response = await app.inject({
      method: 'PUT',
      url: '/api/dev/fighter/outfits/gi',
      payload: { revision, style },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const written = rawSource();
    const parsed = JSON.parse(written) as SourceDocument;
    expect(body).toMatchObject({
      ok: true,
      file: 'packages/archetypes/src/fighter/outfits.json',
      version: 1,
      revision: fighterOutfitRevision(written),
      outfit: 'gi',
      style: { hands: { shape: 'square', radius: 3.25 }, feet: { shape: 'shoe' } },
    });
    expect(parsed.outfits.gi).toEqual(style);
    for (const id of FIGHTER_OUTFIT_IDS) {
      if (id !== 'gi') expect(parsed.outfits[id]).toEqual(before.outfits[id]);
    }
    expect(written.endsWith('\n')).toBe(true);
    expect(written).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
    expect(readdirSync(dir).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('rejects a stale save and returns the currently stored rig for recovery', async () => {
    const initialRevision = fighterOutfitRevision(rawSource());
    const current = sourceDocument();
    current.outfits.boxer.hands.radius = 3.75;
    const currentRaw = `${JSON.stringify(current, null, 2)}\n`;
    writeFileSync(sourcePath, currentRaw);
    const staleStyle = cloneFighterOutfitRig(current.outfits.boxer);
    staleStyle.hands.radius = 2;

    const response = await app.inject({
      method: 'PUT',
      url: '/api/dev/fighter/outfits/boxer',
      payload: { revision: initialRevision, style: staleStyle },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: expect.stringContaining('reload'),
      revision: fighterOutfitRevision(currentRaw),
      outfit: 'boxer',
      style: { hands: { radius: 3.75 } },
    });
    expect(rawSource()).toBe(currentRaw);
  });

  it('rejects unknown ids, malformed revisions, and extra request fields without writing', async () => {
    const before = rawSource();
    const style = sourceDocument().outfits.gi;
    const cases = [
      {
        url: '/api/dev/fighter/outfits/cape',
        payload: { revision: fighterOutfitRevision(before), style },
        status: 404,
      },
      {
        url: '/api/dev/fighter/outfits/gi',
        payload: { revision: 'not-a-hash', style },
        status: 400,
      },
      {
        url: '/api/dev/fighter/outfits/gi',
        payload: { revision: fighterOutfitRevision(before), style, extra: true },
        status: 400,
      },
    ];

    for (const testCase of cases) {
      const response = await app.inject({
        method: 'PUT',
        url: testCase.url,
        payload: testCase.payload,
      });
      expect(response.statusCode).toBe(testCase.status);
      expect(rawSource()).toBe(before);
    }
  });

  it('strictly rejects missing, extra, out-of-range, and invalid-enum style fields', async () => {
    const before = rawSource();
    const revision = fighterOutfitRevision(before);
    const valid = sourceDocument().outfits.street;
    const missing = structuredClone(valid) as unknown as Record<string, unknown>;
    delete missing['feet'];
    const extra = { ...structuredClone(valid), canvasCommands: [] };
    const wideHands = structuredClone(valid);
    wideHands.hands.radius = 999;
    const badShape = structuredClone(valid) as unknown as {
      hands: { shape: string };
    };
    badShape.hands.shape = 'claw';

    const cases = [
      { style: missing, detail: 'style.feet is required' },
      { style: extra, detail: 'style.canvasCommands is not allowed' },
      { style: wideHands, detail: 'style.hands.radius must be between' },
      { style: badShape, detail: 'style.hands.shape must be one of' },
    ];
    for (const testCase of cases) {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/dev/fighter/outfits/street',
        payload: { revision, style: testCase.style },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: 'fighter outfit style is invalid',
        details: expect.arrayContaining([expect.stringContaining(testCase.detail)]),
      });
      expect(rawSource()).toBe(before);
    }
  });

  it('refuses invalid source JSON, wrapper fields, versions, and incomplete registries', async () => {
    const valid = sourceDocument();
    const incomplete = structuredClone(valid) as unknown as {
      version: number;
      outfits: Record<string, unknown>;
    };
    delete incomplete.outfits['armor'];
    const invalidSources = [
      '{broken',
      JSON.stringify({ ...valid, extra: true }),
      JSON.stringify({ ...valid, version: 2 }),
      JSON.stringify(incomplete),
    ];

    for (const raw of invalidSources) {
      writeFileSync(sourcePath, raw);
      const response = await app.inject({ method: 'GET', url: '/api/dev/fighter/outfits' });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ error: expect.stringContaining('source') });
      expect(rawSource()).toBe(raw);
    }
  });
});
