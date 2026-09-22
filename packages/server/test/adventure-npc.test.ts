import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ArtifactCache } from '../src/pipeline/artifact-cache';
import { mockGeneratedImage } from '../src/assets/game-art';
import { ensureAdventureNpc, buildAdventureNpcPrompt } from '../src/assets/adventure-npc';
import {
  adventureObjectCellRect,
  buildAdventureObjectBoardPrompt,
  normalizeAdventureObjectJudgeDecision,
  bestAdventureObjectCandidateId,
  splitGeneratedAdventureObjectBoard,
  type AdventureObjectCandidate,
  type AdventureObjectPromptOptions,
} from '../src/assets/adventure-object';

const promptOptions: AdventureObjectPromptOptions = {
  gameTitle: 'Frostlight Vault',
  tagline: 'Relight the frozen beacon',
  keyConcept: 'brass key',
  itemName: 'Thaw Powder',
  itemConcept: 'a small tin of powder',
  npcConcept: 'a friendly archive keeper in a wool cap and coat',
  secondaryBehavior: 'blast',
  colors: '#17364d, #dce7ec, #b88742',
};
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
let candidates: AdventureObjectCandidate[], rawNpc: Buffer, keyArt: Buffer, hero: Buffer;
beforeAll(async () => {
  const board = await mockGeneratedImage(buildAdventureObjectBoardPrompt(promptOptions));
  candidates = (await splitGeneratedAdventureObjectBoard(board)).candidates;
  const { left, top, width, height } = adventureObjectCellRect(4);
  rawNpc = await sharp(board).extract({ left, top, width, height }).png().toBuffer();
  keyArt = await sharp({ create: { width: 480, height: 270, channels: 3, background: '#25394a' } })
    .png()
    .toBuffer();
  hero = candidates.find(({ role }) => role === 'npc')!.png;
});
function verdict(ids: readonly { id: string; role: string }[], complete: boolean | undefined) {
  return {
    candidateReviews: ids.map(({ id, role }) => ({
      id,
      role,
      scores: {
        conceptMatch: 5,
        worldStyle: 5,
        silhouette: 5,
        gameplayReadability: 5,
        technical: 5,
      },
      npcComplete: role === 'npc' ? complete : null,
      issues: [],
      summary: complete ? 'Full standing body' : 'Chest-up bust without legs or feet',
    })),
    selections: [
      {
        role: 'npc',
        candidateId: ids.find(({ role }) => role === 'npc')?.id,
        confidence: 1,
        rationale: 'High quality art',
      },
    ],
    setSummary: 'Reviewed',
  };
}
function harness(complete = false) {
  const root = mkdtempSync(join(tmpdir(), 'sparkade-npc-'));
  dirs.push(root);
  const generate = vi.fn<Parameters<typeof ensureAdventureNpc>[0]['generate']>(async () => rawNpc);
  const review = vi.fn<Parameters<typeof ensureAdventureNpc>[0]['review']>(async () =>
    verdict([{ id: 'npc-repair-1', role: 'npc' }], true),
  );
  return {
    candidates,
    decision: normalizeAdventureObjectJudgeDecision(verdict(candidates, complete), candidates),
    keyArt,
    hero,
    promptOptions,
    cache: new ArtifactCache(root),
    attempt: 1,
    generate,
    review,
  };
}

describe('Adventure NPC structural gate and focused repair', () => {
  it.each([false, undefined])(
    'never promotes a portrait or missing body review despite high scores (%s)',
    (complete) => {
      const decision = normalizeAdventureObjectJudgeDecision(
        verdict(candidates, complete),
        candidates,
      );
      expect(bestAdventureObjectCandidateId('npc', decision)).toBeNull();
      expect(decision.selections.find(({ role }) => role === 'npc')?.candidateId).toBe('');
      expect(bestAdventureObjectCandidateId('key', decision)).toBeTruthy();
    },
  );
  it('adds zero image or review calls when the sheet NPC is complete', async () => {
    const options = harness(true);
    const result = await ensureAdventureNpc(options);
    expect(result).toEqual(candidates.find(({ id }) => id === 'npc-1')!.png);
    expect(options.generate).not.toHaveBeenCalled();
    expect(options.review).not.toHaveBeenCalled();
  });
  it('repairs only the NPC and restores the accepted repair without new provider calls', async () => {
    const options = harness();
    const result = await ensureAdventureNpc(options);
    expect(options.generate).toHaveBeenCalledTimes(1);
    expect(options.review).toHaveBeenCalledTimes(1);
    expect(options.generate.mock.calls[0]![1]).toContain('two full legs');
    expect(options.generate.mock.calls[0]![1]).toContain('not a duplicate of the hero');
    await expect(sharp(result).metadata()).resolves.toMatchObject({ width: 96, height: 112 });
    await expect(ensureAdventureNpc(options)).resolves.toEqual(result);
    expect(options.generate).toHaveBeenCalledTimes(1);
    expect(options.review).toHaveBeenCalledTimes(1);
  });
  it('fails after two bad NPCs rather than publishing a bust, and gives an explicit retry fresh attempts', async () => {
    const options = harness();
    options.review.mockImplementation(async (_prompt, schema) => {
      const id = (
        schema as {
          properties: { candidateReviews: { items: { properties: { id: { enum: string[] } } } } };
        }
      ).properties.candidateReviews.items.properties.id.enum[0]!;
      return verdict([{ id, role: 'npc' }], false);
    });
    await expect(ensureAdventureNpc(options)).rejects.toThrow('after two repairs');
    expect(options.generate).toHaveBeenCalledTimes(2);
    options.review.mockImplementation(async () =>
      verdict([{ id: 'npc-repair-1', role: 'npc' }], true),
    );
    await expect(ensureAdventureNpc({ ...options, attempt: 2 })).resolves.toBeInstanceOf(Buffer);
    expect(options.generate).toHaveBeenCalledTimes(3);
  });
  it('does not turn a provider refusal or outage into more image calls', async () => {
    const options = harness();
    const error = new Error('provider refusal');
    options.generate.mockRejectedValue(error);
    await expect(ensureAdventureNpc(options)).rejects.toBe(error);
    expect(options.generate).toHaveBeenCalledTimes(1);
    expect(options.review).not.toHaveBeenCalled();
  });
  it('resumes a suspended review using the already-generated NPC', async () => {
    const options = harness();
    const error = new Error('review suspended');
    options.review.mockRejectedValueOnce(error);
    await expect(ensureAdventureNpc(options)).rejects.toBe(error);
    await expect(ensureAdventureNpc(options)).resolves.toBeInstanceOf(Buffer);
    expect(options.generate).toHaveBeenCalledTimes(1);
    expect(options.review).toHaveBeenCalledTimes(2);
  });
  it('requires full-body NPCs in both the sheet and repair prompts', () => {
    for (const prompt of [
      buildAdventureObjectBoardPrompt(promptOptions),
      buildAdventureNpcPrompt(promptOptions),
    ]) {
      expect(prompt).toContain('both visible feet');
      expect(prompt).toContain('bust');
    }
  });
});
