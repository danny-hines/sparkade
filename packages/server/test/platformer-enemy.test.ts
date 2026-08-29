import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { mockGeneratedImage } from '../src/assets/game-art';
import {
  buildPlatformerEnemyCandidatePrompt,
  buildPlatformerEnemyJudgeBoard,
  buildPlatformerEnemyJudgeSchema,
  normalizePlatformerEnemyJudgeDecision,
  processGeneratedPlatformerEnemy,
  type PlatformerEnemyCandidateDescriptor,
} from '../src/assets/platformer-enemy';

const candidates: PlatformerEnemyCandidateDescriptor[] = [
  { id: 'W1', role: 'walker', concept: 'A clockwork beetle patrol' },
  { id: 'W2', role: 'walker', concept: 'A clockwork beetle patrol' },
  { id: 'F1', role: 'flyer', concept: 'A paper-wing moth scout' },
  { id: 'F2', role: 'flyer', concept: 'A paper-wing moth scout' },
];

describe('generated platformer enemy art', () => {
  it('authors one role-readable sprite against a strict green-screen contract', () => {
    const prompt = buildPlatformerEnemyCandidatePrompt({
      gameTitle: 'Clockwork Canopy',
      tagline: 'Wind the forest back to life',
      role: 'shooter',
      concept: 'A brass acorn turret',
      colors: '#181425, #ffcd75, #d04648',
      candidateId: 'S2',
    });

    expect(prompt).toContain('Behavior role: shooter');
    expect(prompt).toContain('brass acorn turret');
    expect(prompt).toContain('integrated muzzle');
    expect(prompt).toContain('faces strictly toward the LEFT');
    expect(prompt).toContain('#00ff00');
    expect(prompt).toContain('Do not copy the player hero');
  });

  it('keys, density-normalizes, and ground-aligns generated enemies', async () => {
    const prompt = buildPlatformerEnemyCandidatePrompt({
      gameTitle: 'Clockwork Canopy',
      tagline: 'Wind the forest back to life',
      role: 'walker',
      concept: 'A clockwork beetle patrol',
      colors: '#181425, #ffcd75, #d04648',
      candidateId: 'W1',
    });
    const processed = await processGeneratedPlatformerEnemy(
      await mockGeneratedImage(prompt),
      'walker',
    );
    const metadata = await sharp(processed.png).metadata();

    expect(metadata.width).toBe(96);
    expect(metadata.height).toBe(96);
    expect(metadata.hasAlpha).toBe(true);
    expect(processed.metrics.outputBounds.height).toBeGreaterThanOrEqual(42);
    expect(processed.metrics.outputBounds.top + processed.metrics.outputBounds.height).toBe(96);
  });

  it('normalizes malformed review output and never selects across behavior roles', () => {
    const decision = normalizePlatformerEnemyJudgeDecision(
      {
        candidateReviews: [
          {
            id: 'W1',
            role: 'flyer',
            scores: {
              conceptMatch: 1,
              worldStyle: 1,
              silhouette: 1,
              roleReadability: 1,
              technical: 1,
            },
            issues: [],
            summary: 'Weak walker.',
          },
          {
            id: 'W2',
            role: 'walker',
            scores: {
              conceptMatch: 5,
              worldStyle: 5,
              silhouette: 5,
              roleReadability: 5,
              technical: 5,
            },
            issues: [],
            summary: 'Strong walker.',
          },
        ],
        selections: [
          { role: 'walker', candidateId: 'F2', confidence: 4, rationale: 'Wrong row.' },
          { role: 'flyer', candidateId: 'F2', confidence: 0.8, rationale: 'Best flyer.' },
        ],
      },
      candidates,
    );

    expect(decision.selections).toEqual([
      expect.objectContaining({ role: 'walker', candidateId: 'W2', confidence: 1 }),
      expect.objectContaining({ role: 'flyer', candidateId: 'F2', confidence: 0.8 }),
    ]);
    expect(decision.candidateReviews.find(({ id }) => id === 'W1')?.role).toBe('walker');
    expect(buildPlatformerEnemyJudgeSchema(candidates)).toMatchObject({
      title: 'Platformer enemy sprite cast selection',
    });
  });

  it('builds one labeled review board for all represented roles', async () => {
    const keyArt = await sharp({
      create: { width: 480, height: 270, channels: 3, background: '#304050' },
    })
      .png()
      .toBuffer();
    const processed = await sharp({
      create: { width: 96, height: 96, channels: 4, background: '#d09040' },
    })
      .png()
      .toBuffer();
    const board = await buildPlatformerEnemyJudgeBoard({
      keyArt,
      candidates: candidates.map((candidate) => ({ ...candidate, processed })),
    });
    const metadata = await sharp(board).metadata();

    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(975);
    expect(metadata.format).toBe('jpeg');
  });
});
