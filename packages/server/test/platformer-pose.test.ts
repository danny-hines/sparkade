import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { mockGeneratedImage } from '../src/assets/game-art';
import {
  GENERATED_PLATFORMER_POSES,
  buildPlatformerPosePrompt,
  prepareGeneratedPlatformerReference,
  processGeneratedPlatformerPose,
} from '../src/assets/platformer-pose';

describe('generated platformer player prompts', () => {
  it('defines the complete four-frame runtime contract', () => {
    expect(GENERATED_PLATFORMER_POSES).toEqual(['idle', 'walk1', 'walk2', 'jump']);
  });

  it('requests identity-safe native 48x64 art with controlled orientation', () => {
    const idle = buildPlatformerPosePrompt('idle', {
      heroConcept: 'a lighthouse keeper in a navy coat',
      colors: 'navy, amber, cream',
    });
    expect(idle).toContain('exact person or character in the attached reference image');
    expect(idle).toContain('Never invent glasses');
    expect(idle).toContain('FRONT-FACING idle pose');
    expect(idle).toContain('native 48x64 player sprite');
    expect(idle).toContain('flat solid #00ff00');
    expect(idle).toContain('NOT a sprite sheet');
    expect(buildPlatformerPosePrompt('walk1')).toContain('left foot forward');
    expect(buildPlatformerPosePrompt('walk2')).toContain('right foot forward');
    expect(buildPlatformerPosePrompt('jump')).toContain('airborne platforming pose facing RIGHT');
  });
});

describe('generated platformer player preprocessing', () => {
  it('keys and normalizes a mock Muse result to an indexed 48x64 PNG', async () => {
    const source = await mockGeneratedImage(buildPlatformerPosePrompt('jump'));
    const result = await processGeneratedPlatformerPose(source);

    await expect(sharp(result.png).metadata()).resolves.toMatchObject({
      format: 'png',
      width: 48,
      height: 64,
      isPalette: true,
    });
    expect(result.metrics.greenFraction).toBeGreaterThan(0.5);
    expect(result.metrics.outputBounds.height).toBeGreaterThan(50);
    expect(result.metrics.outputBounds.top + result.metrics.outputBounds.height).toBe(64);

    const bottomRow = await sharp(result.png)
      .extract({ left: 0, top: 63, width: 48, height: 1 })
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect(Array.from(bottomRow).some((channel, index) => index % 4 === 3 && channel > 0)).toBe(
      true,
    );
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
