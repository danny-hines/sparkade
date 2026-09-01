import { describe, expect, it } from 'vitest';
import { normalizeTranscribedHeroName } from '../src/transcription';

describe('transcribed hero names', () => {
  it('removes sentence punctuation appended to a spoken name', () => {
    expect(normalizeTranscribedHeroName('Bort.')).toBe('Bort');
    expect(normalizeTranscribedHeroName('Amélie,')).toBe('Amélie');
    expect(normalizeTranscribedHeroName('Zelda!?')).toBe('Zelda');
  });

  it('preserves meaningful punctuation inside names', () => {
    expect(normalizeTranscribedHeroName("O'Connor.")).toBe("O'Connor");
    expect(normalizeTranscribedHeroName('Jean-Luc.')).toBe('Jean-Luc');
    expect(normalizeTranscribedHeroName('Dr. Doom.')).toBe('Dr. Doom');
  });

  it('preserves names that consist entirely of initials', () => {
    expect(normalizeTranscribedHeroName('J.')).toBe('J.');
    expect(normalizeTranscribedHeroName('J.R.R.')).toBe('J.R.R.');
  });
});
