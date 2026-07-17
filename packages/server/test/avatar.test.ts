// Feature-driven avatar: draws a pixel face from FaceFeatures alone (no photo).
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { HEAD_SPRITE_SIZES, PORTRAIT_SIZE } from '@sparkade/shared';
import { drawAvatarLikeness } from '../src/likeness/avatar';
import { normalizeFaceFeatures, type FaceFeatures } from '../src/likeness/features';

const base: FaceFeatures = {
  skinTone: '#c98f6b',
  hairColor: '#2a2320',
  facialHairColor: 'none',
  glasses: false,
  facialHair: 'none',
  headwear: false,
  headwearColor: 'none',
};

async function rawHead(features: FaceFeatures, size: 12 | 16 = 16): Promise<Buffer> {
  const likeness = await drawAvatarLikeness(features);
  return sharp(size === 16 ? likeness.head16 : likeness.head12)
    .ensureAlpha()
    .raw()
    .toBuffer();
}

function rgbaAt(raw: Buffer, size: number, x: number, y: number): [number, number, number, number] {
  const i = (y * size + x) * 4;
  return [raw[i]!, raw[i + 1]!, raw[i + 2]!, raw[i + 3]!];
}

async function rawPng(png: Buffer): Promise<Buffer> {
  return sharp(png).ensureAlpha().raw().toBuffer();
}

function samePixel(a: Buffer, b: Buffer, size: number, x: number, y: number): boolean {
  return rgbaAt(a, size, x, y).every((channel, index) => channel === rgbaAt(b, size, x, y)[index]);
}

function changedIndices(a: Buffer, b: Buffer, size: number): Set<number> {
  const changed = new Set<number>();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!samePixel(a, b, size, x, y)) changed.add(y * size + x);
    }
  }
  return changed;
}

function countComponents8(mask: boolean[], size: number): number {
  const unseen = new Set(mask.flatMap((on, index) => (on ? [index] : [])));
  let components = 0;
  while (unseen.size > 0) {
    components++;
    const first = unseen.values().next().value as number;
    unseen.delete(first);
    const queue = [first];
    while (queue.length > 0) {
      const index = queue.pop()!;
      const x = index % size;
      const y = Math.floor(index / size);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
          const neighbor = ny * size + nx;
          if (!unseen.delete(neighbor)) continue;
          queue.push(neighbor);
        }
      }
    }
  }
  return components;
}

describe('drawAvatarLikeness', () => {
  it('produces correctly sized, oval-masked PNGs from traits alone (no photo)', async () => {
    const a = await drawAvatarLikeness(base);
    for (const [buf, size] of [
      [a.head12, HEAD_SPRITE_SIZES[0]],
      [a.head16, HEAD_SPRITE_SIZES[1]],
      [a.portrait, PORTRAIT_SIZE],
    ] as const) {
      const img = sharp(buf);
      const meta = await img.metadata();
      expect(meta.width).toBe(size);
      expect(meta.height).toBe(size);
      const raw = await img.ensureAlpha().raw().toBuffer();
      const alphaAt = (x: number, y: number) => raw[(y * size + x) * 4 + 3]!;
      expect(alphaAt(0, 0)).toBe(0); // corner transparent — oval mask
      expect(alphaAt(size - 1, size - 1)).toBe(0);
      expect(alphaAt(Math.floor(size / 2), Math.floor(size / 2))).toBe(255); // face centre opaque
    }
  });

  it('shows the detected skin tone on the cheek (warm: red > blue)', async () => {
    const size = PORTRAIT_SIZE;
    const raw = await sharp((await drawAvatarLikeness({ ...base, skinTone: '#8d5a34' })).portrait)
      .ensureAlpha()
      .raw()
      .toBuffer();
    // a cheek pixel: left of centre, below the eyes but above the mouth
    const x = Math.round(size * 0.34);
    const y = Math.round(size * 0.6);
    const i = (y * size + x) * 4;
    expect(raw[i + 3]).toBe(255);
    expect(raw[i]!).toBeGreaterThan(raw[i + 2]!);
  });

  it('varies with traits (glasses + headwear change the pixels)', async () => {
    const plain = await drawAvatarLikeness(base);
    const decorated = await drawAvatarLikeness({ ...base, glasses: true, headwear: true, headwearColor: '#33445e' });
    expect(Buffer.compare(plain.portrait, decorated.portrait)).not.toBe(0);
  });

  it('keeps a moustache readable at both shipping head sizes', async () => {
    const plain = await drawAvatarLikeness(base);
    const mustache = await drawAvatarLikeness({
      ...base,
      facialHair: 'mustache',
      facialHairColor: '#2a2320',
    });
    expect(Buffer.compare(plain.head16, mustache.head16)).not.toBe(0);
    expect(Buffer.compare(plain.head12, mustache.head12)).not.toBe(0);

    const [plain12, moustache12] = await Promise.all([rawPng(plain.head12), rawPng(mustache.head12)]);
    expect(samePixel(plain12, moustache12, 12, 4, 8)).toBe(false);
    expect(samePixel(plain12, moustache12, 12, 7, 8)).toBe(false);
    expect(samePixel(plain12, moustache12, 12, 5, 8)).toBe(true);
    expect(samePixel(plain12, moustache12, 12, 6, 8)).toBe(true);
  });

  it('puts stubble on both the upper lip and jaw at native sizes', async () => {
    const cleanFeatures: FaceFeatures = { ...base, hairColor: 'none', hairStyle: 'bald' };
    const plain = await rawHead(cleanFeatures);
    const stubbleFeatures: FaceFeatures = {
      ...cleanFeatures,
      facialHair: 'stubble',
      facialHairColor: '#201810',
    };
    const stubble = await rawHead(stubbleFeatures);
    let upperLipChanges = 0;
    let jawChanges = 0;
    let totalChanges = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const before = rgbaAt(plain, 16, x, y);
        const after = rgbaAt(stubble, 16, x, y);
        if (before.every((channel, i) => channel === after[i])) continue;
        totalChanges++;
        // Stubble must shade the existing face pixel, never lighten it.
        expect(after[0] + after[1] + after[2]).toBeLessThan(before[0] + before[1] + before[2]);
        if (y >= 10 && y <= 11 && x >= 5 && x <= 10) upperLipChanges++;
        if (y >= 12) jawChanges++;
      }
    }
    expect(upperLipChanges).toBeGreaterThanOrEqual(4);
    expect(jawChanges).toBeGreaterThan(0);
    expect(totalChanges).toBeGreaterThanOrEqual(7);

    const [plain12, stubble12] = await Promise.all([
      rawHead(cleanFeatures, 12),
      rawHead(stubbleFeatures, 12),
    ]);
    const changes12 = changedIndices(plain12, stubble12, 12);
    expect(changes12.size).toBeGreaterThanOrEqual(3);
    expect([...changes12].some((index) => Math.floor(index / 12) === 8)).toBe(true);
    expect([...changes12].some((index) => Math.floor(index / 12) >= 10)).toBe(true);
  });

  it('expands side beards across the rear cheek and jaw without covering the nose or mouth', async () => {
    const cleanFeatures: FaceFeatures = {
      ...base,
      hairColor: 'none',
      hairStyle: 'bald',
    };
    const [clean, stubble, beard] = await Promise.all([
      drawAvatarLikeness(cleanFeatures),
      drawAvatarLikeness({
        ...cleanFeatures,
        facialHair: 'stubble',
        facialHairColor: '#201810',
      }),
      drawAvatarLikeness({
        ...cleanFeatures,
        facialHair: 'beard',
        facialHairColor: '#201810',
      }),
    ]);

    for (const [size, view, cleanPng, stubblePng, beardPng] of [
      [12, 'front', clean.head12, stubble.head12, beard.head12],
      [12, 'side', clean.head12Side!, stubble.head12Side!, beard.head12Side!],
      [16, 'front', clean.head16, stubble.head16, beard.head16],
      [16, 'side', clean.head16Side!, stubble.head16Side!, beard.head16Side!],
    ] as const) {
      const [cleanRaw, stubbleRaw, beardRaw] = await Promise.all([
        rawPng(cleanPng),
        rawPng(stubblePng),
        rawPng(beardPng),
      ]);
      const stubbleMask = changedIndices(cleanRaw, stubbleRaw, size);
      const beardMask = changedIndices(cleanRaw, beardRaw, size);
      expect(stubbleMask.size).toBeGreaterThanOrEqual(3);
      expect(beardMask.size).toBeGreaterThanOrEqual(7);
      expect(beardMask.size).toBeGreaterThan(stubbleMask.size * 1.5);
      expect([...beardMask].some((index) => !stubbleMask.has(index))).toBe(true);

      for (const index of beardMask) {
        const x = index % size;
        const y = Math.floor(index / size);
        const before = rgbaAt(cleanRaw, size, x, y);
        const after = rgbaAt(beardRaw, size, x, y);
        expect(after[0] + after[1] + after[2]).toBeLessThan(before[0] + before[1] + before[2]);
      }

      if (view === 'side') {
        const rearX = size === 12 ? 5 : 6;
        const cheekRows = size === 12 ? [8, 9] : [10, 11, 12];
        const jawRows = size === 12 ? [10, 11] : [13, 14, 15];
        expect(cheekRows.some((y) => beardMask.has(y * size + rearX))).toBe(true);
        expect(jawRows.some((y) => beardMask.has(y * size + rearX))).toBe(true);

        const protectedPixels = size === 12
          ? [[9, 7], [10, 7], [7, 9]]
          : [[12, 9], [13, 9], [11, 10], [9, 12], [10, 12]];
        for (const [x, y] of protectedPixels) {
          expect(samePixel(cleanRaw, beardRaw, size, x!, y!)).toBe(true);
        }
      }
    }
  });

  it('keeps the canonical mixed moustache + jaw-stubble regions separate', async () => {
    const common: FaceFeatures = {
      ...base,
      hairColor: 'none',
      hairStyle: 'hidden',
      headwear: true,
      headwearType: 'cap',
      headwearColor: '#151515',
      facialHair: 'stubble',
      facialHairColor: '#3d352f',
      topology: {
        scalpHair: { crown: false, temples: false, belowEars: false },
        headwear: { crown: 'panelled', projection: 'front-bill' },
        glasses: { frame: 'none', lensShape: 'none', lensTint: 'none' },
        facialHair: { upperLip: 'solid', chin: 'stubble', jaw: 'stubble', cheeks: 'none' },
      },
    };
    const clean = await rawHead({
      ...common,
      facialHair: 'none',
      facialHairColor: 'none',
      topology: { ...common.topology!, facialHair: { upperLip: 'none', chin: 'none', jaw: 'none', cheeks: 'none' } },
    });
    const mixed = await rawHead(common);
    const changed = (x: number, y: number): boolean =>
      !rgbaAt(clean, 16, x, y).every((channel, index) => channel === rgbaAt(mixed, 16, x, y)[index]);

    expect([5, 6].some((x) => changed(x, 11))).toBe(true);
    expect([9, 10].some((x) => changed(x, 11))).toBe(true);
    expect(changed(7, 11)).toBe(false); // philtrum gap keeps two moustache lobes
    expect(Array.from({ length: 16 * 3 }, (_, i) => changed(i % 16, 13 + Math.floor(i / 16))).some(Boolean)).toBe(true);
  });

  it('uses one native pupil pixel per eye and keeps average ears off canvas edges', async () => {
    const raw = await rawHead({
      ...base,
      hairColor: 'none',
      hairStyle: 'hidden',
      ears: 'average',
      eyeShape: 'round',
    });
    let pupils = 0;
    for (let y = 0; y < 16; y++) {
      expect(rgbaAt(raw, 16, 0, y)[3]).toBe(0);
      expect(rgbaAt(raw, 16, 15, y)[3]).toBe(0);
      for (let x = 0; x < 16; x++) {
        const [r, g, b, a] = rgbaAt(raw, 16, x, y);
        if (r === 30 && g === 28 && b === 40 && a === 255) pupils++;
      }
    }
    expect(pupils).toBe(2);
  });

  it('keeps eyes readable through clear glasses and tinted sunglasses', async () => {
    const common: FaceFeatures = {
      ...base,
      hairColor: 'none',
      hairStyle: 'bald',
      glasses: true,
      glassesColor: '#20202a',
      topology: {
        scalpHair: { crown: false, temples: false, belowEars: false },
        headwear: { crown: 'none', projection: 'none' },
        glasses: { frame: 'thick', lensShape: 'rectangular', lensTint: 'clear' },
        facialHair: { upperLip: 'none', chin: 'none', jaw: 'none', cheeks: 'none' },
      },
    };
    const [bare, clear, dark] = await Promise.all([
      drawAvatarLikeness({ ...common, glasses: false, glassesColor: 'none' }),
      drawAvatarLikeness(common),
      drawAvatarLikeness({
        ...common,
        topology: {
          ...common.topology!,
          glasses: { ...common.topology!.glasses, lensTint: 'dark' },
        },
      }),
    ]);

    for (const [size, barePng, clearPng, darkPng, expectedPupils] of [
      [12, bare.head12, clear.head12, dark.head12, 2],
      [12, bare.head12Side!, clear.head12Side!, dark.head12Side!, 1],
      [16, bare.head16, clear.head16, dark.head16, 2],
      [16, bare.head16Side!, clear.head16Side!, dark.head16Side!, 1],
    ] as const) {
      const [bareRaw, clearRaw, darkRaw] = await Promise.all([
        rawPng(barePng),
        rawPng(clearPng),
        rawPng(darkPng),
      ]);
      const pupilIndices = (raw: Buffer): number[] => {
        const found: number[] = [];
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const [r, g, b, a] = rgbaAt(raw, size, x, y);
            if (r === 30 && g === 28 && b === 40 && a === 255) found.push(y * size + x);
          }
        }
        return found;
      };
      const clearPupils = pupilIndices(clearRaw);
      const darkPupils = pupilIndices(darkRaw);
      expect(clearPupils).toHaveLength(expectedPupils);
      expect(darkPupils).toEqual(clearPupils);

      for (const index of clearPupils) {
        const x = index % size;
        const y = Math.floor(index / size);
        const neighborLumas = (raw: Buffer): number[] =>
          [-1, 1]
            .filter((dx) => x + dx >= 0 && x + dx < size)
            .map((dx) => {
              const [r, g, b] = rgbaAt(raw, size, x + dx, y);
              return (r + g + b) / 3;
            });
        const clearHighlight = Math.max(...neighborLumas(clearRaw));
        const darkHighlight = Math.max(...neighborLumas(darkRaw));
        expect(clearHighlight).toBeGreaterThan(200);
        expect(darkHighlight).toBeGreaterThan(80);
        expect(darkHighlight).toBeLessThan(clearHighlight - 20);
      }

      expect(Buffer.compare(clearRaw, darkRaw)).not.toBe(0);
      expect([...changedIndices(bareRaw, clearRaw, size)].some((index) => !clearPupils.includes(index))).toBe(true);
      for (let index = 3; index < clearRaw.length; index += 4) {
        expect(clearRaw[index]).toBe(darkRaw[index]);
      }
    }
  });

  it('draws a one-eye right-facing head and a featureless rear head', async () => {
    const artifacts = await drawAvatarLikeness({
      ...base,
      hairStyle: 'short',
      hairLength: 'short',
      facialHair: 'mustache',
      facialHairColor: '#3a2c25',
    });
    expect(artifacts.head16Side).toBeTruthy();
    expect(artifacts.head16Back).toBeTruthy();
    const side = await rawPng(artifacts.head16Side!);
    const back = await rawPng(artifacts.head16Back!);
    const count = (raw: Buffer, wanted: [number, number, number]): number => {
      let found = 0;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const [r, g, b, a] = rgbaAt(raw, 16, x, y);
          if (a === 255 && r === wanted[0] && g === wanted[1] && b === wanted[2]) found++;
        }
      }
      return found;
    };

    expect(count(side, [30, 28, 40])).toBe(1); // one profile pupil
    expect(count(back, [238, 236, 230])).toBe(0); // no rear-facing eye whites

    const cleanBack = await rawPng(
      (
        await drawAvatarLikeness({
          ...base,
          hairStyle: 'short',
          hairLength: 'short',
          facialHair: 'none',
          facialHairColor: 'none',
        })
      ).head16Back!,
    );
    expect(Buffer.compare(back, cleanBack)).toBe(0); // rear view never leaks moustache/beard
  });

  it('keeps native side-view noses to one horizontal row', async () => {
    const artifacts = await drawAvatarLikeness({
      ...base,
      hairColor: 'none',
      hairStyle: 'hidden',
      noseSize: 'medium',
    });
    const views = [
      { size: 12, png: artifacts.head12Side!, noseX: 10, noseY: 7 },
      { size: 16, png: artifacts.head16Side!, noseX: 13, noseY: 9 },
    ] as const;

    // The forward-shifted tip has a base/underside/tip shading ramp, while its
    // neighboring silhouette rows remain clear of the old hanging triangle.
    for (const { size, png, noseX, noseY } of views) {
      const side = await rawPng(png);
      expect(rgbaAt(side, size, noseX, noseY - 1)[3]).toBe(0);
      const tip = rgbaAt(side, size, noseX, noseY);
      const base = rgbaAt(side, size, noseX - 1, noseY);
      const underside = rgbaAt(side, size, noseX - 2, noseY + 1);
      const luma = ([r, g, b]: [number, number, number, number]): number => r + g + b;
      expect(tip[3]).toBe(255);
      expect(base[3]).toBe(255);
      expect(underside[3]).toBe(255);
      expect(luma(base)).toBeGreaterThan(luma(underside));
      expect(luma(underside)).toBeGreaterThan(luma(tip));
      expect(luma(base) - luma(underside)).toBeGreaterThanOrEqual(10);
      expect(luma(underside) - luma(tip)).toBeGreaterThanOrEqual(10);
      expect(rgbaAt(side, size, noseX, noseY + 1)[3]).toBe(0);
    }
  });

  it('suppresses ordinary ears from native side-profile silhouettes', async () => {
    const common: FaceFeatures = {
      ...base,
      hairColor: 'none',
      hairStyle: 'hidden',
    };
    const average = await drawAvatarLikeness({ ...common, ears: 'average' });
    const small = await drawAvatarLikeness({ ...common, ears: 'small' });
    const hidden = await drawAvatarLikeness({ ...common, ears: 'hidden' });
    const prominent = await drawAvatarLikeness({ ...common, ears: 'prominent' });

    expect(Buffer.compare(average.head12Side!, hidden.head12Side!)).toBe(0);
    expect(Buffer.compare(average.head16Side!, hidden.head16Side!)).toBe(0);
    expect(Buffer.compare(small.head12Side!, hidden.head12Side!)).toBe(0);
    expect(Buffer.compare(small.head16Side!, hidden.head16Side!)).toBe(0);
    expect(Buffer.compare(prominent.head12Side!, hidden.head12Side!)).not.toBe(0);
    expect(Buffer.compare(prominent.head16Side!, hidden.head16Side!)).not.toBe(0);

    // Even a prominent ear changes only an interior shade, never the outline.
    for (const [size, ordinaryPng, prominentPng, earX, earY] of [
      [12, average.head12Side!, prominent.head12Side!, 4, 6],
      [16, average.head16Side!, prominent.head16Side!, 4, 8],
    ] as const) {
      const ordinary = await rawPng(ordinaryPng);
      const emphasized = await rawPng(prominentPng);
      const changed: Array<[number, number]> = [];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          expect(rgbaAt(emphasized, size, x, y)[3]).toBe(rgbaAt(ordinary, size, x, y)[3]);
          if (
            !rgbaAt(emphasized, size, x, y).every(
              (channel, index) => channel === rgbaAt(ordinary, size, x, y)[index],
            )
          ) {
            changed.push([x, y]);
          }
        }
      }
      expect(changed).toEqual([[earX, earY]]);
    }
  });

  it('projects a side-view cap bill farther forward than a beanie', async () => {
    const common: FaceFeatures = {
      ...base,
      hairColor: 'none',
      hairStyle: 'hidden',
      headwear: true,
      headwearColor: '#33445e',
    };
    const cap = await drawAvatarLikeness({ ...common, headwearType: 'cap' });
    const beanie = await drawAvatarLikeness({ ...common, headwearType: 'beanie' });
    const bare = await drawAvatarLikeness({
      ...common,
      headwear: false,
      headwearType: 'none',
      headwearColor: 'none',
    });
    const rightmost = (raw: Buffer, size: number): number => {
      let max = -1;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (rgbaAt(raw, size, x, y)[3] === 255) max = Math.max(max, x);
        }
      }
      return max;
    };
    for (const [size, capPng, beaniePng, barePng] of [
      [12, cap.head12Side!, beanie.head12Side!, bare.head12Side!],
      [16, cap.head16Side!, beanie.head16Side!, bare.head16Side!],
    ] as const) {
      const [capRaw, beanieRaw, bareRaw] = await Promise.all([
        rawPng(capPng),
        rawPng(beaniePng),
        rawPng(barePng),
      ]);
      expect(rightmost(capRaw, size)).toBeGreaterThan(rightmost(beanieRaw, size));
      expect(rightmost(capRaw, size)).toBeGreaterThan(rightmost(bareRaw, size));
      expect(rightmost(capRaw, size)).toBe(size - 1);
    }
  });

  it('does not invent scalp hair when headwear hides it', async () => {
    const normalized = normalizeFaceFeatures({
      ...base,
      hairColor: 'none',
      hairStyle: 'short',
      headwear: true,
      headwearType: 'cap',
      headwearColor: '#aaaaaa',
    });
    expect(normalized.hairStyle).toBe('hidden');
    expect(normalized.hairColor).toBe('none');

    const hidden = await rawHead({
      ...base,
      hairColor: '#ff00ff',
      hairStyle: 'hidden',
      headwear: true,
      headwearType: 'cap',
      headwearColor: '#aaaaaa',
    });
    const invented = await rawHead({
      ...base,
      hairColor: '#ff00ff',
      hairStyle: 'short',
      headwear: true,
      headwearType: 'cap',
      headwearColor: '#aaaaaa',
    });
    const isMagentaHair = ([r, g, b]: [number, number, number, number]): boolean =>
      r >= 240 && g <= 20 && b >= 240;
    const allPixels = (raw: Buffer): [number, number, number, number][] =>
      Array.from({ length: 16 * 16 }, (_, i) => rgbaAt(raw, 16, i % 16, Math.floor(i / 16)));
    expect(allPixels(hidden).some(isMagentaHair)).toBe(false);
    // This control proves the assertion catches the sentinel when visible hair
    // is explicitly present, rather than sampling only a few temple positions.
    expect(allPixels(invented).some(isMagentaHair)).toBe(true);
  });

  it('keeps visible temple hair below a fitted cap instead of exposing a forehead band', async () => {
    const size = PORTRAIT_SIZE;
    const raw = await sharp(
      (
        await drawAvatarLikeness({
          ...base,
          hairColor: '#ff00ff',
          hairStyle: 'short',
          hairLength: 'short',
          headwear: true,
          headwearType: 'cap',
          headwearColor: '#203654',
          topology: {
            scalpHair: { crown: false, temples: true, belowEars: false },
            headwear: { crown: 'panelled', projection: 'front-bill' },
            glasses: { frame: 'none', lensShape: 'none', lensTint: 'none' },
            facialHair: { upperLip: 'none', chin: 'none', jaw: 'none', cheeks: 'none' },
          },
        })
      ).portrait,
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    const isSentinelHair = (x: number, y: number): boolean => {
      const [r, g, b, a] = rgbaAt(raw, size, x, y);
      return a === 255 && r >= 150 && g <= 30 && b >= 150;
    };
    const sentinelRows = Array.from({ length: size }, (_, y) => y).filter((y) =>
      Array.from({ length: size }, (_, x) => x).some(
        (x) => (x < size * 0.25 || x > size * 0.75) && isSentinelHair(x, y),
      ),
    );

    // Preserve a tiny sideburn/temple cue, but do not let it start in the gap
    // immediately below the cap bill (the old four-to-six-pixel scalp band).
    expect(sentinelRows.length).toBeGreaterThan(0);
    expect(Math.min(...sentinelRows)).toBeGreaterThanOrEqual(30);
  });

  it('gives a cap a projecting bill and a hat-colored silhouette', async () => {
    const common: FaceFeatures = {
      ...base,
      hairStyle: 'hidden',
      headwear: true,
      headwearColor: '#aaaaaa',
    };
    const cap = await rawHead({ ...common, headwearType: 'cap' });
    const beanie = await rawHead({ ...common, headwearType: 'beanie' });

    // The cap has a one-sided projecting bill outside its crown, but no
    // full-canvas band. Requiring both edges here made the old cap look like a
    // visor; the beanie remains a symmetric dome/cuff with no projection.
    expect(rgbaAt(cap, 16, 14, 4)[3]).toBe(0);
    expect(rgbaAt(cap, 16, 14, 5)[3]).toBe(255);
    expect(rgbaAt(cap, 16, 1, 5)[3]).toBe(0);
    expect(rgbaAt(cap, 16, 0, 5)[3]).toBe(0);
    expect(rgbaAt(cap, 16, 15, 5)[3]).toBe(0);
    expect(rgbaAt(beanie, 16, 1, 5)[3]).toBe(255);
    expect(rgbaAt(beanie, 16, 14, 5)[3]).toBe(255);

    // A neutral-gray cap edge must stay neutral gray rather than inheriting
    // the renderer's brown skin outline (the old beanie-like result).
    const [r, g, b] = rgbaAt(cap, 16, 14, 5);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('covers the scalp and keeps long hair attached beneath fitted and structured hats', async () => {
    for (const [headwearType, crown, projection] of [
      ['cap', 'panelled', 'front-bill'],
      ['flatCap', 'structured', 'front-bill'],
      ['beret', 'structured', 'none'],
      ['topHat', 'structured', 'full-brim'],
    ] as const) {
      const artifacts = await drawAvatarLikeness({
        ...base,
        skinTone: '#ff0000',
        hairColor: '#ff00ff',
        hairStyle: 'long',
        hairLength: 'long',
        hairTexture: 'straight',
        hairPart: 'none',
        headwear: true,
        headwearType,
        headwearColor: '#00ffff',
        topology: {
          scalpHair: { crown: true, temples: true, belowEars: true },
          headwear: { crown, projection },
          glasses: { frame: 'none', lensShape: 'none', lensTint: 'none' },
          facialHair: { upperLip: 'none', chin: 'none', jaw: 'none', cheeks: 'none' },
        },
      });

      for (const [size, png] of [
        [12, artifacts.head12],
        [12, artifacts.head12Side!],
        [12, artifacts.head12Back!],
        [16, artifacts.head16],
        [16, artifacts.head16Side!],
        [16, artifacts.head16Back!],
      ] as const) {
        const raw = await rawPng(png);
        const hairMask = Array<boolean>(size * size).fill(false);
        const hatMask = Array<boolean>(size * size).fill(false);
        const skinMask = Array<boolean>(size * size).fill(false);
        let maxHairY = -1;
        let maxHatY = -1;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const [r, g, b, a] = rgbaAt(raw, size, x, y);
            if (a !== 255) continue;
            const index = y * size + x;
            hairMask[index] = r > g * 1.8 && b > g * 1.8 && r > 70 && b > 70;
            hatMask[index] = g > r * 1.8 && b > r * 1.8 && g > 60 && b > 60;
            skinMask[index] = r > g * 2 && r > b * 2 && r > 60;
            if (hairMask[index]) maxHairY = Math.max(maxHairY, y);
            if (hatMask[index]) maxHatY = Math.max(maxHatY, y);
          }
        }

        expect(maxHairY).toBeGreaterThan(maxHatY);
        expect(maxHatY).toBeGreaterThanOrEqual(0);
        expect(
          skinMask.some((on, index) => on && Math.floor(index / size) <= maxHatY),
        ).toBe(false);
        const clothingAndHair = hairMask.map((hair, index) => hair || hatMask[index]!);
        expect(countComponents8(clothingAndHair, size)).toBe(1);
      }
    }
  });

  it('preserves readable material contrast on a near-black cap', async () => {
    const cap = await rawHead({
      ...base,
      hairColor: 'none',
      hairStyle: 'hidden',
      headwear: true,
      headwearType: 'cap',
      headwearColor: '#121212',
    });
    const levels = new Set<number>();
    for (let y = 0; y <= 6; y++) {
      for (let x = 0; x < 16; x++) {
        const [r, g, b, a] = rgbaAt(cap, 16, x, y);
        if (a === 255 && Math.max(r, g, b) < 120) levels.add(Math.round((r + g + b) / 3));
      }
    }
    expect(levels.size).toBeGreaterThanOrEqual(3);
    expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThanOrEqual(12);
  });

  it('rounds and expands side-hair silhouettes while keeping afro and horseshoe distinct', async () => {
    const common: FaceFeatures = {
      ...base,
      hairColor: '#ff00ff',
      hairLength: 'short',
      hairPart: 'none',
    };
    const [short, curly, afro, horseshoe] = await Promise.all([
      drawAvatarLikeness({ ...common, hairStyle: 'short', hairTexture: 'straight' }),
      drawAvatarLikeness({ ...common, hairStyle: 'curly', hairTexture: 'coily' }),
      drawAvatarLikeness({ ...common, hairStyle: 'afro', hairTexture: 'coily' }),
      drawAvatarLikeness({ ...common, hairStyle: 'horseshoe', hairTexture: 'straight' }),
    ]);
    const isHair = ([r, g, b, a]: [number, number, number, number]): boolean =>
      a === 255 && r >= 120 && g <= 80 && b >= 120;

    for (const [size, shortPng, curlyPng, afroPng, horseFrontPng, horseSidePng] of [
      [12, short.head12Side!, curly.head12Side!, afro.head12Side!, horseshoe.head12, horseshoe.head12Side!],
      [16, short.head16Side!, curly.head16Side!, afro.head16Side!, horseshoe.head16, horseshoe.head16Side!],
    ] as const) {
      const [shortRaw, curlyRaw, afroRaw, horseFrontRaw, horseSideRaw] = await Promise.all([
        rawPng(shortPng),
        rawPng(curlyPng),
        rawPng(afroPng),
        rawPng(horseFrontPng),
        rawPng(horseSidePng),
      ]);
      const hairPoints = (raw: Buffer): Array<[number, number]> => {
        const points: Array<[number, number]> = [];
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            if (isHair(rgbaAt(raw, size, x, y))) points.push([x, y]);
          }
        }
        return points;
      };
      const shortPoints = hairPoints(shortRaw);
      const curlyPoints = hairPoints(curlyRaw);
      const afroPoints = hairPoints(afroRaw);
      const horseFrontPoints = hairPoints(horseFrontRaw);
      const horseSidePoints = hairPoints(horseSideRaw);

      expect(Buffer.compare(shortRaw, curlyRaw)).not.toBe(0);
      expect(shortPoints.some(([, y]) => y === 0)).toBe(false);
      expect(curlyPoints.some(([, y]) => y === 0)).toBe(false);
      expect(afroPoints.some(([, y]) => y === 0)).toBe(false);
      expect(afroPoints.some(([x]) => x === 0 || x === size - 1)).toBe(false);

      const rowLeftEdges = [...new Set(shortPoints.map(([, y]) => y))]
        .sort((a, b) => a - b)
        .map((y) => Math.min(...shortPoints.filter(([, py]) => py === y).map(([x]) => x)));
      expect(Math.min(...rowLeftEdges)).toBe(1);
      expect(new Set(rowLeftEdges).size).toBeGreaterThanOrEqual(4);
      expect(rowLeftEdges.at(-1)).toBeGreaterThan(Math.min(...rowLeftEdges));

      const width = (points: Array<[number, number]>): number =>
        Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x)) + 1;
      expect(width(afroPoints)).toBeGreaterThanOrEqual(width(shortPoints) + (size === 16 ? 2 : 1));

      const centerXs = [Math.floor((size - 1) / 2), Math.ceil((size - 1) / 2)];
      expect(
        horseFrontPoints.some(([x, y]) => centerXs.includes(x) && y <= Math.floor(size * 0.35)),
      ).toBe(false);
      expect(horseFrontPoints.length).toBeGreaterThan(0);
      expect(horseSidePoints.length).toBeGreaterThan(0);
    }
  });

  it('authors distinct, hair-blended left, centre, and right part glyphs at native sizes', async () => {
    const common: FaceFeatures = {
      ...base,
      hairColor: '#ff00ff',
      hairStyle: 'parted',
      hairLength: 'short',
      hairTexture: 'straight',
    };
    const [none, left, center, right] = await Promise.all([
      drawAvatarLikeness({ ...common, hairPart: 'none' }),
      drawAvatarLikeness({ ...common, hairPart: 'left' }),
      drawAvatarLikeness({ ...common, hairPart: 'center' }),
      drawAvatarLikeness({ ...common, hairPart: 'right' }),
    ]);

    for (const [size, nonePng, leftPng, centerPng, rightPng] of [
      [12, none.head12, left.head12, center.head12, right.head12],
      [16, none.head16, left.head16, center.head16, right.head16],
    ] as const) {
      const [noneRaw, leftRaw, centerRaw, rightRaw] = await Promise.all([
        rawPng(nonePng),
        rawPng(leftPng),
        rawPng(centerPng),
        rawPng(rightPng),
      ]);
      const deltas = [leftRaw, centerRaw, rightRaw].map((raw) => changedIndices(noneRaw, raw, size));
      const commonDelta = new Set([...deltas[0]!].filter((index) => deltas.slice(1).every((set) => set.has(index))));
      const strokes = deltas.map((delta) => new Set([...delta].filter((index) => !commonDelta.has(index))));
      const strokeRaws = [leftRaw, centerRaw, rightRaw];
      const centroids = strokes.map((stroke, strokeIndex) => {
        expect(stroke.size).toBeGreaterThanOrEqual(2);
        expect(stroke.size).toBeLessThanOrEqual(5);
        for (const index of stroke) {
          const [r, g, b] = rgbaAt(
            strokeRaws[strokeIndex]!,
            size,
            index % size,
            Math.floor(index / size),
          );
          // Strictly between the magenta hair and warm skin endpoints: never
          // the old raw skin/skin-light stripe.
          expect(r).toBeGreaterThan(205);
          expect(r).toBeLessThan(250);
          expect(g).toBeGreaterThan(20);
          expect(g).toBeLessThan(120);
          expect(b).toBeGreaterThan(120);
          expect(b).toBeLessThan(245);
        }
        return [...stroke].reduce((sum, index) => sum + (index % size), 0) / stroke.size;
      });
      // Hair-part labels are from the person's perspective, so viewer-space
      // ordering is person-right, centre, person-left.
      expect(centroids[2]).toBeLessThan(centroids[1]!);
      expect(centroids[1]).toBeLessThan(centroids[0]!);
    }
  });

  it('makes high-signal hair silhouettes distinct at 16px', async () => {
    const short = await drawAvatarLikeness({ ...base, hairStyle: 'short' });
    const long = await drawAvatarLikeness({ ...base, hairStyle: 'long' });
    const parted = await drawAvatarLikeness({ ...base, hairStyle: 'parted' });
    expect(Buffer.compare(short.head16, long.head16)).not.toBe(0);
    expect(Buffer.compare(short.head16, parted.head16)).not.toBe(0);
  });

  it('normalizes conflicting provider fields into renderer invariants', () => {
    const f = normalizeFaceFeatures({
      skinTone: 'ABC',
      hairColor: '#123456',
      hairStyle: 'bald',
      facialHair: 'none',
      facialHairColor: '#ffffff',
      headwear: false,
      headwearType: 'beanie',
      headwearColor: 'garbage',
      glasses: 'yes',
    });
    expect(f.skinTone).toBe('#aabbcc');
    expect(f.hairColor).toBe('none');
    expect(f.hairStyle).toBe('bald');
    expect(f.facialHairColor).toBe('none');
    expect(f.headwear).toBe(false);
    expect(f.headwearType).toBe('none');
    expect(f.headwearColor).toBe('none');
    expect(f.glasses).toBe(false);
  });

  it('never throws on empty/garbage features (graceful for the mock provider)', async () => {
    await expect(drawAvatarLikeness({} as FaceFeatures)).resolves.toBeTruthy();
  });
});
