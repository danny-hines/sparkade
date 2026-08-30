import { describe, expect, it } from 'vitest';
import { buildCreationPrompt } from '../src/creation-brief';

describe('creation brief prompt', () => {
  it('makes every automatic choice explicit', () => {
    expect(buildCreationPrompt({ heroName: '', archetypeLabel: '', details: '' })).toBe(
      'Spark decides the hero name. Spark decides the game type. Spark decides the story, enemies, setting, and visual style.',
    );
  });

  it('preserves player-supplied values while leaving other choices to Spark', () => {
    expect(
      buildCreationPrompt({
        heroName: 'Nova',
        archetypeLabel: '',
        details: 'Escape a neon zombie wasteland.',
      }),
    ).toBe(
      'Nova is the main character. Spark decides the game type. Escape a neon zombie wasteland.',
    );
  });
});
