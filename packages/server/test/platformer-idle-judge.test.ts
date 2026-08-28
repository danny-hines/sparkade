import { describe, expect, it } from 'vitest';
import {
  bestPlatformerIdleCandidateId,
  buildPlatformerIdleCandidatePrompt,
  buildPlatformerIdleJudgePrompt,
  normalizePlatformerIdleJudgeDecision,
  type PlatformerIdleCandidateDescriptor,
} from '../src/assets/platformer-idle-judge';

const candidates: PlatformerIdleCandidateDescriptor[] = [{ id: 'I1' }, { id: 'I2' }, { id: 'I3' }];

function completeDecision() {
  return {
    sourceReview: {
      eyewear: 'absent',
      summary: 'Adult source without glasses.',
    },
    candidateReviews: candidates.map(({ id }) => ({
      id,
      eyewear: 'absent',
      eyewearMatch: true,
      scores: {
        identity: 5,
        faceAndHair: 5,
        accessories: 5,
        costume: 5,
        proportions: 5,
        pose: 5,
        technical: 5,
      },
      fatalIssues: [] as string[],
      summary: `${id} preserves the source identity.`,
    })),
    selection: {
      accepted: true,
      candidateId: 'I2',
      confidence: 0.93,
      rationale: 'I2 is the safest identity seed.',
      retryGuidance: '',
    },
  };
}

describe('platformer idle foundation prompts', () => {
  it('makes eye artifacts and high-resolution seed quality explicit gates', () => {
    const imagePrompt = buildPlatformerIdleCandidatePrompt('I2', {
      heroConcept: 'navy jacket and tan pants',
      retryGuidance: 'remove dark eye artifacts',
    });
    const judgePrompt = buildPlatformerIdleJudgePrompt(candidates);

    expect(imagePrompt).toContain('independent identity-foundation variation labeled I2');
    expect(imagePrompt).toContain('not glasses');
    expect(imagePrompt).toContain('RETRY CORRECTION FROM THE ART DIRECTOR');
    expect(judgePrompt.system).toContain('SOURCE PHOTO is the only identity truth');
    expect(judgePrompt.system).toContain(
      'high-resolution image that will seed every downstream edit',
    );
    expect(judgePrompt.system).toContain('wrinkles');
    expect(judgePrompt.system).toContain('eyewearMatch=true');
  });
});

describe('platformer idle foundation judge normalization', () => {
  it('accepts a complete high-scoring known candidate', () => {
    expect(normalizePlatformerIdleJudgeDecision(completeDecision(), candidates).selection).toEqual({
      accepted: true,
      candidateId: 'I2',
      confidence: 0.93,
      rationale: 'I2 is the safest identity seed.',
      retryGuidance: '',
    });
  });

  it('fails closed when eyewear conflicts with the source', () => {
    const decision = completeDecision();
    const selected = decision.candidateReviews.find(({ id }) => id === 'I2')!;
    selected.eyewear = 'present';
    selected.eyewearMatch = true;

    const normalized = normalizePlatformerIdleJudgeDecision(decision, candidates);
    expect(normalized.selection).toMatchObject({ accepted: false, candidateId: '' });
  });

  it('fails closed on an omitted review, low score, fatal issue, or unknown id', () => {
    const decision = completeDecision();
    decision.candidateReviews.pop();
    decision.candidateReviews[1]!.scores.faceAndHair = 3;
    decision.candidateReviews[1]!.fatalIssues.push('invented dark frames around both eyes');
    decision.selection.candidateId = 'I999';

    const normalized = normalizePlatformerIdleJudgeDecision(decision, candidates);
    expect(normalized.selection).toMatchObject({ accepted: false, candidateId: '' });
    expect(normalized.candidateReviews.find(({ id }) => id === 'I3')?.fatalIssues).toContain(
      'Judge omitted this candidate',
    );
  });

  it('still ranks the best locally valid candidate when the strict gate rejects the batch', () => {
    const decision = completeDecision();
    decision.selection.accepted = false;
    decision.selection.candidateId = '';
    decision.candidateReviews[0]!.scores.identity = 2;
    decision.candidateReviews[1]!.scores.identity = 3;

    const normalized = normalizePlatformerIdleJudgeDecision(decision, candidates);
    expect(normalized.selection.accepted).toBe(false);
    expect(bestPlatformerIdleCandidateId(normalized)).toBe('I3');
  });
});
