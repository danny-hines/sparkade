import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { FIGHTER_POSES } from '@sparkade/archetypes';
import {
  GENERATED_FIGHTER_POSES,
  bestAvailableFighterPoseFallback,
  buildGeneratedFighterAtlas,
  buildFighterPosePrompt,
  isGeneratedFighterPose,
  prepareGeneratedFighterReference,
  processGeneratedFighterPose,
  validateGeneratedFighterAtlas,
} from '../src/assets/fighter-pose';
import { mockGeneratedImage } from '../src/assets/game-art';

interface SyntheticImageOptions {
  width?: number;
  height?: number;
  subject?: { left: number; top: number; width: number; height: number } | null;
  secondSubject?: { left: number; top: number; width: number; height: number };
  background?: readonly [number, number, number];
  subjectColor?: readonly [number, number, number];
  enclosedGreen?: boolean;
}

async function syntheticFighter(options: SyntheticImageOptions = {}): Promise<Buffer> {
  const width = options.width ?? 80;
  const height = options.height ?? 80;
  const subject =
    options.subject === undefined ? { left: 30, top: 12, width: 20, height: 60 } : options.subject;
  const background = options.background ?? [8, 244, 5];
  const subjectColor = options.subjectColor ?? [196, 106, 72];
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const inSubject =
        subject !== null &&
        x >= subject.left &&
        x < subject.left + subject.width &&
        y >= subject.top &&
        y < subject.top + subject.height;
      const inSecondSubject =
        options.secondSubject !== undefined &&
        x >= options.secondSubject.left &&
        x < options.secondSubject.left + options.secondSubject.width &&
        y >= options.secondSubject.top &&
        y < options.secondSubject.top + options.secondSubject.height;
      raw[offset] = inSubject || inSecondSubject ? subjectColor[0] : background[0];
      raw[offset + 1] = inSubject || inSecondSubject ? subjectColor[1] : background[1];
      raw[offset + 2] = inSubject || inSecondSubject ? subjectColor[2] : background[2];
      raw[offset + 3] = 255;
    }
  }
  if (subject && options.enclosedGreen) {
    const centerX = subject.left + Math.floor(subject.width / 2);
    const centerY = subject.top + Math.floor(subject.height / 2);
    for (let y = centerY - 2; y <= centerY + 2; y++) {
      for (let x = centerX - 2; x <= centerX + 2; x++) {
        const offset = (y * width + x) * 4;
        raw[offset] = 0;
        raw[offset + 1] = 255;
        raw[offset + 2] = 0;
      }
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

async function alphaBounds(png: Buffer): Promise<{
  width: number;
  height: number;
  count: number;
  enclosedTransparent: number;
}> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  let enclosedTransparent = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * 4 + 3]!;
      if (alpha === 0) continue;
      count++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX >= minX && maxY >= minY) {
    for (let y = minY + 1; y < maxY; y++) {
      for (let x = minX + 1; x < maxX; x++) {
        if (data[(y * info.width + x) * 4 + 3] === 0) enclosedTransparent++;
      }
    }
  }
  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    count,
    enclosedTransparent,
  };
}

describe('generated fighter pose prompts', () => {
  it('uses the complete current fighter-pose names and order', () => {
    expect(GENERATED_FIGHTER_POSES).toEqual([
      'idle',
      'walk',
      'crouch',
      'jump',
      'punchHigh',
      'punchLow',
      'kickHigh',
      'kickLow',
      'airPunch',
      'airKick',
      'block',
      'hit',
      'ko',
    ]);
    expect(GENERATED_FIGHTER_POSES).toEqual(FIGHTER_POSES);
    for (const pose of GENERATED_FIGHTER_POSES) expect(isGeneratedFighterPose(pose)).toBe(true);
    expect(isGeneratedFighterPose('guard')).toBe(false);
    expect(isGeneratedFighterPose('hurt')).toBe(false);
  });

  it('requests one identity-preserving right-facing sprite on controlled green', () => {
    const prompt = buildFighterPosePrompt('kickHigh', {
      artDirection:
        'Aesthetic: stylized. Shared character proportions: six-head athletic adults. Shared rendering treatment: crisp dark outlines and three-step cel shading.',
      identity: 'round glasses and a short beard',
      outfit: 'red boxing shorts and white hand wraps',
      colors: 'red, white, and charcoal',
    });
    expect(prompt).toContain('exact person or character in the attached reference image');
    expect(prompt).toContain('round glasses and a short beard');
    expect(prompt).toContain('six-head athletic adults');
    expect(prompt).toContain('high side kick');
    expect(prompt).toContain('faces toward the RIGHT');
    expect(prompt).toContain('flat solid #00ff00');
    expect(prompt).toContain('No text');
    expect(prompt).toContain('No texture or color variation');
    expect(prompt).toContain('NOT a sprite sheet');
  });

  it('rejects a runtime pose outside the supported set', () => {
    expect(() => buildFighterPosePrompt('victory' as never)).toThrow(
      'unsupported generated fighter pose',
    );
  });

  it('authors movement poses that remain visually distinct from attacks', () => {
    expect(buildFighterPosePrompt('walk')).toContain('mid-stride frame of a guarded walk');
    expect(buildFighterPosePrompt('crouch')).toContain('low stationary crouching fighting stance');
    const jump = buildFighterPosePrompt('jump');
    expect(jump).toContain('both feet clearly off the ground');
    expect(jump).toContain('no attack in progress');
    expect(buildFighterPosePrompt('airPunch')).toContain('forward jumping punch');
    expect(buildFighterPosePrompt('airKick')).toContain('forward jumping kick');
  });

  it('describes KO as a policy-safe, non-injurious arcade defeat state', () => {
    const prompt = buildFighterPosePrompt('ko');
    expect(prompt).toContain('non-violent post-match defeat pose');
    expect(prompt).toContain('peaceful uninjured expression');
    expect(prompt).toContain('no wounds, blood, bruises, impact marks, or distress');
    expect(prompt).not.toContain('knocked-out pose');
  });

  it('chooses the closest mechanically valid fallback state without inventing one', () => {
    expect(bestAvailableFighterPoseFallback('ko', new Set(['idle', 'block', 'hit']))).toBe('hit');
    expect(bestAvailableFighterPoseFallback('airKick', new Set(['idle', 'jump']))).toBe('jump');
    expect(bestAvailableFighterPoseFallback('walk', new Set(['idle']))).toBe('idle');
    expect(bestAvailableFighterPoseFallback('idle', new Set(['idle']))).toBeNull();
  });
});

describe('generated fighter pose preprocessing', () => {
  it('keeps the no-key demo fixture fighter-shaped rather than a solid rectangle', async () => {
    const prompt = buildFighterPosePrompt('kickHigh');
    const result = await processGeneratedFighterPose(await mockGeneratedImage(prompt));
    const bounds = await alphaBounds(result.png);

    expect(bounds.width).toBeGreaterThan(20);
    expect(bounds.height).toBeGreaterThan(35);
    expect(bounds.enclosedTransparent).toBeGreaterThan(100);
  });

  it('preserves emerald-green hair or clothing while removing the neon key', async () => {
    const source = await syntheticFighter({ subjectColor: [0, 168, 107] });

    await expect(processGeneratedFighterPose(source)).resolves.toMatchObject({
      metrics: { sourceBounds: { width: 20, height: 60 } },
    });
  });

  it('creates a deterministic 1024px idle reference for resumable generation', async () => {
    const source = await syntheticFighter({ width: 160, height: 120 });
    const first = await prepareGeneratedFighterReference(source);
    const second = await prepareGeneratedFighterReference(source);

    expect(first.equals(second)).toBe(true);
    await expect(sharp(first).metadata()).resolves.toMatchObject({
      width: 1024,
      height: 1024,
      format: 'png',
    });
  });

  it('rejects a second significant character instead of compiling a two-person sprite', async () => {
    const source = await syntheticFighter({
      width: 120,
      height: 100,
      subject: { left: 18, top: 12, width: 24, height: 76 },
      secondSubject: { left: 76, top: 12, width: 24, height: 76 },
    });

    await expect(processGeneratedFighterPose(source)).rejects.toMatchObject({
      code: 'multiple-subjects',
    });
    await expect(
      processGeneratedFighterPose(source, { isolatePrimarySubject: true }),
    ).rejects.toMatchObject({ code: 'multiple-subjects' });
  });

  it('removes a clipped distant foreground island from a pre-segmented sheet cell', async () => {
    const source = await syntheticFighter({
      width: 120,
      height: 100,
      subject: { left: 48, top: 12, width: 24, height: 76 },
      secondSubject: { left: 0, top: 34, width: 12, height: 35 },
    });

    await expect(processGeneratedFighterPose(source)).rejects.toMatchObject({
      code: 'multiple-subjects',
    });
    const isolated = await processGeneratedFighterPose(source, {
      isolatePrimarySubject: true,
    });
    expect(isolated.metrics).toMatchObject({
      sourceBounds: { left: 48, top: 12, width: 24, height: 76 },
      sourceComponentCount: 2,
      discardedComponentCount: 1,
    });
    expect(isolated.metrics.discardedSubjectFraction).toBeCloseTo((12 * 35) / (120 * 100));
  });

  it('retains a tiny nearby disconnected costume detail with the primary fighter', async () => {
    const source = await syntheticFighter({
      width: 80,
      height: 80,
      subject: { left: 28, top: 12, width: 22, height: 60 },
      secondSubject: { left: 52, top: 20, width: 2, height: 4 },
    });
    const isolated = await processGeneratedFighterPose(source, {
      isolatePrimarySubject: true,
    });

    expect(isolated.metrics).toMatchObject({
      sourceBounds: { left: 28, top: 12, width: 26, height: 60 },
      sourceComponentCount: 2,
      discardedComponentCount: 0,
    });
  });

  it('removes even a tiny nearby island when it is clipped by the cell boundary', async () => {
    const source = await syntheticFighter({
      width: 80,
      height: 80,
      subject: { left: 35, top: 12, width: 40, height: 60 },
      secondSubject: { left: 78, top: 20, width: 2, height: 4 },
    });
    const isolated = await processGeneratedFighterPose(source, {
      isolatePrimarySubject: true,
    });

    expect(isolated.metrics).toMatchObject({
      sourceBounds: { left: 35, top: 12, width: 40, height: 60 },
      sourceComponentCount: 2,
      discardedComponentCount: 1,
    });
  });

  it('keys enclosed and exterior green, crops, bottom-aligns, and writes an indexed PNG', async () => {
    const result = await processGeneratedFighterPose(
      await syntheticFighter({ enclosedGreen: true }),
    );
    const metadata = await sharp(result.png).metadata();
    const bounds = await alphaBounds(result.png);

    expect(metadata).toMatchObject({ format: 'png', width: 96, height: 96, isPalette: true });
    expect(result.metrics.sourceBounds).toEqual({ left: 30, top: 12, width: 20, height: 60 });
    expect(result.metrics.outputBounds).toEqual({ left: 33, top: 4, width: 29, height: 88 });
    expect(result.metrics.greenFraction).toBeGreaterThan(0.8);
    expect(bounds).toMatchObject({ width: 29, height: 88 });
    expect(bounds.count).toBeLessThan(29 * 88);
    expect(bounds.enclosedTransparent).toBeGreaterThan(0);

    const { data, info } = await sharp(result.png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number): number => data[(y * info.width + x) * 4 + 3]!;
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(47, 91)).toBeGreaterThan(0);
    expect(alphaAt(47, 92)).toBe(0);
  });

  it('normalizes different source crops onto the same target canvas', async () => {
    const tall = await processGeneratedFighterPose(
      await syntheticFighter({ subject: { left: 8, top: 4, width: 18, height: 70 } }),
    );
    const wide = await processGeneratedFighterPose(
      await syntheticFighter({ subject: { left: 5, top: 45, width: 70, height: 20 } }),
    );
    expect(await sharp(tall.png).metadata()).toMatchObject({ width: 96, height: 96 });
    expect(await sharp(wide.png).metadata()).toMatchObject({ width: 96, height: 96 });
    expect(tall.metrics.outputBounds.top + tall.metrics.outputBounds.height).toBe(92);
    expect(wide.metrics.outputBounds.top + wide.metrics.outputBounds.height).toBe(92);
    expect(
      Math.abs(tall.metrics.outputBounds.left * 2 + tall.metrics.outputBounds.width - 96),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(wide.metrics.outputBounds.left * 2 + wide.metrics.outputBounds.width - 96),
    ).toBeLessThanOrEqual(1);
  });

  it('packs every selected combat state into the stable runtime atlas layout', async () => {
    const poses = Object.fromEntries(
      await Promise.all(
        GENERATED_FIGHTER_POSES.map(async (pose, index) => [
          pose,
          await sharp({
            create: {
              width: 96,
              height: 96,
              channels: 4,
              background: { r: index * 17, g: 40, b: 180 - index * 7, alpha: 1 },
            },
          })
            .png()
            .toBuffer(),
        ]),
      ),
    ) as Record<(typeof GENERATED_FIGHTER_POSES)[number], Buffer>;

    const atlas = await buildGeneratedFighterAtlas(poses);
    await expect(validateGeneratedFighterAtlas(atlas)).resolves.toBeUndefined();
    await expect(sharp(atlas).metadata()).resolves.toMatchObject({
      format: 'png',
      width: 384,
      height: 384,
    });
  });

  it('rejects an image without the promised green screen', async () => {
    const image = await syntheticFighter({ background: [30, 30, 40] });
    await expect(processGeneratedFighterPose(image)).rejects.toMatchObject({
      code: 'missing-green-background',
    });
  });

  it('returns a typed validation error for invalid image bytes', async () => {
    await expect(processGeneratedFighterPose(Buffer.from('not an image'))).rejects.toMatchObject({
      code: 'invalid-image',
    });
  });

  it('rejects an all-green image with no fighter', async () => {
    const image = await syntheticFighter({ subject: null });
    await expect(processGeneratedFighterPose(image)).rejects.toMatchObject({
      code: 'empty-subject',
    });
  });

  it('rejects implausibly tiny and oversized subjects', async () => {
    const tiny = await syntheticFighter({ subject: { left: 39, top: 39, width: 2, height: 2 } });
    const huge = await syntheticFighter({ subject: { left: 3, top: 3, width: 74, height: 74 } });
    await expect(processGeneratedFighterPose(tiny)).rejects.toMatchObject({
      code: 'subject-too-small',
    });
    await expect(processGeneratedFighterPose(huge)).rejects.toMatchObject({
      code: 'subject-too-large',
    });
  });

  it('validates target dimensions before invoking Sharp', async () => {
    const image = await syntheticFighter();
    await expect(processGeneratedFighterPose(image, { width: 8, padding: 4 })).rejects.toEqual(
      expect.objectContaining({ code: 'invalid-options' }),
    );
  });
});
