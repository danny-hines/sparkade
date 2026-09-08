#!/usr/bin/env tsx
// Isolated action-pose experiment using the production prompts, normalization,
// review and cache. Defaults to mock; --live uses configured image/design providers.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  PLATFORMER_BASE_POSES,
  PLATFORMER_ACTION_ASSET_ROLES,
  PLATFORMER_PLAY_STYLES,
  GENERATED_GAME_ASSET_FILES,
  type PlatformerPlayStyle,
  type PlatformerSpec,
  type PlatformerBasePose,
} from '../packages/shared/src/index';
import { platformerStyleExample } from '../packages/archetypes/src/platformer/examples';
import { generatePlatformerActions } from '../packages/server/src/assets/platformer-actions';
import { buildPlatformerJumpJudgeBoard } from '../packages/server/src/assets/platformer-jump-judge';
import { GameAssetWorkspace, readGameAssetManifest } from '../packages/server/src/assets/manifest';
import { MetaImageAdapter } from '../packages/server/src/providers/meta-image';
import { mockGeneratedImage } from '../packages/server/src/assets/game-art';
import { ConfigStore } from '../packages/server/src/storage/config';
import { stageProvider } from '../packages/server/src/providers';
import { parseModelJson } from '../packages/server/src/pipeline/prompts';
import { costOf } from '../packages/server/src/pipeline/cost';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const root = resolve(import.meta.dirname, '..');
const live = process.argv.includes('--live');
const style = (arg('style') ?? 'armedClimber') as PlatformerPlayStyle;
if (!PLATFORMER_PLAY_STYLES.includes(style)) throw new Error('Unknown --style');
const out = resolve(
  arg('out') ??
    join(root, 'data/experiments/platformer-actions', `${style}-${live ? 'live' : 'mock'}`),
);
const gamePath = resolve(
  arg('game') ?? join(root, 'packages/generation/golden/golden-platformer.json'),
);
const assetsDir = resolve(arg('assets') ?? gamePath.replace(/\.json$/, '.assets'));
if (live && existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const config = new ConfigStore(resolve(process.env.SPARKADE_DATA ?? join(root, 'data'))).get();
const configImage = config.imageGeneration;
const spec = platformerStyleExample(
  JSON.parse(readFileSync(gamePath, 'utf8')) as PlatformerSpec,
  style,
);
const base = Object.fromEntries(
  PLATFORMER_BASE_POSES.map((pose) => {
    const role =
      `platformer${pose[0]!.toUpperCase()}${pose.slice(1)}` as keyof typeof GENERATED_GAME_ASSET_FILES;
    return [pose, readFileSync(join(assetsDir, GENERATED_GAME_ASSET_FILES[role]))];
  }),
) as Record<PlatformerBasePose, Buffer>;
mkdirSync(out, { recursive: true });
const evidence = join(out, `attempt-${Date.now()}`);
mkdirSync(evidence, { recursive: true });
for (const pose of PLATFORMER_BASE_POSES) writeFileSync(join(out, `${pose}.png`), base[pose]);
const model = live ? configImage.model : 'mock-image';
const adapter = new MetaImageAdapter(configImage);
const judge = stageProvider(config, 'design');
if (live && judge.providerName === 'mock')
  throw new Error('--live requires a real design provider; unset SPARKADE_PROVIDER=mock.');
let imageCalls = 0,
  judgeCalls = 0,
  judgeCost = 0;
const attempts = new Map<string, number>();
// Bound live requests to two at a time.
let active = 0;
const waiters: (() => void)[] = [];
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>((r) => waiters.push(r));
  else active++;
  try {
    return await work();
  } finally {
    const next = waiters.shift();
    if (next) next();
    else active--;
  }
}
let failure: unknown;
try {
  await generatePlatformerActions({
    spec,
    base,
    source: base.idle,
    sourceKind: 'key-art',
    wardrobe: { heroConcept: spec.meta.heroConcept },
    workspace: new GameAssetWorkspace(out, model),
    report: console.log,
    generate: (pose, prompt, reference) =>
      slot(async () => {
        const n = (attempts.get(pose) ?? 0) + 1;
        attempts.set(pose, n);
        writeFileSync(join(evidence, `${pose}-${n}-prompt.txt`), prompt);
        writeFileSync(join(evidence, `${pose}-${n}-reference.png`), reference);
        const raw = live
          ? (
              await adapter.edit({
                prompt,
                image: reference,
                size: '1024x1024',
                outputFormat: 'png',
                user: 'platformer-action-lab',
              })
            ).image
          : await mockGeneratedImage(prompt);
        imageCalls++;
        writeFileSync(join(evidence, `${pose}-${n}-raw.png`), raw);
        console.log(`Generated ${pose} (${n})`);
        return raw;
      }),
    judge: async (prompt, jsonSchema, image, mockDecision) => {
      const n = ++judgeCalls;
      writeFileSync(join(evidence, `review-${n}.jpg`), image);
      writeFileSync(join(evidence, `review-${n}-prompt.json`), JSON.stringify(prompt, null, 2));
      let result = mockDecision;
      if (live) {
        const response = await judge.provider.complete(
          { ...prompt, jsonSchema, image, maxTokens: 3000, timeoutMs: 120_000, effort: 'low' },
          { model: judge.model },
        );
        result = parseModelJson(response.text);
        judgeCost += costOf(response.model ?? judge.model, response.usage, config.pricing) ?? 0;
      }
      writeFileSync(join(evidence, `review-${n}.json`), JSON.stringify(result, null, 2));
      return result;
    },
  });
} catch (error) {
  failure = error;
}
const result = {
  mode: live ? 'live' : 'mock',
  style,
  evidence,
  imageCalls,
  judgeCalls,
  imageCostUsd: live ? imageCalls * configImage.pricePerImageUsd : 0,
  judgeCostUsd: judgeCost,
  error: failure instanceof Error ? failure.message : null,
};
writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
if (!failure) {
  const manifest = readGameAssetManifest(out)!;
  const candidates = Object.entries(PLATFORMER_ACTION_ASSET_ROLES).flatMap(([id, role]) => {
    const asset = manifest.assets.find((a) => a.role === role);
    return asset ? [{ id, processed: readFileSync(join(out, asset.filename)) }] : [];
  });
  writeFileSync(
    join(out, 'preview.jpg'),
    await buildPlatformerJumpJudgeBoard({
      source: base.idle,
      sourceKind: 'key-art',
      idle: base.idle,
      sideAnchor: base.sideIdle,
      candidates,
      purpose: 'actions',
    }),
  );
}
console.log(JSON.stringify({ ...result, out }));
if (failure) throw failure;
