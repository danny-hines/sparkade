import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KIOSK_DISPLAY_COPY,
  parseKioskDisplayCopy,
  resolveKioskDisplayCopy,
} from '../src/kiosk-display-copy';

describe('kiosk display copy', () => {
  it('normalizes event copy and restores defaults for blank fields', () => {
    expect(
      parseKioskDisplayCopy({ title: '  Event   Arcade ', tagline: 'Your\nnext game' }),
    ).toEqual({ title: 'Event Arcade', tagline: 'Your next game' });
    expect(parseKioskDisplayCopy({ title: '', tagline: '  ' })).toEqual(DEFAULT_KIOSK_DISPLAY_COPY);
    expect(parseKioskDisplayCopy({ title: '', tagline: 'Event games' })).toEqual({
      title: 'Sparkade',
      tagline: 'Event games',
    });
  });

  it('rejects oversized, partial and malformed updates without losing the last good copy', () => {
    const cached = { title: 'Event Arcade', tagline: 'Welcome!' };
    for (const value of [
      null,
      {},
      { title: 'Event' },
      { title: 5, tagline: 'Hi' },
      { title: 'x'.repeat(41), tagline: 'Hi' },
      { title: 'Event', tagline: 'x'.repeat(121) },
      { title: 'Bad\u0000copy', tagline: 'Hi' },
    ]) {
      expect(parseKioskDisplayCopy(value)).toBeNull();
      expect(resolveKioskDisplayCopy(value, cached)).toEqual(cached);
      expect(resolveKioskDisplayCopy(value)).toEqual(DEFAULT_KIOSK_DISPLAY_COPY);
    }
  });
});
