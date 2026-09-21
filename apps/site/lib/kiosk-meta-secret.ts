import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class KioskBillingError extends Error {}

export function kioskMetaEncryptionConfigured(): boolean {
  return /^[a-fA-F0-9]{64}$/.test(process.env.SPARKADE_KIOSK_META_SECRET ?? '');
}

function encryptionKey(): Buffer {
  if (!kioskMetaEncryptionConfigured()) {
    throw new KioskBillingError(
      'Kiosk credential storage is not configured. Set SPARKADE_KIOSK_META_SECRET to a 32-byte hex secret on the server.',
    );
  }
  return Buffer.from(process.env.SPARKADE_KIOSK_META_SECRET!, 'hex');
}

export function normalizeMetaApiKey(value: string): string {
  const key = value.trim();
  if (!/^[\x21-\x7e]{20,4096}$/.test(key)) {
    throw new KioskBillingError('Enter a Meta API key of 20–4096 characters with no spaces.');
  }
  return key;
}

export function encryptKioskMetaKey(key: string, scope: string, id: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`sparkade:kiosk-meta:v1:${scope}:${id}`));
  const ciphertext = Buffer.concat([
    cipher.update(normalizeMetaApiKey(key), 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptKioskMetaKey(value: string, scope: string, id: string): string {
  const key = encryptionKey();
  try {
    const [version, iv, tag, ciphertext, extra] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext || extra !== undefined) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`sparkade:kiosk-meta:v1:${scope}:${id}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return normalizeMetaApiKey(
      Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8'),
    );
  } catch {
    throw new KioskBillingError(
      'The stored Meta credential cannot be decrypted. Restore the server encryption secret or replace the credential.',
    );
  }
}
