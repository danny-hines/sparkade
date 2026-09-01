import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_ADVENTURE_ENEMIES,
  GENERATED_ADVENTURE_ENEMY_ATLAS_WIDTH,
  GENERATED_ADVENTURE_ENEMY_SIZE,
  bestAdventureEnemyCandidateId,
  buildAdventureEnemyBoardPrompt,
  buildAdventureEnemyJudgeBoard,
  buildAdventureEnemyJudgePrompt,
  buildAdventureEnemyJudgeSchema,
  buildGeneratedAdventureEnemyAtlas,
  normalizeAdventureEnemyJudgeDecision,
  splitGeneratedAdventureEnemyBoard,
  type GeneratedAdventureEnemy,
} from '../src/assets/adventure-enemy';
import { mockGeneratedImage } from '../src/assets/game-art';

const CONCEPTS: Record<GeneratedAdventureEnemy, string> = {
  walker: 'a barnacled clockwork crab',
  flyer: 'a brass manta drone',
  shooter: 'a coral cannon automaton',
  chaser: 'a needlefish pursuit machine',
  bruiser: 'a massive diving-bell guardian',
};

const OPTIONS = {
  gameTitle: 'The Drowned Observatory',
  tagline: 'Relight the stars below the tide',
  concepts: CONCEPTS,
  colors: '#10182c, #47c9bd, #d4a85f',
};

describe('generated Adventure enemy cast', () => {
  it('requests two behavior-readable candidates per role in one fixed board', () => {
    const prompt = buildAdventureEnemyBoardPrompt(OPTIONS);
    expect(prompt).toContain('exactly one square 4-column by 3-row board');
    expect(prompt).toContain('first TEN cells');
    expect(prompt).toContain('walker-1');
    expect(prompt).toContain('bruiser-2');
    expect(prompt).toContain('Cells 11 and 12 must remain completely empty');
    expect(prompt).toContain('top-down three-quarter camera');
    expect(prompt).toContain('SHOOTER ALONE must face RIGHT');
    expect(prompt).toContain('rightmost leading edge');
    expect(prompt).toContain('perfectly flat solid #00ff00');
  });

  it('segments ten candidates and packs one selected sprite per role atomically', async () => {
    const source = await mockGeneratedImage(buildAdventureEnemyBoardPrompt(OPTIONS));
    const split = await splitGeneratedAdventureEnemyBoard(source);
    expect(split.failures).toEqual([]);
    expect(split.candidates).toHaveLength(10);
    expect(split.candidates.map(({ id }) => id)).toEqual(
      GENERATED_ADVENTURE_ENEMIES.flatMap((role) => [`${role}-1`, `${role}-2`]),
    );
    const selected = Object.fromEntries(
      GENERATED_ADVENTURE_ENEMIES.map((role) => [
        role,
        split.candidates.find((candidate) => candidate.role === role)!.png,
      ]),
    ) as Record<GeneratedAdventureEnemy, Buffer>;
    const atlas = await buildGeneratedAdventureEnemyAtlas(selected);
    await expect(sharp(atlas).metadata()).resolves.toMatchObject({
      format: 'png',
      width: GENERATED_ADVENTURE_ENEMY_ATLAS_WIDTH,
      height: GENERATED_ADVENTURE_ENEMY_SIZE,
      isPalette: true,
    });
  });

  it('builds a mixed-floor cast review and repairs invalid cross-role selections', async () => {
    const source = await mockGeneratedImage(buildAdventureEnemyBoardPrompt(OPTIONS));
    const candidates = (await splitGeneratedAdventureEnemyBoard(source)).candidates;
    const descriptors = candidates.map(({ id, role }) => ({ id, role }));
    const keyArt = await sharp({
      create: { width: 480, height: 270, channels: 3, background: '#19314a' },
    })
      .png()
      .toBuffer();
    const board = await buildAdventureEnemyJudgeBoard({ keyArt, candidates });
    await expect(sharp(board).metadata()).resolves.toMatchObject({
      format: 'jpeg',
      width: 1320,
      height: 1165,
    });
    expect(buildAdventureEnemyJudgePrompt(descriptors, CONCEPTS).system).toContain(
      'Optimize the five selections as a combination',
    );
    expect(buildAdventureEnemyJudgePrompt(descriptors, CONCEPTS).system).toContain(
      'shooter must visibly face RIGHT',
    );
    expect(buildAdventureEnemyJudgeSchema(descriptors)).toMatchObject({
      properties: { selections: { minItems: 5, maxItems: 5 } },
    });

    const decision = normalizeAdventureEnemyJudgeDecision(
      {
        candidateReviews: descriptors.map(({ id, role }) => ({
          id,
          role,
          scores: {
            conceptMatch: id.endsWith('-2') ? 5 : 3,
            castCohesion: 4,
            silhouette: 4,
            roleReadability: id.endsWith('-2') ? 5 : 3,
            technical: 4,
          },
          issues: [],
          summary: `${id} reviewed`,
        })),
        selections: GENERATED_ADVENTURE_ENEMIES.map((role) => ({
          role,
          candidateId: role === 'walker' ? 'flyer-1' : 'not-a-candidate',
          confidence: 0.4,
          rationale: 'invalid selection for normalization coverage',
        })),
        castSummary: 'reviewed',
      },
      descriptors,
    );
    for (const role of GENERATED_ADVENTURE_ENEMIES) {
      expect(bestAdventureEnemyCandidateId(role, decision)).toBe(`${role}-2`);
      expect(decision.selections.find((selection) => selection.role === role)?.candidateId).toBe(
        `${role}-2`,
      );
    }
  });
});
