import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  SHOOTER_CRAFT_REFERENCE_SIZE,
  SHOOTER_CRAFT_SIZE,
  buildShooterCraftPrompt,
  processGeneratedShooterCraft,
  processGeneratedShooterCraftReference,
} from '../src/assets/shooter-craft';

async function greenScreenSubject(width: number, height: number): Promise<Buffer> {
  const subject = await sharp({
    create: { width, height, channels: 4, background: '#4356a8' },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: 256, height: 256, channels: 4, background: '#00ff00' },
  })
    .composite([{ input: subject, left: 128 - width / 2, top: 128 - height / 2 }])
    .png()
    .toBuffer();
}

describe('vertical-shooter player craft generation', () => {
  it('authors a top-facing vehicle identity separate from player likeness', () => {
    const prompt = buildShooterCraftPrompt({
      gameTitle: 'Petal Squadron',
      tagline: 'Bloom against the storm',
      visualConcept: 'A narrow orchid interceptor with gold wing tips',
      colors: '#101522, #744aa8, #f2aa3b',
      candidateId: 'B',
    });
    expect(prompt).toContain('Candidate B');
    expect(prompt).toContain('nose pointing toward the TOP');
    expect(prompt).toContain('independent from the human pilot');
    expect(prompt).toContain('#00ff00');
  });

  it('normalizes a tall craft and rejects a horizontal silhouette', async () => {
    const source = await greenScreenSubject(72, 184);
    const processed = await processGeneratedShooterCraft(source);
    expect(await sharp(processed.png).metadata()).toMatchObject({
      width: SHOOTER_CRAFT_SIZE.width,
      height: SHOOTER_CRAFT_SIZE.height,
    });
    expect(await sharp(await processGeneratedShooterCraftReference(source)).metadata()).toMatchObject(
      {
        width: SHOOTER_CRAFT_REFERENCE_SIZE.width,
        height: SHOOTER_CRAFT_REFERENCE_SIZE.height,
      },
    );
    await expect(processGeneratedShooterCraft(await greenScreenSubject(184, 72))).rejects.toThrow(
      /tall top-down silhouette/,
    );
  });
});
