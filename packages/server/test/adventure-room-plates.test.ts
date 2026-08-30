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
    expect(prompt).toContain('28-by-14-cell gameplay room');
    expect(prompt).toContain('rich fine-grained surface variation');
    expect(prompt).toContain('modern high-density pixel-art-inspired game art');
    expect(prompt).toContain('clear retro character');
    expect(prompt).toContain('richer and denser than an authentic SNES-era background');
    expect(prompt).toContain('one-to-three-output-pixel texture marks');
    expect(prompt).toContain('no macro-pixels');
    expect(prompt).toContain('Absolutely no photorealism');
    expect(prompt).toContain('Quiet gameplay zones must be low contrast, not empty or low detail');
    expect(prompt).toContain('no walls');
    expect(prompt).toContain('straight-down orthographic');
    expect(prompt).not.toContain('Polished high-density 16-bit SNES-era pixel art');
    expect(prompt).not.toContain('broad low-frequency shapes');
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
    expect(ADVENTURE_ROOM_PLATE_WIDTH).toBe(896);
    expect(ADVENTURE_ROOM_PLATE_HEIGHT).toBe(448);
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
