import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  adventurePlayerPosesNeedingRetry,
  bestAdventurePlayerCandidateIds,
  buildAdventurePlayerSetJudgeBoard,
  buildAdventurePlayerSetJudgePrompt,
  buildAdventurePlayerSetJudgeSchema,
  normalizeAdventurePlayerSetJudgeDecision,
  type AdventurePlayerCandidateDescriptor,
  type AdventurePlayerSetJudgeDecision,
} from '../src/assets/adventure-player-judge';
import { GENERATED_ADVENTURE_PLAYER_POSES } from '../src/assets/adventure-player';

const candidates: AdventurePlayerCandidateDescriptor[] = [];
for (const pose of GENERATED_ADVENTURE_PLAYER_POSES) {
  candidates.push({ id: pose === 'downIdle' ? 'downIdle-anchor' : `${pose}-A`, pose });
  if (pose !== 'downIdle') candidates.push({ id: `${pose}-B`, pose });
}

function acceptedDecision(): AdventurePlayerSetJudgeDecision {
  return {
    candidateReviews: candidates.map(({ id, pose }) => ({
      id,
      pose,
      scores: {
        identity: 5,
        accessories: 5,
        costume: 5,
        orientation: 5,
        motion: 5,
        technical: 5,
      },
      fatalIssues: [],
      summary: 'Strong candidate.',
    })),
    selections: GENERATED_ADVENTURE_PLAYER_POSES.map((pose) => ({
      pose,
      candidateId: pose === 'downIdle' ? 'downIdle-anchor' : `${pose}-B`,
      rationale: 'Best match.',
    })),
    setReview: {
      accepted: true,
      identityConsistency: 5,
      accessoryConsistency: 5,
      costumeConsistency: 5,
      directionReadability: 5,
      motionReadability: 5,
      scaleConsistency: 5,
      fatalIssues: [],
      summary: 'Coherent set.',
    },
    retryPoses: [],
  };
}

describe('Adventure player set judge', () => {
  it('defines identity, rear-view, accessory, and motion requirements', () => {
    const prompt = buildAdventurePlayerSetJudgePrompt(candidates, 'a brass-trimmed navy coat');
    const schema = buildAdventurePlayerSetJudgeSchema(candidates);

    expect(prompt.system).toContain('SELECTED DOWN-IDLE ANCHOR is immutable truth');
    expect(prompt.system).toContain('Inventing, removing, or replacing any of these is fatal');
    expect(prompt.system).toContain('absolutely no face on the back of the head');
    expect(prompt.system).toContain('Idle and walk must differ visibly');
    expect(prompt.user).toContain('CANONICAL GAME-WORLD WARDROBE');
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it('normalizes one valid selection per pose and preserves the best combination', () => {
    const decision = normalizeAdventurePlayerSetJudgeDecision(acceptedDecision(), candidates);

    expect(decision.setReview.accepted).toBe(true);
    expect(bestAdventurePlayerCandidateIds(decision)).toMatchObject({
      downIdle: 'downIdle-anchor',
      upIdle: 'upIdle-B',
      sideWalk: 'sideWalk-B',
    });
    expect(adventurePlayerPosesNeedingRetry(decision)).toEqual([]);
  });

  it('rejects a nominally accepted set with a missing or weak pose and targets it', () => {
    const raw = acceptedDecision();
    raw.candidateReviews.find(({ id }) => id === 'upIdle-B')!.scores.orientation = 2;
    raw.candidateReviews.find(({ id }) => id === 'upIdle-B')!.fatalIssues = [
      'Face painted onto rear view',
    ];
    raw.retryPoses = [
      { pose: 'upIdle' as const, guidance: 'Show a true back view with no rear face.' },
    ];
    raw.setReview.accepted = false;
    raw.setReview.fatalIssues = ['Rear direction failed'];
    const decision = normalizeAdventurePlayerSetJudgeDecision(raw, candidates);

    expect(decision.setReview.accepted).toBe(false);
    expect(adventurePlayerPosesNeedingRetry(decision)).toContainEqual({
      pose: 'upIdle',
      guidance: 'Show a true back view with no rear face.',
    });
  });

  it('builds a readable set-review board from the anchor and candidate pool', async () => {
    const sprite = await sharp({
      create: { width: 112, height: 128, channels: 4, background: '#31598c' },
    })
      .png()
      .toBuffer();
    const board = await buildAdventurePlayerSetJudgeBoard({
      anchor: sprite,
      candidates: candidates.map((candidate) => ({ ...candidate, processed: sprite })),
    });

    await expect(sharp(board).metadata()).resolves.toMatchObject({
      width: 1280,
      format: 'jpeg',
    });
  });
});
