// Bounded category-aware player-strip repair: the live Rooftop Relay job
// (onFoot traversal) failed image-invalid after a vehicle-verdict repaint
// followed by a banking verdict the old code answered with only a cell
// swap — the bad bank poses were never actually corrected. These tests pin
// the repair sequence: current verdict picks at most one full repaint and
// one two-image bank repair, the swap runs at most once and only after a
// bank correction, every candidate faces the same gate, and provider
// policy refusals stop the sequence instead of triggering more calls.
// A strip still rejected when the budget is spent (the SEA Portal+ hover
// board job failed this way on three attempts) ships Muse's least-bad pick
// among the reviewed candidates instead of failing the game.
import { SKATEBOARD_TRAVERSAL } from '@sparkade/shared';
import { describe, expect, it } from 'vitest';
import {
  RACING_BANK_PROMPT_VERSION,
  RACING_JETSKI_BANK_PROMPT_VERSION,
  RACING_TRAVERSAL_BANK_PROMPT_VERSION,
  buildRacingBankEditPrompt,
} from '../src/assets/racing-bank';
import type { RacingLeastBadCandidate, RacingLeastBadChoice } from '../src/assets/racing-least-bad';
import {
  PipelineError,
  runRacingPlayerStripRepair,
  type RacingPlayerReviewPhase,
  type RacingPlayerStripCandidate,
  type RacingPlayerStripRepairOps,
  type RacingPlayerStripVerdict,
} from '../src/pipeline/runner';

const buf = (tag: string): Buffer => Buffer.from(`player-strip:${tag}`);

interface ScriptedVerdict {
  accepted: boolean;
  kind: RacingPlayerStripVerdict['kind'];
  guidance: string;
  banksUsable?: boolean;
}

function scriptOps(
  verdicts: ScriptedVerdict[],
  leastBad: RacingLeastBadChoice = { index: 0, rearOnly: false, rationale: 'least bad' },
): {
  ops: RacingPlayerStripRepairOps;
  calls: string[];
  reviews: Array<{ tag: string; phase: RacingPlayerReviewPhase }>;
  repaints: string[];
  bankRepairs: Array<{ tag: string; guidance: string }>;
  swaps: string[];
  ranked: Array<{ tag: string; rejection: string; banksUsable?: boolean }>;
} {
  const calls: string[] = [];
  const reviews: Array<{ tag: string; phase: RacingPlayerReviewPhase }> = [];
  const repaints: string[] = [];
  const bankRepairs: Array<{ tag: string; guidance: string }> = [];
  const swaps: string[] = [];
  const ranked: Array<{ tag: string; rejection: string; banksUsable?: boolean }> = [];
  let reviewIndex = 0;
  const initial: RacingPlayerStripCandidate = {
    gameplay: buf('initial'),
    presentationReference: buf('reference'),
  };
  const ops: RacingPlayerStripRepairOps = {
    generateInitial: async () => {
      calls.push('generateInitial');
      return initial;
    },
    review: async (gameplay, phase) => {
      const tag = gameplay.toString();
      calls.push(`review:${phase}:${tag}`);
      reviews.push({ tag, phase });
      const verdict = verdicts[reviewIndex++];
      if (!verdict) throw new Error('repair sequence reviewed more candidates than scripted');
      return verdict;
    },
    repaint: async (guidance) => {
      calls.push(`repaint:${guidance}`);
      repaints.push(guidance);
      return { gameplay: buf(`repainted-${repaints.length}`), presentationReference: buf('reference-2') };
    },
    repairBanks: async (current, guidance) => {
      const tag = current.gameplay.toString();
      calls.push(`repairBanks:${tag}:${guidance}`);
      bankRepairs.push({ tag, guidance });
      // The neutral cell and its HR reference survive a bank-only repair.
      return { gameplay: buf(`banks-fixed-${bankRepairs.length}`), presentationReference: current.presentationReference };
    },
    swapBankCells: async (gameplay) => {
      const tag = gameplay.toString();
      calls.push(`swap:${tag}`);
      swaps.push(tag);
      return buf(`swapped-${swaps.length}`);
    },
    onRepair: (kind) => {
      calls.push(`emit:${kind}`);
    },
    chooseLeastBad: async (candidates: RacingLeastBadCandidate[]) => {
      calls.push('chooseLeastBad');
      ranked.push(
        ...candidates.map(({ png, rejection, banksUsable }) => ({
          tag: png.toString(),
          rejection,
          ...(banksUsable === undefined ? {} : { banksUsable }),
        })),
      );
      return leastBad;
    },
  };
  return { ops, calls, reviews, repaints, bankRepairs, swaps, ranked };
}

describe('racing player-strip repair sequence', () => {
  it('repaints a vehicle rejection then corrects the banks the next verdict names', async () => {
    const { ops, calls, reviews, repaints, bankRepairs } = scriptOps([
      { accepted: false, kind: 'vehicle', guidance: 'bad neutral camera' },
      { accepted: false, kind: 'banking', guidance: 'both banks yaw left; roll them opposite' },
      { accepted: true, kind: 'none', guidance: '' },
    ]);
    const result = await runRacingPlayerStripRepair(ops);
    // One repaint with the FIRST verdict's guidance, then one bank repair
    // with the CURRENT (banking) verdict's guidance on the repainted strip.
    expect(repaints).toEqual(['bad neutral camera']);
    expect(bankRepairs).toEqual([
      { tag: 'player-strip:repainted-1', guidance: 'both banks yaw left; roll them opposite' },
    ]);
    // The same gate reviews every candidate in order.
    expect(reviews.map((r) => r.phase)).toEqual(['initial', 'corrected', 'corrected']);
    expect(reviews.map((r) => r.tag)).toEqual([
      'player-strip:initial',
      'player-strip:repainted-1',
      'player-strip:banks-fixed-1',
    ]);
    expect(calls).not.toContainEqual(expect.stringMatching(/^swap:/));
    expect(result.gameplay.toString()).toBe('player-strip:banks-fixed-1');
  });

  it('keeps the accepted neutral reference through a bank-only repair', async () => {
    const { ops } = scriptOps([
      { accepted: false, kind: 'banking', guidance: 'banks yaw the same way' },
      { accepted: true, kind: 'none', guidance: '' },
    ]);
    const before = await ops.generateInitial();
    const result = await runRacingPlayerStripRepair(ops);
    expect(result.presentationReference).toBe(before.presentationReference);
    expect(result.gameplay).not.toBe(before.gameplay);
  });

  it('ships the least-bad reviewed candidate without extra images once the budget is exhausted', async () => {
    // The live SEA Portal+ verdicts: the neutral stayed a true low-rear view,
    // but every review labelled sideways/overhead banks a vehicle fault.
    const verdicts: ScriptedVerdict[] = [
      { accepted: false, kind: 'vehicle', guidance: 'Repaint board pointing away with true opposite rolls.' },
      { accepted: false, kind: 'vehicle', guidance: 'Repaint both banks keeping neutral rear board axis.' },
    ];
    const first = scriptOps(verdicts, { index: 1, rearOnly: true, rationale: 'B has the truest rear' });
    const result = await runRacingPlayerStripRepair(first.ops);
    expect(first.repaints).toEqual(['Repaint board pointing away with true opposite rolls.']);
    expect(first.bankRepairs).toEqual([]);
    expect(first.swaps).toEqual([]);
    // Exactly one initial generation, one repaint, two reviews, one ranking.
    expect(first.calls.filter((c) => c === 'generateInitial')).toHaveLength(1);
    expect(first.calls.filter((c) => c.startsWith('repaint:'))).toHaveLength(1);
    expect(first.calls.filter((c) => c.startsWith('review:'))).toHaveLength(2);
    expect(first.calls.at(-1)).toBe('chooseLeastBad');
    // Muse ranks every reviewed candidate with that candidate's own rejection.
    expect(first.ranked).toEqual([
      { tag: 'player-strip:initial', rejection: verdicts[0]!.guidance },
      { tag: 'player-strip:repainted-1', rejection: verdicts[1]!.guidance },
    ]);
    expect(result.gameplay.toString()).toBe('player-strip:repainted-1');
    expect(result.presentationReference.toString()).toBe('player-strip:reference-2');
    expect(result.leastBad).toEqual({
      index: 1,
      rearOnly: true,
      rationale: 'B has the truest rear',
      candidates: 2,
    });
    // The pick keeps the chosen candidate's own HR reference.
    const second = scriptOps(verdicts);
    const kept = await runRacingPlayerStripRepair(second.ops);
    expect(kept.gameplay.toString()).toBe('player-strip:initial');
    expect(kept.presentationReference.toString()).toBe('player-strip:reference');
  });

  it("hands each candidate's bank-camera evidence to the least-bad pick", async () => {
    const { ops, ranked } = scriptOps([
      { accepted: false, kind: 'vehicle', guidance: 'side banks', banksUsable: false },
      { accepted: false, kind: 'vehicle', guidance: 'wrong jacket', banksUsable: true },
    ]);
    await runRacingPlayerStripRepair(ops);
    expect(ranked.map(({ banksUsable }) => banksUsable)).toEqual([false, true]);
  });

  it('never asks for a least-bad pick when a candidate passes', async () => {
    const { ops, calls } = scriptOps([
      { accepted: false, kind: 'vehicle', guidance: 'bad neutral camera' },
      { accepted: true, kind: 'none', guidance: '' },
    ]);
    const result = await runRacingPlayerStripRepair(ops);
    expect(calls).not.toContain('chooseLeastBad');
    expect(result.leastBad).toBeUndefined();
  });

  it('rejects a least-bad index outside the reviewed candidates', async () => {
    const { ops } = scriptOps(
      [
        { accepted: false, kind: 'vehicle', guidance: 'one' },
        { accepted: false, kind: 'vehicle', guidance: 'two' },
      ],
      { index: 5, rearOnly: false, rationale: 'bogus' },
    );
    await expect(runRacingPlayerStripRepair(ops)).rejects.toThrow(/unknown candidate/);
  });

  it('swaps bank order at most once, only after a bank correction', async () => {
    const { ops, bankRepairs, swaps, repaints } = scriptOps([
      { accepted: false, kind: 'banking', guidance: 'banks swapped' },
      { accepted: false, kind: 'banking', guidance: 'still swapped' },
      { accepted: true, kind: 'none', guidance: '' },
    ]);
    const result = await runRacingPlayerStripRepair(ops);
    expect(repaints).toEqual([]);
    expect(bankRepairs).toHaveLength(1);
    expect(swaps).toEqual(['player-strip:banks-fixed-1']);
    expect(result.gameplay.toString()).toBe('player-strip:swapped-1');
  });

  it('never swaps twice and never repaints after the budget is spent', async () => {
    const { ops, bankRepairs, swaps, repaints, reviews, ranked } = scriptOps(
      [
        { accepted: false, kind: 'banking', guidance: 'bad banks 1' },
        { accepted: false, kind: 'banking', guidance: 'bad banks 2' },
        { accepted: false, kind: 'banking', guidance: 'bad banks 3' },
      ],
      { index: 2, rearOnly: false, rationale: 'swapped banks read best' },
    );
    const result = await runRacingPlayerStripRepair(ops);
    expect(bankRepairs).toHaveLength(1);
    expect(swaps).toHaveLength(1);
    expect(repaints).toEqual([]);
    expect(reviews.map((r) => r.phase)).toEqual(['initial', 'corrected', 'verify']);
    expect(ranked.map((r) => r.tag)).toEqual([
      'player-strip:initial',
      'player-strip:banks-fixed-1',
      'player-strip:swapped-1',
    ]);
    expect(result.gameplay.toString()).toBe('player-strip:swapped-1');
    expect(result.leastBad).toMatchObject({ index: 2, rearOnly: false, candidates: 3 });
  });

  it('treats an unknown reject category as a vehicle repaint, fail-closed', async () => {
    const { ops, repaints, bankRepairs } = scriptOps([
      { accepted: false, kind: 'none', guidance: 'vague rejection' },
      { accepted: true, kind: 'none', guidance: '' },
    ]);
    await runRacingPlayerStripRepair(ops);
    expect(repaints).toEqual(['vague rejection']);
    expect(bankRepairs).toEqual([]);
  });

  it('keeps the gate-approved neutral when the provider declines the bank edit', async () => {
    const { ops, calls } = scriptOps([
      { accepted: false, kind: 'banking', guidance: 'banks yaw the same way' },
    ]);
    const refusal = new PipelineError('image-content-policy', 'provider refused', 'building-assets');
    const result = await runRacingPlayerStripRepair({
      ...ops,
      repairBanks: async () => {
        calls.push('repairBanks:refused');
        throw refusal;
      },
    });
    // No second review, no swap, and no ranking call: the banking verdict
    // already approved this neutral, which now ships with engine lean.
    expect(calls.filter((c) => c.startsWith('review:'))).toHaveLength(1);
    expect(calls).not.toContain('chooseLeastBad');
    expect(result.gameplay.toString()).toBe('player-strip:initial');
    expect(result.leastBad).toMatchObject({ index: 0, rearOnly: true, refused: true, candidates: 1 });
  });

  it('propagates a provider policy refusal instead of repairing around it', async () => {
    const { ops, calls } = scriptOps([
      { accepted: false, kind: 'vehicle', guidance: 'bad neutral camera' },
    ]);
    const refusal = new PipelineError('image-content-policy', 'provider refused', 'building-assets');
    const failing: RacingPlayerStripRepairOps = {
      ...ops,
      repaint: async () => {
        calls.push('repaint:refused');
        throw refusal;
      },
    };
    await expect(runRacingPlayerStripRepair(failing)).rejects.toBe(refusal);
    // No bank repair, no swap, no second review, no least-bad pick after the refusal.
    expect(calls.filter((c) => c.startsWith('review:'))).toHaveLength(1);
    expect(calls).not.toContain('chooseLeastBad');
    expect(calls).not.toContainEqual(expect.stringMatching(/^repairBanks:/));
    expect(calls).not.toContainEqual(expect.stringMatching(/^swap:/));
  });
});

describe('racing bank single-pose prompt scoping', () => {
  const bothDirections = 'banking-left leans left and banking-right leans right, with no yaw';

  it('keeps whole-strip guidance out of traversal single-pose edits, like jetski', () => {
    for (const pose of ['bankLeft', 'bankRight'] as const) {
      const prompt = buildRacingBankEditPrompt({
        vehicleName: 'Rin',
        pose,
        retryGuidance: bothDirections,
        traversal: SKATEBOARD_TRAVERSAL,
      });
      expect(prompt).not.toContain(bothDirections);
      expect(prompt).toContain(pose === 'bankLeft' ? 'LEFT' : 'RIGHT');
    }
  });

  it('still applies the correction in the legacy hover path', () => {
    const prompt = buildRacingBankEditPrompt({
      vehicleName: 'Rin',
      pose: 'bankLeft',
      retryGuidance: bothDirections,
    });
    expect(prompt).toContain(bothDirections);
  });

  it('bumps only the traversal bank lineage', () => {
    expect(RACING_TRAVERSAL_BANK_PROMPT_VERSION).toBe('racing-traversal-bank-v4');
    expect(RACING_BANK_PROMPT_VERSION).toBe('racing-craft-bank-v2');
    expect(RACING_JETSKI_BANK_PROMPT_VERSION).toBe('racing-jetski-bank-v3');
  });
});
