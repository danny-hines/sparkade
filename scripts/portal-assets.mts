// Build from repository goldens/defaults, never from a developer's data or credentials.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archetypes } from '@sparkade/archetypes';
import type { CloudGameBundle } from '@sparkade/shared';
import { Db } from '../packages/server/src/storage/db';
import { GameFiles, seedGoldenGames } from '../packages/server/src/storage/files';
import { defaultConfig } from '../packages/server/src/storage/config';
import { bundleAssets } from '../packages/web/src/portal-runtime';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'apps/portal/app/build');
const version = readFileSync(join(root, 'apps/portal/app/build.gradle'), 'utf8').match(
  /versionName '([^']+)'/,
)?.[1];
if (!version) throw new Error('Missing Portal app version');
const destination = join(buildDir, 'generated/portal-assets/www');
execFileSync('npx', ['vite', 'build', '--outDir', destination], {
  cwd: join(root, 'packages/web'),
  stdio: 'inherit',
});
const seed = join(buildDir, 'portal-seed');
rmSync(seed, { recursive: true, force: true });
mkdirSync(seed, { recursive: true });
const db = new Db(seed),
  files = new GameFiles(seed);
seedGoldenGames(
  files,
  db,
  Object.fromEntries(Object.values(archetypes).map((a) => [a.id, a.version])),
);
const games = db.listGames();
mkdirSync(join(destination, 'portal-games'), { recursive: true });
for (const game of games) {
  const dir = files.gameDir(game.id);
  const bundle: CloudGameBundle = {
    spec: files.readSpec(game.id)!,
    meta: files.readMeta(game.id)!,
    manifest: existsSync(join(dir, 'assets/manifest.json'))
      ? JSON.parse(readFileSync(join(dir, 'assets/manifest.json'), 'utf8'))
      : { version: 1, assets: [] },
  };
  const assetsDir = join(destination, 'api/games', game.id, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  for (const asset of bundle.manifest.assets)
    cpSync(join(dir, 'assets', asset.filename), join(assetsDir, asset.filename));
  writeFileSync(
    join(destination, 'portal-games', `${game.id}.json`),
    JSON.stringify({
      item: db.listItem(game),
      spec: bundle.spec,
      meta: bundle.meta,
      assets: bundleAssets(bundle),
      job: null,
      usage: [],
    }),
  );
}
const { audio, input, likeness, devices, presets, stages, pricing, imageGeneration } =
  defaultConfig();
let commit: string | null = null;
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
} catch {
  /* source archive */
}
writeFileSync(
  join(destination, 'portal-bootstrap.json'),
  JSON.stringify({
    version,
    buildCommit: commit,
    settings: {
      audio,
      input,
      likeness,
      devices,
      presets,
      stages,
      pricing,
      imageGeneration: {
        model: imageGeneration.model,
        baseUrl: imageGeneration.baseUrl,
        pricePerImageUsd: imageGeneration.pricePerImageUsd,
      },
    },
    games: games.map((game) => db.listItem(game)),
  }),
);
db.close();
rmSync(seed, { recursive: true, force: true });
console.log(`Packaged ${games.length} starter games with standalone Sparkade.`);
