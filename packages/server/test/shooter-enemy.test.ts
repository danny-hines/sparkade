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
  processGeneratedShooterEnemy,
  processShooterEnemyCandidate,
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

  it('gives a too-wide scout an actionable aspect constraint without relaxing validation', async () => {
    const prompt = buildShooterEnemyReplacementPrompt({
      ...OPTIONS,
      role: 'popcorn',
      correction: 'Candidate was 84x38',
    });
    expect(prompt).toContain('at least 1.05 times the TOTAL opaque width');
    expect(prompt).toContain('fold or sweep wings backward');
    const image = await sharp({
      create: { width: 96, height: 96, channels: 3, background: '#00ff00' },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 72, height: 32, channels: 3, background: '#302b46' },
          })
            .png()
            .toBuffer(),
          left: 12,
          top: 32,
        },
      ])
      .png()
      .toBuffer();
    await expect(processGeneratedShooterEnemy(image, 'popcorn')).rejects.toThrow(
      'at least 1.05 times total width',
    );
  });

  it('tells a too-thin scout to widen instead of lengthening it into a needle', async () => {
    const needle = await sharp({
      create: { width: 96, height: 96, channels: 3, background: '#00ff00' },
    })
      .composite([
        {
          input: await sharp({ create: { width: 12, height: 70, channels: 3, background: '#302b46' } })
            .png()
            .toBuffer(),
          left: 42,
          top: 13,
        },
      ])
      .png()
      .toBuffer();
    const { processed, issue } = await processShooterEnemyCandidate(needle, 'popcorn');
    // The processed sprite survives for a least-bad pick; only the rule reports a miss.
    expect(processed.png.length).toBeGreaterThan(0);
    expect(issue).toContain('too thin');
    expect(issue).toContain('widen');
    expect(issue).not.toContain('lengthen');
    await expect(processGeneratedShooterEnemy(needle, 'popcorn')).rejects.toThrow('too thin');
    expect(
      buildShooterEnemyReplacementPrompt({ ...OPTIONS, role: 'popcorn', correction: issue! }),
    ).toContain('never a thin needle');
  });

  it('keeps shape-only board misses as processed near-miss candidates', async () => {
    const board = await sharp(await mockGeneratedImage(buildShooterEnemyBoardPrompt(OPTIONS)))
      .resize(1024, 1024, { fit: 'cover' })
      .png()
      .toBuffer();
    const wide = await sharp({ create: { width: 200, height: 80, channels: 3, background: '#302b46' } })
      .png()
      .toBuffer();
    const cell = await sharp({ create: { width: 256, height: 341, channels: 3, background: '#00ff00' } })
      .composite([{ input: wide, left: 28, top: 130 }])
      .png()
      .toBuffer();
    const split = await splitGeneratedShooterEnemyBoard(
      await sharp(board).composite([{ input: cell, left: 0, top: 0 }]).png().toBuffer(),
    );
    expect(split.nearMisses.map(({ id }) => id)).toEqual([split.failures[0]!.id]);
    expect(split.nearMisses[0]).toMatchObject({ role: 'popcorn', issue: expect.stringContaining('1.05') });
    expect(split.candidates.some(({ id }) => id === split.nearMisses[0]!.id)).toBe(false);
  });

  it('accepts a readable laterally expressive weaver silhouette', async () => {
    const image = await sharp({
      create: { width: 96, height: 96, channels: 3, background: '#00ff00' },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg width="72" height="60" xmlns="http://www.w3.org/2000/svg"><path d="M0 30 L24 0 L36 14 L48 0 L72 30 L48 60 L36 46 L24 60 Z" fill="#302b46"/></svg>',
          ),
          left: 12,
          top: 18,
        },
      ])
      .png()
      .toBuffer();

    await expect(processGeneratedShooterEnemy(image, 'weaver')).resolves.toMatchObject({
      metrics: { outputBounds: { width: 84 } },
    });
  });
});
