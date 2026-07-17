import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { Provider } from '@sparkade/shared';
import {
  PHOTO_HEAD_INPUT_SIZE,
  PHOTO_HEAD_SCANLINES,
  PHOTO_HEAD_SIZES,
  buildPhotoHeadPrompt,
  generatePhotoHeadLikeness,
  normalizePhotoHeadGeometry,
  normalizePhotoHeadInput,
  parsePhotoHeadDocument,
  renderPhotoHeadSprites,
  type PhotoHeadGeometry,
} from '../src/likeness/photo-head';

const features = {
  skinTone: '#8f5d45',
  hairColor: 'none',
  hairStyle: 'hidden' as const,
  facialHairColor: '#2e211c',
  headwearColor: '#17191e',
  glasses: false,
  headwear: true,
  headwearType: 'cap' as const,
  facialHair: 'stubble' as const,
  faceShape: 'oval' as const,
  chin: 'square' as const,
  noseSize: 'medium' as const,
  eyeSpacing: 'average' as const,
  eyeShape: 'almond' as const,
  eyebrows: 'medium' as const,
  eyebrowShape: 'straight' as const,
  ears: 'average' as const,
};

const spans = [
  [350, 650], [250, 750], [150, 850], [80, 920],
  [40, 960], [70, 930], [100, 900], [120, 880],
  [130, 870], [150, 850], [180, 820], [210, 790],
  [250, 750], [300, 700], [350, 650], [410, 590],
] as const;

const geometry: PhotoHeadGeometry = {
  headBox: { x: 250, y: 120, width: 500, height: 680 },
  faceBox: { x: 330, y: 330, width: 340, height: 430 },
  landmarks: {
    leftEye: { x: 420, y: 440 },
    rightEye: { x: 580, y: 440 },
    noseTip: { x: 500, y: 535 },
    mouthCenter: { x: 500, y: 635 },
    chin: { x: 500, y: 750 },
  },
  rows: spans.map(([left, right]) => ({ left, right })),
  contourSource: 'muse',
  confidence: 'high',
};

function documentFixture(): Record<string, unknown> {
  return { features, geometry };
}

async function syntheticHead(exposure = 1): Promise<Buffer> {
  const svg = Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <rect width="512" height="512" fill="#ef6da9"/>
    <ellipse cx="256" cy="265" rx="105" ry="145" fill="#8f5d45"/>
    <path d="M145 240 Q145 100 256 90 Q365 100 367 230 L330 210 Q250 175 145 240" fill="#17191e"/>
    <path d="M140 222 Q250 190 390 225 L380 248 Q250 224 140 245Z" fill="#17191e"/>
    <rect x="184" y="248" width="55" height="12" rx="5" fill="#251d1a"/>
    <rect x="273" y="248" width="55" height="12" rx="5" fill="#251d1a"/>
    <circle cx="215" cy="270" r="8" fill="#17131f"/>
    <circle cx="297" cy="270" r="8" fill="#17131f"/>
    <path d="M220 350 Q256 370 292 350" stroke="#321e1d" stroke-width="9" fill="none"/>
  </svg>`);
  return sharp(svg).linear(exposure, 0).png().toBuffer();
}

describe('Muse-guided photo heads', () => {
  it('requests a dedicated box-and-landmark document instead of Muse-authored pixels or scanlines', () => {
    const prompt = buildPhotoHeadPrompt();
    expect(prompt.system).toContain('cap into a rounded beanie');
    expect(prompt.system).toContain('bottom must be the chin');
    expect(prompt.system).toContain('pupil/iris centers');
    expect(prompt.system).not.toContain('scanline');
    const schema = prompt.jsonSchema as {
      required: string[];
      properties: { geometry: { required: string[]; properties: Record<string, unknown> } };
    };
    expect(schema.required).toEqual(['geometry']);
    expect(schema.properties.geometry.required).toEqual(['headBox', 'faceBox', 'landmarks', 'confidence']);
    expect(schema.properties.geometry.properties).not.toHaveProperty('rows');
  });

  it('normalizes provider drift but rejects unusable boxes and scanlines', () => {
    const normalized = normalizePhotoHeadGeometry({
      ...geometry,
      headBox: { x: -3, y: 120.4, width: 1100, height: 680.2 },
      rows: geometry.rows.map((row, index) => index === 0 ? { left: row.right, right: row.left } : row),
    });
    expect(normalized.headBox.x).toBeGreaterThanOrEqual(0);
    expect(normalized.headBox.x + normalized.headBox.width).toBeLessThanOrEqual(1000);
    expect(normalized.headBox.x).toBeLessThanOrEqual(normalized.faceBox.x);
    expect(normalized.headBox.x + normalized.headBox.width).toBeGreaterThanOrEqual(
      normalized.faceBox.x + normalized.faceBox.width,
    );
    expect(normalized.rows).toHaveLength(16);
    expect(normalized.rows.every((row) => row.left < row.right)).toBe(true);
    expect(normalized.landmarks.leftEye.x).toBeLessThan(normalized.landmarks.rightEye.x);

    expect(() => normalizePhotoHeadGeometry({ ...geometry, rows: geometry.rows.slice(1) })).toThrow(/exactly 16/);
    expect(() => normalizePhotoHeadGeometry({ ...geometry, headBox: { x: 990, y: 990, width: 40, height: 40 } })).toThrow(/implausibly small/);
    expect(() => normalizePhotoHeadGeometry({
      ...geometry,
      rows: geometry.rows.map(() => ({ left: 0, right: 1000 })),
    })).toThrow(/mean coverage/);
  });

  it('keeps locally segmented geometry local when an already-normalized document is normalized again', () => {
    const once = normalizePhotoHeadGeometry({
      headBox: geometry.headBox,
      faceBox: geometry.faceBox,
      landmarks: geometry.landmarks,
      confidence: 95,
    });
    expect(once.contourSource).toBe('local');
    expect(once.rows).toHaveLength(PHOTO_HEAD_SCANLINES);
    expect(normalizePhotoHeadGeometry(once).contourSource).toBe('local');

    const partialOverlap = normalizePhotoHeadGeometry({
      headBox: { x: 400, y: 120, width: 300, height: 680 },
      faceBox: { x: 300, y: 300, width: 400, height: 430 },
      confidence: 70,
    });
    expect(partialOverlap.headBox.x).toBeLessThanOrEqual(partialOverlap.faceBox.x);
    expect(partialOverlap.headBox.x + partialOverlap.headBox.width).toBeGreaterThanOrEqual(
      partialOverlap.faceBox.x + partialOverlap.faceBox.width,
    );
  });

  it('normalizes arbitrary source dimensions to the exact shared coordinate image', async () => {
    const source = await sharp({
      create: { width: 240, height: 480, channels: 3, background: '#8f5d45' },
    }).webp().toBuffer();
    const normalized = await normalizePhotoHeadInput(source);
    expect(await sharp(normalized).metadata()).toMatchObject({
      width: PHOTO_HEAD_INPUT_SIZE,
      height: PHOTO_HEAD_INPUT_SIZE,
      format: 'jpeg',
    });
  });

  it('renders every target size, removes connected backdrop, and keeps transparent corners', async () => {
    const normalized = await normalizePhotoHeadInput(await syntheticHead());
    const localGeometry = normalizePhotoHeadGeometry({
      headBox: geometry.headBox,
      faceBox: geometry.faceBox,
      landmarks: geometry.landmarks,
      confidence: 95,
    });
    expect(localGeometry.contourSource).toBe('local');
    const pngs = await renderPhotoHeadSprites(normalized, features, localGeometry);
    expect(Object.keys(pngs)).toEqual(['16', '20', '24', '28']);
    for (const size of PHOTO_HEAD_SIZES) {
      const image = sharp(pngs[String(size)]!);
      expect(await image.metadata()).toMatchObject({ width: size, height: size });
      const { data } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(data[3]).toBe(0);
      let opaquePink = 0;
      let opaqueDark = 0;
      for (let p = 0; p < size * size; p++) {
        if (data[p * 4 + 3]! < 128) continue;
        const r = data[p * 4]!;
        const g = data[p * 4 + 1]!;
        const b = data[p * 4 + 2]!;
        const backdropDistance = Math.hypot(r - 239, g - 109, b - 169);
        if (backdropDistance < 45) opaquePink++;
        if (r < 60 && g < 60 && b < 70) opaqueDark++;
      }
      expect(opaquePink, `${size}px backdrop pixels`).toBe(0);
      expect(opaqueDark, `${size}px cap pixels`).toBeGreaterThan(2);
    }
  });

  it('normalizes strongly different photo exposures toward the same Muse-observed skin tone', async () => {
    const localGeometry = normalizePhotoHeadGeometry({
      headBox: geometry.headBox,
      faceBox: geometry.faceBox,
      landmarks: geometry.landmarks,
      confidence: 95,
    });
    const means: number[] = [];
    for (const exposure of [0.55, 1.35]) {
      const normalized = await normalizePhotoHeadInput(await syntheticHead(exposure));
      const png = (await renderPhotoHeadSprites(normalized, features, localGeometry, [28]))['28']!;
      const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let total = 0;
      let count = 0;
      for (let y = 10; y < 25; y++) {
        for (let x = 7; x < 21; x++) {
          const offset = (y * 28 + x) * 4;
          if (data[offset + 3]! < 128) continue;
          total += data[offset]! * 0.2126 + data[offset + 1]! * 0.7152 + data[offset + 2]! * 0.0722;
          count++;
        }
      }
      means.push(total / count);
    }
    expect(Math.abs(means[0]! - means[1]!)).toBeLessThan(45);
  });

  it('uses one dedicated Muse geometry call after traits are supplied and renders every size locally', async () => {
    let calls = 0;
    const provider: Provider = {
      name: 'fixture',
      kind: 'mock',
      capabilities: { imageIn: true, structuredOutput: true, audioIn: false },
      async complete(request) {
        calls++;
        expect(request.effort).toBe('minimal');
        expect(request.jsonSchema).toBeTruthy();
        expect(request.image).toBeTruthy();
        expect(await sharp(request.image!).metadata()).toMatchObject({ width: 512, height: 512, format: 'jpeg' });
        return { text: JSON.stringify(documentFixture()), usage: { input: 123, output: 456 } };
      },
    };
    const result = await generatePhotoHeadLikeness(await syntheticHead(), features, provider, 'muse-spark-1.1');
    expect(calls).toBe(1);
    expect(result.features.headwearType).toBe('cap');
    expect(result.geometry.rows).toHaveLength(16);
    expect(Object.keys(result.pngs)).toEqual(['16', '20', '24', '28']);
    expect(result.usage).toEqual({ input: 123, output: 456 });
  });

  it('applies existing face-feature invariants to non-hex preview responses', () => {
    const malformed = documentFixture();
    malformed['features'] = { ...features, skinTone: 'light', hairColor: 'not visible' };
    const parsed = parsePhotoHeadDocument(malformed);
    expect(parsed.features.skinTone).toMatch(/^#[0-9a-f]{6}$/);
    expect(parsed.features.hairStyle).toBe('hidden');
  });
});
