import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { PORTRAIT_SIZE } from '@sparkade/shared';
import {
  GENERATED_HEAD_SIZES,
  describeVisibleTraits,
  extractGeneratedHead,
  generateDefeatPortrait,
  generateHeadSprites,
  generatePortrait,
  type LikenessImageEdit,
} from '../src/likeness/portrait-gen';
import type { FaceFeatures } from '../src/likeness/features';
import type { MetaImageCallOptions, MetaImageEditRequest } from '../src/providers/meta-image';

describe('generated likeness heads', () => {
  it('describes occluded hair without inventing baldness', () => {
    const features = {
      hairStyle: 'hidden',
      hairColor: '#2a2320',
      headwear: true,
      facialHair: 'stubble',
      glasses: true,
    } as FaceFeatures;
    const phrase = describeVisibleTraits(features);
    expect(phrase).toContain('scalp hair fully hidden');
    expect(phrase).not.toMatch(/\bbald\b/);
    expect(phrase).toContain('stubble');
    expect(phrase).toContain('glasses');
  });

  it('removes all generated green-screen regions, including enclosed ones', async () => {
    const width = 64;
    const height = 64;
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const inHead = x >= 16 && x <= 47 && y >= 10 && y <= 53;
        raw[offset] = inHead ? 201 : 0;
        raw[offset + 1] = inHead ? 143 : 255;
        raw[offset + 2] = inHead ? 107 : 0;
        raw[offset + 3] = 255;
      }
    }
    // Models sometimes surround a patch of background with their outline, so
    // the key removal cannot depend on edge connectivity.
    const interior = (30 * width + 30) * 4;
    raw[interior] = 0;
    raw[interior + 1] = 255;
    raw[interior + 2] = 0;

    const source = await sharp(raw, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    const cutout = await extractGeneratedHead(source);
    const image = sharp(cutout);
    const meta = await image.metadata();
    expect(meta.width).toBe(meta.height);
    expect(meta.width).toBeGreaterThan(44);
    const pixels = await image.ensureAlpha().raw().toBuffer();
    expect(pixels[3]).toBe(0);
    let opaqueGreen = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 0 && pixels[i + 1] === 255 && pixels[i + 2] === 0 && pixels[i + 3] === 255)
        opaqueGreen++;
    }
    expect(opaqueGreen).toBe(0);
  });

  it('preserves dark green identity details while removing the neon key', async () => {
    const width = 64;
    const height = 64;
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const inHead = x >= 16 && x <= 47 && y >= 10 && y <= 53;
        raw[offset] = inHead ? 201 : 0;
        raw[offset + 1] = inHead ? 143 : 255;
        raw[offset + 2] = inHead ? 107 : 0;
        raw[offset + 3] = 255;
      }
    }
    const darkGreenDetail = (30 * width + 30) * 4;
    raw[darkGreenDetail] = 0;
    raw[darkGreenDetail + 1] = 168;
    raw[darkGreenDetail + 2] = 107;

    const source = await sharp(raw, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    const cutout = await extractGeneratedHead(source);
    const pixels = await sharp(cutout).ensureAlpha().raw().toBuffer();
    let retained = false;
    for (let i = 0; i < pixels.length; i += 4) {
      if (
        pixels[i] === 0 &&
        pixels[i + 1] === 168 &&
        pixels[i + 2] === 107 &&
        pixels[i + 3] === 255
      ) {
        retained = true;
        break;
      }
    }
    expect(retained).toBe(true);
  });

  it('sends a normalized PNG through the injected Meta edit seam', async () => {
    const source = await sharp({
      create: { width: 80, height: 40, channels: 3, background: '#ac7654' },
    })
      .jpeg()
      .toBuffer();
    const generated = await sharp({
      create: { width: 128, height: 128, channels: 3, background: '#5a346b' },
    })
      .png()
      .toBuffer();
    let request: MetaImageEditRequest | undefined;
    let callOptions: MetaImageCallOptions | undefined;
    const edit: LikenessImageEdit = async (nextRequest, nextOptions) => {
      request = nextRequest;
      callOptions = nextOptions;
      return {
        image: generated,
        usage: { generated_images: 1 },
        outputFormat: 'png',
        imageCount: 1,
      };
    };

    const portrait = await generatePortrait(source, {} as FaceFeatures, edit, {
      size: '768x768',
      user: 'game-123',
      heroConcept: 'a silver pressure suit with cobalt shoulder panels',
      callOptions: { model: 'muse-image-test', timeoutMs: 7_500 },
    });

    expect(request).toMatchObject({
      imageMimeType: 'image/png',
      imageFilename: 'player-photo.png',
      outputFormat: 'png',
      size: '768x768',
      user: 'game-123',
    });
    expect(request?.prompt).toContain('front-facing head-and-shoulders portrait');
    expect(request?.prompt).toContain('likeness from the neck up');
    expect(request?.prompt).toContain('silver pressure suit with cobalt shoulder panels');
    expect(request?.prompt).toContain("source photo's clothing below the neck is not identity");
    const inputMeta = await sharp(request!.image).metadata();
    expect(inputMeta).toMatchObject({ width: 512, height: 512, format: 'png' });
    expect(callOptions).toEqual({ model: 'muse-image-test', timeoutMs: 7_500 });
    const portraitMeta = await sharp(portrait).metadata();
    expect(portraitMeta).toMatchObject({
      width: PORTRAIT_SIZE,
      height: PORTRAIT_SIZE,
      format: 'png',
    });
  });

  it('authors a story-aware defeat expression while preserving photo identity', async () => {
    const source = await sharp({
      create: { width: 80, height: 80, channels: 3, background: '#ac7654' },
    })
      .png()
      .toBuffer();
    const generated = await sharp({
      create: { width: 128, height: 128, channels: 3, background: '#4b365f' },
    })
      .png()
      .toBuffer();
    let prompt = '';
    const edit: LikenessImageEdit = async (request) => {
      prompt = request.prompt;
      return {
        image: generated,
        usage: undefined,
        outputFormat: 'png',
        imageCount: 1,
      };
    };

    const portrait = await generateDefeatPortrait(
      source,
      null,
      'The storm scattered every rescued star and the tower went dark.',
      edit,
      { heroConcept: 'a silver pressure suit with cobalt shoulder panels' },
    );

    expect(prompt).toContain('storm scattered every rescued star');
    expect(prompt).toMatch(/disappointment, worry, sadness, or concern/);
    expect(prompt).toContain('Change only the expression');
    expect(prompt).toContain('silver pressure suit with cobalt shoulder panels');
    expect(prompt).toContain('Add no accessory that is absent');
    expect(prompt).not.toMatch(/glasses|lens|temple arm/i);
    await expect(sharp(portrait).metadata()).resolves.toMatchObject({
      width: PORTRAIT_SIZE,
      height: PORTRAIT_SIZE,
      format: 'png',
    });
  });

  it('derives engine-sized 12px and 16px heads from one Muse edit', async () => {
    const source = await sharp({
      create: { width: 48, height: 64, channels: 3, background: '#7c4c34' },
    })
      .png()
      .toBuffer();
    const generated = await greenScreenHead();
    let calls = 0;
    const edit: LikenessImageEdit = async () => {
      calls++;
      return {
        image: generated,
        usage: undefined,
        outputFormat: 'png',
        imageCount: 1,
      };
    };

    const result = await generateHeadSprites(source, {} as FaceFeatures, edit);

    expect(calls).toBe(1);
    expect(Object.keys(result.heads).map(Number)).toEqual([...GENERATED_HEAD_SIZES]);
    await expect(sharp(result.heads[12]).metadata()).resolves.toMatchObject({
      width: 12,
      height: 12,
    });
    await expect(sharp(result.heads[16]).metadata()).resolves.toMatchObject({
      width: 16,
      height: 16,
    });
  });

  it('authors distinct profile and rear-view prompts without front-view contradictions', async () => {
    const source = await sharp({
      create: { width: 48, height: 64, channels: 3, background: '#7c4c34' },
    })
      .png()
      .toBuffer();
    const generated = await greenScreenHead();
    const prompts: string[] = [];
    const edit: LikenessImageEdit = async (request) => {
      prompts.push(request.prompt);
      return {
        image: generated,
        usage: undefined,
        outputFormat: 'png',
        imageCount: 1,
      };
    };

    await generateHeadSprites(source, null, edit, { direction: 'front' });
    await generateHeadSprites(source, null, edit, { direction: 'side' });
    await generateHeadSprites(source, null, edit, { direction: 'back' });

    expect(prompts[0]).toContain('symmetrical, clearly readable face');
    expect(prompts[1]).toContain('show exactly one eye');
    expect(prompts[1]).not.toContain('two separate visible eyes');
    expect(prompts[2]).toContain('Show no eyes, nose, mouth');
    expect(prompts[2]).not.toContain('symmetrical, clearly readable face');
    for (const prompt of prompts) {
      expect(prompt).toContain('Add no accessory that is absent');
      expect(prompt).not.toMatch(/glasses|lens|temple arm/i);
    }
  });

  it('mentions eyewear geometry only when structured features confirm it', async () => {
    const source = await sharp({
      create: { width: 48, height: 64, channels: 3, background: '#7c4c34' },
    })
      .png()
      .toBuffer();
    const generated = await greenScreenHead();
    const prompts: string[] = [];
    const edit: LikenessImageEdit = async (request) => {
      prompts.push(request.prompt);
      return {
        image: generated,
        usage: undefined,
        outputFormat: 'png',
        imageCount: 1,
      };
    };
    const base = {
      hairStyle: 'short',
      hairColor: '#2a2320',
      headwear: false,
      facialHair: 'none',
    } as FaceFeatures;

    await generateHeadSprites(source, { ...base, glasses: true }, edit, { direction: 'side' });
    await generateHeadSprites(source, { ...base, glasses: false }, edit, { direction: 'side' });

    expect(prompts[0]).toContain('exactly one visible lens and its temple arm');
    expect(prompts[1]).toContain('not wearing eyewear');
    expect(prompts[1]).toContain('Do not add glasses');
  });
});

async function greenScreenHead(): Promise<Buffer> {
  const width = 96;
  const height = 96;
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const inHead = x >= 25 && x <= 70 && y >= 15 && y <= 80;
      raw[offset] = inHead ? 172 : 0;
      raw[offset + 1] = inHead ? 108 : 255;
      raw[offset + 2] = inHead ? 79 : 0;
      raw[offset + 3] = 255;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}
