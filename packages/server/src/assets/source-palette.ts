import sharp from 'sharp';
import type { SpriteData } from '@sparkade/shared';

interface WeightedColor {
  r: number;
  g: number;
  b: number;
  weight: number;
}

interface ColorBox {
  colors: WeightedColor[];
  weight: number;
}

function hex(color: Pick<WeightedColor, 'r' | 'g' | 'b'>): string {
  return `#${[color.r, color.g, color.b]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'))
    .join('')}`;
}

function luminance(color: Pick<WeightedColor, 'r' | 'g' | 'b'>): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

function distanceSquared(
  a: Pick<WeightedColor, 'r' | 'g' | 'b'>,
  b: Pick<WeightedColor, 'r' | 'g' | 'b'>,
): number {
  const meanRed = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return (2 + meanRed / 256) * dr * dr + 4 * dg * dg + (2 + (255 - meanRed) / 256) * db * db;
}

function channelRange(colors: readonly WeightedColor[], channel: 'r' | 'g' | 'b'): number {
  return Math.max(...colors.map((color) => color[channel])) - Math.min(...colors.map((color) => color[channel]));
}

function splitBox(box: ColorBox): [ColorBox, ColorBox] | null {
  if (box.colors.length < 2) return null;
  const channels: Array<'r' | 'g' | 'b'> = ['r', 'g', 'b'];
  const channel = channels.sort(
    (a, b) => channelRange(box.colors, b) - channelRange(box.colors, a),
  )[0]!;
  const sorted = [...box.colors].sort((a, b) => a[channel] - b[channel]);
  const halfway = box.weight / 2;
  let accumulated = 0;
  let splitAt = 1;
  for (; splitAt < sorted.length; splitAt++) {
    accumulated += sorted[splitAt - 1]!.weight;
    if (accumulated >= halfway) break;
  }
  splitAt = Math.max(1, Math.min(sorted.length - 1, splitAt));
  const make = (colors: WeightedColor[]): ColorBox => ({
    colors,
    weight: colors.reduce((sum, color) => sum + color.weight, 0),
  });
  return [make(sorted.slice(0, splitAt)), make(sorted.slice(splitAt))];
}

function centroid(colors: readonly WeightedColor[]): WeightedColor {
  const weight = colors.reduce((sum, color) => sum + color.weight, 0) || 1;
  return {
    r: colors.reduce((sum, color) => sum + color.r * color.weight, 0) / weight,
    g: colors.reduce((sum, color) => sum + color.g * color.weight, 0) / weight,
    b: colors.reduce((sum, color) => sum + color.b * color.weight, 0) / weight,
    weight,
  };
}

async function weightedImageColors(image: Buffer): Promise<WeightedColor[]> {
  const decoded = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const histogram = new Map<string, { r: number; g: number; b: number; count: number }>();
  let opaque = 0;
  for (let pixel = 0; pixel < decoded.info.width * decoded.info.height; pixel++) {
    const offset = pixel * 4;
    if (decoded.data[offset + 3]! <= 24) continue;
    const r = decoded.data[offset]!;
    const g = decoded.data[offset + 1]!;
    const b = decoded.data[offset + 2]!;
    const key = `${r},${g},${b}`;
    const current = histogram.get(key);
    if (current) current.count++;
    else histogram.set(key, { r, g, b, count: 1 });
    opaque++;
  }
  if (opaque === 0) return [];
  return [...histogram.values()].map((color) => ({
    r: color.r,
    g: color.g,
    b: color.b,
    // Every source role contributes the same total weight, so large terrain
    // sheets cannot erase the much smaller checkpoint/exit/deco colors.
    weight: color.count / opaque,
  }));
}

/** Build a shared 15-color RGB palette; index zero remains sprite transparency. */
export async function buildSourcePalette(images: readonly Buffer[]): Promise<string[]> {
  const merged = new Map<string, WeightedColor>();
  for (const image of images) {
    for (const color of await weightedImageColors(image)) {
      const key = `${color.r},${color.g},${color.b}`;
      const current = merged.get(key);
      if (current) current.weight += color.weight;
      else merged.set(key, { ...color });
    }
  }
  const colors = [...merged.values()];
  if (colors.length === 0) return Array(16).fill('#000000') as string[];

  const boxes: ColorBox[] = [
    { colors, weight: colors.reduce((sum, color) => sum + color.weight, 0) },
  ];
  while (boxes.length < 15) {
    const candidates = boxes
      .map((box, index) => ({
        box,
        index,
        score:
          Math.max(
            channelRange(box.colors, 'r'),
            channelRange(box.colors, 'g'),
            channelRange(box.colors, 'b'),
          ) * box.weight,
      }))
      .filter(({ box }) => box.colors.length > 1)
      .sort((a, b) => b.score - a.score);
    const candidate = candidates[0];
    if (!candidate) break;
    const split = splitBox(candidate.box);
    if (!split) break;
    boxes.splice(candidate.index, 1, ...split);
  }

  let centers = boxes.map((box) => centroid(box.colors));
  // A few deterministic Lloyd passes refine the median-cut seed while retaining
  // the equal-per-role weighting established above.
  for (let iteration = 0; iteration < 6; iteration++) {
    const clusters = centers.map(() => [] as WeightedColor[]);
    for (const color of colors) {
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < centers.length; index++) {
        const distance = distanceSquared(color, centers[index]!);
        if (distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      }
      clusters[best]!.push(color);
    }
    centers = centers.map((center, index) =>
      clusters[index]!.length > 0 ? centroid(clusters[index]!) : center,
    );
  }

  centers.sort((a, b) => luminance(a) - luminance(b));
  const result = ['#000000', ...centers.map(hex)];
  while (result.length < 16) result.push(result[result.length - 1]!);
  return result.slice(0, 16);
}

/** Index an image against a pack-local palette while preserving transparency. */
export async function indexImageToSourcePalette(
  image: Buffer,
  palette: readonly string[],
): Promise<SpriteData> {
  if (palette.length !== 16) throw new Error('source palette must contain exactly 16 colors');
  const colors = palette.map((value) => ({
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  }));
  const decoded = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rows: string[] = [];
  for (let y = 0; y < decoded.info.height; y++) {
    let row = '';
    for (let x = 0; x < decoded.info.width; x++) {
      const offset = (y * decoded.info.width + x) * 4;
      if (decoded.data[offset + 3]! <= 24) {
        row += '.';
        continue;
      }
      const pixel = {
        r: decoded.data[offset]!,
        g: decoded.data[offset + 1]!,
        b: decoded.data[offset + 2]!,
      };
      let best = 1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 1; index < colors.length; index++) {
        const distance = distanceSquared(pixel, colors[index]!);
        if (distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      }
      row += best.toString(16);
    }
    rows.push(row);
  }
  return { w: decoded.info.width, h: decoded.info.height, rows };
}
