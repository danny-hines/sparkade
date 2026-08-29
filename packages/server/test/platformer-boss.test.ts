import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { mockGeneratedImage } from '../src/assets/game-art';
import {
  GENERATED_PLATFORMER_BOSS_HEIGHT,
  GENERATED_PLATFORMER_BOSS_WIDTH,
  bestPlatformerBossCandidateId,
  buildPlatformerBossCandidatePrompt,
  buildPlatformerBossJudgeBoard,
  buildPlatformerBossJudgePrompt,
  buildPlatformerBossJudgeSchema,
  normalizePlatformerBossJudgeDecision,
  processGeneratedPlatformerBoss,
} from '../src/assets/platformer-boss';

const PROMPT_OPTIONS = {
  bossName: 'The Brass Maw',
  bossIntro: 'A clockwork guardian blocks the moon gate.',
  colors: '#161320, #cf7642, #f6d6bd',
  candidateId: 'B1',
};

describe('generated platformer boss', () => {
  it('asks for one large story-faithful left-facing boss on green', () => {
    const prompt = buildPlatformerBossCandidatePrompt(PROMPT_OPTIONS);
    expect(prompt).toContain('MAIN BOSS');
    expect(prompt).toContain('immutable visual identity reference');
    expect(prompt).toContain('strict LEFT-facing side view');
    expect(prompt).toContain('native 192x192 high-density boss sprite canvas');
    expect(prompt).toContain('perfectly flat solid #00ff00');
    expect(prompt).toContain('No player hero');
  });

  it('keys, quantizes, and foot-anchors a boss candidate', async () => {
    const source = await mockGeneratedImage(buildPlatformerBossCandidatePrompt(PROMPT_OPTIONS));
    const result = await processGeneratedPlatformerBoss(source);
    await expect(sharp(result.png).metadata()).resolves.toMatchObject({
      format: 'png',
      width: GENERATED_PLATFORMER_BOSS_WIDTH,
      height: GENERATED_PLATFORMER_BOSS_HEIGHT,
      isPalette: true,
    });
    expect(result.metrics.outputBounds.width).toBeGreaterThanOrEqual(64);
    expect(result.metrics.outputBounds.height).toBeGreaterThanOrEqual(80);
    const bottom = await sharp(result.png)
      .extract({
        left: 0,
        top: GENERATED_PLATFORMER_BOSS_HEIGHT - 1,
        width: GENERATED_PLATFORMER_BOSS_WIDTH,
        height: 1,
      })
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect(Array.from(bottom).some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
  });

  it('builds a review board and always resolves to one locally valid candidate', async () => {
    const descriptors = [{ id: 'B1' }, { id: 'B2' }, { id: 'B3' }];
    const processed = await Promise.all(
      descriptors.map(async ({ id }) => {
        const prompt = buildPlatformerBossCandidatePrompt({ ...PROMPT_OPTIONS, candidateId: id });
        return (await processGeneratedPlatformerBoss(await mockGeneratedImage(prompt))).png;
      }),
    );
    const storyBoss = await sharp({
      create: { width: 420, height: 180, channels: 3, background: '#6f3d4a' },
    })
      .png()
      .toBuffer();
    const board = await buildPlatformerBossJudgeBoard({
      storyBoss,
      candidates: descriptors.map(({ id }, index) => ({ id, processed: processed[index]! })),
    });
    await expect(sharp(board).metadata()).resolves.toMatchObject({
      format: 'jpeg',
      width: 1320,
      height: 760,
    });
    expect(buildPlatformerBossJudgePrompt(descriptors).system).toContain(
      'MUST select the strongest available candidate',
    );
    expect(buildPlatformerBossJudgeSchema(descriptors)).toMatchObject({
      properties: { selection: { properties: { candidateId: { enum: ['B1', 'B2', 'B3'] } } } },
    });

    const decision = normalizePlatformerBossJudgeDecision(
      {
        candidateReviews: descriptors.map(({ id }, index) => ({
          id,
          scores: {
            villainMatch: index === 1 ? 5 : 3,
            silhouette: index === 1 ? 5 : 3,
            pose: 4,
            technical: 4,
            gameplayReadability: index === 1 ? 5 : 3,
          },
          issues: [],
          summary: `${id} reviewed`,
        })),
        selection: { candidateId: 'not-valid', confidence: 0.8, rationale: 'bad id' },
      },
      descriptors,
    );
    expect(bestPlatformerBossCandidateId(decision)).toBe('B2');
    expect(decision.selection.candidateId).toBe('B2');
  });
});
