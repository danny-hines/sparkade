#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import sharp from 'sharp';
import {
  buildSourcePalette,
  indexImageToSourcePalette,
} from '../packages/server/src/assets/source-palette';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT = join(ROOT, 'packages/engine/src/library/platformer-hd.generated.json');

type TileKind =
  | 'solid'
  | 'solid_inner'
  | 'platform'
  | 'hazard'
  | 'checkpoint'
  | 'exit'
  | 'deco'
  | 'moving_platform';

interface SpriteFrame {
  w: number;
  h: number;
  rows: string[];
}

interface PackFile {
  version: 1;
  density: number;
  themes: Record<
    string,
    {
      source?: { model?: string; note?: string };
      sourcePalette?: string[];
      entries: Partial<
        Record<
          TileKind,
          {
            frames: SpriteFrame[];
            anims: Record<string, number[]>;
          }
        >
      >;
    }
  >;
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function required(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

async function cells(image: Buffer, columns: number, rows: number): Promise<Buffer[]> {
  const metadata = await sharp(image).metadata();
  if (!metadata.width || !metadata.height) throw new Error('undecodable atlas');
  const width = Math.floor(metadata.width / columns);
  const height = Math.floor(metadata.height / rows);
  const result: Buffer[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      result.push(
        await sharp(image)
          .extract({ left: column * width, top: row * height, width, height })
          .png()
          .toBuffer(),
      );
    }
  }
  return result;
}

async function derivedPlatform(capCell: Buffer): Promise<Buffer> {
  const ledge = await sharp(capCell)
    .extract({ left: 0, top: 0, width: 64, height: 20 })
    .png()
    .toBuffer();
  return sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: ledge, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function main(): Promise<void> {
  const theme = required('theme').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(theme)) throw new Error('theme must be a lowercase id');
  const assetsDir = resolve(required('assets'));
  const paths = {
    solid: join(assetsDir, 'platformer-terrain-solid-cap.png'),
    solid_inner: join(assetsDir, 'platformer-terrain-solid-inner.png'),
    hazard: join(assetsDir, 'platformer-terrain-hazard.png'),
    checkpoint: join(assetsDir, 'platformer-terrain-checkpoint.png'),
    exit: join(assetsDir, 'platformer-terrain-exit.png'),
    deco: join(assetsDir, 'platformer-terrain-decoration.png'),
    moving_platform: join(assetsDir, 'platformer-terrain-moving-platform.png'),
  } as const;
  for (const path of Object.values(paths)) {
    if (!existsSync(path)) throw new Error(`missing source asset ${path}`);
  }
  const sourcePalette = await buildSourcePalette(
    Object.values(paths).map((path) => readFileSync(path)),
  );

  const capCells = await cells(readFileSync(paths.solid), 4, 1);
  const innerCells = await cells(readFileSync(paths.solid_inner), 4, 4);
  const platform = await derivedPlatform(capCells[0]!);
  const entry = async (frames: readonly Buffer[]) => ({
    frames: await Promise.all(
      frames.map((frame) => indexImageToSourcePalette(frame, sourcePalette)),
    ),
    anims: { idle: [0] },
  });
  const entries = {
    solid: await entry(capCells),
    solid_inner: await entry(innerCells),
    platform: await entry([platform]),
    hazard: await entry([readFileSync(paths.hazard)]),
    checkpoint: await entry([readFileSync(paths.checkpoint)]),
    exit: await entry([readFileSync(paths.exit)]),
    deco: await entry([readFileSync(paths.deco)]),
    moving_platform: await entry([readFileSync(paths.moving_platform)]),
  } satisfies Record<TileKind, { frames: SpriteFrame[]; anims: Record<string, number[]> }>;

  const file = JSON.parse(readFileSync(OUTPUT, 'utf8')) as PackFile;
  file.themes[theme] = {
    sourcePalette,
    source: {
      model: 'muse-image-1.0',
      note:
        argument('note') ??
        `Curated from ${basename(resolve(assetsDir, '..'))}; one-way platform derived from the accepted solid cap.`,
    },
    entries,
  };
  writeFileSync(OUTPUT, `${JSON.stringify(file, null, 2)}\n`);
  process.stdout.write(
    `promoted ${theme} platformer HD pack (${Object.keys(entries).length} roles)\n`,
  );
}

await main();
