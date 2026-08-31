import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_HSHOOTER_BOSS_HEIGHT,
  GENERATED_HSHOOTER_BOSS_WIDTH,
  buildHShooterBossCandidatePrompt,
  buildHShooterBossJudgePrompt,
  processGeneratedHShooterBoss,
} from '../src/assets/hshooter-boss';

async function greenScreenSubject(width: number, height: number): Promise<Buffer> {
  const subject = await sharp({
    create: { width, height, channels: 4, background: '#53489a' },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: 512, height: 512, channels: 4, background: '#00ff00' },
  })
    .composite([{ input: subject, left: Math.round((512 - width) / 2), top: (512 - height) / 2 }])
    .png()
    .toBuffer();
}

describe('generated H-scroll boss', () => {
  it('authors a left-facing story-faithful boss without the player or runtime effects', () => {
    const prompt = buildHShooterBossCandidatePrompt({
      bossName: 'The Crown Leviathan',
      bossIntro: 'Its armored jaws seal the final trench.',
      colors: '#101522, #53489a, #f2aa3b',
      candidateId: 'B2',
    });

    expect(prompt).toContain('horizontal-shooter MAIN BOSS');
    expect(prompt).toContain('Crown Leviathan');
    expect(prompt).toContain('strict LEFT-facing side profile');
    expect(prompt).toContain('No player, pilot, player craft');
    expect(prompt).toContain('No player, pilot, player craft, minion, orbiting pod');
    expect(prompt).toContain('#00ff00');
  });

  it('adds corrective direction only for the bounded replacement pool', () => {
    const initial = buildHShooterBossCandidatePrompt({
      bossName: 'The Crown Leviathan',
      bossIntro: 'Its armored jaws seal the final trench.',
      colors: '#101522, #53489a, #f2aa3b',
      candidateId: 'B1',
    });
    const replacement = buildHShooterBossCandidatePrompt({
      bossName: 'The Crown Leviathan',
      bossIntro: 'Its armored jaws seal the final trench.',
      colors: '#101522, #53489a, #f2aa3b',
      candidateId: 'B4',
      retryGuidance: 'Return one complete broad left-facing boss.',
    });

    expect(initial).not.toContain('REPLACEMENT-POOL CORRECTION');
    expect(replacement).toContain(
      'REPLACEMENT-POOL CORRECTION: Return one complete broad left-facing boss.',
    );
  });

  it('keys and normalizes a broad candidate while rejecting tall silhouettes', async () => {
    const processed = await processGeneratedHShooterBoss(await greenScreenSubject(390, 180));
    expect(await sharp(processed.png).metadata()).toMatchObject({
      format: 'png',
      width: GENERATED_HSHOOTER_BOSS_WIDTH,
      height: GENERATED_HSHOOTER_BOSS_HEIGHT,
    });
    expect(processed.metrics.outputBounds.width).toBeGreaterThan(
      processed.metrics.outputBounds.height,
    );

    await expect(processGeneratedHShooterBoss(await greenScreenSubject(80, 350))).rejects.toThrow(
      /broad side-view silhouette/,
    );
  });

  it('reviews identity, orientation, and projectile-heavy readability', () => {
    const prompt = buildHShooterBossJudgePrompt(['B1', 'B2', 'B3']);
    expect(prompt.system.toLowerCase()).toContain('boss story art');
    expect(prompt.system).toContain('strict left-facing side profile');
    expect(prompt.system).toContain('projectile-heavy play');
    expect(prompt.user).toContain('B1, B2, B3');
  });
});
