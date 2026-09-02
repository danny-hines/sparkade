import { createHash, randomBytes } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { KioskFeedVisibility, KioskRegistrationStatus } from '@sparkade/shared';
import { atomicWriteFile, readJson } from '../util';

const IDENTITY_FILENAME = 'cloud-registration.json';
const TOKEN_PATTERN = /^spk_kiosk_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/;
const REQUEST_TIMEOUT_MS = 5_000;

type StoredIdentity = {
  version: 1;
  origin: string;
  credentialId: string;
  token: string;
  state: 'unregistered' | 'pairing' | 'registered' | 'expired' | 'revoked';
  pairingCode?: string;
  expiresAt?: string;
  kioskId?: string;
  name?: string;
  defaultFeedVisibility?: KioskFeedVisibility;
};

type RemoteRegistrationStatus =
  | {
      state: 'registered';
      kioskId: string | null;
      name: string;
      defaultFeedVisibility: KioskFeedVisibility;
      legacy?: boolean;
    }
  | { state: 'pending'; code: string; expiresAt: string }
  | { state: 'expired' | 'revoked' | 'unregistered' };

function newIdentity(origin: string): StoredIdentity {
  const credentialId = randomBytes(12).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  return {
    version: 1,
    origin,
    credentialId,
    token: `spk_kiosk_${credentialId}_${secret}`,
    state: 'unregistered',
  };
}

function validIdentity(value: StoredIdentity | null, origin: string): value is StoredIdentity {
  return (
    value?.version === 1 &&
    value.origin === origin &&
    TOKEN_PATTERN.test(value.token) &&
    TOKEN_PATTERN.exec(value.token)?.[1] === value.credentialId
  );
}

export class KioskRegistration {
  private identity: StoredIdentity | null;

  constructor(
    private readonly origin: string,
    dataDir: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly legacy?: { apiKey: string; kioskName: string },
  ) {
    this.identityPath = join(dataDir, IDENTITY_FILENAME);
    const stored = readJson<StoredIdentity>(this.identityPath);
    this.identity = validIdentity(stored, origin) ? stored : null;
  }

  private readonly identityPath: string;

  authorizationToken(): string | null {
    if (this.identity?.state === 'registered') return this.identity.token;
    return this.legacy?.apiKey ?? null;
  }

  kioskName(): string | null {
    if (this.identity?.state === 'registered') return this.identity.name ?? null;
    return this.legacy?.kioskName ?? null;
  }

  status(): KioskRegistrationStatus {
    if (this.identity?.state === 'registered') {
      return {
        state: 'registered',
        origin: this.origin,
        name: this.identity.name ?? 'Sparkade Cabinet',
        defaultFeedVisibility: this.identity.defaultFeedVisibility ?? 'unlisted',
      };
    }
    if (this.identity?.state === 'pairing') {
      return {
        state: 'pairing',
        origin: this.origin,
        pairingCode: this.identity.pairingCode,
        expiresAt: this.identity.expiresAt,
      };
    }
    if (this.identity) return { state: this.identity.state, origin: this.origin };
    if (this.legacy) {
      return {
        state: 'registered',
        origin: this.origin,
        name: this.legacy.kioskName,
        defaultFeedVisibility: 'listed',
        legacy: true,
      };
    }
    return { state: 'unregistered', origin: this.origin };
  }

  async startPairing(forceNewCredential = false): Promise<KioskRegistrationStatus> {
    if (!forceNewCredential && (this.identity?.state === 'registered' || this.legacy)) {
      return this.status();
    }
    if (
      forceNewCredential ||
      !this.identity ||
      this.identity.state === 'revoked' ||
      !validIdentity(this.identity, this.origin)
    ) {
      this.identity = newIdentity(this.origin);
      this.persist();
    }

    try {
      const response = await this.fetchImpl(new URL('/api/kiosk/pairings', this.origin), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          credentialId: this.identity.credentialId,
          secretHash: createHash('sha256').update(this.identity.token).digest('hex'),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`pairing service returned HTTP ${response.status}`);
      const payload = (await response.json()) as { code?: unknown; expiresAt?: unknown };
      if (typeof payload.code !== 'string' || typeof payload.expiresAt !== 'string') {
        throw new Error('pairing service returned an invalid response');
      }
      this.identity = {
        ...this.identity,
        state: 'pairing',
        pairingCode: payload.code,
        expiresAt: payload.expiresAt,
        kioskId: undefined,
        name: undefined,
        defaultFeedVisibility: undefined,
      };
      this.persist();
      return this.status();
    } catch (error) {
      return {
        ...this.status(),
        state: 'error',
        message: error instanceof Error ? error.message : 'pairing service unavailable',
      };
    }
  }

  async refresh(): Promise<KioskRegistrationStatus> {
    if (!this.identity) return this.status();
    try {
      const response = await this.fetchImpl(new URL('/api/kiosk/registration', this.origin), {
        headers: { authorization: `Bearer ${this.identity.token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`registration service returned HTTP ${response.status}`);
      const payload = (await response.json()) as RemoteRegistrationStatus;
      if (payload.state === 'registered') {
        this.identity = {
          ...this.identity,
          state: 'registered',
          pairingCode: undefined,
          expiresAt: undefined,
          kioskId: payload.kioskId ?? undefined,
          name: payload.name,
          defaultFeedVisibility: payload.defaultFeedVisibility,
        };
      } else if (payload.state === 'pending') {
        this.identity = {
          ...this.identity,
          state: 'pairing',
          pairingCode: payload.code,
          expiresAt: payload.expiresAt,
        };
      } else {
        this.identity = { ...this.identity, state: payload.state };
      }
      this.persist();
      return this.status();
    } catch (error) {
      return {
        ...this.status(),
        state: 'error',
        message: error instanceof Error ? error.message : 'registration service unavailable',
      };
    }
  }

  private persist(): void {
    if (!this.identity) return;
    atomicWriteFile(this.identityPath, `${JSON.stringify(this.identity, null, 2)}\n`);
    chmodSync(this.identityPath, 0o600);
  }
}
