// MOCK-ONLY synthetic racing sources for unit tests and the future mock
// provider. These are deterministic sharp drawings — they NEVER touch an
// image model, provider, or cache, and the real pipeline path must never
// import them. Every buffer here is built to pass the real validators in
// ./racing-craft, ./racing-scenery, and ./racing-materials.
import sharp, { type OverlayOptions } from 'sharp';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GREEN = { r: 0, g: 255, b: 0, alpha: 1 };

async function blob(
  width: number,
  height: number,
  color: string,
  skew: number,
  seed: number,
): Promise<Buffer> {
  // Asymmetric vehicle-ish wedge: wide rear, narrow nose, off-center canopy.
  const rand = mulberry32(seed);
  const hull: OverlayOptions[] = [
    { input: await rect(width, Math.round(height * 0.52), color), left: 0, top: Math.round(height * 0.34) },
    {
      input: await rect(Math.round(width * 0.44), Math.round(height * 0.3), color),
      left: Math.round(width * 0.28 + skew),
      top: Math.round(height * 0.12),
    },
    {
      input: await rect(Math.round(width * 0.2), Math.round(height * 0.22), '#101418'),
      left: Math.round(width * 0.4 + skew * 2),
      top: Math.round(height * 0.2),
    },
  ];
  void rand;
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(hull)
    .png()
    .toBuffer();
}

async function rect(width: number, height: number, color: string): Promise<Buffer> {
  return sharp({
    create: { width: Math.max(1, width), height: Math.max(1, height), channels: 4, background: color },
  })
    .png()
    .toBuffer();
}

/** Deterministic 3-pose mock strip source (384x128 green key). */
export async function mockRacingCraftStripSource(seed = 7): Promise<Buffer> {
  const cellW = 128;
  const cellH = 128;
  const poses = [
    await blob(84, 56, '#3a6fd8', 0, seed),
    await blob(76, 52, '#3a6fd8', -10, seed + 1),
    await blob(78, 54, '#3a6fd8', 10, seed + 2),
  ];
  return sharp({ create: { width: cellW * 3, height: cellH, channels: 4, background: GREEN } })
    .composite(
      poses.map((input, k) => ({
        input,
        left: k * cellW + Math.round((cellW - (k === 0 ? 84 : k === 1 ? 76 : 78)) / 2),
        top: Math.round((cellH - 56) / 2),
      })),
    )
    .png()
    .toBuffer();
}

/** Deterministic mock watercraft with a visible seated rider in three rear poses. */
export async function mockRacingJetskiStripSource(seed = 7): Promise<Buffer> {
  const colors = ['#237cb2', '#cc6839', '#7055a8', '#288d82', '#c49c3a'];
  const color = colors[seed % colors.length]!;
  const cells = [0, -10, 10].map((angle, index) => `
    <g transform="translate(${index * 128},0)">
      <g transform="rotate(${angle},64,94)" stroke="#172638" stroke-width="3" stroke-linejoin="round">
        <path fill="${color}" d="M 41 58 L 49 50 L 79 50 L 87 58 L 94 98 L 34 98 Z"/>
        <path fill="#e7e8d8" d="M 43 73 L 85 73 L 88 91 L 40 91 Z"/>
        <path fill="#172638" d="M 52 62 L 76 62 L 79 86 L 49 86 Z"/>
        <path fill="none" d="M 43 55 L 85 55"/>
        <path fill="#ed9755" d="M 50 48 L 44 55 L 49 63 L 56 54 M 78 48 L 84 55 L 79 63 L 72 54"/>
        <path fill="#e5e8d7" d="M 52 44 L 76 44 L 78 70 L 69 78 L 59 78 L 50 70 Z"/>
        <circle fill="#b37550" cx="64" cy="36" r="10"/>
        <path fill="#253345" d="M 54 34 Q 54 21 64 25 Q 76 24 74 36 Z"/>
        <rect fill="#172638" x="58" y="91" width="12" height="7"/>
      </g>
    </g>`).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="384" height="128"><rect width="384" height="128" fill="#00ff00"/>${cells}</svg>`)).png().toBuffer();
}

/** Deterministic single rear craft on green (256px) for reference tests. */
export async function mockRacingCraftRearSource(seed = 7): Promise<Buffer> {
  const subject = await blob(168, 112, '#3a6fd8', 0, seed);
  return sharp({ create: { width: 256, height: 256, channels: 4, background: GREEN } })
    .composite([{ input: subject, left: 44, top: 72 }])
    .png()
    .toBuffer();
}

/** Mock strip with one empty (pure green) pose cell. Must fail validation. */
export async function mockRacingCraftStripEmptySource(): Promise<Buffer> {
  const full = await mockRacingCraftStripSource();
  return sharp(full)
    .composite([{ input: await rect(128, 128, '#00ff00'), left: 256, top: 0 }])
    .png()
    .toBuffer();
}

/**
 * Mock strip with the middle pose starting before the mathematical third
 * divider (uneven provider spacing, like live sample #3). True gutters
 * rescue it: must PASS under gutter extraction.
 */
export async function mockRacingCraftStripCroppedSource(): Promise<Buffer> {
  const cellW = 128;
  const cellH = 128;
  const ok = await blob(84, 56, '#3a6fd8', 0, 7);
  const shifted = await blob(84, 56, '#3a6fd8', 0, 99);
  return sharp({ create: { width: cellW * 3, height: cellH, channels: 4, background: GREEN } })
    .composite([
      { input: ok, left: 22, top: 36 },
      { input: shifted, left: cellW - 11, top: 36 },
      { input: ok, left: 2 * cellW + 22, top: 36 },
    ])
    .png()
    .toBuffer();
}

/** Mock strip with two poses merged across the first divider. Must fail. */
export async function mockRacingCraftStripMergedSource(): Promise<Buffer> {
  const cellW = 128;
  const cellH = 128;
  const left = await blob(84, 56, '#3a6fd8', 0, 7);
  const right = await blob(84, 56, '#d83a6f', 0, 99);
  const lone = await blob(84, 56, '#3ad86f', 0, 5);
  return sharp({ create: { width: cellW * 3, height: cellH, channels: 4, background: GREEN } })
    .composite([
      { input: left, left: 60, top: 36 },
      { input: right, left: 140, top: 36 },
      { input: lone, left: 2 * cellW + 22, top: 36 },
    ])
    .png()
    .toBuffer();
}

/** Mock strip with a subject touching the sheet edge. Must fail. */
export async function mockRacingCraftStripEdgeSource(): Promise<Buffer> {
  const cellW = 128;
  const cellH = 128;
  const edge = await blob(84, 56, '#3a6fd8', 0, 7);
  const ok = await blob(84, 56, '#3ad86f', 0, 5);
  return sharp({ create: { width: cellW * 3, height: cellH, channels: 4, background: GREEN } })
    .composite([
      { input: edge, left: 0, top: 36 },
      { input: ok, left: cellW + 22, top: 36 },
      { input: ok, left: 2 * cellW + 22, top: 36 },
    ])
    .png()
    .toBuffer();
}

/** Deterministic 6-slot mock scenery sheet source (576x384 green key). */
export async function mockRacingScenerySheetSource(seed = 21): Promise<Buffer> {
  const cellW = 192;
  const cellH = 192;
  const colors = ['#8a4fd8', '#d84f6f', '#4fd88a', '#d8b44f', '#4f9fd8', '#ffb02e'];
  const layers: OverlayOptions[] = [];
  for (let k = 0; k < 6; k++) {
    const size = 60 + ((seed + k * 37) % 60);
    const subject = await blob(size, Math.round(size * 0.7), colors[k]!, (k % 3) * 6 - 6, seed + k);
    layers.push({
      input: subject,
      left: (k % 3) * cellW + Math.round((cellW - size) / 2),
      top: Math.floor(k / 3) * cellH + Math.round((cellH - size * 0.7) / 2),
    });
  }
  return sharp({ create: { width: cellW * 3, height: cellH * 2, channels: 4, background: GREEN } })
    .composite(layers)
    .png()
    .toBuffer();
}

/** Deterministic opaque mock panorama source (512x160). */
export async function mockRacingPanoramaSource(seed = 5): Promise<Buffer> {
  const rand = mulberry32(seed);
  const sky = await rect(512, 100, '#1b2a52');
  const ridge = await rect(512, 40, '#3a2a5e');
  const ground = await rect(512, 20, '#2f4a26');
  const sun = await rect(36, 36, '#ffb02e');
  return sharp({ create: { width: 512, height: 160, channels: 3, background: '#000000' } })
    .composite([
      { input: sky, left: 0, top: 0 },
      { input: ridge, left: 0, top: 90 },
      { input: ground, left: 0, top: 140 },
      { input: sun, left: 60 + Math.round(rand() * 380), top: 30 },
    ])
    .png()
    .toBuffer();
}

/** Deterministic opaque mock 2x2 materials source with real texture variance. */
export async function mockRacingMaterialsSource(seed = 11): Promise<Buffer> {
  const half = 128;
  const bases = ['#5c5e6e', '#2f4a26', '#d8d8cc', '#35e0ff'];
  const tiles: OverlayOptions[] = [];
  for (let k = 0; k < 4; k++) {
    const rand = mulberry32(seed + k * 101);
    const pixels = Buffer.alloc(half * half * 3);
    const base = bases[k]!;
    const br = parseInt(base.slice(1, 3), 16);
    const bg = parseInt(base.slice(3, 5), 16);
    const bb = parseInt(base.slice(5, 7), 16);
    for (let p = 0; p < half * half; p++) {
      const noise = Math.round((rand() - 0.5) * 56);
      pixels[p * 3] = Math.max(0, Math.min(255, br + noise));
      pixels[p * 3 + 1] = Math.max(0, Math.min(255, bg + noise));
      pixels[p * 3 + 2] = Math.max(0, Math.min(255, bb + noise));
    }
    const tile = await sharp(pixels, { raw: { width: half, height: half, channels: 3 } })
      .png()
      .toBuffer();
    tiles.push({ input: tile, left: (k % 2) * half, top: Math.floor(k / 2) * half });
  }
  return sharp({ create: { width: half * 2, height: half * 2, channels: 3, background: '#000000' } })
    .composite(tiles)
    .png()
    .toBuffer();
}

/** Synthetic animation grid used ONLY by mock generation and processor tests. */
export async function mockRacingLocomotionSource(): Promise<Buffer> {
  const cells = Array.from({ length: 6 }, (_, i) => `<g transform="translate(${i % 3 * 128},${Math.floor(i / 3) * 128})"><path fill="#3a6fd8" d="M44 32 H84 V78 L${88 + i} 99 H${72 + i} L64 77 L${52 - i} 99 H${38 - i} L44 72 Z"/><rect x="58" y="20" width="12" height="18" fill="#b37550"/><rect x="${48 + i * 3}" y="46" width="8" height="12" fill="#f0c44c"/></g>`).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="384" height="256"><rect width="384" height="256" fill="#00ff00"/>${cells}</svg>`)).png().toBuffer();
}
