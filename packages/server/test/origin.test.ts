import { describe, expect, it } from 'vitest';
import { isSameHttpOrigin } from '../src/api/origin';

describe('LAN same-origin matching', () => {
  it('accepts the Pi IP or hostname only when it matches the request host', () => {
    expect(isSameHttpOrigin('http://192.168.1.42:8080', '192.168.1.42:8080')).toBe(true);
    expect(isSameHttpOrigin('http://sparkade.local:8080', 'sparkade.local:8080')).toBe(true);
    expect(isSameHttpOrigin('http://other.local:8080', 'sparkade.local:8080')).toBe(false);
    expect(isSameHttpOrigin('https://sparkade.local:8080', 'sparkade.local:8080')).toBe(false);
    expect(isSameHttpOrigin(undefined, 'sparkade.local:8080')).toBe(false);
  });
});
