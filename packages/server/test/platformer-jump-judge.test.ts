import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  bestPlatformerJumpCandidateId,
  buildPlatformerJumpJudgeBoard,
  buildPlatformerJumpJudgePrompt,
  buildPlatformerJumpJudgeSchema,
  normalizePlatformerJumpJudgeDecision,
  type PlatformerJumpCandidateDescriptor,
} from '../src/assets/platformer-jump-judge';

const candidates: PlatformerJumpCandidateDescriptor[] = [{ id: 'J1' }, { id: 'J2' }, { id: 'J3' }];

function reviews() {
  return candidates.map(({ id }) => ({
    id,
    scores: { identity: 5, costume: 5, pose: 5, technical: 5 },
    fatalIssues: [] as string[],
    summary: 'Same character and complete costume in a clear airborne pose.',
  }));
}

describe('platformer jump continuity judge', () => {
  it('makes the front-idle wardrobe and written costume immutable', () => {
    const prompt = buildPlatformerJumpJudgePrompt(candidates, {
      sourceKind: 'photo',
      heroConcept: 'patched olive field jacket, grey tee, cargo pants, and heavy boots',
    });
    expect(prompt.system).toContain('SOURCE PHOTO is immutable identity truth from the neck up');
    expect(prompt.system).toContain('FRONT IDLE establishes the canonical game-world costume');
    expect(prompt.system).toContain('patched olive field jacket');
    expect(prompt.system).toContain('may not remove or replace a jacket');
    expect(prompt.system).toContain('expose newly bare skin');
    expect(prompt.user).toContain('J1, J2, J3');
  });

  it('builds an exact structured review for every known candidate', () => {
    const schema = buildPlatformerJumpJudgeSchema(candidates) as {
      properties: {
        candidateReviews: { minItems: number; maxItems: number };
        selection: { properties: { candidateId: { enum: string[] } } };
      };
    };
    expect(schema.properties.candidateReviews).toMatchObject({ minItems: 3, maxItems: 3 });
    expect(schema.properties.selection.properties.candidateId.enum).toEqual(['', 'J1', 'J2', 'J3']);
  });

  it('accepts a complete identity- and costume-safe jump', () => {
    const decision = normalizePlatformerJumpJudgeDecision(
      {
        candidateReviews: reviews(),
        selection: {
          accepted: true,
          candidateId: 'J2',
          confidence: 0.94,
          rationale: 'Best continuity and jump silhouette.',
          retryGuidance: '',
        },
      },
      candidates,
    );
    expect(decision.selection).toMatchObject({
      accepted: true,
      candidateId: 'J2',
      confidence: 0.94,
    });
  });

  it('fails closed when the selected jump changes or removes the costume', () => {
    const candidateReviews = reviews();
    const drifted = candidateReviews.find(({ id }) => id === 'J1')!;
    drifted.scores.costume = 2;
    drifted.fatalIssues.push('The olive jacket and sleeves disappeared.');
    const decision = normalizePlatformerJumpJudgeDecision(
      {
        candidateReviews,
        selection: {
          accepted: true,
          candidateId: 'J1',
          confidence: 0.99,
          rationale: 'Incorrectly accepted.',
          retryGuidance: 'Restore the complete olive jacket and both sleeves.',
        },
      },
      candidates,
    );
    expect(decision.selection).toMatchObject({
      accepted: false,
      candidateId: '',
      retryGuidance: 'Restore the complete olive jacket and both sleeves.',
    });
  });

  it('uses identity and costume continuity to choose the best locally valid fallback', () => {
    const candidateReviews = reviews();
    candidateReviews[0]!.scores.costume = 1;
    candidateReviews[1]!.scores.costume = 3;
    candidateReviews[2]!.scores.identity = 4;
    const decision = normalizePlatformerJumpJudgeDecision(
      {
        candidateReviews,
        selection: {
          accepted: false,
          candidateId: '',
          confidence: 0.6,
          rationale: 'No candidate cleared every premium gate.',
          retryGuidance: 'Preserve the jacket while keeping both feet airborne.',
        },
      },
      candidates,
    );
    expect(bestPlatformerJumpCandidateId(decision)).toBe('J3');
  });

  it('renders anchors and six retry-pool candidates on one review board', async () => {
    const source = await sharp({
      create: { width: 256, height: 256, channels: 3, background: '#6a513b' },
    })
      .png()
      .toBuffer();
    const sprite = await sharp({
      create: { width: 112, height: 128, channels: 4, background: '#746a45ff' },
    })
      .png()
      .toBuffer();
    const board = await buildPlatformerJumpJudgeBoard({
      source,
      sourceKind: 'photo',
      idle: sprite,
      sideAnchor: sprite,
      candidates: [1, 2, 3, 4, 5, 6].map((number) => ({
        id: `J${number}`,
        processed: sprite,
      })),
    });
    await expect(sharp(board).metadata()).resolves.toMatchObject({
      format: 'jpeg',
      width: 1720,
      height: 1200,
    });
  });
});
