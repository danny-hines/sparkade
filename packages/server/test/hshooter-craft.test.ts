import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  HSHOOTER_CRAFT_REFERENCE_SIZE,
  HSHOOTER_CRAFT_SIZE,
  buildHShooterCraftPrompt,
  buildHShooterIdentityReference,
  processGeneratedHShooterCraft,
  processGeneratedHShooterCraftReference,
} from '../src/assets/hshooter-craft';

async function greenScreenSubject(width: number, height: number): Promise<Buffer> {
  const subject = await sharp({
    create: { width, height, channels: 4, background: '#4356a8' },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: 256, height: 256, channels: 4, background: '#00ff00' },
  })
    .composite([{ input: subject, left: Math.round((256 - width) / 2), top: 128 - height / 2 }])
    .png()
    .toBuffer();
}

describe('H-scroll player craft generation', () => {
  it('authors a right-facing vehicle identity without accepting player likeness', () => {
    const concept =
      'The Starling, a low cobalt trench skiff with swept brass fins and twin amber drives';
    const prompt = buildHShooterCraftPrompt({
      gameTitle: 'Trenchlight Exodus',
      tagline: 'Race the last safe current',
      visualConcept: concept,
      colors: '#101522, #324a86, #f2aa3b',
    });

    expect(prompt).toContain(concept);
    expect(prompt).toContain('nose pointing toward the RIGHT');
    expect(prompt).toContain('independent from the human pilot');
    expect(prompt).toContain('No person, pilot, rider, passenger, face, head');
    expect(prompt).toContain('#00ff00');
  });

  it('keys and normalizes a broad craft while rejecting portrait-like silhouettes', async () => {
    const source = await greenScreenSubject(184, 72);
    const processed = await processGeneratedHShooterCraft(source);
    expect(await sharp(processed.png).metadata()).toMatchObject({
      format: 'png',
      width: HSHOOTER_CRAFT_SIZE.width,
      height: HSHOOTER_CRAFT_SIZE.height,
    });
    expect(processed.metrics.outputBounds.width).toBeGreaterThan(
      processed.metrics.outputBounds.height,
    );
    expect(
      await sharp(await processGeneratedHShooterCraftReference(source)).metadata(),
    ).toMatchObject({
      format: 'png',
      width: HSHOOTER_CRAFT_REFERENCE_SIZE.width,
      height: HSHOOTER_CRAFT_REFERENCE_SIZE.height,
    });

    await expect(processGeneratedHShooterCraft(await greenScreenSubject(52, 172))).rejects.toThrow(
      /broad side-view silhouette/,
    );
  });

  it('packs key art with the presentation-scale craft instead of the runtime sprite', async () => {
    const primary = await sharp({
      create: { width: 480, height: 270, channels: 4, background: '#203050' },
    })
      .png()
      .toBuffer();
    const craft = await processGeneratedHShooterCraftReference(await greenScreenSubject(184, 72));
    const board = await buildHShooterIdentityReference(primary, craft);

    expect(await sharp(board).metadata()).toMatchObject({
      format: 'png',
      width: 1024,
      height: 1024,
    });
  });
});
