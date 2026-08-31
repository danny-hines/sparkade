import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { mockGeneratedImage } from '../src/assets/game-art';
import {
  ADVENTURE_PLAYER_POSE_HEIGHT,
  ADVENTURE_PLAYER_POSE_WIDTH,
  GENERATED_ADVENTURE_PLAYER_POSES,
  buildAdventurePlayerIdentityJudgePrompt,
  buildAdventurePlayerIdentityPrompt,
  buildAdventurePlayerIdentityReference,
  buildAdventurePlayerPosePrompt,
  buildAdventurePortraitIdentityReference,
  buildAdventureStoryIdentityReference,
  processGeneratedAdventurePlayerPose,
  validateGeneratedAdventurePlayerPoseSet,
} from '../src/assets/adventure-player';

async function solid(width: number, height: number, color: string): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();
}

async function footAnchoredPose(width: number, height = 116): Promise<Buffer> {
  const raw = Buffer.alloc(ADVENTURE_PLAYER_POSE_WIDTH * ADVENTURE_PLAYER_POSE_HEIGHT * 4);
  const top = ADVENTURE_PLAYER_POSE_HEIGHT - height;
  const centerX = Math.floor(ADVENTURE_PLAYER_POSE_WIDTH / 2);
  const paintRect = (left: number, y0: number, rectWidth: number, rectHeight: number): void => {
    for (let y = y0; y < y0 + rectHeight; y++) {
      for (let x = left; x < left + rectWidth; x++) {
        const offset = (y * ADVENTURE_PLAYER_POSE_WIDTH + x) * 4;
        raw[offset] = 58;
        raw[offset + 1] = 86;
        raw[offset + 2] = 142;
        raw[offset + 3] = 255;
      }
    }
  };
  const bodyWidth = Math.min(28, width);
  paintRect(centerX - 7, top, 14, 14);
  paintRect(centerX - Math.floor(bodyWidth / 2), top + 12, bodyWidth, height - 34);
  paintRect(Math.floor((ADVENTURE_PLAYER_POSE_WIDTH - width) / 2), top + 28, width, 5);
  for (const left of [centerX - 13, centerX + 5]) {
    for (let y = ADVENTURE_PLAYER_POSE_HEIGHT - 22; y < ADVENTURE_PLAYER_POSE_HEIGHT; y++) {
      for (let x = left; x < left + 8; x++) {
        const offset = (y * ADVENTURE_PLAYER_POSE_WIDTH + x) * 4;
        raw[offset] = 58;
        raw[offset + 1] = 86;
        raw[offset + 2] = 142;
        raw[offset + 3] = 255;
      }
    }
  }
  return sharp(raw, {
    raw: {
      width: ADVENTURE_PLAYER_POSE_WIDTH,
      height: ADVENTURE_PLAYER_POSE_HEIGHT,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
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

describe('generated Adventure player prompts', () => {
  it('separates neck-up photo identity from canonical game wardrobe', () => {
    const prompt = buildAdventurePlayerIdentityPrompt('I1', {
      hasPhoto: true,
      heroConcept: 'an observatory diver in a brass-trimmed navy pressure coat',
      colors: '#14253d, #bf8b45, #e8ddbb',
      combatKit,
    });

    expect(prompt).toContain(
      "TOP PANEL of the attached reference board is the exact player's photo",
    );
    expect(prompt).toContain('immutable identity truth from the neck up');
    expect(prompt).toContain('glasses, headwear, and every visible head accessory');
    expect(prompt).toContain('Never invent an absent accessory');
    expect(prompt).toContain('source photo clothing is not identity');
    expect(prompt).toContain('Canonical game-world wardrobe contract');
    expect(prompt).toContain('DOWN-facing idle in a classic top-down three-quarter');
    expect(prompt).toContain('native 112x128 canvas');
    expect(prompt).toContain('strongly readable outer silhouette');
    expect(prompt).toContain('similarly colored floor');
    expect(prompt).toContain('flat solid #00ff00');
    expect(prompt).toContain('Signal Wrench');
    expect(prompt).toContain('LOW AND PASSIVE BESIDE THE BODY');
    expect(prompt).toContain('grip hand at hip or thigh height');
    expect(prompt).toContain('never raise the equipment overhead');
    expect(prompt).toContain('never be centered above the head');
    expect(prompt).toContain('hero is right-handed');
    expect(prompt).toContain("DOWN/front view that hand appears on the viewer's LEFT");
    expect(prompt).toContain('Never swap the primary into the anatomical left hand');
    expect(prompt).toContain('move it onto the back or shoulder');
    expect(prompt).toContain('never replace it with a generic sword');
  });

  it('derives every other direction from the exact selected gameplay hero', () => {
    const up = buildAdventurePlayerPosePrompt('upIdle');
    const sideWalk = buildAdventurePlayerPosePrompt('sideWalk');
    const melee = buildAdventurePlayerPosePrompt('sideMelee', { combatKit });
    const secondary = buildAdventurePlayerPosePrompt('downSecondary', { combatKit });

    expect(up).toContain(
      'immutable identity, wardrobe, primary-equipment, proportion, pixel-technique, and scale truth',
    );
    expect(up).toContain('no face painted onto the back of the head');
    expect(sideWalk).toContain('RIGHT-facing top-down three-quarter walking contact frame');
    expect(sideWalk).toContain('Change only the requested facing and action state');
    expect(melee).toContain('Signal Wrench');
    expect(melee).toContain('contact moment');
    expect(melee).toContain('anatomical RIGHT hand as the main grip');
    expect(secondary).toContain('Flare Caster');
    expect(secondary).toContain('launched projectile');
    expect(secondary).toContain('anatomical LEFT hand');
    expect(secondary).toContain('primary remains visibly low and passive');
    expect(secondary).toContain('move the primary to the back');
  });

  it('requires the identity judge to preserve hats, glasses, hair, and adult likeness', () => {
    const judge = buildAdventurePlayerIdentityJudgePrompt(
      [{ id: 'I1' }, { id: 'I2' }, { id: 'I3' }],
      'a forest cartographer in a moss-green travel coat',
      combatKit,
    );

    expect(judge.system).toContain('SOURCE PHOTO is the canonical identity truth');
    expect(judge.system).toContain('Inventing or removing glasses, hats, hair');
    expect(judge.system).toContain('childlike');
    expect(judge.system).toContain('light, dark, and noisy floor art');
    expect(judge.system).toContain('carry the primary low and passive beside the hip or thigh');
    expect(judge.system).toContain('centered above the head');
    expect(judge.system).toContain('fatal pose and equipment error');
    expect(judge.system).toContain('canonically right-handed');
    expect(judge.system).toContain("anatomical RIGHT hand appears on the viewer's LEFT");
    expect(judge.system).toContain('never on the back, shoulder, or belt');
    expect(judge.system).toContain('hand swap or alternate stow location');
    expect(judge.user).toContain('CANONICAL GAME-WORLD WARDROBE');
    expect(
      buildAdventurePlayerIdentityJudgePrompt(
        [{ id: 'I1' }],
        'a forest cartographer in a moss-green travel coat',
        combatKit,
        'key-art',
      ).system,
    ).toContain('SOURCE KEY ART is the canonical identity truth');
    expect(judge.user).toContain('IMMUTABLE PRIMARY EQUIPMENT');
  });
});

describe('generated Adventure player processing', () => {
  it('keys and foot-anchors a mock Muse result to a high-density indexed PNG', async () => {
    const source = await mockGeneratedImage(
      buildAdventurePlayerIdentityPrompt('I1', { hasPhoto: false }),
    );
    const png = await processGeneratedAdventurePlayerPose(source);

    await expect(sharp(png).metadata()).resolves.toMatchObject({
      format: 'png',
      width: ADVENTURE_PLAYER_POSE_WIDTH,
      height: ADVENTURE_PLAYER_POSE_HEIGHT,
      isPalette: true,
    });
    const bottom = await sharp(png)
      .extract({
        left: 0,
        top: ADVENTURE_PLAYER_POSE_HEIGHT - 1,
        width: ADVENTURE_PLAYER_POSE_WIDTH,
        height: 1,
      })
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect(Array.from(bottom).some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
  });

  it('keeps wide equipment poses at the common hero height instead of applying platformer scale rejection', async () => {
    const widePose = await sharp({
      create: { width: 1024, height: 1024, channels: 4, background: '#00ff00' },
    })
      .composite([
        {
          input: await solid(260, 720, '#8b5e3c'),
          left: 382,
          top: 152,
        },
        {
          input: await solid(860, 30, '#8b5e3c'),
          left: 82,
          top: 470,
        },
      ])
      .png()
      .toBuffer();

    const png = await processGeneratedAdventurePlayerPose(widePose);
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const opaqueRows = new Set<number>();
    for (let pixel = 0; pixel < info.width * info.height; pixel++) {
      if (data[pixel * 4 + 3]! > 8) opaqueRows.add(Math.floor(pixel / info.width));
    }

    expect(info).toMatchObject({ width: 112, height: 128 });
    expect(opaqueRows.size).toBe(112);
  });

  it('rejects an opaque rectangular panel that would shrink the actual hero', async () => {
    const failedGreenScreen = await sharp({
      create: { width: 1024, height: 1024, channels: 4, background: '#00ff00' },
    })
      .composite([
        {
          input: await solid(720, 840, '#17232c'),
          left: 152,
          top: 92,
        },
      ])
      .png()
      .toBuffer();

    await expect(processGeneratedAdventurePlayerPose(failedGreenScreen)).rejects.toThrow(
      'opaque rectangular background panel',
    );
  });

  it('accepts a complete scale-consistent movement-and-combat pose set', async () => {
    const entries = await Promise.all(
      GENERATED_ADVENTURE_PLAYER_POSES.map(async (pose) => {
        const prompt =
          pose === 'downIdle'
            ? buildAdventurePlayerIdentityPrompt('I1', { hasPhoto: false })
            : buildAdventurePlayerPosePrompt(pose);
        return [pose, await processGeneratedAdventurePlayerPose(await mockGeneratedImage(prompt))];
      }),
    );
    const set = Object.fromEntries(entries) as Record<
      (typeof GENERATED_ADVENTURE_PLAYER_POSES)[number],
      Buffer
    >;

    await expect(validateGeneratedAdventurePlayerPoseSet(set)).resolves.toBeUndefined();
  });

  it('allows direction- and stride-specific silhouette widths at one character height', async () => {
    const widths = [78, 92, 72, 84, 38, 76, 94, 90, 100, 88, 86, 96] as const;
    const set = Object.fromEntries(
      await Promise.all(
        GENERATED_ADVENTURE_PLAYER_POSES.map(async (pose, index) => [
          pose,
          await footAnchoredPose(widths[index]!),
        ]),
      ),
    ) as Record<(typeof GENERATED_ADVENTURE_PLAYER_POSES)[number], Buffer>;

    await expect(validateGeneratedAdventurePlayerPoseSet(set)).resolves.toBeUndefined();
  });

  it('still rejects a pose that changes the character height', async () => {
    const entries = await Promise.all(
      GENERATED_ADVENTURE_PLAYER_POSES.map(async (pose, index) => [
        pose,
        await footAnchoredPose(64, index === 5 ? 92 : 116),
      ]),
    );
    const set = Object.fromEntries(entries) as Record<
      (typeof GENERATED_ADVENTURE_PLAYER_POSES)[number],
      Buffer
    >;

    await expect(validateGeneratedAdventurePlayerPoseSet(set)).rejects.toThrow(
      'poses change character height',
    );
  });

  it('builds one-image identity boards for Muse edits and story continuity', async () => {
    const keyArt = await solid(768, 1024, '#28334a');
    const photo = await solid(480, 640, '#b57b5d');
    const identityBoard = await buildAdventurePlayerIdentityReference(keyArt, photo);
    const sprite = await processGeneratedAdventurePlayerPose(
      await mockGeneratedImage(buildAdventurePlayerIdentityPrompt('I1', { hasPhoto: false })),
    );
    const storyBoard = await buildAdventureStoryIdentityReference(keyArt, sprite);
    const portraitBoard = await buildAdventurePortraitIdentityReference(photo, keyArt, sprite);

    await expect(sharp(identityBoard).metadata()).resolves.toMatchObject({
      width: 1024,
      height: 1024,
    });
    await expect(sharp(storyBoard).metadata()).resolves.toMatchObject({
      width: 1024,
      height: 1024,
    });
    await expect(sharp(portraitBoard).metadata()).resolves.toMatchObject({
      width: 1024,
      height: 1024,
    });
  });
});
