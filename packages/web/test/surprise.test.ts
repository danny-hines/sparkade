import { describe, expect, it } from 'vitest';
import { ARCHETYPE_IDS } from '@sparkade/shared';
import { drawSurpriseArchetype, type SurpriseBagState } from '../src/surprise';

describe('Surprise archetype shuffle bag', () => {
  const BAG = [...ARCHETYPE_IDS];

  it('uses every archetype exactly once per cycle', () => {
    let state: SurpriseBagState | null = null;
    const draws = Array.from({ length: BAG.length * 2 }, () => {
      const result = drawSurpriseArchetype(state, () => 0.37);
      state = result.state;
      return result.archetype;
    });

    for (let start = 0; start < draws.length; start += BAG.length) {
      expect(new Set(draws.slice(start, start + BAG.length))).toEqual(new Set(BAG));
    }
  });

  it('does not repeat an archetype across a cycle boundary', () => {
    let state: SurpriseBagState = { version: 1, remaining: [], last: 'shooter' };
    const first = drawSurpriseArchetype(state, () => 0);
    expect(first.archetype).not.toBe('shooter');
    state = first.state;

    const draws = [first.archetype];
    for (let index = 1; index < ARCHETYPE_IDS.length * 3; index++) {
      const result = drawSurpriseArchetype(state, () => (index % 7) / 7);
      draws.push(result.archetype);
      state = result.state;
    }
    expect(draws.every((archetype, index) => index === 0 || archetype !== draws[index - 1])).toBe(true);
  });

  it('always includes racing in a full cycle so AI choice can land on it', () => {
    let state: SurpriseBagState | null = null;
    const draws: string[] = [];
    for (let index = 0; index < ARCHETYPE_IDS.length; index++) {
      const result = drawSurpriseArchetype(state, () => (index * 0.31) % 1);
      draws.push(result.archetype);
      state = result.state;
    }
    expect(draws).toContain('racing');
  });

  it('recovers from missing or corrupt persisted state', () => {
    expect(drawSurpriseArchetype(null, () => 0.5).archetype).toBeTruthy();
    const recovered = drawSurpriseArchetype(
      { version: 99, remaining: ['fighter', 'fighter', 'bogus'], last: 'bogus' },
      () => 0.5,
    );
    expect(recovered.archetype).toBe('fighter');
    expect(recovered.state.remaining).toEqual([]);
    expect(recovered.state.last).toBe('fighter');
  });
});
