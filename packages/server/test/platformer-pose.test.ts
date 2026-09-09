import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { mockGeneratedImage } from '../src/assets/game-art';
import { platformerReviewSprite } from '../src/assets/platformer-review';
import {
  GENERATED_PLATFORMER_POSE_HEIGHT,
  GENERATED_PLATFORMER_POSE_WIDTH,
  GENERATED_PLATFORMER_POSES,
  alignGeneratedPlatformerPoseCanvases,
  buildPlatformerPosePrompt,
  buildPlatformerRunCorrectionPrompt,
  measureGeneratedPlatformerRunPair,
  prepareGeneratedPlatformerReference,
  processGeneratedPlatformerPose,
  recoverGeneratedPlatformerGreenPanel,
  validateGeneratedPlatformerRunPair,
  validateGeneratedPlatformerPoseSet,
} from '../src/assets/platformer-pose';

const POSE_FIXTURE_SCALE = GENERATED_PLATFORMER_POSE_WIDTH / 56;

function paintCircle(
  raw: Buffer,
  centerX: number,
  centerY: number,
  radius: number,
  color: readonly [number, number, number],
): void {
  const scaledCenterX = centerX * POSE_FIXTURE_SCALE + (POSE_FIXTURE_SCALE - 1);
  const scaledCenterY = centerY * POSE_FIXTURE_SCALE + (POSE_FIXTURE_SCALE - 1);
  const scaledRadius = radius * POSE_FIXTURE_SCALE;
  for (let y = 0; y < GENERATED_PLATFORMER_POSE_HEIGHT; y++) {
    for (let x = 0; x < GENERATED_PLATFORMER_POSE_WIDTH; x++) {
      if ((x - scaledCenterX) ** 2 + (y - scaledCenterY) ** 2 > scaledRadius ** 2) continue;
      const offset = (y * GENERATED_PLATFORMER_POSE_WIDTH + x) * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = 255;
    }
  }
}

function paintSegment(
  raw: Buffer,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  radius: number,
  color: readonly [number, number, number],
): void {
  const scaledX1 = x1 * POSE_FIXTURE_SCALE + (POSE_FIXTURE_SCALE - 1);
  const scaledY1 = y1 * POSE_FIXTURE_SCALE + (POSE_FIXTURE_SCALE - 1);
  const scaledX2 = x2 * POSE_FIXTURE_SCALE + (POSE_FIXTURE_SCALE - 1);
  const scaledY2 = y2 * POSE_FIXTURE_SCALE + (POSE_FIXTURE_SCALE - 1);
  const scaledRadius = radius * POSE_FIXTURE_SCALE;
  const dx = scaledX2 - scaledX1;
  const dy = scaledY2 - scaledY1;
  const lengthSquared = dx * dx + dy * dy;
  for (let y = 0; y < GENERATED_PLATFORMER_POSE_HEIGHT; y++) {
    for (let x = 0; x < GENERATED_PLATFORMER_POSE_WIDTH; x++) {
      const t = Math.max(
        0,
        Math.min(1, ((x - scaledX1) * dx + (y - scaledY1) * dy) / lengthSquared),
      );
      const nearestX = scaledX1 + t * dx;
      const nearestY = scaledY1 + t * dy;
      if ((x - nearestX) ** 2 + (y - nearestY) ** 2 > scaledRadius ** 2) continue;
      const offset = (y * GENERATED_PLATFORMER_POSE_WIDTH + x) * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = 255;
    }
  }
}

async function syntheticRunPose(
  stride: 'left-forward' | 'right-forward',
  upperBody: 'stable' | 'raised-with-prop' = 'stable',
): Promise<Buffer> {
  const raw = Buffer.alloc(GENERATED_PLATFORMER_POSE_WIDTH * GENERATED_PLATFORMER_POSE_HEIGHT * 4);
  const skin = [212, 142, 104] as const;
  const costume = [28, 38, 82] as const;
  paintCircle(raw, 28, 9, 5, skin);
  paintSegment(raw, 28, 15, 28, 35, 6, costume);
  paintSegment(raw, 23, 19, 15, 29, 3, skin);
  if (upperBody === 'raised-with-prop') {
    paintSegment(raw, 33, 19, 44, 8, 3, skin);
    for (let y = 7 * POSE_FIXTURE_SCALE; y <= 17 * POSE_FIXTURE_SCALE; y++) {
      for (let x = 44 * POSE_FIXTURE_SCALE; x <= 50 * POSE_FIXTURE_SCALE; x++) {
        const offset = (y * GENERATED_PLATFORMER_POSE_WIDTH + x) * 4;
        raw[offset] = 242;
        raw[offset + 1] = 188;
        raw[offset + 2] = 28;
        raw[offset + 3] = 255;
      }
    }
  } else {
    paintSegment(raw, 33, 19, 42, 27, 3, skin);
  }
  if (stride === 'left-forward') {
    paintSegment(raw, 25, 34, 13, 60, 3, costume);
    paintSegment(raw, 31, 34, 43, 56, 3, costume);
  } else {
    paintSegment(raw, 25, 34, 18, 45, 3, costume);
    paintSegment(raw, 18, 45, 10, 59, 3, costume);
    paintSegment(raw, 31, 34, 49, 60, 3, costume);
  }
  return sharp(raw, {
    raw: {
      width: GENERATED_PLATFORMER_POSE_WIDTH,
      height: GENERATED_PLATFORMER_POSE_HEIGHT,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

describe('generated platformer player prompts', () => {
  it('defines the complete five-frame runtime contract', () => {
    expect(GENERATED_PLATFORMER_POSES).toEqual(['idle', 'sideIdle', 'walk1', 'walk2', 'jump']);
  });

  it('requests identity-safe native 112x128 art with controlled orientation', () => {
    const idle = buildPlatformerPosePrompt('idle', {
      heroConcept: 'a lighthouse keeper in a navy coat',
      colors: 'navy, amber, cream',
    });
    expect(idle).toContain('exact person or character in the attached reference image');
    expect(idle).toContain('Never invent glasses');
    expect(idle).toContain('identity from the neck up');
    expect(idle).toContain('The canonical costume contract below is wardrobe truth');
    expect(idle).toContain('FRONT-FACING idle pose');
    expect(idle).toContain('native 112x128 high-density player sprite canvas');
    expect(idle).toContain('flat solid #00ff00');
    expect(idle).toContain('NOT a sprite sheet');
    expect(idle).toContain('Canonical game-world costume contract');
    expect(idle).toContain('garments, footwear, colors');
    expect(idle).toContain('both hands must remain empty');
    expect(buildPlatformerPosePrompt('walk1')).toContain('left foot reaching forward');
    expect(buildPlatformerPosePrompt('walk2')).toContain('right foot reaching forward');
    expect(buildPlatformerPosePrompt('sideIdle')).toContain('strict RIGHT-facing side profile');
    expect(buildPlatformerPosePrompt('jump')).toContain('airborne platforming pose facing RIGHT');

    const correction = buildPlatformerRunCorrectionPrompt();
    expect(correction).toContain('establishes identity and costume ONLY, not pose');
    expect(correction).toContain('Do not reuse the reference leg positions');
    expect(correction).toContain('Remove and do not add any lantern');
  });
});

describe('generated platformer player preprocessing', () => {
  it('keys and normalizes a mock Muse result to an indexed 112x128 PNG', async () => {
    const source = await mockGeneratedImage(buildPlatformerPosePrompt('jump'));
    const result = await processGeneratedPlatformerPose(source);

    await expect(sharp(result.png).metadata()).resolves.toMatchObject({
      format: 'png',
      width: GENERATED_PLATFORMER_POSE_WIDTH,
      height: GENERATED_PLATFORMER_POSE_HEIGHT,
      isPalette: true,
    });
    expect(result.metrics.greenFraction).toBeGreaterThan(0.5);
    expect(result.metrics.outputBounds.height).toBeGreaterThan(100);
    expect(result.metrics.outputBounds.top + result.metrics.outputBounds.height).toBe(
      GENERATED_PLATFORMER_POSE_HEIGHT,
    );

    const bottomRow = await sharp(result.png)
      .extract({
        left: 0,
        top: GENERATED_PLATFORMER_POSE_HEIGHT - 1,
        width: GENERATED_PLATFORMER_POSE_WIDTH,
        height: 1,
      })
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect(Array.from(bottomRow).some((channel, index) => index % 4 === 3 && channel > 0)).toBe(
      true,
    );
  });

  it('removes background-connected pure-green spill from the silhouette edge', async () => {
    const width = 96;
    const height = 96;
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const subject = x >= 30 && x < 66 && y >= 8 && y < 90;
        const spill = (x === 29 || x === 66) && y >= 8 && y < 90;
        const color = subject ? [196, 106, 72] : spill ? [2, 104, 1] : [0, 255, 0];
        raw[offset] = color[0]!;
        raw[offset + 1] = color[1]!;
        raw[offset + 2] = color[2]!;
        raw[offset + 3] = 255;
      }
    }
    const source = await sharp(raw, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    const result = await processGeneratedPlatformerPose(source);
    const decoded = await sharp(result.png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let pixel = 0; pixel < decoded.info.width * decoded.info.height; pixel++) {
      const offset = pixel * 4;
      if (decoded.data[offset + 3]! <= 8) continue;
      const r = decoded.data[offset]!;
      const g = decoded.data[offset + 1]!;
      const b = decoded.data[offset + 2]!;
      expect(g >= 72 && r <= g * 0.25 && b <= g * 0.25).toBe(false);
    }
  });

  it('removes small dark-green remnants at final sprite resolution', async () => {
    const width = 64;
    const height = 64;
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const subject = x >= 20 && x < 44 && y >= 3;
        const remnant = x === 19 && y >= 35 && y < 41;
        const color = subject ? [42, 48, 86] : remnant ? [41, 103, 15] : [0, 255, 0];
        raw[offset] = color[0]!;
        raw[offset + 1] = color[1]!;
        raw[offset + 2] = color[2]!;
        raw[offset + 3] = 255;
      }
    }
    const source = await sharp(raw, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    const result = await processGeneratedPlatformerPose(source);
    const decoded = await sharp(result.png).ensureAlpha().raw().toBuffer();
    for (
      let pixel = 0;
      pixel < GENERATED_PLATFORMER_POSE_WIDTH * GENERATED_PLATFORMER_POSE_HEIGHT;
      pixel++
    ) {
      const offset = pixel * 4;
      if (decoded[offset + 3]! <= 8) continue;
      const r = decoded[offset]!;
      const g = decoded[offset + 1]!;
      const b = decoded[offset + 2]!;
      expect(g >= 56 && r <= g * 0.45 && b <= g * 0.4).toBe(false);
    }
  });

  it('preserves a substantial dark-green character feature', async () => {
    const width = 64;
    const height = 64;
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const subject = x >= 20 && x < 44 && y >= 3;
        const greenGarment = subject && y >= 20 && y < 42;
        const color = greenGarment ? [38, 112, 40] : subject ? [42, 48, 86] : [0, 255, 0];
        raw[offset] = color[0]!;
        raw[offset + 1] = color[1]!;
        raw[offset + 2] = color[2]!;
        raw[offset + 3] = 255;
      }
    }
    const source = await sharp(raw, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    const result = await processGeneratedPlatformerPose(source);
    const decoded = await sharp(result.png).ensureAlpha().raw().toBuffer();
    let greenPixels = 0;
    for (
      let pixel = 0;
      pixel < GENERATED_PLATFORMER_POSE_WIDTH * GENERATED_PLATFORMER_POSE_HEIGHT;
      pixel++
    ) {
      const offset = pixel * 4;
      if (
        decoded[offset + 3]! > 8 &&
        decoded[offset + 1]! > decoded[offset]! * 1.5 &&
        decoded[offset + 1]! > decoded[offset + 2]! * 1.5
      ) {
        greenPixels++;
      }
    }
    expect(greenPixels).toBeGreaterThan(100);
  });

  it('recovers only a symmetric inset green-screen panel before normalization', async () => {
    const width = 100;
    const height = 100;
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const subject = x >= 41 && x < 59 && y >= 5 && y < 96;
        const greenPanel = x >= 20 && x < 80;
        const color = subject ? [42, 48, 86] : greenPanel ? [0, 255, 0] : [245, 245, 245];
        raw[offset] = color[0]!;
        raw[offset + 1] = color[1]!;
        raw[offset + 2] = color[2]!;
        raw[offset + 3] = 255;
      }
    }
    const source = await sharp(raw, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();

    await expect(processGeneratedPlatformerPose(source)).rejects.toMatchObject({
      code: 'multiple-subjects',
    });
    const recovery = await recoverGeneratedPlatformerGreenPanel(source);
    expect(recovery).toMatchObject({
      recovered: true,
      crop: { left: 20, top: 0, width: 60, height: 100 },
    });
    await expect(processGeneratedPlatformerPose(recovery.image)).resolves.toMatchObject({
      metrics: { sourceWidth: 60, sourceHeight: 100 },
    });

    const asymmetric = await sharp(source)
      .extract({ left: 10, top: 0, width: 90, height })
      .png()
      .toBuffer();
    await expect(recoverGeneratedPlatformerGreenPanel(asymmetric)).resolves.toMatchObject({
      recovered: false,
    });
  });

  it('widens the canvas for a broad stride without stretching its proportions', async () => {
    const width = 512;
    const height = 512;
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const subject = x >= 71 && x < 441 && y >= 56 && y < 456;
        raw[offset] = subject ? 38 : 0;
        raw[offset + 1] = subject ? 44 : 255;
        raw[offset + 2] = subject ? 91 : 0;
        raw[offset + 3] = 255;
      }
    }
    const source = await sharp(raw, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    const result = await processGeneratedPlatformerPose(source);

    expect(result.metrics.outputBounds).toMatchObject({ height: 112, top: 16 });
    expect(result.metrics.outputBounds.width / result.metrics.outputBounds.height).toBeCloseTo(
      370 / 400,
      2,
    );
    await expect(sharp(result.png).metadata()).resolves.toMatchObject({
      width: 160,
      height: GENERATED_PLATFORMER_POSE_HEIGHT,
    });
  });

  it('preserves round and wide silhouettes and pads the base set without resizing pixels', async () => {
    const makeShape = async (aspect: number) => {
      const raw = Buffer.alloc(512 * 512 * 4);
      for (let y = 0; y < 512; y++)
        for (let x = 0; x < 512; x++) {
          const inside = ((x - 256) / (100 * aspect)) ** 2 + ((y - 256) / 100) ** 2 < 1;
          const i = (y * 512 + x) * 4;
          raw[i] = inside ? 130 : 0;
          raw[i + 1] = inside ? 50 : 255;
          raw[i + 2] = inside ? 80 : 0;
          raw[i + 3] = 255;
        }
      return sharp(raw, { raw: { width: 512, height: 512, channels: 4 } })
        .png()
        .toBuffer();
    };
    const round = await processGeneratedPlatformerPose(await makeShape(1));
    const broad = await processGeneratedPlatformerPose(await makeShape(1.8));
    expect(round.metrics.outputBounds.width).toBe(112);
    expect(broad.metrics.outputBounds.width / broad.metrics.outputBounds.height).toBeCloseTo(
      1.8,
      1,
    );
    expect(await sharp(round.png).metadata()).toMatchObject({ width: 160, height: 128 });
    expect(await sharp(broad.png).metadata()).toMatchObject({ width: 224, height: 128 });
    const aligned = await alignGeneratedPlatformerPoseCanvases({
      idle: round.png,
      sideIdle: round.png,
      walk1: broad.png,
      walk2: broad.png,
      jump: round.png,
    });
    await expect(
      validateGeneratedPlatformerPoseSet(aligned, { strictMotion: false }),
    ).resolves.toBeUndefined();
    const original = await sharp(round.png).ensureAlpha().raw().toBuffer();
    const padded = await sharp(aligned.idle)
      .extract({ left: 32, top: 0, width: 160, height: 128 })
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect(padded).toEqual(original);
    const review = await platformerReviewSprite(round.png, 224, 256);
    const sameReview = await platformerReviewSprite(aligned.idle, 224, 256);
    expect(await sharp(review).metadata()).toMatchObject({ width: 224, height: 256 });
    // Compare visible pixels; PNG palette encoding may change RGB under zero alpha.
    const reviewPixels = await sharp(review).flatten({ background: '#101020' }).raw().toBuffer();
    const alignedReviewPixels = await sharp(sameReview)
      .flatten({ background: '#101020' })
      .raw()
      .toBuffer();
    expect(reviewPixels.equals(alignedReviewPixels)).toBe(true);
    await expect(processGeneratedPlatformerPose(await makeShape(2.2))).rejects.toMatchObject({
      code: 'inconsistent-scale',
    });
  });

  it('validates one shared canvas, scale, and opposing lower-body stride', async () => {
    const walk1 = await syntheticRunPose('left-forward');
    const walk2 = await syntheticRunPose('right-forward');
    const metrics = await measureGeneratedPlatformerRunPair(walk1, walk2);
    expect(metrics.lowerBody.iou).toBeLessThan(0.72);
    expect(metrics.lowerBody.changeFraction).toBeGreaterThan(
      metrics.upperBody.changeFraction * 0.7,
    );
    await expect(validateGeneratedPlatformerRunPair(walk1, walk2)).resolves.toEqual(metrics);
    await expect(
      validateGeneratedPlatformerPoseSet({
        idle: walk1,
        sideIdle: walk1,
        walk1,
        walk2,
        jump: walk2,
      }),
    ).resolves.toBeUndefined();

    const wrongWidth = await sharp(walk2)
      .extract({
        left: 0,
        top: 0,
        width: GENERATED_PLATFORMER_POSE_WIDTH - 8,
        height: GENERATED_PLATFORMER_POSE_HEIGHT,
      })
      .png()
      .toBuffer();
    await expect(
      validateGeneratedPlatformerPoseSet({
        idle: walk1,
        sideIdle: walk1,
        walk1,
        walk2: wrongWidth,
        jump: walk2,
      }),
    ).rejects.toMatchObject({ code: 'inconsistent-scale' });
  });

  it('rejects the observed arm-and-prop change when the legs keep the same stride', async () => {
    const walk1 = await syntheticRunPose('left-forward');
    const armOnly = await syntheticRunPose('left-forward', 'raised-with-prop');
    const metrics = await measureGeneratedPlatformerRunPair(walk1, armOnly);

    expect(metrics.lowerBody.iou).toBeGreaterThan(0.72);
    expect(metrics.lowerBody.changeFraction).toBeLessThan(metrics.upperBody.changeFraction * 0.7);
    await expect(validateGeneratedPlatformerRunPair(walk1, armOnly)).rejects.toMatchObject({
      code: 'insufficient-pose-change',
    });
    await expect(
      validateGeneratedPlatformerPoseSet(
        {
          idle: walk1,
          sideIdle: walk1,
          walk1,
          walk2: armOnly,
          jump: walk1,
        },
        { strictMotion: false },
      ),
    ).resolves.toBeUndefined();
  });

  it('keeps a deterministic 1024px edit reference for the remaining poses', async () => {
    const source = await mockGeneratedImage(buildPlatformerPosePrompt('idle'));
    const first = await prepareGeneratedPlatformerReference(source);
    const second = await prepareGeneratedPlatformerReference(source);
    expect(first.equals(second)).toBe(true);
    await expect(sharp(first).metadata()).resolves.toMatchObject({
      format: 'png',
      width: 1024,
      height: 1024,
    });
  });
});
