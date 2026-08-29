import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  buildPlatformerLevelHydrationJudgeBoard,
  buildPlatformerLevelHydrationJudgePrompt,
  normalizePlatformerLevelHydrationJudgeDecision,
  reviewPlatformerLevelHydrationGeometry,
} from '../src/assets/platformer-level-hydration-judge';
import type { PlatformerLevelHydrationResult } from '../src/assets/platformer-level-lab';

describe('platformer level hydration selection', () => {
  it('gates severe spill before Spark and scores compliant candidates higher', () => {
    const clean = reviewPlatformerLevelHydrationGeometry('H1', metrics());
    const spilled = reviewPlatformerLevelHydrationGeometry(
      'H2',
      metrics({
        paintOutsideVisualMaskRatio: 0.49,
        rejectedPaintRatio: 0.57,
        acceptedPaintRatio: 0.43,
      }),
    );

    expect(clean.viable).toBe(true);
    expect(spilled.viable).toBe(false);
    expect(spilled.reasons.join(' ')).toContain('generated paint was rejected');
    expect(clean.score).toBeGreaterThan(spilled.score);
  });

  it('builds a labeled review board and normalizes Spark selection', async () => {
    const descriptors = ['H1', 'H2', 'H3'].map((id, index) =>
      reviewPlatformerLevelHydrationGeometry(
        id,
        metrics({ rejectedPaintRatio: 0.12 + index * 0.03 }),
      ),
    );
    const guide = await image('#ffffff');
    const board = await buildPlatformerLevelHydrationJudgeBoard({
      guide,
      candidates: await Promise.all(
        descriptors.map(async (geometry, index) => ({
          id: geometry.id,
          geometry,
          safeTerrain: await image(index === 1 ? '#ae743d' : '#4f74a8'),
        })),
      ),
    });
    await expect(sharp(board).metadata()).resolves.toMatchObject({
      format: 'jpeg',
      width: 1200,
      height: 1086,
    });
    const prompt = buildPlatformerLevelHydrationJudgePrompt('clockwork rooftops', descriptors);
    expect(prompt.system).toContain('visual quality only');
    expect(prompt.user).toContain('H1: geometry');

    const decision = normalizePlatformerLevelHydrationJudgeDecision(
      {
        candidateReviews: descriptors.map(({ id }) => ({
          id,
          scores: {
            craftsmanship: id === 'H2' ? 5 : 4,
            materialRichness: 4,
            visualCohesion: 4,
            gameplayReadability: 4,
          },
          issues: [],
          summary: `${id} review`,
        })),
        selection: { candidateId: 'H2', confidence: 0.9, rationale: 'Best materials.' },
      },
      descriptors,
    );
    expect(decision.selection.candidateId).toBe('H2');
    expect(decision.candidateReviews).toHaveLength(3);
  });
});

function metrics(
  overrides: Partial<PlatformerLevelHydrationResult['metrics']> = {},
): PlatformerLevelHydrationResult['metrics'] {
  return {
    paintOutsideCollisionRatio: 0.16,
    paintOutsideVisualMaskRatio: 0.14,
    falsePositiveRatio: 0.16,
    missingTerrainRatio: 0.34,
    fringeUsageRatio: 0.4,
    rejectedPaintRatio: 0.32,
    acceptedPaintRatio: 0.68,
    collisionCoverageRatio: 0.66,
    surfaceAlignment: { runsDetected: 10, runsShifted: 3, meanShiftPx: 8 },
    exactCollisionMask: true,
    fringe: { topPx: 4, sidePx: 1, bottomPx: 2 },
    ...overrides,
  };
}

async function image(color: string): Promise<Buffer> {
  return sharp({
    create: { width: 1536, height: 288, channels: 4, background: color },
  })
    .png()
    .toBuffer();
}
