// Least-bad racer selection after spent repairs: the gates still reject, but
// a rejected racer sprite must not fail an otherwise complete game. These
// tests pin the ranking prompt/schema, the never-failing normalizer, the
// rear-only sprite geometry, and the durable least-bad rival neutral.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { GeneratedAssetStorageError, imagePromptHash } from '../src/assets/manifest';
import { RacingBankFallbackStore } from '../src/assets/racing-bank-fallback';
import {
  RACING_LEAST_BAD_REAR_REASON,
  buildRacingLeastBadPrompt,
  buildRacingLeastBadBoard,
  buildRacingLeastBadSchema,
  enforceRacingLeastBadBanks,
  isRacingRearOnlySprite,
  normalizeRacingLeastBadChoice,
  racingLeastBadIds,
} from '../src/assets/racing-least-bad';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const root = () => {
  const path = mkdtempSync(join(tmpdir(), 'racing-least-bad-'));
  roots.push(path);
  return path;
};
const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: '#224466' } })
    .png()
    .toBuffer();

describe('least-bad ranking prompt', () => {
  it('shows every candidate with its own rejection and offers rear-only for strips', () => {
    const prompt = buildRacingLeastBadPrompt({
      racerName: 'Danny',
      concept: 'teal lantern glide-board',
      rejections: ['banks yaw sideways', 'banks stand upright'],
      banks: true,
    });
    expect(prompt.user).toContain('A was rejected for: banks yaw sideways.');
    expect(prompt.user).toContain('B was rejected for: banks stand upright.');
    expect(prompt.user).toContain('neutral-rear, banking-left, banking-right');
    expect(prompt.user).toContain('rearOnly');
    expect(prompt.user).toContain('never reject them all');
    expect(prompt.user).not.toContain('TOP PANEL');
  });

  it('describes the player reference panel without review-only repair instructions', () => {
    const prompt = buildRacingLeastBadPrompt({
      racerName: 'Danny',
      concept: 'board',
      rejections: ['one'],
      banks: false,
      playerReference: 'photo',
    });
    expect(prompt.user).toContain('TOP PANEL');
    expect(prompt.user).toContain('source photo');
    expect(prompt.user).not.toContain('rearOnly');
    expect(prompt.user).not.toMatch(/repaint|fatalIssues/);
  });

  it('constrains the choice to the shown candidates', () => {
    expect(buildRacingLeastBadSchema(3, true)).toMatchObject({
      required: ['choice', 'rearOnly', 'rationale'],
      properties: { choice: { enum: ['A', 'B', 'C'] }, rearOnly: { type: 'boolean' } },
    });
    const foundation = buildRacingLeastBadSchema(2, false) as { properties: object; required: string[] };
    expect(foundation.required).toEqual(['choice', 'rationale']);
    expect(foundation.properties).not.toHaveProperty('rearOnly');
    expect(() => racingLeastBadIds(0)).toThrow();
    expect(() => racingLeastBadIds(7)).toThrow();
  });
});

describe('least-bad normalization', () => {
  it('maps the chosen label to its reviewed index', () => {
    expect(
      normalizeRacingLeastBadChoice({ choice: 'B', rearOnly: false, rationale: ' clean banks ' }, 3, true),
    ).toEqual({ index: 1, rearOnly: false, rationale: 'clean banks' });
    expect(normalizeRacingLeastBadChoice({ choice: 'A', rearOnly: true, rationale: 'x' }, 2, true)).toMatchObject({
      index: 0,
      rearOnly: true,
    });
  });

  it('never keeps banks for foundation candidates', () => {
    expect(normalizeRacingLeastBadChoice({ choice: 'A', rearOnly: true, rationale: 'x' }, 2, false).rearOnly).toBe(
      false,
    );
  });

  it('still ships a candidate for unusable answers, preferring the latest rear', () => {
    for (const raw of [null, 'B', {}, { choice: 'Z' }, { choice: 'C' }]) {
      expect(normalizeRacingLeastBadChoice(raw, 2, true)).toMatchObject({ index: 1, rearOnly: true });
    }
    // A valid label with a missing rearOnly falls back to the leaning rear.
    expect(normalizeRacingLeastBadChoice({ choice: 'A' }, 2, true)).toMatchObject({
      index: 0,
      rearOnly: true,
      rationale: expect.any(String),
    });
  });
});

describe('least-bad bank gate', () => {
  const kept = { index: 1, rearOnly: false, rationale: 'B rolls believably.' };

  it('never ships bank cells the gate classified as a non-rear camera', () => {
    expect(enforceRacingLeastBadBanks(kept, [{ banksUsable: true }, { banksUsable: false }])).toEqual({
      index: 1,
      rearOnly: true,
      rationale: expect.stringContaining('failed the rear-camera gate'),
    });
  });

  it('keeps camera-valid or unclassified banks and any rear-only pick unchanged', () => {
    expect(enforceRacingLeastBadBanks(kept, [{ banksUsable: false }, { banksUsable: true }])).toBe(kept);
    expect(enforceRacingLeastBadBanks(kept, [{}, {}])).toBe(kept);
    const rear = { ...kept, rearOnly: true };
    expect(enforceRacingLeastBadBanks(rear, [{}, { banksUsable: false }])).toBe(rear);
  });
});

it('renders labeled candidate rows at 3x for the ranking', async () => {
  const board = await buildRacingLeastBadBoard([await png(192, 64), await png(192, 64)]);
  const meta = await sharp(board).metadata();
  expect(meta.width).toBe(192 * 3 + 32);
  expect(meta.height).toBe((64 * 3 + 40 + 16) * 2);
  await expect(buildRacingLeastBadBoard([])).rejects.toThrow();
});

it('recognizes a published rear-only racer by its single 64px cell', async () => {
  expect(await isRacingRearOnlySprite(await png(64, 64))).toBe(true);
  expect(await isRacingRearOnlySprite(await png(192, 64))).toBe(false);
  expect(await isRacingRearOnlySprite(await png(192, 192))).toBe(false);
});

describe('least-bad rival neutral persistence', () => {
  it('restores a chosen rear across instances with its least-bad reason', async () => {
    const dir = root(),
      key = imagePromptHash('rival3');
    const neutral = await png(64, 64);
    const saved = await new RacingBankFallbackStore(dir).chooseNeutral(key, neutral, RACING_LEAST_BAD_REAR_REASON);
    expect(saved).toEqual({ reason: RACING_LEAST_BAD_REAR_REASON, neutral });
    expect(await new RacingBankFallbackStore(dir).load(key)).toEqual({
      reason: RACING_LEAST_BAD_REAR_REASON,
      neutral,
    });
  });

  it('fails closed on an invalid rear or a least-bad record without its image', async () => {
    const dir = root(),
      key = imagePromptHash('rival4');
    const store = new RacingBankFallbackStore(dir);
    await expect(store.chooseNeutral(key, await png(192, 64), 'reason')).rejects.toBeInstanceOf(
      GeneratedAssetStorageError,
    );
    expect(await store.load(key)).toBeNull();
    writeFileSync(
      join(dir, `${key}.json`),
      JSON.stringify({ version: 'racing-bank-neutral-v1', key, outcome: 'least-bad', reason: 'r' }),
    );
    await expect(store.load(key)).rejects.toBeInstanceOf(GeneratedAssetStorageError);
  });
});
