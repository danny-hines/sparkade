import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { mockGeneratedImage } from '../src/assets/game-art';
import {
  GENERATED_SHOOTER_ENEMIES,
  GENERATED_SHOOTER_ENEMY_SIZE,
  buildGeneratedShooterEnemyAtlas,
  buildShooterEnemyBoardPrompt,
  buildShooterEnemyJudgeBoard,
  buildShooterEnemyJudgePrompt,
  buildShooterEnemyReplacementPrompt,
  splitGeneratedShooterEnemyBoard,
  type GeneratedShooterEnemy,
} from '../src/assets/shooter-enemy';

const CONCEPTS: Record<GeneratedShooterEnemy, string> = {
  popcorn: 'a tiny thorn-seed scout',
  weaver: 'a slim brass moth with lateral steering petals',
  tank: 'a broad armored hive barge',
  turret: 'a hovering pollen cannon platform',
  kamikaze: 'a downward-pointing stinger drone',
};
const OPTIONS = {
  gameTitle: 'Void Petal',
  tagline: 'One seed against the swarm',
  concepts: CONCEPTS,
  colors: '#10182c, #47c9bd, #d4a85f',
};

describe('generated vertical-shooter enemy cast', () => {
  it('requests ten downward-facing candidates and a terrain-free turret', () => {
    const prompt = buildShooterEnemyBoardPrompt(OPTIONS);
    expect(prompt).toContain('first TEN cells');
    expect(prompt).toContain('strict TOP-DOWN overhead camera');
    expect(prompt).toContain('attack end pointing DOWN');
    expect(prompt).toContain('free-flying gun platform');
    expect(prompt).toContain('perfectly flat solid #00ff00');
  });

  it('segments the board, reviews it, and packs one atomic five-role atlas', async () => {
    const split = await splitGeneratedShooterEnemyBoard(
      await mockGeneratedImage(buildShooterEnemyBoardPrompt(OPTIONS)),
    );
    expect(split.failures).toEqual([]);
    expect(split.candidates).toHaveLength(10);
    const selected = Object.fromEntries(
      GENERATED_SHOOTER_ENEMIES.map((role) => [
        role,
        split.candidates.find((candidate) => candidate.role === role)!.png,
      ]),
    ) as Record<GeneratedShooterEnemy, Buffer>;
    await expect(
      sharp(await buildGeneratedShooterEnemyAtlas(selected)).metadata(),
    ).resolves.toMatchObject({
      width: GENERATED_SHOOTER_ENEMY_SIZE * 5,
      height: GENERATED_SHOOTER_ENEMY_SIZE,
    });
    const keyArt = await sharp({
      create: { width: 480, height: 270, channels: 3, background: '#19314a' },
    })
      .png()
      .toBuffer();
    await expect(
      sharp(await buildShooterEnemyJudgeBoard({ keyArt, candidates: split.candidates })).metadata(),
    ).resolves.toMatchObject({ format: 'jpeg', width: 1320, height: 1165 });
    expect(
      buildShooterEnemyJudgePrompt(
        split.candidates.map(({ id, role }) => ({ id, role })),
        CONCEPTS,
      ).system,
    ).toContain('coherent but deliberately distinct combination');
  });

  it('limits recovery to a role-specific corrective call', () => {
    const prompt = buildShooterEnemyReplacementPrompt({
      ...OPTIONS,
      role: 'turret',
      correction: 'Both board cells were cropped.',
    });
    expect(prompt).toContain('ROLE REPLACEMENT');
    expect(prompt).toContain('CORRECTION FROM LOCAL VALIDATION');
    expect(prompt).toContain('never a surface-mounted emplacement');
  });
});
