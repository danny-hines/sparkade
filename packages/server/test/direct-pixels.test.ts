import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { Provider } from '@sparkade/shared';
import type { FaceFeatures } from '../src/likeness/features';
import {
  DIRECT_PIXEL_SIZES,
  auditDirectPixelDraft,
  buildDirectPixelPalette,
  buildDirectPixelPrompt,
  generateDirectPixelLikeness,
  parseDirectPixelDraft,
  rasterizeDirectPixelSprite,
  reduceDirectPixelRows,
  type DirectPixelDraft,
} from '../src/likeness/direct-pixels';

const features: FaceFeatures = {
  skinTone: '#c98f6b',
  hairColor: 'none',
  hairStyle: 'bald',
  hairLength: 'none',
  hairTexture: 'none',
  hairPart: 'none',
  facialHairColor: 'none',
  headwearColor: 'none',
  glasses: false,
  glassesColor: 'none',
  headwear: false,
  headwearType: 'none',
  facialHair: 'none',
  faceShape: 'oval',
  chin: 'round',
  noseSize: 'medium',
  eyeSpacing: 'average',
  eyeShape: 'almond',
  eyebrows: 'medium',
  eyebrowShape: 'straight',
  ears: 'average',
  topology: {
    scalpHair: { crown: false, temples: false, belowEars: false },
    headwear: { crown: 'none', projection: 'none' },
    glasses: { frame: 'none', lensShape: 'none', lensTint: 'none' },
    facialHair: { upperLip: 'none', chin: 'none', jaw: 'none', cheeks: 'none' },
  },
};

function validDraft(): DirectPixelDraft {
  const size = 28;
  const center = 13.5;
  const rows = Array.from({ length: size }, (_, y) => {
    if (y === 0) return '.'.repeat(size);
    const normalized = Math.min(1, Math.abs(y - 14) / 13);
    const halfWidth = Math.max(1, Math.round(10.5 * Math.sqrt(1 - normalized * normalized)));
    const left = Math.ceil(center - halfWidth);
    const right = Math.floor(center + halfWidth);
    return Array.from({ length: size }, (_unused, x) => {
      if (x < left || x > right) return '.';
      return x === left || x === right ? '1' : '4';
    }).join('');
  });
  const replace = (x: number, y: number, symbol: string): void => {
    rows[y] = `${rows[y]!.slice(0, x)}${symbol}${rows[y]!.slice(x + 1)}`;
  };
  replace(9, 10, 'e');
  replace(10, 10, 'c');
  replace(17, 10, 'c');
  replace(18, 10, 'e');
  replace(14, 15, '3');
  replace(14, 16, 'c');
  for (const x of [12, 13, 14, 15]) replace(x, 20, 'd');
  return {
    anchors: {
      crownTop: 1,
      faceLeft: 4,
      faceRight: 23,
      leftEyeX: 10,
      rightEyeX: 17,
      eyeY: 10,
      noseTipX: 14,
      noseTipY: 16,
      upperLipY: 18,
      mouthY: 20,
      chinY: 27,
    },
    rows,
  };
}

describe('direct Muse pixel likeness', () => {
  it('asks for one semantic master grounded by analyzed topology', () => {
    const palette = buildDirectPixelPalette(features);
    const prompt = buildDirectPixelPrompt(features, palette);
    expect(prompt.system).toContain('ONE final 28x28');
    expect(prompt.system).toContain('Symbols 6 and 7 are FORBIDDEN');
    expect(prompt.system).toContain('baseball cap = panelled crown PLUS');
    expect(prompt.system).toContain('b = ' + palette[11] + ' = glasses frame only');
    const schema = prompt.jsonSchema as {
      properties: { rows: { minItems: number; maxItems: number } };
    };
    expect(schema.properties.rows).toMatchObject({ minItems: 28, maxItems: 28 });
  });

  it('parses anchors and exact indexed rows', () => {
    const draft = validDraft();
    expect(parseDirectPixelDraft(JSON.stringify(draft))).toEqual(draft);
    const malformed = structuredClone(draft);
    malformed.rows[0] = `0${'.'.repeat(27)}`;
    expect(() => parseDirectPixelDraft(malformed)).toThrow(/invalid palette symbol/);
  });

  it('recovers exact rows when Meta omits JSON punctuation', () => {
    const draft = validDraft();
    const malformed = JSON.stringify(draft).replace(',"faceLeft"', '"faceLeft"');
    expect(() => JSON.parse(malformed)).toThrow();
    expect(parseDirectPixelDraft(malformed)).toEqual(draft);
  });

  it('rejects a short horizontal visor even when its dimensions are syntactically valid', () => {
    const draft = validDraft();
    draft.rows = Array.from({ length: 28 }, (_unused, y) =>
      y >= 4 && y <= 15 ? `...${'4'.repeat(22)}...` : '.'.repeat(28),
    );
    const audit = auditDirectPixelDraft(draft, features);
    expect(audit.errors.join(' ')).toMatch(/only 12px tall/);
    expect(audit.errors.join(' ')).toMatch(/horizontal sandwich/);
  });

  it('rejects detached outline rails and hat pixels hanging below the eyes', () => {
    const draft = validDraft();
    draft.rows = draft.rows.map((row, y) => {
      const values = [...row];
      if (y >= 5 && y <= 20) values[0] = '1';
      if (y <= 7 || y >= 15) {
        for (let x = 8; x <= 19; x++) values[x] = 'a';
      }
      return values.join('');
    });
    const capFeatures: FaceFeatures = {
      ...features,
      hairStyle: 'hidden',
      headwear: true,
      headwearType: 'cap',
      headwearColor: '#202020',
      topology: {
        ...features.topology!,
        headwear: { crown: 'panelled', projection: 'front-bill' },
      },
    };
    const audit = auditDirectPixelDraft(draft, capFeatures);
    expect(audit.errors.join(' ')).toMatch(/outline pixels form detached rails/);
    expect(audit.errors.join(' ')).toMatch(/headwear pixels continue below the eye line/);
  });

  it('role-aware reduction keeps critical eye and mouth cues', () => {
    const draft = validDraft();
    const rows = reduceDirectPixelRows(draft.rows, 16, draft.anchors, features);
    expect(rows).toHaveLength(16);
    expect(rows.every((row) => row.length === 16)).toBe(true);
    expect(rows.join('')).toContain('c');
    expect(rows.join('')).toContain('d');
  });

  it('rasterizes semantic indexed rows with binary transparency', async () => {
    const draft = validDraft();
    const palette = buildDirectPixelPalette(features);
    const png = await rasterizeDirectPixelSprite(palette, draft.rows);
    const image = sharp(png);
    expect(await image.metadata()).toMatchObject({ width: 28, height: 28 });
    const raw = await image.ensureAlpha().raw().toBuffer();
    expect([...raw.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
  });

  it('sends one master request and derives every comparison size locally', async () => {
    let calls = 0;
    const provider: Provider = {
      name: 'fixture',
      kind: 'mock',
      capabilities: { imageIn: true, structuredOutput: true, audioIn: false },
      async complete(request) {
        calls++;
        expect(request.image?.length).toBeGreaterThan(0);
        expect(request.jsonSchema).toBeTruthy();
        expect(request.effort).toBe('minimal');
        return { text: JSON.stringify(validDraft()), usage: { input: 10, output: 20 } };
      },
    };
    const photo = await sharp({
      create: { width: 32, height: 40, channels: 3, background: '#c98f6b' },
    }).jpeg().toBuffer();
    const result = await generateDirectPixelLikeness(photo, features, provider, 'fixture-model');
    expect(calls).toBe(1);
    expect(Object.keys(result.pngs)).toEqual(DIRECT_PIXEL_SIZES.map(String));
    expect(result.document.validation.errors).toEqual([]);
    expect(result.usage).toEqual({ input: 10, output: 20 });
  });

  it('returns validator diagnostics without an invisible second paid call', async () => {
    let calls = 0;
    const invalid = validDraft();
    invalid.rows = invalid.rows.map((_row, y) =>
      y >= 7 && y <= 16 ? `....${'4'.repeat(20)}....` : '.'.repeat(28),
    );
    const provider: Provider = {
      name: 'fixture',
      kind: 'mock',
      capabilities: { imageIn: true, structuredOutput: true, audioIn: false },
      async complete() {
        calls++;
        return {
          text: JSON.stringify(invalid),
          usage: { input: 10, output: 20, cachedInput: 2 },
        };
      },
    };
    const photo = await sharp({
      create: { width: 32, height: 40, channels: 3, background: '#c98f6b' },
    }).jpeg().toBuffer();
    const result = await generateDirectPixelLikeness(photo, features, provider, 'fixture-model');
    expect(calls).toBe(1);
    expect(result.document.validation.repaired).toBe(false);
    expect(result.document.validation.errors.length).toBeGreaterThan(0);
    expect(result.usage).toEqual({ input: 10, output: 20, cachedInput: 2 });
  });
});
