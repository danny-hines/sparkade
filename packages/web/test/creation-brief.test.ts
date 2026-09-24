import { describe, expect, it } from 'vitest';
import { buildCreationPrompt } from '../src/creation-brief';

describe('creation brief prompt', () => {
  it('makes every automatic choice explicit', () => {
    expect(buildCreationPrompt({ heroName: '', archetypeLabel: '', details: '' })).toBe(
      'Muse decides the hero name. Muse decides the game type. Muse decides the story, enemies, setting, and visual style.',
    );
  });

  it('preserves player-supplied values while leaving other choices to Muse', () => {
    expect(
      buildCreationPrompt({
        heroName: 'Nova',
        archetypeLabel: '',
        details: 'Escape a neon zombie wasteland.',
      }),
    ).toBe(
      'Nova is the main character. Muse decides the game type. Escape a neon zombie wasteland.',
    );
  });

  it('carries an explicitly chosen racing type into the prompt', () => {
    expect(
      buildCreationPrompt({
        heroName: 'Nova',
        archetypeLabel: 'Racing',
        details: 'Neon harbor cup.',
      }),
    ).toBe('Nova is the main character. Make it a Racing game. Neon harbor cup.');
  });
});
