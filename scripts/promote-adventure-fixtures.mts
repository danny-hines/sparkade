#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import sharp from 'sharp';
import {
  buildSourcePalette,
  indexImageToSourcePalette,
} from '../packages/server/src/assets/source-palette';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT = join(ROOT, 'packages/engine/src/library/adventure-fixtures.generated.json');

interface SpriteFrame {
  w: number;
  h: number;
  rows: string[];
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

async function atlasCells(image: Buffer): Promise<Buffer[]> {
  const square = await sharp(image)
    .rotate()
    .resize(1024, 1024, { fit: 'fill', kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
  const result: Buffer[] = [];
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 4; column++) {
      result.push(
        await sharp(square)
          .extract({ left: column * 256, top: row * 256, width: 256, height: 256 })
          .png()
          .toBuffer(),
      );
    }
  }
  return result;
}

async function doorCells(image: Buffer): Promise<Buffer[]> {
  const normalized = await sharp(image)
    .rotate()
    .resize(1024, 1536, { fit: 'fill', kernel: sharp.kernel.nearest })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = normalized;
  const visited = new Uint8Array(info.width * info.height);
  const queue = new Int32Array(info.width * info.height);
  let head = 0;
  let tail = 0;
  const backgroundCandidate = (pixel: number): boolean => {
    const offset = pixel * 4;
    if (data[offset + 3]! <= 8) return true;
    const r = data[offset]!;
    const g = data[offset + 1]!;
    const b = data[offset + 2]!;
    return Math.max(r, g, b) < 100 && Math.max(r, g, b) - Math.min(r, g, b) <= 12;
  };
  const visit = (pixel: number): void => {
    if (visited[pixel] || !backgroundCandidate(pixel)) return;
    visited[pixel] = 1;
    queue[tail++] = pixel;
  };
  for (let x = 0; x < info.width; x++) {
    visit(x);
    visit((info.height - 1) * info.width + x);
  }
  for (let y = 0; y < info.height; y++) {
    visit(y * info.width);
    visit(y * info.width + info.width - 1);
  }
  while (head < tail) {
    const pixel = queue[head++]!;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    if (x > 0) visit(pixel - 1);
    if (x + 1 < info.width) visit(pixel + 1);
    if (y > 0) visit(pixel - info.width);
    if (y + 1 < info.height) visit(pixel + info.width);
  }
  for (let pixel = 0; pixel < visited.length; pixel++) {
    if (!visited[pixel]) continue;
    const offset = pixel * 4;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
  }
  const cleaned = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
  return Promise.all(
    Array.from({ length: 3 }, (_, row) =>
      sharp(cleaned)
        .extract({ left: 0, top: row * 512, width: 1024, height: 512 })
        .png()
        .toBuffer(),
    ),
  );
}

async function normalizeFixture(
  image: Buffer,
  canvas: { width: number; height: number },
  bounds: { width: number; height: number },
): Promise<Buffer> {
  const decoded = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = decoded.info.width;
  let top = decoded.info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < decoded.info.height; y++) {
    for (let x = 0; x < decoded.info.width; x++) {
      if (decoded.data[(y * decoded.info.width + x) * 4 + 3]! <= 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error('fixture atlas cell is empty');

  const sourceWidth = right - left + 1;
  const sourceHeight = bottom - top + 1;
  const scale = Math.min(bounds.width / sourceWidth, bounds.height / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const normalized = await sharp(decoded.data, {
    raw: {
      width: decoded.info.width,
      height: decoded.info.height,
      channels: 4,
    },
  })
    .extract({ left, top, width: sourceWidth, height: sourceHeight })
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.nearest })
    .extend({
      left: Math.floor((canvas.width - width) / 2),
      right: Math.ceil((canvas.width - width) / 2),
      top: canvas.height - height,
      bottom: 0,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ palette: true, colours: 48, dither: 0, compressionLevel: 9 })
    .toBuffer();
  return normalized;
}

async function indexedEntry(
  frames: readonly Buffer[],
  sourcePalette: readonly string[],
  anims: Record<string, number[]>,
): Promise<{ frames: SpriteFrame[]; anims: Record<string, number[]> }> {
  return {
    frames: await Promise.all(
      frames.map((frame) => indexImageToSourcePalette(frame, sourcePalette)),
    ),
    anims,
  };
}

async function main(): Promise<void> {
  const atlasPath = resolve(required('atlas'));
  const doorsPath = resolve(required('doors'));
  const cells = await atlasCells(readFileSync(atlasPath));
  const lowDecoration = await Promise.all(
    cells
      .slice(0, 4)
      .map((cell) => normalizeFixture(cell, { width: 64, height: 96 }, { width: 58, height: 48 })),
  );
  const tallDecoration = await Promise.all(
    cells
      .slice(4, 8)
      .map((cell) => normalizeFixture(cell, { width: 64, height: 96 }, { width: 58, height: 90 })),
  );
  const blocks = await Promise.all(
    cells
      .slice(8, 12)
      .map((cell) => normalizeFixture(cell, { width: 64, height: 64 }, { width: 60, height: 60 })),
  );
  const switches = await Promise.all(
    cells
      .slice(12, 16)
      .map((cell) => normalizeFixture(cell, { width: 64, height: 64 }, { width: 60, height: 60 })),
  );
  const doors = await Promise.all(
    (await doorCells(readFileSync(doorsPath))).map((cell) =>
      normalizeFixture(cell, { width: 128, height: 64 }, { width: 124, height: 60 }),
    ),
  );
  const all = [...lowDecoration, ...tallDecoration, ...blocks, ...switches, ...doors];
  const sourcePalette = await buildSourcePalette(all);
  const model = argument('model') ?? 'built-in-image-generation';
  const file = {
    version: 1,
    density: 4,
    sourcePalette,
    source: {
      model,
      note: `Curated from ${basename(atlasPath)} and ${basename(doorsPath)}; equal-grid crop, edge-connected backdrop removal, nearest-neighbor normalization, and palette indexing are deterministic.`,
    },
    entries: {
      deco: await indexedEntry([...lowDecoration, ...tallDecoration], sourcePalette, {
        idle: [0, 1, 2, 3, 4, 5, 6, 7],
      }),
      block: await indexedEntry(blocks, sourcePalette, { idle: [0, 1, 2, 3] }),
      switch: await indexedEntry(switches, sourcePalette, {
        idle: [0, 2],
        pressed: [1, 3],
      }),
      door_open: await indexedEntry([doors[0]!], sourcePalette, { idle: [0] }),
      door_locked: await indexedEntry([doors[1]!], sourcePalette, { idle: [0] }),
      door_boss: await indexedEntry([doors[2]!], sourcePalette, { idle: [0] }),
    },
  };
  writeFileSync(OUTPUT, `${JSON.stringify(file, null, 2)}\n`);
  process.stdout.write(`promoted Adventure fixture atlas (${all.length} frames)\n`);
}

await main();
