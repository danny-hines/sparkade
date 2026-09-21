import { afterEach, expect, it, vi } from 'vitest';
import {
  decryptKioskMetaKey,
  encryptKioskMetaKey,
  kioskMetaEncryptionConfigured,
  normalizeMetaApiKey,
} from '../lib/kiosk-meta-secret';

const apiKey = 'test-meta-event-key-not-a-real-secret';
afterEach(() => vi.unstubAllEnvs());

it('encrypts with randomized authenticated ciphertext bound to credential and environment', () => {
  vi.stubEnv('SPARKADE_KIOSK_META_SECRET', 'a1'.repeat(32));
  const first = encryptKioskMetaKey(apiKey, 'production', 'credential-a');
  expect(first).not.toContain(apiKey);
  expect(encryptKioskMetaKey(apiKey, 'production', 'credential-a')).not.toBe(first);
  expect(decryptKioskMetaKey(first, 'production', 'credential-a')).toBe(apiKey);
  expect(() => decryptKioskMetaKey(first, 'preview', 'credential-a')).toThrow(
    'cannot be decrypted',
  );
  expect(() => decryptKioskMetaKey(first, 'production', 'credential-b')).toThrow(
    'cannot be decrypted',
  );
  const parts = first.split('.');
  parts[3] = Buffer.from('tampered-secret').toString('base64url');
  expect(() => decryptKioskMetaKey(parts.join('.'), 'production', 'credential-a')).toThrow(
    'cannot be decrypted',
  );
  vi.stubEnv('SPARKADE_KIOSK_META_SECRET', 'b2'.repeat(32));
  expect(() => decryptKioskMetaKey(first, 'production', 'credential-a')).toThrow(
    'cannot be decrypted',
  );
});

it('rejects missing encryption configuration and malformed keys without exposing input', () => {
  vi.stubEnv('SPARKADE_KIOSK_META_SECRET', '');
  expect(kioskMetaEncryptionConfigured()).toBe(false);
  expect(() => encryptKioskMetaKey(apiKey, 'production', 'id')).toThrow(
    'storage is not configured',
  );
  expect(normalizeMetaApiKey(` ${apiKey}\n`)).toBe(apiKey);
  for (const key of [
    '',
    'short',
    'x'.repeat(4097),
    `invalid key ${apiKey}`,
    `invalid\u0000${apiKey}`,
  ]) {
    expect(() => normalizeMetaApiKey(key)).toThrow('Enter a Meta API key');
  }
});
