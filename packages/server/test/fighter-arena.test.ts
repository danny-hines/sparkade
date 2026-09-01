import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { FighterSpec } from '@sparkade/shared';
import {
  FIGHTER_ARENA_ATLAS_HEIGHT,
  FIGHTER_ARENA_HEIGHT,
  FIGHTER_ARENA_PROMPT_VERSION,
  FIGHTER_ARENA_WIDTH,
  buildFighterArenaPrompt,
  fighterArenaPresentationIsBaked,
  normalizeFighterArenaAtlas,
  validateFighterArenaAtlas,
} from '../src/assets/fighter-arena';

function golden(): FighterSpec {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'packages/generation/golden/golden-fighter.json'), 'utf8'),
  ) as FighterSpec;
}

describe('generated Fighter arenas', () => {
  it('marks only the server-treated arena contract as presentation-baked', () => {
    expect(fighterArenaPresentationIsBaked(FIGHTER_ARENA_PROMPT_VERSION)).toBe(true);
    expect(fighterArenaPresentationIsBaked('fighter-arena-sheet-v3')).toBe(false);
  });

  it('locks both environments to the roster art direction and reserves edge props', () => {
    const spec = golden();
    const prompt = buildFighterArenaPrompt(spec);

    expect(prompt).toContain('exactly TWO stacked landscape');
    expect(prompt).toContain(spec.artDirection.aesthetic);
    expect(prompt).toContain(spec.artDirection.proportions);
    expect(prompt).toContain(spec.levels[0]!.name);
    expect(prompt).toContain(spec.boss.name);
    expect(prompt).toContain('environmental props at the far sides');
    expect(prompt).toContain('broad unobstructed central combat zone');
    expect(prompt).toContain('PIXEL-DENSITY CONTRACT');
    expect(prompt).toContain('native 512x300 runtime background');
    expect(prompt).toContain('fighters that are 70-90 runtime pixels tall');
    expect(prompt).toContain('crisp one-pixel outlines');
    expect(prompt).toContain('never oversized 8-16px blocks');
    expect(prompt).toContain('VISUAL-HIERARCHY CONTRACT');
    expect(prompt).toContain('central 70 percent must be quieter than the edges');
    expect(prompt).toContain('no high-frequency texture');
    expect(prompt).toContain('No fighters, people, crowds');
  });

  it('segments a source sheet into exact ladder and boss runtime panels', async () => {
    const top = await sharp({
      create: { width: 1024, height: 512, channels: 3, background: '#d64a45' },
    })
      .png()
      .toBuffer();
    const bottom = await sharp({
      create: { width: 1024, height: 512, channels: 3, background: '#315aa8' },
    })
      .png()
      .toBuffer();
    const source = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: '#000000' },
    })
      .composite([
        { input: top, left: 0, top: 0 },
        { input: bottom, left: 0, top: 512 },
      ])
      .png()
      .toBuffer();

    const atlas = await normalizeFighterArenaAtlas(source);
    await expect(validateFighterArenaAtlas(atlas)).resolves.toBeUndefined();
    await expect(sharp(atlas).metadata()).resolves.toMatchObject({
      width: FIGHTER_ARENA_WIDTH,
      height: FIGHTER_ARENA_ATLAS_HEIGHT,
      format: 'png',
    });
    const topPixel = await sharp(atlas)
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer();
    const bottomPixel = await sharp(atlas)
      .extract({ left: 0, top: FIGHTER_ARENA_HEIGHT, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect([...topPixel.slice(0, 3)]).toEqual([175, 60, 56]);
    expect([...bottomPixel.slice(0, 3)]).toEqual([41, 74, 138]);
  });

  it('rejects malformed runtime dimensions', async () => {
    const malformed = await sharp({
      create: {
        width: FIGHTER_ARENA_WIDTH,
        height: FIGHTER_ARENA_HEIGHT,
        channels: 3,
        background: '#000',
      },
    })
      .png()
      .toBuffer();
    await expect(validateFighterArenaAtlas(malformed)).rejects.toThrow(
      'fighter arena atlas must be',
    );
  });
});
