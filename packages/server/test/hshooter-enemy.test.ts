import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_HSHOOTER_ENEMIES,
  GENERATED_HSHOOTER_ENEMY_ATLAS_WIDTH,
  GENERATED_HSHOOTER_ENEMY_SIZE,
  bestHShooterEnemyCandidateId,
  buildGeneratedHShooterEnemyAtlas,
  buildHShooterEnemyBoardPrompt,
  buildHShooterEnemyJudgeBoard,
  buildHShooterEnemyJudgePrompt,
  buildHShooterEnemyJudgeSchema,
  buildHShooterEnemyReplacementPrompt,
  normalizeHShooterEnemyJudgeDecision,
  splitGeneratedHShooterEnemyBoard,
  type GeneratedHShooterEnemy,
} from '../src/assets/hshooter-enemy';
import { mockGeneratedImage } from '../src/assets/game-art';

const CONCEPTS: Record<GeneratedHShooterEnemy, string> = {
  popcorn: 'a tiny barnacled scout submersible',
  weaver: 'a slim brass manta with articulated steering vanes',
  tank: 'a broad armored diving-bell gunship',
  turret: 'a coral-encrusted trench cannon',
  kamikaze: 'a needlefish impact drone with swept-back fins',
};

const OPTIONS = {
  gameTitle: 'The Drowned Observatory',
  tagline: 'Relight the stars below the tide',
  concepts: CONCEPTS,
  colors: '#10182c, #47c9bd, #d4a85f',
};

describe('generated H-scroll enemy cast', () => {
  it('requests two native side-view candidates per role in one fixed board', () => {
    const prompt = buildHShooterEnemyBoardPrompt(OPTIONS);
    expect(prompt).toContain('exactly one square 4-column by 3-row board');
    expect(prompt).toContain('first TEN cells');
    expect(prompt).toContain('popcorn-1');
    expect(prompt).toContain('kamikaze-2');
    expect(prompt).toContain('Cells 11 and 12 must remain completely empty');
    expect(prompt).toContain('strict LEFT-facing side profile');
    expect(prompt).toContain('attachment base along the BOTTOM edge');
    expect(prompt).toContain('perfectly flat solid #00ff00');
  });

  it('segments ten candidates and packs one selected sprite per role atomically', async () => {
    const source = await mockGeneratedImage(buildHShooterEnemyBoardPrompt(OPTIONS));
    const split = await splitGeneratedHShooterEnemyBoard(source);
    expect(split.failures).toEqual([]);
    expect(split.candidates).toHaveLength(10);
    expect(split.candidates.map(({ id }) => id)).toEqual(
      GENERATED_HSHOOTER_ENEMIES.flatMap((role) => [`${role}-1`, `${role}-2`]),
    );
    const selected = Object.fromEntries(
      GENERATED_HSHOOTER_ENEMIES.map((role) => [
        role,
        split.candidates.find((candidate) => candidate.role === role)!.png,
      ]),
    ) as Record<GeneratedHShooterEnemy, Buffer>;
    const atlas = await buildGeneratedHShooterEnemyAtlas(selected);
    await expect(sharp(atlas).metadata()).resolves.toMatchObject({
      format: 'png',
      width: GENERATED_HSHOOTER_ENEMY_ATLAS_WIDTH,
      height: GENERATED_HSHOOTER_ENEMY_SIZE,
      isPalette: true,
    });
  });

  it('uses one corrective replacement for a mechanically missing role', () => {
    const prompt = buildHShooterEnemyReplacementPrompt({
      ...OPTIONS,
      role: 'turret',
      correction: 'The board candidates were too narrow and had no surface attachment base.',
    });
    expect(prompt).toContain('exactly ONE complete isolated');
    expect(prompt).toContain('Role: turret');
    expect(prompt).toContain('CORRECTION FROM LOCAL VALIDATION');
    expect(prompt).toContain('no surface attachment base');
    expect(prompt).toContain('aim its integrated barrel left');
  });

  it('builds a mixed-lane cast review and repairs invalid cross-role selections', async () => {
    const source = await mockGeneratedImage(buildHShooterEnemyBoardPrompt(OPTIONS));
    const candidates = (await splitGeneratedHShooterEnemyBoard(source)).candidates;
    const descriptors = candidates.map(({ id, role }) => ({ id, role }));
    const keyArt = await sharp({
      create: { width: 480, height: 270, channels: 3, background: '#19314a' },
    })
      .png()
      .toBuffer();
    const board = await buildHShooterEnemyJudgeBoard({ keyArt, candidates });
    await expect(sharp(board).metadata()).resolves.toMatchObject({
      format: 'jpeg',
      width: 1320,
      height: 1165,
    });
    expect(buildHShooterEnemyJudgePrompt(descriptors, CONCEPTS).system).toContain(
      'Optimize the five selections as a combination',
    );
    expect(buildHShooterEnemyJudgeSchema(descriptors)).toMatchObject({
      properties: { selections: { minItems: 5, maxItems: 5 } },
    });

    const decision = normalizeHShooterEnemyJudgeDecision(
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
        selections: GENERATED_HSHOOTER_ENEMIES.map((role) => ({
          role,
          candidateId: role === 'popcorn' ? 'weaver-1' : 'not-a-candidate',
          confidence: 0.4,
          rationale: 'invalid selection for normalization coverage',
        })),
        castSummary: 'reviewed',
      },
      descriptors,
    );
    for (const role of GENERATED_HSHOOTER_ENEMIES) {
      expect(bestHShooterEnemyCandidateId(role, decision)).toBe(`${role}-2`);
      expect(decision.selections.find((selection) => selection.role === role)?.candidateId).toBe(
        `${role}-2`,
      );
    }
  });
});
