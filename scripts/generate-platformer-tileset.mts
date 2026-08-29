#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  PLATFORMER_TILESET_AUTHOR_PROMPT_VERSION,
  PLATFORMER_TILESET_FIXTURE_ROLES,
  buildPlatformerTilesetBodyPrompt,
  buildPlatformerTilesetBodyStyleReference,
  buildPlatformerTilesetFixturePrompt,
  buildPlatformerTilesetFixturePolicyFallbackPrompt,
  buildPlatformerTilesetTerrainPrompt,
  processPlatformerTilesetFixture,
  processPlatformerTilesetTerrain,
  type PlatformerTilesetFixtureRole,
} from '../packages/server/src/assets/platformer-tileset-author';
import { recoverGeneratedPlatformerGreenPanel } from '../packages/server/src/assets/platformer-pose';
import { MetaImageAdapter } from '../packages/server/src/providers/meta-image';
import { ProviderHttpError, ProviderNetworkError } from '../packages/server/src/providers/base';
import { ConfigStore } from '../packages/server/src/storage/config';

const ROOT = resolve(import.meta.dirname, '..');

function argument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function required(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

function loadDotEnv(): void {
  const path = join(ROOT, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && process.env[match[1]!] === undefined) {
      process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
    }
  }
}

async function mapLimit<T>(
  values: readonly T[],
  concurrency: number,
  work: (value: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const worker = async () => {
    for (;;) {
      const current = index++;
      const value = values[current];
      if (value === undefined) return;
      await work(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPolicyError(error: unknown): boolean {
  return (
    error instanceof ProviderHttpError &&
    error.status === 400 &&
    /content[_ -]?policy|filtered/i.test(error.body)
  );
}

async function withTransientRetry<T>(label: string, work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      const transient =
        (error instanceof ProviderHttpError && error.transient) ||
        error instanceof ProviderNetworkError;
      if (!transient || attempt >= 3) throw error;
      const hintedMs =
        error instanceof ProviderHttpError && error.retryAfterS ? error.retryAfterS * 1_000 : 0;
      const delayMs = Math.min(10_000, Math.max(hintedMs, 2_000 * 2 ** attempt));
      process.stdout.write(
        `${label} hit a transient provider error; retrying in ${Math.round(delayMs / 1_000)}s (${attempt + 1}/3)…\n`,
      );
      await sleep(delayMs);
    }
  }
}

function fixtureFilename(role: PlatformerTilesetFixtureRole): string {
  return {
    hazard: 'platformer-terrain-hazard.png',
    checkpoint: 'platformer-terrain-checkpoint.png',
    exit: 'platformer-terrain-exit.png',
    deco: 'platformer-terrain-decoration.png',
    movingPlatform: 'platformer-terrain-moving-platform.png',
    spring: 'platformer-terrain-spring.png',
  }[role];
}

async function main(): Promise<void> {
  loadDotEnv();
  const theme = required('theme').trim().toLowerCase();
  const concept = required('concept').replace(/\s+/g, ' ').trim();
  if (!/^[a-z][a-z0-9_]*$/.test(theme)) throw new Error('theme must be a lowercase id');
  if (!concept) throw new Error('concept must not be empty');

  const dataDir = resolve(process.env.SPARKADE_DATA ?? join(ROOT, 'data'));
  const imageConfig = new ConfigStore(dataDir).get().imageGeneration;
  const adapter = new MetaImageAdapter({
    baseUrl: imageConfig.baseUrl,
    model: imageConfig.model,
    apiKeyEnv: imageConfig.apiKeyEnv,
    timeoutMs: imageConfig.timeoutMs,
    name: 'platformer-tileset-author',
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = resolve(
    argument('output') ?? join(dataDir, 'experiments', 'platformer-tilesets', `${theme}-${stamp}`),
  );
  const assetsDir = join(runDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });

  const terrainPrompt = buildPlatformerTilesetTerrainPrompt(theme, concept);
  const bodyPrompt = buildPlatformerTilesetBodyPrompt(theme, concept);
  const terrainRawPath = join(runDir, 'terrain-raw.png');
  const bodyRawPath = join(runDir, 'terrain-body-raw.png');
  const bodyStyleReferencePath = join(runDir, 'terrain-body-style-reference.png');
  let imageCalls =
    (existsSync(terrainRawPath) ? 1 : 0) +
    (existsSync(bodyRawPath) ? 1 : 0) +
    readdirSync(runDir).filter((name) => /-raw-\d+\.png$/.test(name)).length;
  let terrainImage: Buffer;
  if (existsSync(terrainRawPath)) {
    terrainImage = readFileSync(terrainRawPath);
    process.stdout.write(`Reusing ${theme} terrain material.\n`);
  } else {
    process.stdout.write(`Generating ${theme} terrain material…\n`);
    const terrain = await withTransientRetry(`${theme} terrain`, () =>
      adapter.generate({
        prompt: terrainPrompt,
        outputFormat: 'png',
        size: '1024x1024',
        user: `tileset-${theme}`,
      }),
    );
    terrainImage = terrain.image;
    imageCalls++;
    writeFileSync(terrainRawPath, terrainImage);
  }
  writeFileSync(join(runDir, 'terrain-prompt.txt'), `${terrainPrompt}\n`);

  const bodyStyleReference = await buildPlatformerTilesetBodyStyleReference(terrainImage);
  writeFileSync(bodyStyleReferencePath, bodyStyleReference);

  let bodyImage: Buffer;
  if (existsSync(bodyRawPath)) {
    bodyImage = readFileSync(bodyRawPath);
    process.stdout.write(`Reusing ${theme} buried-body texture.\n`);
  } else {
    process.stdout.write(`Generating ${theme} buried-body texture…\n`);
    const body = await withTransientRetry(`${theme} buried body`, () =>
      adapter.edit({
        prompt: bodyPrompt,
        image: bodyStyleReference,
        imageMimeType: 'image/png',
        imageFilename: `${theme}-interior-material-style-reference.png`,
        outputFormat: 'png',
        size: '1024x1024',
        user: `tileset-${theme}`,
      }),
    );
    bodyImage = body.image;
    imageCalls++;
    writeFileSync(bodyRawPath, bodyImage);
  }
  writeFileSync(join(runDir, 'terrain-body-prompt.txt'), `${bodyPrompt}\n`);

  const capPath = join(assetsDir, 'platformer-terrain-solid-cap.png');
  const innerPath = join(assetsDir, 'platformer-terrain-solid-inner.png');
  if (!existsSync(capPath) || !existsSync(innerPath)) {
    const processedTerrain = await processPlatformerTilesetTerrain(terrainImage, bodyImage);
    if (!existsSync(capPath)) writeFileSync(capPath, processedTerrain.solidCap);
    if (!existsSync(innerPath)) writeFileSync(innerPath, processedTerrain.solidInner);
  }

  const fixturePrompts: Record<string, string> = {};
  const fixturePolicyFallbackPrompts: Record<string, string> = {};
  await mapLimit(PLATFORMER_TILESET_FIXTURE_ROLES, 3, async (role) => {
    const basePrompt = buildPlatformerTilesetFixturePrompt(theme, concept, role);
    const policyFallbackPrompt = buildPlatformerTilesetFixturePolicyFallbackPrompt(role);
    fixturePrompts[role] = basePrompt;
    fixturePolicyFallbackPrompts[role] = policyFallbackPrompt;
    const outputPath = join(assetsDir, fixtureFilename(role));
    if (existsSync(outputPath)) {
      process.stdout.write(`Reusing accepted ${theme} ${role}.\n`);
      return;
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt =
        attempt === 0
          ? basePrompt
          : `${basePrompt} RETRY CORRECTION: return exactly one complete, substantial, isolated asset on a perfectly flat #00ff00 background.`;
      process.stdout.write(`Generating ${theme} ${role}${attempt ? ' retry' : ''}…\n`);
      const edit = (editPrompt: string) =>
        withTransientRetry(`${theme} ${role}`, () =>
          adapter.edit({
            prompt: editPrompt,
            image: terrainImage,
            imageMimeType: 'image/png',
            imageFilename: `${theme}-terrain-reference.png`,
            outputFormat: 'png',
            size: '1024x1024',
            user: `tileset-${theme}`,
          }),
        );
      let result: Awaited<ReturnType<typeof edit>>;
      try {
        result = await edit(prompt);
      } catch (error) {
        if (!isPolicyError(error)) throw error;
        process.stdout.write(`${theme} ${role} was filtered; trying the safe fixture prompt…\n`);
        result = await edit(policyFallbackPrompt);
      }
      imageCalls++;
      writeFileSync(join(runDir, `${role}-raw-${attempt + 1}.png`), result.image);
      try {
        let processed: Buffer;
        try {
          processed = await processPlatformerTilesetFixture(result.image, role);
        } catch (initialError) {
          const recovery = await recoverGeneratedPlatformerGreenPanel(result.image);
          if (!recovery.recovered) throw initialError;
          processed = await processPlatformerTilesetFixture(recovery.image, role);
        }
        writeFileSync(outputPath, processed);
        process.stdout.write(`Accepted ${theme} ${role}.\n`);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `${theme} ${role} failed validation: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  });

  const manifest = {
    version: 1,
    promptVersion: PLATFORMER_TILESET_AUTHOR_PROMPT_VERSION,
    theme,
    concept,
    model: imageConfig.model,
    createdAt: new Date().toISOString(),
    imageCalls,
    estimatedCostUsd:
      imageConfig.pricePerImageUsd === null
        ? null
        : Number((imageCalls * imageConfig.pricePerImageUsd).toFixed(4)),
    terrainPrompt,
    bodyPrompt,
    fixturePrompts,
    fixturePolicyFallbackPrompts,
    status: 'candidate-needs-review',
  };
  writeFileSync(join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`\nCandidate pack: ${runDir}\n`);
  process.stdout.write(
    `After visual review: npm run tilesets:promote -- --theme ${theme} --assets ${assetsDir}\n`,
  );
}

await main();
