import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  bestPlayerCraftCandidateId,
  buildPlayerCraftJudgeBoard,
  normalizePlayerCraftJudgeDecision,
} from '../src/assets/player-craft-judge';

const descriptors = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];

describe('player craft judge', () => {
  it('builds one labeled candidate board', async () => {
    const png = await sharp({
      create: { width: 64, height: 96, channels: 4, background: '#7b55c7' },
    })
      .png()
      .toBuffer();
    const board = await buildPlayerCraftJudgeBoard({
      orientation: 'top-down',
      candidates: descriptors.map(({ id }) => ({ id, processed: png })),
    });
    expect(await sharp(board).metadata()).toMatchObject({ width: 900, height: 300 });
  });

  it('retains the strongest generated candidate when none meets the acceptance bar', () => {
    const decision = normalizePlayerCraftJudgeDecision(
      {
        candidateReviews: descriptors.map(({ id }, index) => ({
          id,
          concept: index + 2,
          orientation: index + 2,
          silhouette: index + 2,
          readability: index + 2,
          technical: index + 2,
          fatalIssues: [],
          summary: '',
        })),
        selection: {
          accepted: false,
          candidateId: 'A',
          rationale: 'Below ideal.',
          retryGuidance: 'Sharper silhouette.',
        },
      },
      descriptors,
    );
    expect(bestPlayerCraftCandidateId(decision)).toBe('C');
  });
});
