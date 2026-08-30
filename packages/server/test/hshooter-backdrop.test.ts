import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  HSHOOTER_BACKDROP_HEIGHT,
  HSHOOTER_BACKDROP_WIDTH,
  buildHShooterBackdropPrompt,
  normalizeHShooterBackdrop,
} from '../src/assets/hshooter-backdrop';

describe('generated H-scroll backdrops', () => {
  it('keeps the full flight corridor subdued and excludes subject-like details', () => {
    const prompt = buildHShooterBackdropPrompt({
      gameTitle: 'Trenchlight Exodus',
      tagline: 'Race the last safe current',
      role: 'level2',
      sceneName: 'The Violet Narrows',
      sceneBeat: 'Thread a bioluminescent abyss beneath the drowned observatory.',
      backdrop: 'alien trench',
      colors: '#101522, #324a86, #f2aa3b',
    });

    expect(prompt).toContain('continuously auto-scrolling horizontal shooter');
    expect(prompt).toContain('Violet Narrows');
    expect(prompt).toContain('central 80 percent of the full image height');
    expect(prompt).toContain('Avoid bright pinpoints');
    expect(prompt).toContain('No player, pilot, person');
    expect(prompt).toContain('opaque scenery');
  });

  it('does not leak either combatant into the boss-arena prompt', () => {
    const prompt = buildHShooterBackdropPrompt({
      gameTitle: 'Trenchlight Exodus',
      tagline: 'Race the last safe current',
      role: 'boss',
      sceneName: 'The Devourer Throne',
      sceneBeat: 'The Crown Leviathan opens its burning eye.',
      backdrop: 'alien trench',
      colors: '#101522, #324a86, #f2aa3b',
    });

    expect(prompt).not.toContain('Devourer Throne');
    expect(prompt).not.toContain('Crown Leviathan');
    expect(prompt).not.toContain('burning eye');
    expect(prompt).toContain('Do not depict or visually reference the boss or player craft');
    expect(prompt).toContain('No central subject or character-shaped landmark');
  });

  it('normalizes a landscape into the fixed panoramic runtime plate', async () => {
    const input = await sharp({
      create: { width: 1200, height: 700, channels: 4, background: '#334466' },
    })
      .png()
      .toBuffer();

    const result = await normalizeHShooterBackdrop(input);
    expect(await sharp(result).metadata()).toMatchObject({
      format: 'png',
      width: HSHOOTER_BACKDROP_WIDTH,
      height: HSHOOTER_BACKDROP_HEIGHT,
      hasAlpha: false,
    });
  });

  it('rejects portrait and square outputs before publication', async () => {
    const input = await sharp({
      create: { width: 600, height: 700, channels: 3, background: '#334466' },
    })
      .png()
      .toBuffer();

    await expect(normalizeHShooterBackdrop(input)).rejects.toThrow(/not landscape/);
  });
});
