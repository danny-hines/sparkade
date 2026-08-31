import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_ADVENTURE_OBJECTS,
  GENERATED_ADVENTURE_OBJECT_ATLAS_WIDTH,
  GENERATED_ADVENTURE_OBJECT_HEIGHT,
  bestAdventureObjectCandidateId,
  buildAdventureObjectBoardPrompt,
  buildAdventureObjectJudgeBoard,
  buildAdventureObjectJudgePrompt,
  buildAdventureObjectJudgeSchema,
  buildGeneratedAdventureObjectAtlas,
  normalizeAdventureObjectJudgeDecision,
  splitGeneratedAdventureObjectBoard,
  type AdventureObjectPromptOptions,
  type GeneratedAdventureObject,
} from '../src/assets/adventure-object';
import { mockGeneratedImage } from '../src/assets/game-art';

const OPTIONS: AdventureObjectPromptOptions = {
  gameTitle: 'The Drowned Observatory',
  tagline: 'Relight the stars below the tide',
  keyConcept: 'a brass tide-key with a glass constellation tooth',
  itemName: 'Arc Harpoon',
  itemConcept: 'a compact brass harpoon launcher with a cyan coil',
  npcConcept: 'an elderly observatory keeper in a copper diving coat',
  secondaryBehavior: 'shot',
  colors: '#10182c, #47c9bd, #d4a85f',
};

describe('generated Adventure gameplay objects', () => {
  it('requests two candidates per themed role in one fixed board', () => {
    const prompt = buildAdventureObjectBoardPrompt(OPTIONS);
    expect(prompt).toContain('exactly one square 3-column by 3-row board');
    expect(prompt).toContain('first EIGHT cells');
    expect(prompt).toContain('key-1');
    expect(prompt).toContain('secondaryEffect-2');
    expect(prompt).toContain('Cell 9 must remain completely empty');
    expect(prompt).toContain('Arc Harpoon');
    expect(prompt).toContain('point it toward the RIGHT');
    expect(prompt).toContain('perfectly flat solid #00ff00');
  });

  it('segments eight candidates and packs one selected source per role atomically', async () => {
    const source = await mockGeneratedImage(buildAdventureObjectBoardPrompt(OPTIONS));
    const split = await splitGeneratedAdventureObjectBoard(source);
    expect(split.failures).toEqual([]);
    expect(split.candidates).toHaveLength(8);
    expect(split.candidates.map(({ id }) => id)).toEqual(
      GENERATED_ADVENTURE_OBJECTS.flatMap((role) => [`${role}-1`, `${role}-2`]),
    );
    const selected = Object.fromEntries(
      GENERATED_ADVENTURE_OBJECTS.map((role) => [
        role,
        split.candidates.find((candidate) => candidate.role === role)!.png,
      ]),
    ) as Record<GeneratedAdventureObject, Buffer>;
    const atlas = await buildGeneratedAdventureObjectAtlas(selected);
    await expect(sharp(atlas).metadata()).resolves.toMatchObject({
      format: 'png',
      width: GENERATED_ADVENTURE_OBJECT_ATLAS_WIDTH,
      height: GENERATED_ADVENTURE_OBJECT_HEIGHT,
      isPalette: true,
    });
  });

  it('reviews objects over mixed floors and repairs invalid cross-role selections', async () => {
    const source = await mockGeneratedImage(buildAdventureObjectBoardPrompt(OPTIONS));
    const candidates = (await splitGeneratedAdventureObjectBoard(source)).candidates;
    const descriptors = candidates.map(({ id, role }) => ({ id, role }));
    const keyArt = await sharp({
      create: { width: 480, height: 270, channels: 3, background: '#19314a' },
    })
      .png()
      .toBuffer();
    const board = await buildAdventureObjectJudgeBoard({ keyArt, candidates });
    await expect(sharp(board).metadata()).resolves.toMatchObject({
      format: 'jpeg',
      width: 1320,
      height: 965,
    });
    expect(buildAdventureObjectJudgePrompt(descriptors, OPTIONS).system).toContain(
      'Optimize the set for coherent materials',
    );
    expect(buildAdventureObjectJudgeSchema(descriptors)).toMatchObject({
      properties: { selections: { minItems: 4, maxItems: 4 } },
    });

    const decision = normalizeAdventureObjectJudgeDecision(
      {
        candidateReviews: descriptors.map(({ id, role }) => ({
          id,
          role,
          scores: {
            conceptMatch: id.endsWith('-2') ? 5 : 3,
            worldStyle: 4,
            silhouette: 4,
            gameplayReadability: id.endsWith('-2') ? 5 : 3,
            technical: 4,
          },
          issues: [],
          summary: `${id} reviewed`,
        })),
        selections: GENERATED_ADVENTURE_OBJECTS.map((role) => ({
          role,
          candidateId: role === 'key' ? 'npc-1' : 'not-a-candidate',
          confidence: 0.4,
          rationale: 'invalid selection for normalization coverage',
        })),
        setSummary: 'reviewed',
      },
      descriptors,
    );
    for (const role of GENERATED_ADVENTURE_OBJECTS) {
      expect(bestAdventureObjectCandidateId(role, decision)).toBe(`${role}-2`);
      expect(decision.selections.find((selection) => selection.role === role)?.candidateId).toBe(
        `${role}-2`,
      );
    }
  });
});
