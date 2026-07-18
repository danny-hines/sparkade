import { describe, expect, it } from 'vitest';
import { generationTemperature, parseRetryTokenBudget } from '../src/pipeline/runner';

describe('parse retry token budget', () => {
  it('grows repeated parse retries without exceeding the bounded surcharge', () => {
    expect(parseRetryTokenBudget(9_000, 1)).toBe(11_250);
    expect(parseRetryTokenBudget(9_000, 2)).toBe(13_000);
    expect(parseRetryTokenBudget(9_000, 99)).toBe(13_000);
  });

  it('normalizes invalid inputs to a finite positive allowance', () => {
    expect(parseRetryTokenBudget(0, 0)).toBe(2);
    expect(Number.isFinite(parseRetryTokenBudget(Number.NaN, Number.NaN))).toBe(true);
  });
});

describe('generation temperature', () => {
  it('starts level geometry deterministically and preserves creativity elsewhere', () => {
    expect(generationTemperature('levels', 0, 0.8)).toBe(0);
    expect(generationTemperature('design', 0, 0.8)).toBe(0.8);
    expect(generationTemperature('music', 0)).toBeUndefined();
  });

  it('makes every transient retry deterministic', () => {
    expect(generationTemperature('design', 1, 0.8)).toBe(0);
    expect(generationTemperature('repair', 2)).toBe(0);
  });
});
