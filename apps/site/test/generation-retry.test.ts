import { describe, expect, it } from 'vitest';
import { autoRetryEligible, transientProviderDelayMs } from '../lib/generation/retry';

const kiosk = { owner: 'kiosk:kiosk-a', attempt: 1, checkpoint: 'checkpoint-url' };

describe('automatic kiosk retry eligibility', () => {
  it('retries the first failed kiosk attempt, including art and provider failures', () => {
    for (const code of ['image-invalid', 'image-content-policy', 'provider-error', 'cloud-step', undefined])
      expect(autoRetryEligible(kiosk, code)).toBe(true);
  });

  it('never retries twice, website jobs, expired checkpoints, or unfixable failures', () => {
    expect(autoRetryEligible({ ...kiosk, attempt: 2 }, 'image-invalid')).toBe(false);
    expect(autoRetryEligible({ ...kiosk, owner: 'website:user-1' }, 'image-invalid')).toBe(false);
    expect(autoRetryEligible({ ...kiosk, checkpoint: '' }, 'image-invalid')).toBe(false);
    for (const code of ['auth', 'canceled', 'image-config', 'suspended'])
      expect(autoRetryEligible(kiosk, code)).toBe(false);
  });
});

describe('transient provider backoff', () => {
  it('spaces paid attempts out and honors a longer Retry-After up to five minutes', () => {
    expect([1, 2, 3, 4].map((n) => transientProviderDelayMs(n, null))).toEqual([5000, 20000, 60000, 60000]);
    expect(transientProviderDelayMs(1, 120)).toBe(120000);
    expect(transientProviderDelayMs(3, 2)).toBe(60000);
    expect(transientProviderDelayMs(1, 3600)).toBe(300000);
  });
});
