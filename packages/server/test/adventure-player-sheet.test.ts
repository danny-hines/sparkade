import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { mockGeneratedImage } from '../src/assets/game-art';
import {
  ADVENTURE_PLAYER_SHEET_GROUPS,
  buildAdventurePlayerSheetPrompt,
  buildAdventurePlayerSheetSeed,
  splitGeneratedAdventurePlayerSheet,
} from '../src/assets/adventure-player-sheet';
import {
  ADVENTURE_PLAYER_POSE_HEIGHT,
  ADVENTURE_PLAYER_POSE_WIDTH,
  buildAdventurePlayerIdentityPrompt,
  processGeneratedAdventurePlayerPose,
} from '../src/assets/adventure-player';
import { fighterPoseSheetCellRect } from '../src/assets/fighter-pose-sheet';

async function identityAnchor(): Promise<Buffer> {
  return processGeneratedAdventurePlayerPose(
    await mockGeneratedImage(buildAdventurePlayerIdentityPrompt('I1', { hasPhoto: false })),
  );
}

const combatKit = {
  primary: {
    profile: 'sweep' as const,
    name: 'Signal Wrench',
    visualConcept: 'a compact brass wrench with a teal insulated grip',
    unarmed: false,
  },
  secondary: {
    behavior: 'shot' as const,
    name: 'Flare Caster',
    visualConcept: 'a short orange rescue flare launcher',
  },
};

describe('Adventure player pose sheets', () => {
  it('defines one movement and one combat sheet with exact six-cell contracts', () => {
    expect(ADVENTURE_PLAYER_SHEET_GROUPS.map(({ id }) => id)).toEqual(['movement', 'combat']);
    const prompt = buildAdventurePlayerSheetPrompt(ADVENTURE_PLAYER_SHEET_GROUPS[1], {
      heroConcept: 'a sand-tan canvas wayfinder vest with teal trim and amber sash',
      colors: '#c9a468, #23a89a, #f0a83c',
      combatKit,
    });

    expect(prompt).toContain(
      'ADVENTURE PLAYER POSE SHEET CONTRACT: combat [downMelee,upMelee,sideMelee,downSecondary,upSecondary,sideSecondary]',
    );
    expect(prompt).toContain('exact selected gameplay hero once in every cell');
    expect(prompt).toContain('Never invent an absent accessory');
    expect(prompt).toContain('source-photo clothing is not identity');
    expect(prompt).toContain('Cell 3 (row 1, column 3) — sideMelee');
    expect(prompt).toContain('no face on the back of the head');
    expect(prompt).toContain('Cell 6 (row 2, column 3) — sideSecondary');
    expect(prompt).toContain('Signal Wrench');
    expect(prompt).toContain('Flare Caster');
    expect(prompt).toContain('Movement cells carry this exact equipment low and passive');
    expect(prompt).toContain('never above the center of the head');
    expect(prompt).toContain('Melee cells alone show it raised or extended at contact');
    expect(prompt).toContain('STATE-CONTRAST CONTRACT');
    expect(prompt).toContain('Only melee cells may raise, brandish, swing, thrust, or extend');
    expect(prompt).toContain('hero is canonically right-handed');
    expect(prompt).toContain("viewer's LEFT in DOWN/front cells");
    expect(prompt).toContain("viewer's RIGHT in UP/back cells");
    expect(prompt).toContain('Never swap it into the anatomical left hand');
    expect(prompt).toContain(
      'secondary cells operate this exact item with the anatomical LEFT hand',
    );
    expect(prompt).toContain(
      'primary remains visibly low and passive in the anatomical RIGHT hand',
    );
    expect(prompt).toContain('EQUIPMENT-CONTINUITY CONTRACT');
    expect(prompt).toContain('does not authorize a hand swap');
    expect(prompt).toContain('Never substitute a generic sword');
    expect(prompt).toContain('No body part may cross into another cell');
    expect(prompt).toContain('clean darkest outer contour');
    expect(prompt).toContain('light, dark, noisy, or similarly colored floor');
  });

  it('repeats the selected native identity in every seed-board cell', async () => {
    const seed = await buildAdventurePlayerSheetSeed(await identityAnchor());
    await expect(sharp(seed).metadata()).resolves.toMatchObject({
      width: 1024,
      height: 1024,
      format: 'png',
    });

    const { data, info } = await sharp(seed).raw().toBuffer({ resolveWithObject: true });
    for (let index = 0; index < 6; index++) {
      const rect = fighterPoseSheetCellRect(index);
      let nonGreen = 0;
      for (let y = rect.top; y < rect.top + rect.height; y++) {
        for (let x = rect.left; x < rect.left + rect.width; x++) {
          const offset = (y * info.width + x) * info.channels;
          if (!(data[offset] === 0 && data[offset + 1] === 255 && data[offset + 2] === 0)) {
            nonGreen++;
          }
        }
      }
      expect(nonGreen).toBeGreaterThan(1000);
    }
  });

  it('segments one generated sheet into six native foot-anchored poses', async () => {
    const group = ADVENTURE_PLAYER_SHEET_GROUPS[0];
    const raw = await mockGeneratedImage(buildAdventurePlayerSheetPrompt(group));
    const cells = await splitGeneratedAdventurePlayerSheet(raw, group);

    expect(cells.map(({ pose }) => pose)).toEqual(group.poses);
    expect(cells.every(({ processed }) => processed)).toBe(true);
    for (const cell of cells) {
      await expect(sharp(cell.processed!).metadata()).resolves.toMatchObject({
        width: ADVENTURE_PLAYER_POSE_WIDTH,
        height: ADVENTURE_PLAYER_POSE_HEIGHT,
        isPalette: true,
      });
    }
  });

  it('retains five healthy cells when one sheet cell is empty', async () => {
    const group = ADVENTURE_PLAYER_SHEET_GROUPS[1];
    const raw = await mockGeneratedImage(buildAdventurePlayerSheetPrompt(group));
    const damagedRect = fighterPoseSheetCellRect(3);
    const green = await sharp({
      create: {
        width: damagedRect.width,
        height: damagedRect.height,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const damaged = await sharp(raw)
      .composite([{ input: green, left: damagedRect.left, top: damagedRect.top }])
      .png()
      .toBuffer();
    const cells = await splitGeneratedAdventurePlayerSheet(damaged, group);

    expect(cells.filter(({ processed }) => processed)).toHaveLength(5);
    expect(cells.find(({ pose }) => pose === 'downSecondary')?.processed).toBeUndefined();
    expect(cells.find(({ pose }) => pose === 'downSecondary')?.error).toContain('empty');
  });
});
