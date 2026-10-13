#!/usr/bin/env tsx
// Backfill rigid-limb run in-betweens (platformer-run-rig.ts) onto existing
// platformer games, the same frames generation stores when
// SPARKADE_PLATFORMER_RUN_RIG=1. A game gets them only when at least one
// frame used the rig; otherwise its player keeps computing pixel shift.
//
//   npx tsx scripts/backfill-run-rig.mts --local [--data DIR]   # dry run: games and SAM calls
//   npx tsx scripts/backfill-run-rig.mts --local --live         # call SAM, write each game's frames
//   npx tsx scripts/backfill-run-rig.mts --golden --live        # repo golden-platformer (commit the result)
//   npx tsx scripts/backfill-run-rig.mts --cloud [--live]       # published website games
//
// Only run --local/--golden writes where the code reading the two new assets
// is installed, and only write cloud games once the website deploy that knows
// them is live. SAM responses are cached under --cache (default
// <data>/run-rig-sam-cache), so reruns and interrupted runs cost nothing.
// --cloud covers games whose art is in public Blob storage (kiosk and cloud
// generation); website-created games keep their art in a private bundle behind
// moderation and are skipped. It reads DATABASE_URL and BLOB_READ_WRITE_TOKEN from
// apps/site/.env.local; SAM uses META_API_KEY from .env. --max-calls caps
// live SAM calls (default 400); --games a,b limits the run.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GENERATED_GAME_ASSET_FILES } from '../packages/shared/src/constants';
import {
  GameAssetWorkspace,
  generatedAssetForRole,
  sha256,
} from '../packages/server/src/assets/manifest';
import {
  buildRigRunInbetweens,
  decodeRigImage,
  encodeRigImage,
  PLATFORMER_RUN_RIG_VERSION,
  RUN_RIG_SAM_INPUT,
  SamResponseCache,
  samInputPixels,
  type RigImage,
} from '../packages/server/src/assets/platformer-sam-rig';
import { alignRgbaFrames } from '../packages/shared/src/run-inbetweens';
import {
  MetaSamAdapter,
  META_SAM_PRICE_PER_IMAGE_USD,
} from '../packages/server/src/providers/meta-sam';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const live = flag('live');
const only = option('games', '')
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean);
const dataDir = resolve(option('data', process.env.SPARKADE_DATA ?? join(root, 'data')));
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const cache = new SamResponseCache({
  cacheDir: resolve(option('cache', join(dataDir, 'run-rig-sam-cache'))),
  live,
  segment: live ? (png, concept) => new MetaSamAdapter({}).segmentImage(png, concept) : undefined,
  maxLiveCalls: Number(option('max-calls', '400')),
  concurrency: 4,
});

const FILES = {
  walk1: GENERATED_GAME_ASSET_FILES.platformerWalk1,
  sideIdle: GENERATED_GAME_ASSET_FILES.platformerSideIdle,
  walk2: GENERATED_GAME_ASSET_FILES.platformerWalk2,
  runMid1: GENERATED_GAME_ASSET_FILES.platformerRunMid1,
  runMid2: GENERATED_GAME_ASSET_FILES.platformerRunMid2,
};
type Frames = { walk1: Buffer; sideIdle: Buffer; walk2: Buffer };
type Outcome =
  | { kind: 'frames'; runMid1: Buffer; runMid2: Buffer; methods: string }
  | { kind: 'pixel shift'; methods: string }
  | { kind: 'missing SAM responses' };

/** The rig for one game, its SAM responses cached under `cacheGame`. */
async function rig(cacheGame: string, frames: Frames): Promise<Outcome> {
  const decoded = {
    walk1: await decodeRigImage(frames.walk1),
    sideIdle: await decodeRigImage(frames.sideIdle),
    walk2: await decodeRigImage(frames.walk2),
  };
  // The entry point aligns the three frames before sending SAM the contacts;
  // match each request back to its frame for the cache key.
  const [walk1, , walk2] = alignRgbaFrames([
    decoded.walk1,
    decoded.sideIdle,
    decoded.walk2,
  ]) as RigImage[];
  const pngs = await Promise.all(
    [walk1!, walk2!].map((image) => encodeRigImage(samInputPixels(image, RUN_RIG_SAM_INPUT))),
  );
  let missing = false;
  const result = await buildRigRunInbetweens(decoded, async (png, concept) => {
    const frame = png.equals(pngs[0]!) ? 'walk-1' : png.equals(pngs[1]!) ? 'walk-2' : null;
    if (!frame) throw new Error('unexpected SAM input');
    const entry = await cache.get({
      game: cacheGame,
      frame,
      concept,
      input: RUN_RIG_SAM_INPUT,
      png,
    });
    if (!entry || entry.error) {
      missing = true;
      return { masks: [] };
    }
    return { masks: entry.masks };
  });
  if (missing) return { kind: 'missing SAM responses' };
  const methods = `A ${result.runMid1.method}, B ${result.runMid2.method}`;
  if (result.runMid1.method === 'pixel shift' && result.runMid2.method === 'pixel shift')
    return { kind: 'pixel shift', methods };
  return {
    kind: 'frames',
    runMid1: await encodeRigImage(result.runMid1.image),
    runMid2: await encodeRigImage(result.runMid2.image),
    methods,
  };
}

/** Rig a game folder's frames and store them in its asset manifest. */
async function rigFolder(id: string, assetsDir: string): Promise<string> {
  const entries = (['walk1', 'sideIdle', 'walk2'] as const).map((key) =>
    generatedAssetForRole(
      assetsDir,
      key === 'walk1'
        ? 'platformerWalk1'
        : key === 'walk2'
          ? 'platformerWalk2'
          : 'platformerSideIdle',
    ),
  );
  if (entries.some((entry) => !entry)) return 'skipped: no complete run frames';
  const frames: Frames = {
    walk1: readFileSync(join(assetsDir, FILES.walk1)),
    sideIdle: readFileSync(join(assetsDir, FILES.sideIdle)),
    walk2: readFileSync(join(assetsDir, FILES.walk2)),
  };
  const fingerprint = sha256(Buffer.concat([frames.walk1, frames.sideIdle, frames.walk2]));
  const workspace = new GameAssetWorkspace(assetsDir, entries[0]!.model);
  if (
    workspace.load('platformerRunMid1', PLATFORMER_RUN_RIG_VERSION, fingerprint) &&
    workspace.load('platformerRunMid2', PLATFORMER_RUN_RIG_VERSION, fingerprint)
  )
    return 'already has frames';
  const outcome = await rig(id, frames);
  if (outcome.kind !== 'frames')
    return `${outcome.kind}${'methods' in outcome ? ` (${outcome.methods})` : ''}`;
  if (!live) return `would store frames (${outcome.methods})`;
  await workspace.store(
    'platformerRunMid1',
    outcome.runMid1,
    PLATFORMER_RUN_RIG_VERSION,
    fingerprint,
  );
  await workspace.store(
    'platformerRunMid2',
    outcome.runMid2,
    PLATFORMER_RUN_RIG_VERSION,
    fingerprint,
  );
  return `stored frames (${outcome.methods})`;
}

async function local() {
  const gamesDir = join(dataDir, 'games');
  for (const id of readdirSync(gamesDir).sort()) {
    if (only.length && !only.includes(id)) continue;
    const specPath = join(gamesDir, id, 'game.json');
    if (!existsSync(specPath)) continue;
    const spec = JSON.parse(readFileSync(specPath, 'utf8')) as { archetype?: string };
    if (spec.archetype !== 'platformer') continue;
    console.log(`${id}: ${await rigFolder(id, join(gamesDir, id, 'assets'))}`);
  }
}

async function golden() {
  const dir = join(root, 'packages/generation/golden/golden-platformer.assets');
  console.log(`golden-platformer: ${await rigFolder('golden-platformer', dir)}`);
}

async function cloud() {
  process.loadEnvFile(join(root, 'apps/site/.env.local'));
  const { neon } = await import('@neondatabase/serverless');
  const { put } = await import('@vercel/blob');
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`SELECT id, assets_json FROM public_games
    WHERE status = 'ready' AND spec_json->>'archetype' = 'platformer'
    ORDER BY created_at`) as Array<{ id: string; assets_json: Record<string, string> | string }>;
  for (const row of rows) {
    if (only.length && !only.includes(row.id)) continue;
    const assets =
      typeof row.assets_json === 'string'
        ? (JSON.parse(row.assets_json) as Record<string, string>)
        : row.assets_json;
    const label = `public ${row.id}`;
    if (assets[FILES.runMid1] && assets[FILES.runMid2]) {
      console.log(`${label}: already has frames`);
      continue;
    }
    if (!assets[FILES.walk1] || !assets[FILES.sideIdle] || !assets[FILES.walk2]) {
      console.log(`${label}: skipped: no complete run frames`);
      continue;
    }
    // Website-created games serve art from a private bundle behind moderation;
    // public Blob frames would bypass it, so they keep pixel shift for now.
    if (!/^https:\/\//.test(assets[FILES.walk1]!)) {
      console.log(`${label}: skipped: website game (private bundle)`);
      continue;
    }
    const download = async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} for ${url}`);
      return Buffer.from(await response.arrayBuffer());
    };
    const outcome = await rig(`public-${row.id}`, {
      walk1: await download(assets[FILES.walk1]!),
      sideIdle: await download(assets[FILES.sideIdle]!),
      walk2: await download(assets[FILES.walk2]!),
    });
    if (outcome.kind !== 'frames') {
      console.log(
        `${label}: ${outcome.kind}${'methods' in outcome ? ` (${outcome.methods})` : ''}`,
      );
      continue;
    }
    if (!live) {
      console.log(`${label}: would store frames (${outcome.methods})`);
      continue;
    }
    const urls: Record<string, string> = {};
    for (const [file, png] of [
      [FILES.runMid1, outcome.runMid1],
      [FILES.runMid2, outcome.runMid2],
    ] as const) {
      const blob = await put(`public-games/${row.id}/${file}`, png, {
        access: 'public',
        contentType: 'image/png',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      urls[file] = blob.url;
    }
    // Merge only the two new files; updated_at stays so the feed order holds.
    await sql`UPDATE public_games SET assets_json = assets_json || ${JSON.stringify(urls)}::jsonb
      WHERE id = ${row.id}`;
    console.log(`${label}: stored frames (${outcome.methods})`);
  }
}

if (flag('local')) await local();
if (flag('golden')) await golden();
if (flag('cloud')) await cloud();
if (!flag('local') && !flag('golden') && !flag('cloud'))
  console.log('Choose --local, --golden, or --cloud (add --live to call SAM and write).');
const usage = cache.usage;
console.log(
  JSON.stringify({
    live,
    samCalls: usage.liveCalls,
    failed: usage.failedCalls,
    cached: usage.cacheHits + usage.dedupedHits,
    missing: usage.missing,
    estimatedCostUsd: Math.round(usage.liveCalls * META_SAM_PRICE_PER_IMAGE_USD * 1000) / 1000,
  }),
);
