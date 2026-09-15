import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  buildRacingLocomotionPrompt,
  composeRacingLocomotion,
  processRacingLocomotion,
  generateReviewedRacingLocomotion,
  RacingLocomotionImageError,
  buildRacingLocomotionReference,
} from '../src/assets/racing-locomotion';
import { mockRacingCraftStripSource, mockRacingLocomotionSource } from '../src/assets/racing-mock';
import { processGeneratedRacingCraftStrip } from '../src/assets/racing-craft';
import { BICYCLE_TRAVERSAL } from '@sparkade/shared';
describe('generated motion atlas', () => {
  it('preserves the approved identity row and adds six real frames', async () => {
    const base = (await processGeneratedRacingCraftStrip(await mockRacingCraftStripSource())).png;
    const frames = await processRacingLocomotion(await mockRacingLocomotionSource());
    const atlas = await composeRacingLocomotion(base, frames);
    expect(await sharp(atlas).metadata()).toMatchObject({
      width: 192,
      height: 192,
      hasAlpha: true,
    });
    const row = await sharp(atlas)
      .extract({ left: 0, top: 0, width: 192, height: 64 })
      .raw()
      .toBuffer();
    expect(row.equals(await sharp(base).raw().toBuffer())).toBe(true);
    await expect(composeRacingLocomotion(base, frames.slice(1))).rejects.toThrow('six');
  });
  it('fails on empty or invalid grids rather than replacing missing animation', async () => {
    await expect(processRacingLocomotion(Buffer.from('invalid'))).rejects.toThrow();
    const empty = await sharp({
      create: { width: 384, height: 256, channels: 4, background: '#00ff00' },
    })
      .png()
      .toBuffer();
    await expect(processRacingLocomotion(empty)).rejects.toThrow();
  });
  it('rejects a grid with a duplicated generated frame', async () => {
    const source = await mockRacingLocomotionSource();
    const { width, height } = await sharp(source).metadata();
    const cell = await sharp(source)
      .extract({ left: 0, top: 0, width: width! / 3, height: height! / 2 })
      .png()
      .toBuffer();
    const duplicated = await sharp(source)
      .composite([{ input: cell, left: width! / 3, top: 0 }])
      .png()
      .toBuffer();
    await expect(processRacingLocomotion(duplicated)).rejects.toThrow('six distinct');
  });
  it('is activity-label independent and requires explicit motion', () => {
    const t = { ...BICYCLE_TRAVERSAL, motion: 'pedal' as const };
    expect(buildRacingLocomotionPrompt(t, 'c', 'a')).toBe(
      buildRacingLocomotionPrompt({ ...t, label: 'Invented' }, 'c', 'a'),
    );
    expect(buildRacingLocomotionPrompt(t, 'c', 'a')).toContain('SIX temporal frames');
    expect(() => buildRacingLocomotionPrompt(BICYCLE_TRAVERSAL, 'c', 'a')).toThrow();
  });

  it('corrects a malformed sheet once and reviews all repaired frames', async () => {
    const base = (await processGeneratedRacingCraftStrip(await mockRacingCraftStripSource())).png;
    const generate = vi.fn().mockResolvedValueOnce(Buffer.from('invalid')).mockResolvedValueOnce(await mockRacingLocomotionSource());
    const review = vi.fn().mockResolvedValue({ accepted: true });
    const atlas = await generateReviewedRacingLocomotion({ base, prompt: 'Original motion contract', motion: 'pedal', generate, review });
    expect(await sharp(atlas).metadata()).toMatchObject({ width: 192, height: 192 });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]![0]).toContain('Original motion contract');
    expect(generate.mock.calls[1]![0]).toContain('never splay legs or kick feet sideways');
    expect(generate.mock.calls[1]![0]).toContain('ONLY pixel technique and palette');
    expect(generate.mock.calls[1]![1]).toBe(true);
    expect(review).toHaveBeenCalledTimes(1);
  });

  it('fails closed after two malformed sheets', async () => {
    const generate = vi.fn().mockResolvedValue(Buffer.from('invalid'));
    const review = vi.fn();
    await expect(generateReviewedRacingLocomotion({ base: Buffer.alloc(0), prompt: 'contract', motion: 'pedal', generate, review })).rejects.toBeInstanceOf(RacingLocomotionImageError);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(review).not.toHaveBeenCalled();
  });

  it('propagates a provider refusal immediately without a correction', async () => {
    const refusal = new Error('provider content policy refusal');
    const generate = vi.fn().mockRejectedValue(refusal);
    await expect(generateReviewedRacingLocomotion({ base: Buffer.alloc(0), prompt: 'contract', motion: 'pedal', generate, review: vi.fn() })).rejects.toBe(refusal);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('provides an identity-and-scale scaffold that cannot masquerade as a valid cycle', async () => {
    const base = (await processGeneratedRacingCraftStrip(await mockRacingCraftStripSource())).png;
    const reference = await buildRacingLocomotionReference(base);
    expect(await sharp(reference).metadata()).toMatchObject({ width: 1536, height: 1024 });
    await expect(processRacingLocomotion(reference)).rejects.toThrow('six distinct');
  });
});
