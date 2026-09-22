import { describe, expect, it } from 'vitest';
import { compactArtReview } from '../src/assets/compact-art-review';
import { buildPlatformerPoseJudgeSchema } from '../src/assets/platformer-pose-judge';
import {
  buildPlatformerJumpJudgeSchema,
  normalizePlatformerJumpJudgeDecision,
} from '../src/assets/platformer-jump-judge';

const candidates = [
  { id: 'A1', kind: 'phase-a' as const },
  { id: 'B1', kind: 'phase-b' as const },
];
describe('compact art review contract', () => {
  it('removes only redundant prose, retaining every required score, candidate and pair', () => {
    const schema = buildPlatformerPoseJudgeSchema(candidates);
    const original = structuredClone(schema);
    const compact = compactArtReview({
      system: 'Judge all visible defects.',
      user: 'Review board',
      jsonSchema: schema,
    });
    const expected = JSON.parse(
      JSON.stringify(schema, (key, value) => {
        if (key === 'summary' || key === 'rationale') return undefined;
        if (key === 'required')
          return value.filter((name: string) => name !== 'summary' && name !== 'rationale');
        return value;
      }),
    );
    expect(compact.jsonSchema).toEqual(expected);
    expect(schema).toEqual(original);
    expect(compact.system).toContain('Judge all visible defects.');
    expect(compact.system).toContain('failure checks');
    expect(compact.user).toBe('Review board');
  });

  it('accepts compact scores but still rejects missing scores, omitted candidates and unknown IDs', () => {
    const raw = {
      candidateReviews: [
        { id: 'J1', scores: { identity: 5, costume: 5, pose: 5, technical: 5 }, fatalIssues: [] },
      ],
      selection: { accepted: true, candidateId: 'J1', confidence: 0.95, retryGuidance: '' },
    };
    expect(normalizePlatformerJumpJudgeDecision(raw, [{ id: 'J1' }]).selection.accepted).toBe(true);
    const noScores = { ...raw, candidateReviews: [{ id: 'J1', fatalIssues: [] }] };
    expect(normalizePlatformerJumpJudgeDecision(noScores, [{ id: 'J1' }]).selection.accepted).toBe(
      false,
    );
    expect(
      normalizePlatformerJumpJudgeDecision({ ...raw, candidateReviews: [] }, [{ id: 'J1' }])
        .selection.accepted,
    ).toBe(false);
    expect(normalizePlatformerJumpJudgeDecision(raw, [{ id: 'J2' }]).selection.accepted).toBe(
      false,
    );
    const compact = compactArtReview({
      system: '',
      user: '',
      jsonSchema: buildPlatformerJumpJudgeSchema([{ id: 'J1' }]),
    });
    expect(JSON.stringify(compact.jsonSchema)).toContain('fatalIssues');
    expect(JSON.stringify(compact.jsonSchema)).toContain('retryGuidance');
  });
});
