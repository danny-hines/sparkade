import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_SHOOTER_BOSS_HEIGHT,
  GENERATED_SHOOTER_BOSS_WIDTH,
  buildShooterBossCandidatePrompt,
  buildShooterBossJudgePrompt,
  processGeneratedShooterBoss,
} from '../src/assets/shooter-boss';

async function greenScreenSubject(width: number, height: number): Promise<Buffer> {
  const subject = await sharp({
    create: { width, height, channels: 4, background: '#53489a' },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: 512, height: 512, channels: 4, background: '#00ff00' },
  })
    .composite([{ input: subject, left: (512 - width) / 2, top: (512 - height) / 2 }])
    .png()
    .toBuffer();
}

describe('generated vertical-shooter boss', () => {
  it('authors a story-faithful top-down opponent with one corrective pool contract', () => {
    const prompt = buildShooterBossCandidatePrompt({
      bossName: 'Baron Thornwake',
      bossIntro: 'The stolen sapling burns inside his armored hive.',
      colors: '#101522, #53489a, #f2aa3b',
      candidateId: 'B4',
      retryGuidance: 'Return one complete top-down downward-facing silhouette',
    });
    expect(prompt).toContain('vertical-shooter MAIN BOSS');
    expect(prompt).toContain('strict TOP-DOWN overhead camera');
    expect(prompt).toContain('pointing DOWN');
    expect(prompt).toContain('No player, pilot, player craft');
    expect(prompt).toContain('REPLACEMENT-POOL CORRECTION');
  });

  it('normalizes tall silhouettes and rejects broad side-view shapes', async () => {
    const processed = await processGeneratedShooterBoss(await greenScreenSubject(180, 390));
    await expect(sharp(processed.png).metadata()).resolves.toMatchObject({
      width: GENERATED_SHOOTER_BOSS_WIDTH,
      height: GENERATED_SHOOTER_BOSS_HEIGHT,
    });
    await expect(processGeneratedShooterBoss(await greenScreenSubject(350, 80))).rejects.toThrow(
      /tall top-down silhouette/,
    );
  });

  it('reviews identity, downward orientation, and projectile readability', () => {
    const prompt = buildShooterBossJudgePrompt(['B1', 'B2', 'B3']);
    expect(prompt.system).toContain('TOP-DOWN');
    expect(prompt.system).toContain('DOWNWARD');
    expect(prompt.system).toContain('projectile-heavy');
  });
});
