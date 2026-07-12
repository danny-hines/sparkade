// Atomic-publish behavior: a game in staging is NEVER visible as Ready; only
// the atomic rename publishes it; a discarded staging dir leaves no trace.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../src/storage/db';
import { GameFiles, reconcileGames } from '../src/storage/files';
import { ensureDir } from '../src/util';

let dir: string;
let db: Db;
let files: GameFiles;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sparkade-test-'));
  db = new Db(dir);
  files = new GameFiles(dir);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const FAKE_SPEC = JSON.stringify({
  specVersion: 1,
  archetype: 'platformer',
  seed: 1,
  meta: { title: 'Test Game', tagline: 'testing' },
  palette: new Array(16).fill('#123456'),
  sprites: { custom: {}, assign: { hero: 'lib:hero_squire', boss: 'lib:boss_titan' } },
});

const FAKE_META = (id: string) =>
  JSON.stringify({
    id,
    status: 'ready',
    createdAt: new Date().toISOString(),
    archetype: 'platformer',
    seed: 1,
    engineVersion: '1.0.0',
    archetypeVersion: '1.0.0',
    specVersion: 1,
    title: 'Test Game',
    tagline: 'testing',
    sourcePrompt: 'x',
    sourceKind: 'preset',
    hadPhoto: false,
    model: 'mock',
    provider: 'mock',
    costUsd: 0,
    costBreakdown: [],
    priceSnapshot: {},
  });

describe('atomic publish', () => {
  it('staging content is never visible in games/ before publish', () => {
    const staging = files.stagingFor('job1');
    writeFileSync(join(staging, 'game.json'), FAKE_SPEC);
    writeFileSync(join(staging, 'meta.json'), FAKE_META('game1'));
    ensureDir(join(staging, 'assets'));
    // not published: the game dir must not exist, and reconciliation must not index it
    expect(existsSync(files.gameDir('game1'))).toBe(false);
    reconcileGames(files, db);
    expect(db.getGame('game1')).toBeNull();
  });

  it('publish renames staging into games/ in one step and strips the raw photo', () => {
    const staging = files.stagingFor('job2');
    writeFileSync(join(staging, 'game.json'), FAKE_SPEC);
    writeFileSync(join(staging, 'meta.json'), FAKE_META('game2'));
    writeFileSync(join(staging, 'photo.jpg'), Buffer.from([0xff, 0xd8])); // privacy: must not survive
    ensureDir(join(staging, 'assets'));
    files.publish('job2', 'game2');
    expect(existsSync(join(files.gameDir('game2'), 'game.json'))).toBe(true);
    expect(existsSync(join(files.gameDir('game2'), 'photo.jpg'))).toBe(false);
    expect(existsSync(staging)).toBe(false);
    expect(JSON.parse(readFileSync(join(files.gameDir('game2'), 'game.json'), 'utf8')).meta.title).toBe(
      'Test Game',
    );
  });

  it('reconciliation indexes published games and drops rows whose files vanished', () => {
    const staging = files.stagingFor('job3');
    writeFileSync(join(staging, 'game.json'), FAKE_SPEC);
    writeFileSync(join(staging, 'meta.json'), FAKE_META('game3'));
    files.publish('job3', 'game3');
    reconcileGames(files, db);
    expect(db.getGame('game3')?.status).toBe('ready');
    // delete files behind the DB's back → row disappears on next reconcile
    rmSync(files.gameDir('game3'), { recursive: true, force: true });
    reconcileGames(files, db);
    expect(db.getGame('game3')).toBeNull();
  });

  it('engine major-version mismatch surfaces needs-migration, never silent reinterpretation', () => {
    const staging = files.stagingFor('job4');
    writeFileSync(join(staging, 'game.json'), FAKE_SPEC);
    writeFileSync(
      join(staging, 'meta.json'),
      FAKE_META('game4').replace('"engineVersion":"1.0.0"', '"engineVersion":"0.9.0"'),
    );
    files.publish('job4', 'game4');
    reconcileGames(files, db);
    expect(db.getGame('game4')?.status).toBe('needs-migration');
  });

  it('discardStaging leaves no trace (cancel / power-loss cleanup)', () => {
    const staging = files.stagingFor('job5');
    writeFileSync(join(staging, 'photo.jpg'), Buffer.from([1]));
    files.discardStaging('job5');
    expect(existsSync(staging)).toBe(false);
  });
});

describe('jobs and the immutable cost ledger', () => {
  it('interrupted jobs become failed-retryable at boot, never stuck Generating', () => {
    db.insertJob(
      {
        id: 'j1',
        gameId: 'g1',
        status: 'running',
        stage: 'writing-spec',
        detail: 'working',
        promptText: 'a game',
        sourceKind: 'voice',
        seed: 7,
        idempotencyKey: 'ik1',
        hasPhoto: false,
        createdAt: new Date().toISOString(),
        costSoFarUsd: 0,
        attempt: 1,
      },
      {},
    );
    db.upsertGame({
      id: 'g1',
      title: 'x',
      tagline: '',
      archetype: 'platformer',
      status: 'generating',
      createdAt: new Date().toISOString(),
      golden: false,
      jobId: 'j1',
      costUsd: 0,
      cover: null,
      failure: null,
      engineVersion: '1.0.0',
      archetypeVersion: '1.0.0',
    });
    const interrupted = db.reconcileInterruptedJobs();
    expect(interrupted).toEqual(['j1']);
    expect(db.getJob('j1')?.status).toBe('failed');
    expect(db.getJob('j1')?.error?.code).toBe('interrupted');
    expect(db.getGame('g1')?.status).toBe('failed');
  });

  it('ledger keeps failed + repair calls and survives game deletion (lifetime spend)', () => {
    db.insertUsage({ jobId: 'j2', gameId: 'g2', stage: 'design', model: 'm', provider: 'p', inputTokens: 100, outputTokens: 50, costUsd: 0.01, failed: false, repair: false });
    db.insertUsage({ jobId: 'j2', gameId: 'g2', stage: 'levels', model: 'm', provider: 'p', inputTokens: 0, outputTokens: 0, costUsd: 0, failed: true, repair: false });
    db.insertUsage({ jobId: 'j2', gameId: 'g2', stage: 'repair', model: 'm', provider: 'p', inputTokens: 40, outputTokens: 20, costUsd: 0.004, failed: false, repair: true });
    expect(db.jobCost('j2')).toBeCloseTo(0.014, 9);
    db.deleteGame('g2');
    expect(db.lifetimeSpendUsd()).toBeCloseTo(0.014, 9);
  });

  it('unknown-price events poison job cost to null (cost unavailable, not $0)', () => {
    db.insertUsage({ jobId: 'j3', gameId: 'g3', stage: 'design', model: 'm', provider: 'p', inputTokens: 1, outputTokens: 1, costUsd: null, failed: false, repair: false });
    expect(db.jobCost('j3')).toBeNull();
  });

  it('scores keep a top list per game', () => {
    for (let i = 0; i < 12; i++) db.addScore('g4', 'AAA', i * 100);
    const top = db.topScores('g4');
    expect(top).toHaveLength(10);
    expect(top[0]!.score).toBe(1100);
    expect(top[9]!.score).toBe(200);
  });
});
