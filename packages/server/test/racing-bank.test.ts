// Targeted banking correction: opposite prompts, single-pose physical
// gates, 192x64 assembly around the byte-preserved neutral cell, and exact
// two-call orchestration with sibling drain on failure. Pure helpers run on
// deterministic mock pixels — no provider calls.
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { mockRacingCraftStripSource } from '../src/assets/racing-mock';
import { processGeneratedRacingCraftStrip, splitRacingStripCells } from '../src/assets/racing-craft';
import {
  RACING_BANK_CORRECTION_IMAGE_CALLS,
  RACING_BANK_PROMPT_VERSION,
  assembleRacingBankStrip,
  buildRacingBankEditPrompt,
  correctRacingBankPoses,
  extractRacingNeutralCell,
  normalizeRacingBankPose,
} from '../src/assets/racing-bank';

async function greenCanvasWithRect(
  canvas: number,
  w: number,
  h: number,
  left: number,
  top: number,
): Promise<Buffer> {
  const subject = await sharp({
    create: { width: w, height: h, channels: 4, background: '#3a6fd8' },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background: '#00ff00' } })
    .composite([{ input: subject, left, top }])
    .png()
    .toBuffer();
}

/** Opaque-pixel mask of a cell: neutral preservation compares these. */
async function alphaMask(cell: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(cell).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mask = Buffer.alloc(info.width * info.height);
  for (let p = 0; p < info.width * info.height; p++) mask[p] = data[p * 4 + 3]! > 8 ? 1 : 0;
  return mask;
}

const baseOptions = {
  vehicleName: 'Pippa Vane',
  artDirection: 'test direction',
  colors: '#111111, #222222',
  retryGuidance: 'both banks yaw left; roll them opposite ways',
  rolePrefix: 'racing-craft-test',
  checkActive: () => undefined,
  validationFailure: () => undefined,
};

describe('racing bank edit prompts', () => {
  it('pins opposite rolls with a yaw lock and shared identity', () => {
    const left = buildRacingBankEditPrompt({ ...baseOptions, pose: 'bankLeft' });
    const right = buildRacingBankEditPrompt({ ...baseOptions, pose: 'bankRight' });
    expect(left).not.toBe(right);
    expect(left).toContain('LEFT');
    expect(left).toContain('left side dips');
    expect(right).toContain('RIGHT');
    expect(right).toContain('right side dips');
    for (const prompt of [left, right]) {
      expect(prompt).toContain('NO YAW');
      expect(prompt).toContain('SAME vehicle as the reference');
      expect(prompt).toContain('never mirror');
      expect(prompt).toContain('both banks yaw left');
    }
    expect(RACING_BANK_PROMPT_VERSION).toBe('racing-craft-bank-v1');
    expect(RACING_BANK_CORRECTION_IMAGE_CALLS).toBe(2);
  });
});

describe('racing bank single-pose gates', () => {
  it('normalizes a bank pose to the 64px cell fingerprint', async () => {
    const { cells } = await splitRacingStripCells(await mockRacingCraftStripSource());
    expect(cells).toHaveLength(3);
    const bank = await normalizeRacingBankPose(cells[1]!, 'bankLeft');
    const meta = await sharp(bank.png).metadata();
    expect({ width: meta.width, height: meta.height }).toEqual({ width: 64, height: 64 });
    expect(bank.spanFrac).toBeGreaterThan(0.1);
    expect(bank.spanFrac).toBeLessThanOrEqual(0.95);
  });

  it('rejects a bank pose cropped by its sheet cell', async () => {
    const raw = await greenCanvasWithRect(128, 60, 40, 0, 44);
    await expect(normalizeRacingBankPose(raw, 'bankLeft')).rejects.toThrow(/cropped by its sheet cell/);
  });
});

describe('racing bank strip assembly', () => {
  it('assembles 192x64 around the byte-preserved neutral cell', async () => {
    const { cells } = await splitRacingStripCells(await mockRacingCraftStripSource());
    const gameplay = (await processGeneratedRacingCraftStrip(await mockRacingCraftStripSource())).png;
    const neutral = await extractRacingNeutralCell(gameplay);
    const left = await normalizeRacingBankPose(cells[1]!, 'bankLeft');
    const right = await normalizeRacingBankPose(cells[2]!, 'bankRight');
    const strip = await assembleRacingBankStrip(neutral, left.png, right.png);
    const meta = await sharp(strip).metadata();
    expect({ width: meta.width, height: meta.height }).toEqual({ width: 192, height: 64 });
    // Regression: the original neutral cell survives reassembly untouched.
    const kept = await sharp(strip).extract({ left: 0, top: 0, width: 64, height: 64 }).png().toBuffer();
    expect(await alphaMask(kept)).toEqual(await alphaMask(neutral));
  });
});

describe('racing bank correction orchestration', () => {
  it('issues exactly two opposite edits and preserves the neutral cell', async () => {
    const { cells } = await splitRacingStripCells(await mockRacingCraftStripSource());
    const gameplay = (await processGeneratedRacingCraftStrip(await mockRacingCraftStripSource())).png;
    const neutral = await extractRacingNeutralCell(gameplay);
    // A 192x64 gameplay strip with the true neutral cell up front.
    const strip = await assembleRacingBankStrip(neutral, neutral, neutral);
    const calls: Array<{ prompt: string; pose: string }> = [];
    const generate = async (prompt: string, pose: 'bankLeft' | 'bankRight'): Promise<Buffer> => {
      calls.push({ prompt, pose });
      return pose === 'bankLeft' ? cells[1]! : cells[2]!;
    };
    const corrected = await correctRacingBankPoses({ ...baseOptions, strip, generate });
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.pose).sort()).toEqual(['bankLeft', 'bankRight']);
    expect(calls[0]!.prompt).not.toBe(calls[1]!.prompt);
    const meta = await sharp(corrected).metadata();
    expect({ width: meta.width, height: meta.height }).toEqual({ width: 192, height: 64 });
    const kept = await sharp(corrected).extract({ left: 0, top: 0, width: 64, height: 64 }).png().toBuffer();
    expect(await alphaMask(kept)).toEqual(await alphaMask(neutral));
  });

  it('drains the sibling edit before reporting a bank failure', async () => {
    const { cells } = await splitRacingStripCells(await mockRacingCraftStripSource());
    const gameplay = (await processGeneratedRacingCraftStrip(await mockRacingCraftStripSource())).png;
    const strip = gameplay;
    let leftFinished = false;
    const validationFailure = vi.fn();
    const generate = async (prompt: string, pose: 'bankLeft' | 'bankRight'): Promise<Buffer> => {
      if (pose === 'bankRight') throw new Error('synthetic bank-right provider failure');
      await new Promise((resolve) => setTimeout(resolve, 50));
      leftFinished = true;
      return cells[1]!;
    };
    await expect(
      correctRacingBankPoses({ ...baseOptions, strip, generate, validationFailure }),
    ).rejects.toThrow('synthetic bank-right provider failure');
    expect(leftFinished).toBe(true);
    // A provider-side generate failure is not a validation failure (the
    // image call already receipts itself); only the drain matters here.
    expect(validationFailure).not.toHaveBeenCalled();
  });

  it('receipts a bank normalize failure under the bank role', async () => {
    const { cells } = await splitRacingStripCells(await mockRacingCraftStripSource());
    const gameplay = (await processGeneratedRacingCraftStrip(await mockRacingCraftStripSource())).png;
    const strip = gameplay;
    const flat = await sharp({ create: { width: 128, height: 128, channels: 4, background: '#00ff00' } })
      .png()
      .toBuffer();
    const validationFailure = vi.fn();
    const generate = async (prompt: string, pose: 'bankLeft' | 'bankRight'): Promise<Buffer> =>
      pose === 'bankLeft' ? flat : cells[2]!;
    await expect(
      correctRacingBankPoses({ ...baseOptions, strip, generate, validationFailure }),
    ).rejects.toThrow(/bankLeft/);
    expect(validationFailure).toHaveBeenCalledWith('racing-craft-test-bank-bankLeft');
  });

  it('rejects banks that disagree on vehicle scale', async () => {
    const { cells } = await splitRacingStripCells(await mockRacingCraftStripSource());
    const gameplay = (await processGeneratedRacingCraftStrip(await mockRacingCraftStripSource())).png;
    const strip = gameplay;
    const tiny = await greenCanvasWithRect(128, 30, 24, 49, 52);
    const generate = async (prompt: string, pose: 'bankLeft' | 'bankRight'): Promise<Buffer> =>
      pose === 'bankLeft' ? cells[1]! : tiny;
    await expect(correctRacingBankPoses({ ...baseOptions, strip, generate })).rejects.toThrow(
      /disagree on vehicle scale/,
    );
  });
});
