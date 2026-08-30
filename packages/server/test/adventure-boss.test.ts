import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_ADVENTURE_BOSS_HEIGHT,
  GENERATED_ADVENTURE_BOSS_WIDTH,
  bestAdventureBossCandidateId,
  buildAdventureBossBoardPrompt,
  buildAdventureBossJudgeBoard,
  buildAdventureBossJudgePrompt,
  buildAdventureBossJudgeSchema,
  buildAdventureBossRetryPrompt,
  normalizeAdventureBossJudgeDecision,
  splitGeneratedAdventureBossBoard,
} from '../src/assets/adventure-boss';
import { mockGeneratedImage } from '../src/assets/game-art';

const OPTIONS = {
  bossName: 'The Glass Regent',
  bossIntro: 'The ancient ruler waits beneath the broken observatory.',
  colors: '#10182c, #5e4e9b, #e6c86d',
};

describe('generated Adventure boss', () => {
  it('asks for one fixed four-candidate story-faithful board', () => {
    const prompt = buildAdventureBossBoardPrompt(OPTIONS);
    expect(prompt).toContain('exactly one square 2x2 board');
    expect(prompt).toContain('B1, B2, B3, B4');
    expect(prompt).toContain('SAME MAIN BOSS');
    expect(prompt).toContain('top-down three-quarter camera');
    expect(prompt).toContain('facing toward the bottom edge');
    expect(prompt).toContain('High-density modern retro pixel art');
    expect(prompt).toContain('perfectly flat solid #00ff00');
    expect(prompt).toContain('No antialiasing, blur, smooth vector shapes, photorealism');
  });

  it('segments one Muse board into four exact palette-indexed boss sprites', async () => {
    const source = await mockGeneratedImage(buildAdventureBossBoardPrompt(OPTIONS));
    const result = await splitGeneratedAdventureBossBoard(source);
    expect(result.failures).toEqual([]);
    expect(result.candidates.map(({ id }) => id)).toEqual(['B1', 'B2', 'B3', 'B4']);
    for (const candidate of result.candidates) {
      await expect(sharp(candidate.png).metadata()).resolves.toMatchObject({
        format: 'png',
        width: GENERATED_ADVENTURE_BOSS_WIDTH,
        height: GENERATED_ADVENTURE_BOSS_HEIGHT,
        isPalette: true,
      });
      expect(candidate.metrics.outputBounds.width).toBeGreaterThanOrEqual(72);
      expect(candidate.metrics.outputBounds.height).toBeGreaterThanOrEqual(100);
    }
  });

  it('builds the mixed-floor review board and repairs an invalid judge selection', async () => {
    const source = await mockGeneratedImage(buildAdventureBossBoardPrompt(OPTIONS));
    const candidates = (await splitGeneratedAdventureBossBoard(source)).candidates;
    const descriptors = candidates.map(({ id }) => ({ id }));
    const storyBoss = await sharp({
      create: { width: 420, height: 180, channels: 3, background: '#5e4e9b' },
    })
      .png()
      .toBuffer();
    const board = await buildAdventureBossJudgeBoard({ storyBoss, candidates });
    await expect(sharp(board).metadata()).resolves.toMatchObject({
      format: 'jpeg',
      width: 1320,
      height: 740,
    });
    expect(buildAdventureBossJudgePrompt(descriptors).system).toContain(
      'light, dark, saturated, and noisy floors',
    );
    expect(buildAdventureBossJudgeSchema(descriptors)).toMatchObject({
      properties: {
        selection: { properties: { candidateId: { enum: ['B1', 'B2', 'B3', 'B4'] } } },
      },
    });

    const decision = normalizeAdventureBossJudgeDecision(
      {
        candidateReviews: descriptors.map(({ id }, index) => ({
          id,
          scores: {
            villainMatch: index === 2 ? 5 : 3,
            silhouette: index === 2 ? 5 : 3,
            camera: 4,
            technical: 4,
            gameplayReadability: index === 2 ? 5 : 3,
          },
          issues: [],
          summary: `${id} reviewed`,
        })),
        selection: { candidateId: 'invalid', confidence: 0.5, rationale: 'bad id' },
      },
      descriptors,
    );
    expect(bestAdventureBossCandidateId(decision)).toBe('B3');
    expect(decision.selection.candidateId).toBe('B3');
  });

  it('keeps the isolated retry bounded to one boss and includes processing feedback', () => {
    const prompt = buildAdventureBossRetryPrompt({
      ...OPTIONS,
      failures: [{ id: 'B1', reason: 'subject too small' }],
    });
    expect(prompt).toContain('exactly ONE isolated full-body gameplay sprite');
    expect(prompt).toContain('subject too small');
    expect(prompt).not.toContain('2x2');
  });
});
