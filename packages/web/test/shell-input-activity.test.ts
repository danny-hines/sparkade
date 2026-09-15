import { afterEach, describe, expect, it } from 'vitest';
import { shellInput } from '../src/shell-input';

describe('shell input native activity', () => {
  afterEach(() => {
    shellInput.onAnyInput = null;
  });

  it('reports native interactions (typing/clicks) as user activity', () => {
    let reports = 0;
    shellInput.onAnyInput = () => {
      reports += 1;
    };
    shellInput.pokeActivity();
    shellInput.pokeActivity();
    expect(reports).toBe(2);
  });

  it('tolerates no activity listener', () => {
    expect(() => shellInput.pokeActivity()).not.toThrow();
  });
});
