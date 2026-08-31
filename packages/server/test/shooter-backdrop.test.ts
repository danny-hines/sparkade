import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  SHOOTER_BACKDROP_HEIGHT,
  SHOOTER_BACKDROP_WIDTH,
  buildShooterBackdropPrompt,
  normalizeShooterBackdrop,
} from '../src/assets/shooter-backdrop';

describe('generated vertical-shooter backdrops', () => {
  it('requests a terrain-free portrait flyover with full-field readability', () => {
    const prompt = buildShooterBackdropPrompt({
      gameTitle: 'Cloudgarden Lance',
      tagline: 'Carry spring through the iron storm',
      role: 'level2',
      sceneName: 'The Violet Canopy',
      sceneBeat: 'Race above flooded glasshouses under thunderclouds.',
      backdrop: 'metropolis',
      colors: '#101522, #324a86, #f2aa3b',
    });
    expect(prompt).toContain('tall portrait BACKGROUND FLYOVER PLATE');
    expect(prompt).toContain('strict TOP-DOWN');
    expect(prompt).toContain('READABILITY IS MANDATORY ACROSS THE FULL WIDTH');
    expect(prompt).toContain('No near-camera wall, corridor');
    expect(prompt).toContain('No player, pilot, person');
  });

  it('normalizes portrait art and rejects square outputs', async () => {
    const portrait = await sharp({
      create: { width: 700, height: 1200, channels: 4, background: '#334466' },
    })
      .png()
      .toBuffer();
    await expect(sharp(await normalizeShooterBackdrop(portrait)).metadata()).resolves.toMatchObject(
      {
        format: 'png',
        width: SHOOTER_BACKDROP_WIDTH,
        height: SHOOTER_BACKDROP_HEIGHT,
        hasAlpha: false,
      },
    );
    const square = await sharp({
      create: { width: 700, height: 700, channels: 3, background: '#334466' },
    })
      .png()
      .toBuffer();
    await expect(normalizeShooterBackdrop(square)).rejects.toThrow(/not portrait/);
  });
});
