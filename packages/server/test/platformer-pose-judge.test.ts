import { describe, expect, it } from 'vitest';
import {
  bestPlatformerPosePair,
  buildPlatformerPhaseACandidatePrompt,
  buildPlatformerPhaseBCandidatePrompt,
  buildPlatformerJumpCandidatePrompt,
  buildPlatformerPoseJudgePrompt,
  buildPlatformerSideAnchorPrompt,
  normalizePlatformerPoseJudgeDecision,
  type PlatformerPoseCandidateReview,
  type PlatformerPoseCandidateDescriptor,
  type PlatformerPosePairReview,
} from '../src/assets/platformer-pose-judge';

const candidates: PlatformerPoseCandidateDescriptor[] = [
  { id: 'A1', kind: 'phase-a' },
  { id: 'A2', kind: 'phase-a' },
  { id: 'B1', kind: 'phase-b' },
  { id: 'B2', kind: 'phase-b' },
];

function candidateReviews(): PlatformerPoseCandidateReview[] {
  return candidates.map(({ id, kind }) => ({
    id,
    kind,
    scores: { identity: 5, costume: 5, pose: 5, technical: 5 },
    fatalIssues: [],
    summary: 'usable',
  }));
}

function pairReviews(): PlatformerPosePairReview[] {
  return candidates
    .filter(({ kind }) => kind === 'phase-a')
    .flatMap(({ id: phaseAId }) =>
      candidates
        .filter(({ kind }) => kind === 'phase-b')
        .map(({ id: phaseBId }) => ({
          phaseAId,
          phaseBId,
          legAlternation: 5,
          armAlternation: 4,
          pairConsistency: 5,
          fatalIssues: [],
          summary: 'visible stride alternation',
        })),
    );
}

describe('platformer pose lab prompts', () => {
  it('uses one neutral anchor and explicitly inverted limb assignments', () => {
    const anchor = buildPlatformerSideAnchorPrompt({ colors: '#123456' });
    const phaseA = buildPlatformerPhaseACandidatePrompt(2);
    const phaseB = buildPlatformerPhaseBCandidatePrompt(3);
    const jump = buildPlatformerJumpCandidatePrompt(2);

    expect(anchor).toContain('neutral standing pose');
    expect(anchor).toContain('not a running, walking, jumping');
    expect(anchor).toContain('#123456');
    expect(phaseA).toContain('candidate A2');
    expect(phaseA).toContain('CAMERA-SIDE (near) LEG');
    expect(phaseA).toContain('FAR-SIDE ARM must swing forward');
    expect(phaseB).toContain('candidate B3');
    expect(phaseB).toContain('FAR-SIDE LEG');
    expect(phaseB).toContain('CAMERA-SIDE ARM must swing forward');
    expect(phaseB).toContain('do not mirror');
    expect(jump).toContain('independent jump-pose variation labeled J2');
    for (const prompt of [anchor, phaseA, phaseB]) {
      expect(prompt).toContain('apparent adult age');
      expect(prompt).toContain('make them bald');
      expect(prompt).toContain('Keep both hands empty');
    }
  });

  it('asks Spark to judge identity and the pair jointly with a reject-all option', () => {
    const prompt = buildPlatformerPoseJudgePrompt(candidates);
    expect(prompt.system).toContain('SOURCE PHOTO is immutable identity truth from the neck up');
    expect(prompt.system).toContain('FRONT IDLE establishes the canonical game-world costume');
    expect(prompt.system).toContain('Becoming bald, childlike');
    expect(prompt.system).toContain('leg alternation is the non-negotiable gate');
    expect(prompt.system).toContain('Do not reject an individual candidate');
    expect(prompt.system).toContain('every labeled A+B comparison cell');
    expect(prompt.system).toContain('Select a pair only if');
    expect(prompt.user).toContain('A1=phase-a');
    expect(prompt.user).toContain('B2=phase-b');
    expect(prompt.user).toContain('every possible A+B pair');
  });
});

describe('platformer pose judge normalization', () => {
  it('accepts a complete high-scoring known pair', () => {
    const decision = normalizePlatformerPoseJudgeDecision(
      {
        anchorReview: {
          identity: 5,
          sideView: 4,
          costume: 5,
          fatalIssues: [],
          summary: 'same person',
        },
        candidateReviews: candidateReviews(),
        pairReviews: pairReviews(),
        selection: {
          accepted: true,
          phaseAId: 'A2',
          phaseBId: 'B1',
          confidence: 0.91,
          rationale: 'coherent pair',
          retryGuidance: '',
        },
      },
      candidates,
    );

    expect(decision.selection).toMatchObject({
      accepted: true,
      phaseAId: 'A2',
      phaseBId: 'B1',
      legAlternation: 5,
      armAlternation: 4,
      pairConsistency: 5,
    });
  });

  it('fails closed on identity drift, omitted reviews, or unknown selection ids', () => {
    const reviews = candidateReviews();
    reviews[2]!.scores.identity = 2;
    reviews[2]!.fatalIssues.push('The character became a bald child');
    reviews.pop();
    const decision = normalizePlatformerPoseJudgeDecision(
      {
        anchorReview: {},
        candidateReviews: reviews,
        pairReviews: pairReviews(),
        selection: {
          accepted: true,
          phaseAId: 'A999',
          phaseBId: 'B1',
          confidence: 3,
          rationale: 'bad selection',
          retryGuidance: 'preserve identity',
        },
      },
      candidates,
    );

    expect(decision.selection).toMatchObject({
      accepted: false,
      phaseAId: '',
      phaseBId: '',
      confidence: 1,
    });
    expect(decision.candidateReviews.find(({ id }) => id === 'B2')?.fatalIssues).toContain(
      'Judge omitted this candidate',
    );
  });

  it('uses the direct pair comparison instead of isolated limb-depth guesses', () => {
    const pairs = pairReviews();
    const selected = pairs.find(
      ({ phaseAId, phaseBId }) => phaseAId === 'A1' && phaseBId === 'B1',
    )!;
    selected.legAlternation = 2;
    selected.fatalIssues.push('No visible leg swap');
    const decision = normalizePlatformerPoseJudgeDecision(
      {
        anchorReview: {
          identity: 5,
          sideView: 5,
          costume: 5,
          fatalIssues: [],
          summary: 'same person',
        },
        candidateReviews: candidateReviews(),
        pairReviews: pairs,
        selection: {
          accepted: true,
          phaseAId: 'A1',
          phaseBId: 'B1',
          confidence: 0.99,
          rationale: 'incorrectly accepted',
          retryGuidance: '',
        },
      },
      candidates,
    );

    expect(decision.selection.accepted).toBe(false);
    expect(decision.selection.legAlternation).toBe(2);
    expect(
      decision.pairReviews.find(({ phaseAId, phaseBId }) => phaseAId === 'A1' && phaseBId === 'B1')
        ?.fatalIssues,
    ).toContain('No visible leg swap');
  });

  it('rejects an otherwise strong pair when the shared side identity anchor drifts', () => {
    const decision = normalizePlatformerPoseJudgeDecision(
      {
        anchorReview: {
          identity: 2,
          sideView: 5,
          costume: 5,
          fatalIssues: ['The side anchor became a different person'],
          summary: 'identity drift',
        },
        candidateReviews: candidateReviews(),
        pairReviews: pairReviews(),
        selection: {
          accepted: true,
          phaseAId: 'A1',
          phaseBId: 'B1',
          confidence: 0.9,
          rationale: 'pair alone looks strong',
          retryGuidance: 'restore the source identity',
        },
      },
      candidates,
    );

    expect(decision.selection.accepted).toBe(false);
    expect(decision.anchorReview.fatalIssues).toContain(
      'The side anchor became a different person',
    );
  });

  it('requires an explicit leg-alternation score of at least four', () => {
    const pairs = pairReviews();
    pairs.find(({ phaseAId, phaseBId }) => phaseAId === 'A1' && phaseBId === 'B1')!.legAlternation =
      3;
    const decision = normalizePlatformerPoseJudgeDecision(
      {
        anchorReview: {
          identity: 5,
          sideView: 5,
          costume: 5,
          fatalIssues: [],
          summary: 'same person',
        },
        candidateReviews: candidateReviews(),
        pairReviews: pairs,
        selection: {
          accepted: true,
          phaseAId: 'A1',
          phaseBId: 'B1',
          confidence: 0.99,
          rationale: 'legs do not read clearly enough',
          retryGuidance: 'increase leg separation',
        },
      },
      candidates,
    );

    expect(decision.selection).toMatchObject({
      accepted: false,
      phaseAId: '',
      phaseBId: '',
      legAlternation: 3,
    });
  });

  it('fails closed when the selected pair comparison was omitted', () => {
    const pairs = pairReviews().filter(
      ({ phaseAId, phaseBId }) => phaseAId !== 'A2' || phaseBId !== 'B2',
    );
    const decision = normalizePlatformerPoseJudgeDecision(
      {
        anchorReview: {
          identity: 5,
          sideView: 5,
          costume: 5,
          fatalIssues: [],
          summary: 'same person',
        },
        candidateReviews: candidateReviews(),
        pairReviews: pairs,
        selection: {
          accepted: true,
          phaseAId: 'A2',
          phaseBId: 'B2',
          confidence: 0.8,
          rationale: 'selected omitted pair',
          retryGuidance: '',
        },
      },
      candidates,
    );

    expect(decision.selection.accepted).toBe(false);
    expect(decision.selection.legAlternation).toBe(0);
    expect(decision.pairReviews).toHaveLength(4);
    expect(decision.pairReviews.at(-1)?.fatalIssues).toContain('Judge omitted this pair');
  });

  it('does not make arm alternation a hard gate', () => {
    const pairs = pairReviews();
    pairs.find(({ phaseAId, phaseBId }) => phaseAId === 'A1' && phaseBId === 'B2')!.armAlternation =
      1;
    const decision = normalizePlatformerPoseJudgeDecision(
      {
        anchorReview: {
          identity: 5,
          sideView: 5,
          costume: 5,
          fatalIssues: [],
          summary: 'same person',
        },
        candidateReviews: candidateReviews(),
        pairReviews: pairs,
        selection: {
          accepted: true,
          phaseAId: 'A1',
          phaseBId: 'B2',
          confidence: 0.78,
          rationale: 'legs alternate even though arms barely move',
          retryGuidance: '',
        },
      },
      candidates,
    );

    expect(decision.selection).toMatchObject({ accepted: true, armAlternation: 1 });
  });

  it('ranks the strongest reviewed pair when the strict gate rejects every pair', () => {
    const pairs = pairReviews();
    for (const pair of pairs) {
      pair.legAlternation = 1;
      pair.pairConsistency = 2;
    }
    const best = pairs.find(({ phaseAId, phaseBId }) => phaseAId === 'A2' && phaseBId === 'B2')!;
    best.legAlternation = 3;
    best.pairConsistency = 4;
    const decision = normalizePlatformerPoseJudgeDecision(
      {
        anchorReview: {
          identity: 5,
          sideView: 5,
          costume: 5,
          fatalIssues: [],
          summary: 'same person',
        },
        candidateReviews: candidateReviews(),
        pairReviews: pairs,
        selection: {
          accepted: false,
          phaseAId: '',
          phaseBId: '',
          confidence: 0.7,
          rationale: 'No pair cleared the premium threshold.',
          retryGuidance: 'Increase leg separation.',
        },
      },
      candidates,
    );

    expect(decision.selection.accepted).toBe(false);
    expect(bestPlatformerPosePair(decision)).toEqual({ phaseAId: 'A2', phaseBId: 'B2' });
  });
});
