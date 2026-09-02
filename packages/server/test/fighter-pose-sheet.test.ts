import sharp, { type OverlayOptions } from 'sharp';
import { describe, expect, it } from 'vitest';
import { GENERATED_FIGHTER_POSES } from '../src/assets/fighter-pose';
import {
  FIGHTER_POSE_SHEET_GROUPS,
  FIGHTER_POSE_SHEET_BLEED_TOLERANCE,
  FIGHTER_POSE_SHEET_SIZE,
  actionPosesFromSheets,
  buildFighterPoseSheetPrompt,
  buildFighterPoseSheetSeed,
  fighterPoseSheetCellRect,
  recoverRejectedFighterSheetCells,
  splitGeneratedFighterPoseSheet,
} from '../src/assets/fighter-pose-sheet';
import { mockGeneratedImage } from '../src/assets/game-art';

async function syntheticBleedingSheet(koBleed: number): Promise<Buffer> {
  const overlays: OverlayOptions[] = [];
  for (let index = 0; index < 5; index++) {
    const rect = fighterPoseSheetCellRect(index);
    const width = 80;
    const height = 260;
    const input = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 80 + index * 20, g: 70, b: 180 - index * 15, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    overlays.push({
      input,
      left: rect.left + Math.floor((rect.width - width) / 2),
      top: rect.top + 120,
    });
  }
  const koRect = fighterPoseSheetCellRect(5);
  const koWidth = 300;
  const koHeight = 80;
  const ko = await sharp({
    create: {
      width: koWidth,
      height: koHeight,
      channels: 4,
      background: { r: 205, g: 110, b: 70, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  overlays.push({ input: ko, left: koRect.left - koBleed, top: koRect.top + 390 });
  return sharp({
    create: {
      width: FIGHTER_POSE_SHEET_SIZE,
      height: FIGHTER_POSE_SHEET_SIZE,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    },
  })
    .composite(overlays)
    .png()
    .toBuffer();
}

describe('fighter pose sheets', () => {
  it('partitions a 1024px board into six fixed cells without gaps or overlap', () => {
    const rects = Array.from({ length: 6 }, (_, index) => fighterPoseSheetCellRect(index));
    expect(rects.map(({ width }) => width)).toEqual([341, 341, 342, 341, 341, 342]);
    expect(rects.map(({ height }) => height)).toEqual([512, 512, 512, 512, 512, 512]);
    expect(rects.map(({ left, top }) => [left, top])).toEqual([
      [0, 0],
      [341, 0],
      [682, 0],
      [0, 512],
      [341, 512],
      [682, 512],
    ]);
  });

  it('assigns every non-idle combat state to exactly one sheet', () => {
    const actions = actionPosesFromSheets();
    expect(actions).toHaveLength(12);
    expect(new Set(actions).size).toBe(12);
    expect(new Set(actions)).toEqual(
      new Set(GENERATED_FIGHTER_POSES.filter((pose) => pose !== 'idle')),
    );
  });

  it('builds a repeated identity seed and an exact ordered sheet contract', async () => {
    const anchor = await mockGeneratedImage('neutral ready fighting stance on #00ff00');
    const seed = await buildFighterPoseSheetSeed(anchor);
    await expect(sharp(seed).metadata()).resolves.toMatchObject({
      format: 'png',
      width: FIGHTER_POSE_SHEET_SIZE,
      height: FIGHTER_POSE_SHEET_SIZE,
    });

    const prompt = buildFighterPoseSheetPrompt(FIGHTER_POSE_SHEET_GROUPS[1]!, {
      artDirection: 'Aesthetic: stylized. Shared character proportions: six-head athletic adults.',
      outfit: 'indigo jacket',
      colors: '#315a9c',
    });
    expect(prompt).toContain(
      'FIGHTER POSE SHEET CONTRACT: attacks [punchHigh,punchLow,kickHigh,kickLow,airPunch,airKick].',
    );
    expect(prompt).toContain('exactly SIX');
    expect(prompt).toContain('IMMUTABLE ROSTER-WIDE ART DIRECTION');
    expect(prompt).toContain('six-head athletic adults');
    expect(prompt).toContain('do not swap, omit, duplicate, or merge states');
    expect(prompt).toContain('Do not draw grid lines, borders, labels, text');
  });

  it('splits and validates cells independently so one invalid cell preserves the other five', async () => {
    const group = FIGHTER_POSE_SHEET_GROUPS[0]!;
    const prompt = buildFighterPoseSheetPrompt(group);
    const validSheet = await mockGeneratedImage(prompt);
    const valid = await splitGeneratedFighterPoseSheet(validSheet, group);
    expect(valid.every(({ processed, error }) => processed && !error)).toBe(true);

    const badRect = fighterPoseSheetCellRect(2);
    const greenCell = await sharp({
      create: {
        width: badRect.width,
        height: badRect.height,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const damaged = await sharp(validSheet)
      .composite([{ input: greenCell, left: badRect.left, top: badRect.top }])
      .png()
      .toBuffer();
    const split = await splitGeneratedFighterPoseSheet(damaged, group);

    expect(split.filter(({ processed }) => processed)).toHaveLength(5);
    const rejected = split.filter(({ error }) => error);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ pose: group.poses[2] });
    expect(rejected[0]?.processed).toBeUndefined();
  });

  it('removes a clipped foreground island leaked from an adjacent frame', async () => {
    const group = FIGHTER_POSE_SHEET_GROUPS[0]!;
    const sheet = await mockGeneratedImage(buildFighterPoseSheetPrompt(group));
    const target = fighterPoseSheetCellRect(2);
    const artifact = await sharp({
      create: {
        width: 24,
        height: 96,
        channels: 4,
        background: { r: 225, g: 55, b: 180, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const leaked = await sharp(sheet)
      .composite([
        {
          input: artifact,
          left: target.left + target.width - 24,
          top: target.top + 190,
        },
      ])
      .png()
      .toBuffer();

    const split = await splitGeneratedFighterPoseSheet(leaked, group);
    expect(split.every(({ processed }) => processed)).toBe(true);
    expect(split[2]?.metrics).toMatchObject({
      sourceComponentCount: 2,
      discardedComponentCount: 1,
    });
  });

  it('reassigns bounded cross-cell pixels to their full-sheet component owner', async () => {
    const group = FIGHTER_POSE_SHEET_GROUPS[0]!;
    const bleed = 32;
    const split = await splitGeneratedFighterPoseSheet(await syntheticBleedingSheet(bleed), group);

    expect(split.every(({ processed }) => processed)).toBe(true);
    expect(split[4]?.segmentation).toMatchObject({
      reclaimedBleedPixels: 0,
      excludedNeighborPixels: bleed * 80,
    });
    expect(split[5]?.segmentation).toMatchObject({
      reclaimedBleedPixels: bleed * 80,
      excludedNeighborPixels: 0,
      bleed: { left: bleed, top: 0, right: 0, bottom: 0 },
    });
    expect(split[5]?.metrics?.sourceBounds.width).toBe(300);
  });

  it('rejects an owned component that exceeds the bounded bleed tolerance', async () => {
    const group = FIGHTER_POSE_SHEET_GROUPS[0]!;
    const split = await splitGeneratedFighterPoseSheet(
      await syntheticBleedingSheet(FIGHTER_POSE_SHEET_BLEED_TOLERANCE + 1),
      group,
    );

    expect(split[5]).toMatchObject({
      segmentation: { bleed: { left: FIGHTER_POSE_SHEET_BLEED_TOLERANCE + 1 } },
    });
    expect(split[5]?.processed).toBeUndefined();
    expect(split[5]?.error).toContain(
      `exceeds the ${FIGHTER_POSE_SHEET_BLEED_TOLERANCE}px sheet-cell bleed tolerance`,
    );
  });

  it('uses one bounded A3 repair when the first isolated recovery fails', async () => {
    const calls: string[] = [];
    const recovered = await recoverRejectedFighterSheetCells(
      ['ko', 'hit'],
      async (pose, suffix, guidance) => {
        calls.push(`${pose}-${suffix}`);
        expect(guidance).toContain('complete uncropped silhouette');
        if (pose === 'ko' && suffix === 'A2') return null;
        return `${pose}-${suffix}`;
      },
    );

    expect(recovered).toEqual(['ko-A3', 'hit-A2']);
    expect(calls).toEqual(['ko-A2', 'hit-A2', 'ko-A3']);
  });
});
