import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  PLATFORMER_BACKDROP_HEIGHT,
  PLATFORMER_BACKDROP_WIDTH,
  buildPlatformerBackdropPrompt,
  normalizePlatformerBackdrop,
} from '../src/assets/platformer-backdrop';

describe('generated platformer backdrops', () => {
  it('asks for an environment-only panoramic plate with a readable gameplay band', () => {
    const prompt = buildPlatformerBackdropPrompt({
      gameTitle: 'Clockwork Hollow',
      tagline: 'Wind the sleeping city',
      role: 'level2',
      sceneName: 'The Copper Canopy',
      sceneBeat: 'Climb through a forest of mechanical trees.',
      backdrop: 'factory',
      colors: '#10131f, #b66f2f, #f0c35a',
    });

    expect(prompt).toContain('The Copper Canopy');
    expect(prompt).toContain('mechanical trees');
    expect(prompt).toContain('extra-wide panoramic');
    expect(prompt).toContain('lower third simpler, darker, and lower contrast');
    expect(prompt).toContain('No player hero');
    expect(prompt).toContain('opaque scenery');
  });

  it('does not leak the boss identity or story description into the final arena prompt', () => {
    const prompt = buildPlatformerBackdropPrompt({
      gameTitle: 'Starbound Salvage',
      tagline: 'Hop the shattered orbitals and reignite the star core.',
      role: 'boss',
      sceneName: 'Star Maw — final arena',
      sceneBeat: 'The Star Maw blooms open, a station heart turned hungry sun.',
      backdrop: 'space station',
      colors: '#120d2f, #ff704d, #57e6c2',
    });

    expect(prompt).not.toContain('Star Maw');
    expect(prompt).not.toContain('hungry sun');
    expect(prompt).not.toContain('boss arena');
    expect(prompt).toContain('completely empty environment');
    expect(prompt).toContain('Never copy, repeat, enlarge');
    expect(prompt).toContain('no giant figure, eye, face');
    expect(prompt).toContain('Do not depict or visually reference the opponent');
  });

  it('normalizes a landscape result into the fixed extra-wide runtime plate', async () => {
    const input = await sharp({
      create: { width: 1200, height: 700, channels: 4, background: '#4c6f91' },
    })
      .png()
      .toBuffer();

    const result = await normalizePlatformerBackdrop(input);
    const metadata = await sharp(result).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(PLATFORMER_BACKDROP_WIDTH);
    expect(metadata.height).toBe(PLATFORMER_BACKDROP_HEIGHT);
    expect(metadata.hasAlpha).toBe(false);
  });

  it('rejects portrait and square outputs before publishing them', async () => {
    const input = await sharp({
      create: { width: 600, height: 700, channels: 3, background: '#4c6f91' },
    })
      .png()
      .toBuffer();

    await expect(normalizePlatformerBackdrop(input)).rejects.toThrow(/not landscape/);
  });
});
