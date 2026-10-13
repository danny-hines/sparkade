import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  PLATFORMER_TEMPLATE_POSES,
  buildPlatformerTemplateBoard,
  buildPlatformerTemplateBoardPrompt,
  buildPlatformerCycleBoard,
  buildPlatformerCycleBoardPrompt,
  measureCycleDiversity,
  measureCycleIdentityShift,
  renderPlatformerCycleTemplates,
  normalizePlatformerCycle,
  splitPlatformerCycleBoard,
  measureMannequinResidue,
  measurePlatformerSilhouetteAgreement,
  renderPlatformerMannequin,
  splitPlatformerTemplateBoard,
} from '../src/assets/platformer-template-board';
import { fighterPoseSheetCellRect } from '../src/assets/fighter-pose-sheet';
import { isFighterGreenScreenPixel } from '../src/assets/fighter-pose';

/** A 48x110 red/blue figure with a head, on transparency. */
async function syntheticIdentity(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="120" shape-rendering="crispEdges">
    <circle cx="32" cy="22" r="14" fill="#d9a066"/>
    <rect x="18" y="36" width="28" height="44" fill="#b03a2e"/>
    <rect x="8" y="38" width="8" height="36" fill="#b03a2e"/>
    <rect x="48" y="38" width="8" height="36" fill="#b03a2e"/>
    <rect x="20" y="80" width="10" height="38" fill="#2e4b8f"/>
    <rect x="34" y="80" width="10" height="38" fill="#2e4b8f"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function lowestSubjectRow(board: Buffer, index: number): Promise<number> {
  const rect = fighterPoseSheetCellRect(index);
  const { data, info } = await sharp(board)
    .extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let y = info.height - 1; y >= 0; y--)
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels;
      if (!isFighterGreenScreenPixel(data[offset]!, data[offset + 1]!, data[offset + 2]!)) return y;
    }
  return -1;
}

describe('platformer template board', () => {
  it('renders crisp mannequins on one scale, with strides shorter than standing and a lifted jump', async () => {
    const heights: Record<string, number> = {};
    for (const pose of PLATFORMER_TEMPLATE_POSES) {
      const { png, lift } = await renderPlatformerMannequin(pose, { height: 112 });
      const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      for (let offset = 3; offset < data.length; offset += 4)
        expect([0, 255]).toContain(data[offset]);
      heights[pose] = info.height;
      expect(lift > 0).toBe(pose === 'jump');
    }
    expect(Math.abs(heights.sideIdle! - 112)).toBeLessThanOrEqual(3);
    expect(heights.walk1).toBeLessThan(heights.sideIdle!);
    expect(heights.walk1).toBe(heights.walk2);
  });

  it('places the identity and every template on a shared ground line, lifting only the jump', async () => {
    const built = await buildPlatformerTemplateBoard({ identity: await syntheticIdentity() });
    expect(await sharp(built.board).metadata()).toMatchObject({ width: 1024, height: 1024 });
    expect(built.templateSource).toBe('mannequin');
    expect(built.upscale).toBe(3);
    const ground = await lowestSubjectRow(built.board, 0);
    for (const [index, pose] of PLATFORMER_TEMPLATE_POSES.entries()) {
      const row = await lowestSubjectRow(built.board, index + 1);
      if (pose === 'jump') expect(row).toBeLessThan(ground - 20);
      else expect(Math.abs(row - ground)).toBeLessThanOrEqual(built.upscale);
    }
  });

  it('splits an unedited board into five valid templates that match only their own silhouettes', async () => {
    const built = await buildPlatformerTemplateBoard({ identity: await syntheticIdentity() });
    const cells = await splitPlatformerTemplateBoard(built.board);
    expect(cells.map((cell) => cell.pose)).toEqual([...PLATFORMER_TEMPLATE_POSES]);
    for (const cell of cells) expect(cell.error).toBeUndefined();
    const frame = Object.fromEntries(cells.map((cell) => [cell.pose, cell.processed!]));
    expect((await measurePlatformerSilhouetteAgreement(frame.walk1!, frame.walk1!)).iou).toBe(1);
    // Contact A and B differ only in which limbs are in front; the two-tone
    // depth code, not the outline, carries that distinction.
    expect(
      (await measurePlatformerSilhouetteAgreement(frame.walk1!, frame.walk2!)).iou,
    ).toBeGreaterThan(0.95);
    expect(
      (await measurePlatformerSilhouetteAgreement(frame.walk1!, frame.sideIdle!)).lowerBodyIou,
    ).toBeLessThan(0.6);
  });

  it('flags frames that kept the gray mannequin body but not the dressed identity', async () => {
    const built = await buildPlatformerTemplateBoard({ identity: await syntheticIdentity() });
    const [sideIdle] = await splitPlatformerTemplateBoard(built.board);
    expect(await measureMannequinResidue(sideIdle!.processed!)).toBeGreaterThan(0.6);
    expect(await measureMannequinResidue(await syntheticIdentity())).toBe(0);
  });

  it('scales imported templates uniformly from their side idle and rejects an incomplete set', async () => {
    const identity = await syntheticIdentity();
    const imported = Object.fromEntries(
      await Promise.all(
        PLATFORMER_TEMPLATE_POSES.map(async (pose) => [
          pose,
          (await renderPlatformerMannequin(pose, { height: 400 })).png,
        ]),
      ),
    );
    const built = await buildPlatformerTemplateBoard({ identity, templates: imported });
    expect(built.templateSource).toBe('imported');
    // The synthetic identity spans rows 8-117, so imported side idle matches 110px.
    expect((await sharp(built.templates.sideIdle).metadata()).height).toBe(110);
    expect((await sharp(built.templates.walk1).metadata()).height).toBeLessThan(110);
    const { jump: _jump, ...missing } = imported;
    await expect(buildPlatformerTemplateBoard({ identity, templates: missing })).rejects.toThrow(
      'missing jump',
    );
  });

  it('draws outline templates hollow and skeletons as thin lines on the same ground line', async () => {
    const identity = await syntheticIdentity();
    const coverage = async (style: 'volume' | 'outline' | 'skeleton') => {
      const { png } = await renderPlatformerMannequin('walk1', { height: 112, style });
      const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      let ink = 0;
      for (let offset = 0; offset < data.length; offset += 4)
        if (
          data[offset + 3] &&
          !isFighterGreenScreenPixel(data[offset]!, data[offset + 1]!, data[offset + 2]!)
        )
          ink++;
      return ink;
    };
    const volume = await coverage('volume');
    expect(await coverage('outline')).toBeLessThan(volume * 0.6);
    expect(await coverage('skeleton')).toBeLessThan(volume * 0.6);
    const volumeBoard = await buildPlatformerTemplateBoard({ identity });
    for (const style of ['outline', 'skeleton'] as const) {
      const board = await buildPlatformerTemplateBoard({ identity, style });
      expect(board.style).toBe(style);
      expect(board.upscale).toBe(volumeBoard.upscale);
      expect(
        Math.abs(
          (await lowestSubjectRow(board.board, 2)) - (await lowestSubjectRow(volumeBoard.board, 2)),
        ),
      ).toBeLessThanOrEqual(board.upscale * 2);
    }
  });

  it('places an imported jump at its measured lift', async () => {
    const identity = await syntheticIdentity();
    const imported = Object.fromEntries(
      await Promise.all(
        PLATFORMER_TEMPLATE_POSES.map(async (pose) => [
          pose,
          (await renderPlatformerMannequin(pose, { height: 200 })).png,
        ]),
      ),
    );
    for (const lift of [0.05, 0.3]) {
      const board = await buildPlatformerTemplateBoard({
        identity,
        templates: imported,
        templateLifts: { jump: lift },
      });
      // Native pixels between the identity's ground line and the jump's feet.
      const native =
        ((await lowestSubjectRow(board.board, 0)) - (await lowestSubjectRow(board.board, 4))) /
        board.upscale;
      expect(Math.abs(native - lift * 110)).toBeLessThanOrEqual(2);
    }
  });

  it('describes each template style and its depth code', () => {
    expect(buildPlatformerTemplateBoardPrompt({ style: 'outline' })).toContain(
      'hollow line-art pose sketch',
    );
    expect(buildPlatformerTemplateBoardPrompt({ style: 'outline' })).toContain(
      'PALE gray outlines mark the far-side',
    );
    expect(buildPlatformerTemplateBoardPrompt({ style: 'skeleton' })).toContain(
      'stick-figure pose skeleton',
    );
    expect(buildPlatformerTemplateBoardPrompt({ style: 'skeleton' })).toContain(
      'Never draw a thin stick-limbed version',
    );
    expect(buildPlatformerTemplateBoardPrompt()).toContain("gray, featureless artist's mannequin");
  });

  it('splits a run-cycle board onto one shared canvas and keeps the bob of each frame', async () => {
    // Eight 70x130 canvases, each a 40x110 figure on the ground except frame 3,
    // which floats 12px up, like consecutive video frames on a shared canvas.
    const frames = await Promise.all(
      Array.from({ length: 8 }, (_, k) =>
        sharp(
          Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="70" height="130" shape-rendering="crispEdges"><rect x="${15 + (k % 3)}" y="${20 - (k === 3 ? 12 : 0)}" width="40" height="110" fill="#b03a2e"/></svg>`,
          ),
        )
          .png()
          .toBuffer(),
      ),
    );
    const built = await buildPlatformerCycleBoard({ identity: await syntheticIdentity(), frames });
    const cells = await splitPlatformerCycleBoard(built.board);
    expect(cells).toHaveLength(8);
    for (const cell of cells) expect(cell.error).toBeUndefined();
    const cycle = await normalizePlatformerCycle(cells, built.upscale);
    const sizes = await Promise.all(cycle.frames.map((png) => sharp(png).metadata()));
    expect(new Set(sizes.map((m) => `${m.width}x${m.height}`)).size).toBe(1);
    expect(new Set(cycle.metrics.map((m) => m.height)).size).toBe(1);
    expect(Math.abs(cycle.metrics[3]!.lift - 12)).toBeLessThanOrEqual(1);
    for (const [k, metric] of cycle.metrics.entries()) if (k !== 3) expect(metric.lift).toBe(0);
    expect(buildPlatformerCycleBoardPrompt()).toContain('Cells 2 to 9, in reading order');
  });

  it('reports an empty cycle cell instead of normalizing a partial cycle', async () => {
    const frames = await Promise.all(
      Array.from({ length: 8 }, () =>
        sharp({ create: { width: 40, height: 110, channels: 4, background: '#b03a2e' } })
          .png()
          .toBuffer(),
      ),
    );
    const built = await buildPlatformerCycleBoard({ identity: await syntheticIdentity(), frames });
    const blanked = await sharp(built.board)
      .composite([
        {
          input: await sharp({
            create: { width: 300, height: 300, channels: 4, background: '#00ff00' },
          })
            .png()
            .toBuffer(),
          left: 700,
          top: 360,
        },
      ])
      .png()
      .toBuffer();
    const cells = await splitPlatformerCycleBoard(blanked);
    expect(cells[4]!.error).toBe('no figure in this cell');
    await expect(normalizePlatformerCycle(cells, built.upscale)).rejects.toThrow('cell 6');
  });

  it('draws the hand-posed cycle on one canvas with the up frames off the ground', async () => {
    const { outline, silhouette } = await renderPlatformerCycleTemplates({ height: 112 });
    expect(outline).toHaveLength(8);
    expect(silhouette).toHaveLength(8);
    const sizes = await Promise.all(
      [...outline, ...silhouette].map((png) => sharp(png).metadata()),
    );
    expect(new Set(sizes.map((m) => `${m.width}x${m.height}`)).size).toBe(1);
    const clearance = async (png: Buffer) => {
      const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      for (let y = info.height - 1; y >= 0; y--)
        for (let x = 0; x < info.width; x++)
          if (data[(y * info.width + x) * 4 + 3]) return info.height - 1 - y;
      return info.height;
    };
    const lifts = await Promise.all(silhouette.map(clearance));
    // Contacts touch the shared floor; the two "up" phases (3 and 7) leave it.
    expect(lifts[0]).toBe(lifts[4]);
    expect(lifts[3]! - lifts[0]!).toBeGreaterThan(3);
    expect(lifts[7]! - lifts[0]!).toBeGreaterThan(3);
  });

  it('describes each cycle phase, the empty cells, and the magenta depth label', () => {
    const eight = buildPlatformerCycleBoardPrompt();
    expect(eight).toContain(
      'Cell 2 (row 1, column 2), phase 1 of 8: contact: the camera-side (near) leg reaches forward',
    );
    expect(eight).toContain('phase 3 of 8: passing: the camera-side (near) leg supports');
    expect(eight).toContain('phase 5 of 8: contact: the far leg reaches forward');
    expect(eight).toContain('MAGENTA outlines mark the far-side arm and leg');
    expect(eight).toContain('No two cells may show the same pose');
    expect(eight).not.toContain('intentionally empty');
    const six = buildPlatformerCycleBoardPrompt({ frameCount: 6, farLines: 'pale' });
    expect(six).toContain('Cells 8 to 9 are intentionally empty');
    expect(six).toContain('phase 4 of 6: contact: the far leg');
    expect(six).toContain('PALE gray outlines mark the far-side');
    expect(() => buildPlatformerCycleBoardPrompt({ frameCount: 5 })).toThrow(RangeError);
  });

  it('counts copied cycle poses and flags a recolored identity cell', async () => {
    const frame = (x: number) =>
      sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120" shape-rendering="crispEdges"><rect x="${x}" y="10" width="30" height="110" fill="#b03a2e"/></svg>`,
        ),
      )
        .png()
        .toBuffer();
    const varied = await Promise.all([0, 25, 50].map(frame));
    const copied = await Promise.all([0, 0, 50].map(frame));
    expect((await measureCycleDiversity(varied)).distinct).toBe(3);
    expect((await measureCycleDiversity(copied)).distinct).toBe(2);
    const identity = await syntheticIdentity();
    const frames = await Promise.all(Array.from({ length: 8 }, () => frame(20)));
    const { board } = await buildPlatformerCycleBoard({ identity, frames });
    expect(await measureCycleIdentityShift(board, board)).toBe(0);
    const recolored = await sharp(board)
      .composite([
        {
          input: await sharp(identity).modulate({ brightness: 0.5 }).resize(160).png().toBuffer(),
          left: 90,
          top: 60,
        },
      ])
      .png()
      .toBuffer();
    expect(await measureCycleIdentityShift(board, recolored)).toBeGreaterThan(20);
  });

  it('describes every cell, the depth code, and the costume contract in the prompt', () => {
    const prompt = buildPlatformerTemplateBoardPrompt({
      heroConcept: 'Courier in a yellow raincoat carrying a lantern',
      colors: '#ffcc00, #223344',
    });
    for (let cell = 2; cell <= 6; cell++) expect(prompt).toContain(`Cell ${cell} (`);
    expect(prompt).toContain('Cell 4 (row 2, column 1)');
    expect(prompt).toContain('LIGHT-gray limbs are the camera-side');
    expect(prompt).toContain('yellow raincoat');
    expect(prompt).toContain('both hands stay empty');
    expect(prompt).toContain('front-facing');
    expect(buildPlatformerTemplateBoardPrompt({ identityView: 'side' })).toContain(
      'right-facing side view',
    );
  });
});
