// Rival repair planner: the live cycling cup failed image-invalid at the
// re-review because a repaint (vehicle verdict) followed by a banking
// verdict got only a cell swap — the bad bank poses were never corrected.
// These tests pin the per-round plan: the CURRENT category picks at most
// one repaint, one two-image bank correction, then at most one swap after
// a bank correction; approved rivals are never redone; exhausted budgets
// spend no calls. A refused rival bank correction now retains the accepted
// neutral; it never becomes another image attempt (pipeline coverage lives
// in racing-bank-fallback-pipeline.test.ts).
import { describe, expect, it } from 'vitest';
import type { RacingSlotCorrectionKind } from '../src/assets/racing-pack';
import {
  RACING_RIVAL_REPAIR_MAX_ROUNDS,
  freshRacingRivalRepairState,
  planRacingRivalRepair,
  planRacingRivalRepairRound,
  type RacingRivalRepairState,
} from '../src/pipeline/runner';

function stateWith(partial: Partial<RacingRivalRepairState>): RacingRivalRepairState {
  return { ...freshRacingRivalRepairState(), ...partial };
}

function statesOf(entries: Record<string, RacingRivalRepairState>): Map<string, RacingRivalRepairState> {
  return new Map(Object.entries(entries));
}

/** Drive one rival through successive verdict categories, evolving state. */
function driveRival(kinds: RacingSlotCorrectionKind[]): string[] {
  const state = freshRacingRivalRepairState();
  return kinds.map((kind) => {
    const action = planRacingRivalRepair(kind, state);
    if (action === 'repaint') state.didRepaint = true;
    if (action === 'bank') state.didBankRepair = true;
    if (action === 'swap') state.didSwap = true;
    return action;
  });
}

describe('racing rival repair planner', () => {
  it('repairs vehicle then banking then swaps: the cycling rival4 gap', async () => {
    // Round 1 says vehicle (too close to the player) -> repaint; round 2
    // says banking (rebuilt strip, bad rolls) -> real bank correction, not
    // just a swap; round 3 still banking -> one order swap; then exhausted.
    expect(driveRival(['vehicle', 'banking', 'banking', 'banking'])).toEqual([
      'repaint',
      'bank',
      'swap',
      'exhausted',
    ]);
  });

  it('repairs banking then vehicle across rounds', async () => {
    expect(driveRival(['banking', 'vehicle', 'vehicle'])).toEqual([
      'bank',
      'repaint',
      'exhausted',
    ]);
  });

  it('never retries an exhausted category', async () => {
    expect(driveRival(['vehicle', 'vehicle', 'vehicle'])).toEqual([
      'repaint',
      'exhausted',
      'exhausted',
    ]);
    expect(driveRival(['banking', 'banking', 'banking', 'banking'])).toEqual([
      'bank',
      'swap',
      'exhausted',
      'exhausted',
    ]);
  });

  it('swaps only after a bank correction, at most once', async () => {
    // Fresh banking verdicts always correct the poses first, never swap.
    expect(planRacingRivalRepair('banking', freshRacingRivalRepairState())).toBe('bank');
    // A repaint alone never unlocks the swap.
    expect(planRacingRivalRepair('banking', stateWith({ didRepaint: true }))).toBe('bank');
    // After bank + swap, a repeat banking verdict is exhausted, not re-swapped.
    expect(
      planRacingRivalRepair('banking', stateWith({ didBankRepair: true, didSwap: true })),
    ).toBe('exhausted');
  });

  it('fails closed to a repaint on none or unknown categories', async () => {
    expect(planRacingRivalRepair('none', freshRacingRivalRepairState())).toBe('repaint');
    expect(
      planRacingRivalRepair('vehicle', stateWith({ didBankRepair: true, didSwap: true })),
    ).toBe('repaint');
  });

  it('bounds correction rounds', async () => {
    expect(RACING_RIVAL_REPAIR_MAX_ROUNDS).toBeLessThanOrEqual(4);
  });
});

describe('racing rival repair round plan', () => {
  it('plans mixed categories per rival independently', async () => {
    const actions = planRacingRivalRepairRound(
      ['rival1', 'rival4'],
      { rival1: 'banking', rival4: 'vehicle' },
      new Set(['player']),
      statesOf({}),
    );
    expect(actions).toEqual([
      { id: 'rival1', action: 'bank' },
      { id: 'rival4', action: 'repaint' },
    ]);
  });

  it('never redoes approved rivals, even when still listed as rejected', async () => {
    const states = statesOf({ rival1: stateWith({ didRepaint: true }) });
    const before = states.size;
    const actions = planRacingRivalRepairRound(
      ['rival1', 'rival2'],
      { rival1: 'vehicle', rival2: 'banking' },
      new Set(['player', 'rival1']),
      states,
    );
    expect(actions).toEqual([{ id: 'rival2', action: 'bank' }]);
    expect(states.size).toBe(before);
  });

  it('marks exhausted rivals so the loop spends no call on them', async () => {
    const actions = planRacingRivalRepairRound(
      ['rival4'],
      { rival4: 'vehicle' },
      new Set(['player']),
      statesOf({ rival4: stateWith({ didRepaint: true, didBankRepair: true, didSwap: true }) }),
    );
    expect(actions).toEqual([{ id: 'rival4', action: 'exhausted' }]);
  });

  it('defaults a missing category to vehicle, fail-closed', async () => {
    const actions = planRacingRivalRepairRound(
      ['rival3'],
      {},
      new Set(['player']),
      statesOf({}),
    );
    expect(actions).toEqual([{ id: 'rival3', action: 'repaint' }]);
  });

  it('carries each rival through a vehicle->banking->banking live sequence', async () => {
    const states = statesOf({});
    const round = (rejected: string[], kinds: Record<string, RacingSlotCorrectionKind>) =>
      planRacingRivalRepairRound(rejected, kinds, new Set(['player']), states).filter(
        ({ action }) => action !== 'exhausted',
      );
    // Round 1: rival4 too close to the player -> repaint; rival2 banks bad -> correct.
    expect(
      round(['rival2', 'rival4'], { rival2: 'banking', rival4: 'vehicle' }),
    ).toEqual([
      { id: 'rival2', action: 'bank' },
      { id: 'rival4', action: 'repaint' },
    ]);
    for (const { id, action } of [
      { id: 'rival2', action: 'bank' },
      { id: 'rival4', action: 'repaint' },
    ] as const) {
      const s = states.get(id) ?? freshRacingRivalRepairState();
      if (action === 'bank') s.didBankRepair = true;
      if (action === 'repaint') s.didRepaint = true;
      states.set(id, s);
    }
    // Round 2: rebuilt rival4 now has bad rolls -> real bank correction.
    expect(round(['rival4'], { rival4: 'banking' })).toEqual([{ id: 'rival4', action: 'bank' }]);
  });
});
