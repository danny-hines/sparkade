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
  const left = Math.floor((ADVENTURE_PLAYER_POSE_WIDTH - width) / 2);
  const top = ADVENTURE_PLAYER_POSE_HEIGHT - height;
  for (let y = top; y < ADVENTURE_PLAYER_POSE_HEIGHT; y++) {
    for (let x = left; x < left + width; x++) {
      const offset = (y * ADVENTURE_PLAYER_POSE_WIDTH + x) * 4;
      raw[offset] = 58;
      raw[offset + 1] = 86;
      raw[offset + 2] = 142;
      raw[offset + 3] = 255;
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

describe('generated Adventure player prompts', () => {
  it('separates neck-up photo identity from canonical game wardrobe', () => {
    const prompt = buildAdventurePlayerIdentityPrompt('I1', {
      hasPhoto: true,
      heroConcept: 'an observatory diver in a brass-trimmed navy pressure coat',
      colors: '#14253d, #bf8b45, #e8ddbb',
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
  });

  it('derives every other direction from the exact selected gameplay hero', () => {
    const up = buildAdventurePlayerPosePrompt('upIdle');
    const sideWalk = buildAdventurePlayerPosePrompt('sideWalk');

    expect(up).toContain(
      'immutable identity, wardrobe, proportion, pixel-technique, and scale truth',
    );
    expect(up).toContain('no face painted onto the back of the head');
    expect(sideWalk).toContain('RIGHT-facing top-down three-quarter walking contact frame');
    expect(sideWalk).toContain('Change only the requested facing and walking pose');
  });

  it('requires the identity judge to preserve hats, glasses, hair, and adult likeness', () => {
    const judge = buildAdventurePlayerIdentityJudgePrompt(
      [{ id: 'I1' }, { id: 'I2' }, { id: 'I3' }],
      'a forest cartographer in a moss-green travel coat',
    );

    expect(judge.system).toContain('SOURCE PHOTO is the only identity truth from the neck up');
    expect(judge.system).toContain('Inventing or removing glasses, hats, hair');
    expect(judge.system).toContain('childlike');
    expect(judge.system).toContain('light, dark, and noisy floor art');
    expect(judge.user).toContain('CANONICAL GAME-WORLD WARDROBE');
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

  it('accepts a complete scale-consistent six-pose set', async () => {
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
    const widths = [78, 92, 72, 84, 38, 76] as const;
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

  it('still rejects a direction that changes the character height', async () => {
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
      'directions change character height',
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

    await expect(sharp(identityBoard).metadata()).resolves.toMatchObject({
      width: 1024,
      height: 1024,
    });
    await expect(sharp(storyBoard).metadata()).resolves.toMatchObject({
      width: 1024,
      height: 1024,
    });
  });
});
