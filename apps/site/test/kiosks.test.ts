import { describe, expect, it } from 'vitest';
import {
  hashKioskCredential,
  isFeedVisibility,
  KIOSK_TOKEN_PATTERN,
  normalizeKioskName,
  normalizePairingCode,
} from '../lib/kiosks';

describe('kiosk pairing validation', () => {
  it('normalizes readable pairing codes and rejects ambiguous characters', () => {
    expect(normalizePairingCode('k7m4 pq9d')).toBe('K7M4-PQ9D');
    expect(normalizePairingCode('K7M4-IQ9D')).toBeNull();
    expect(normalizePairingCode('short')).toBeNull();
  });

  it('normalizes safe display names', () => {
    expect(normalizeKioskName('  Meta   SEA  ')).toBe('Meta SEA');
    expect(normalizeKioskName('')).toBeNull();
    expect(normalizeKioskName(`Meta\u0000SEA`)).toBeNull();
    expect(normalizeKioskName('x'.repeat(81))).toBeNull();
  });

  it('recognizes device credentials without exposing their raw value', () => {
    const token = `spk_kiosk_${'a'.repeat(16)}_${'b'.repeat(43)}`;
    expect(KIOSK_TOKEN_PATTERN.test(token)).toBe(true);
    expect(hashKioskCredential(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashKioskCredential(token)).not.toContain(token);
  });

  it('accepts only supported feed visibility states', () => {
    expect(isFeedVisibility('listed')).toBe(true);
    expect(isFeedVisibility('unlisted')).toBe(true);
    expect(isFeedVisibility('admin-only')).toBe(false);
  });
});
