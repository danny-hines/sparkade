import { describe, expect, it } from 'vitest';
import { validateUsername } from '../lib/usernames';

describe('public username screening', () => {
  it('canonicalizes case and surrounding spaces, with useful punctuation', () => {
    expect(validateUsername('  Moon_Racer-42  ')).toBe('moon_racer-42');
    expect(validateUsername('a'.repeat(24))).toBe('a'.repeat(24));
    expect(validateUsername('ace')).toBe('ace');
  });
  it.each([
    'ab',
    'a'.repeat(25),
    '-ace',
    'ace_',
    'moon racer',
    'аdmin',
    '<script>',
    'one/two',
    'a\nb',
  ])('rejects malformed name %j', (name) => {
    expect(() => validateUsername(name)).toThrow('3–24');
  });
  it.each(['ADMIN', 'sparkade-team', 's_u_p_p_o_r_t', '0fficial-player', 'player-123456789abc'])(
    'reserves system identity %j',
    (name) => {
      expect(() => validateUsername(name)).toThrow('reserved');
    },
  );
  it.each(['f_u_c_k', 'sh1thead', 'n4zi-racer', 'p0rn-king', 'sex'])(
    'screens explicit and obfuscated name %j',
    (name) => {
      expect(() => validateUsername(name)).toThrow('offensive');
    },
  );
  it('permits ordinary names containing short ambiguous words', () => {
    expect(validateUsername('classic-racer')).toBe('classic-racer');
    expect(validateUsername('dickens')).toBe('dickens');
  });
});
