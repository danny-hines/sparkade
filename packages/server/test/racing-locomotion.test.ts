import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  buildRacingLocomotionPrompt,
  composeRacingLocomotion,
  processRacingLocomotion,
  generateReviewedRacingLocomotion,
  RacingLocomotionImageError,
  buildRacingLocomotionReference,
  assertRacingMotionSilhouette,
  buildRacingMotionReviewBoard,
  buildRacingStrideFramePrompt,
} from '../src/assets/racing-locomotion';
import { mockRacingCraftStripSource, mockRacingLocomotionSource } from '../src/assets/racing-mock';
import { processGeneratedRacingCraftStrip } from '../src/assets/racing-craft';
import { BICYCLE_TRAVERSAL } from '@sparkade/shared';
describe('generated motion atlas', () => {
  it('uses isolated generated poses only after a rejected sheet and reviews the complete replacement', async () => {
    const base = (await processGeneratedRacingCraftStrip(await mockRacingCraftStripSource())).png;
    const source = await mockRacingLocomotionSource();
    const meta = await sharp(source).metadata();
    const width = meta.width! / 3, height = meta.height! / 2;
    const frames = await Promise.all(Array.from({ length: 6 }, (_, i) => sharp(source).extract({ left: i % 3 * width, top: Math.floor(i / 3) * height, width, height }).png().toBuffer()));
    const generate = vi.fn().mockResolvedValue(source);
    const generateFrames = vi.fn().mockResolvedValue(frames);
    const review = vi.fn().mockResolvedValueOnce({ accepted: false, reason: 'Frozen poses' }).mockResolvedValueOnce({ accepted: true });
    const atlas = await generateReviewedRacingLocomotion({ base, prompt: 'stride', motion: 'stride', generate, generateFrames, review });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generateFrames).toHaveBeenCalledExactlyOnceWith('Frozen poses');
    expect(review).toHaveBeenCalledTimes(2);
    expect(await sharp(atlas).metadata()).toMatchObject({ width: 192, height: 192 });
    const prompts = Array.from({ length: 6 }, (_, i) => buildRacingStrideFramePrompt('Pink singlet, white cap', 'Pixel art', i));
    expect(new Set(prompts).size).toBe(6);
    for (const prompt of prompts) expect(prompt).toContain('exactly ONE isolated full-body runner pose');
  });

  it('shows alpha as a checkerboard while leaving an opaque black matte visibly black', async () => {
    const atlas = await sharp({ create: { width: 192, height: 192, channels: 4, background: '#00000000' } })
      .composite([{ input: Buffer.from('<svg width="64" height="64"><rect width="64" height="64" fill="black"/></svg>'), left: 64, top: 64 }]).png().toBuffer();
    const { data, info } = await sharp(await buildRacingMotionReviewBoard(atlas)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const color = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
    expect(color(0, 0)).not.toEqual(color(32, 0));
    expect(color(300, 300)).toEqual([0, 0, 0]);
  });

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

  it('rejects an opaque matte even when the cell has transparent outer margins', async () => {
    const panel = await sharp(Buffer.from('<svg width="64" height="64"><rect x="6" y="6" width="52" height="52" fill="black"/><rect x="6" y="6" width="1" height="52" fill="#001b00"/><rect x="25" y="10" width="14" height="44" fill="#b05030"/></svg>')).png().toBuffer();
    await expect(assertRacingMotionSilhouette(panel)).rejects.toThrow('opaque rectangular background');
  });
});

it('never turns cancellation, suspension, storage, or programming errors into an optional fallback', async () => {
  const { generateOptionalRacingMotion } = await import('../src/assets/racing-locomotion');
  const { GeneratedAssetStorageError } = await import('../src/assets/manifest');
  for (const error of [new GeneratedAssetStorageError('disk full'), new TypeError('bug'), Object.assign(new Error('suspend'), {code:'suspended'}), null]) {
    const generate = vi.fn().mockRejectedValue(error);
    await expect(generateOptionalRacingMotion({base:Buffer.alloc(0),prompt:'contract',motion:'pedal',terminal:null,generate,review:vi.fn(),checkActive:()=>{},isCancelled:()=>false})).rejects.toBe(error);
    expect(generate).toHaveBeenCalledTimes(1);
  }
  const generate=vi.fn();
  await expect(generateOptionalRacingMotion({base:Buffer.alloc(0),prompt:'contract',motion:'pedal',terminal:null,generate,review:vi.fn(),checkActive:()=>{},isCancelled:()=>true})).rejects.toMatchObject({code:'canceled'});
  expect(generate).not.toHaveBeenCalled();
});

it('fails closed on a damaged saved terminal outcome instead of repeating an uncertain request', async () => {
  const {parseRacingMotionTerminalOutcome}=await import('../src/assets/racing-locomotion');
  expect(()=>parseRacingMotionTerminalOutcome('{broken', 'key')).toThrow('refusing to repeat');
  expect(parseRacingMotionTerminalOutcome(null,'key')).toBeNull();
});
