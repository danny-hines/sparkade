import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  ADVENTURE_ROOM_PLATE_ATLAS_HEIGHT,
  ADVENTURE_ROOM_PLATE_ATLAS_WIDTH,
  ADVENTURE_ROOM_PLATE_HEIGHT,
  ADVENTURE_ROOM_PLATE_WIDTH,
  buildAdventureRoomPlatePrompt,
  normalizeAdventureRoomPlates,
} from '../src/assets/adventure-room-plates';

describe('generated Adventure room plates', () => {
  it('asks for four quiet, environment-only top-down surfaces without gameplay geometry', () => {
    const prompt = buildAdventureRoomPlatePrompt({
      gameTitle: 'The Drowned Observatory',
      tagline: 'Relight the stars beneath the tide',
      backdrop: 'submerged stone observatory',
      colors: '#081b22, #2c6f70, #efc55a',
    });

    expect(prompt).toContain('2-by-2 ROOM-SURFACE ATLAS');
    expect(prompt).toContain('Top-left is ENTRANCE');
    expect(prompt).toContain('bottom-right is FINALE');
    expect(prompt).toContain('not a repeated tile texture');
    expect(prompt).toContain('32-by-16-cell gameplay room');
    expect(prompt).toContain('substantially calmer and less contrasty than the key art');
    expect(prompt).toContain('Roughly 65–75 percent of every panel');
    expect(prompt).toContain('Reserve the darkest outlines, brightest lights');
    expect(prompt).toContain('MATERIAL-RICHNESS CONTRACT');
    expect(prompt).toContain('three to five broad, overlapping, low-contrast tonal fields');
    expect(prompt).toContain('small CONNECTED irregular runs and clusters');
    expect(prompt).toContain('Never use uniformly scattered square flecks');
    expect(prompt).toContain('random block noise');
    expect(prompt).toContain('Use no freestanding environmental accents');
    expect(prompt).toContain('Avoid any mark or cluster at player, enemy, pickup');
    expect(prompt).toContain('branching crack networks');
    expect(prompt).toContain('no individual background shape should attract attention');
    expect(prompt).toContain('modern high-density pixel-art-inspired game art');
    expect(prompt).toContain('clear retro character');
    expect(prompt).toContain('richer and denser than an authentic SNES-era background');
    expect(prompt).toContain('Fine one-to-three-output-pixel marks');
    expect(prompt).toContain('no macro-pixels');
    expect(prompt).toContain('Absolutely no photorealism');
    expect(prompt).toContain('the entire panel is a subordinate gameplay underlay');
    expect(prompt).toContain('no walls');
    expect(prompt).toContain('straight-down orthographic');
    expect(prompt).not.toContain('Polished high-density 16-bit SNES-era pixel art');
    expect(prompt).not.toContain('broad low-frequency shapes');
    expect(prompt).not.toContain('rich fine-grained surface variation');
    expect(prompt).not.toContain('layered micro-detail');
    expect(prompt).not.toContain('Relight the stars beneath the tide. —');
  });

  it('normalizes a wide result into four exact display-density runtime panels', async () => {
    const input = await sharp({
      create: { width: 1600, height: 900, channels: 4, background: '#2c6f70' },
    })
      .png()
      .toBuffer();

    const result = await normalizeAdventureRoomPlates(input);
    const metadata = await sharp(result).metadata();
    expect(metadata).toMatchObject({
      format: 'png',
      width: ADVENTURE_ROOM_PLATE_ATLAS_WIDTH,
      height: ADVENTURE_ROOM_PLATE_ATLAS_HEIGHT,
      hasAlpha: false,
    });
    expect(metadata.width! / 2).toBe(ADVENTURE_ROOM_PLATE_WIDTH);
    expect(metadata.height! / 2).toBe(ADVENTURE_ROOM_PLATE_HEIGHT);
    expect(ADVENTURE_ROOM_PLATE_WIDTH).toBe(1024);
    expect(ADVENTURE_ROOM_PLATE_HEIGHT).toBe(512);
    expect(metadata.isPalette).toBe(false);
  });

  it('rejects portrait and square outputs before publishing them', async () => {
    const input = await sharp({
      create: { width: 700, height: 700, channels: 3, background: '#2c6f70' },
    })
      .png()
      .toBuffer();

    await expect(normalizeAdventureRoomPlates(input)).rejects.toThrow(/not landscape/);
  });
});
