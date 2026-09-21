import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../lib/kiosk-billing-access', () => ({ requireKioskBillingAdmin: vi.fn() }));
vi.mock('../lib/kiosk-meta-spend', () => ({ setMetaKeyLimits: vi.fn() }));
vi.mock('../lib/kiosk-meta-credentials', () => ({
  saveKioskMetaCredential: vi.fn(),
  assignKioskMetaCredential: vi.fn(),
  clearKioskMetaCredential: vi.fn(),
  disableKioskMetaCredential: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import { requireKioskBillingAdmin } from '../lib/kiosk-billing-access';
import * as credentials from '../lib/kiosk-meta-credentials';
import { setMetaKeyLimits } from '../lib/kiosk-meta-spend';
import {
  assignMetaCredentialAction,
  disableMetaCredentialAction,
  saveMetaCredentialAction,
  useSharedMetaCredentialAction,
  setMetaLimitsAction,
} from '../app/admin/kiosks/billing-actions';

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    kioskId: 'kiosk-a',
    credentialId: 'credential-a',
    actorUserId: 'attacker-supplied',
    label: 'Event',
    apiKey: 'private-test-credential-key',
  }))
    data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireKioskBillingAdmin).mockResolvedValue({
    userId: 'admin-a',
    email: 'test@example.com',
    displayName: 'Test',
    authorized: true,
  });
});
it('authorizes limit changes, including shared billing, using the signed-in actor', async () => {
  const data = form();
  data.set('keyId', 'shared');
  data.set('dailyUsd', '10');
  data.set('weeklyUsd', '50');
  data.set('concurrency', '4');
  vi.mocked(requireKioskBillingAdmin).mockRejectedValueOnce(new Error('Access denied'));
  await expect(setMetaLimitsAction(data)).rejects.toThrow('Access denied');
  expect(setMetaKeyLimits).not.toHaveBeenCalled();
  await expect(setMetaLimitsAction(data)).rejects.toThrow('tone=success');
  expect(setMetaKeyLimits).toHaveBeenCalledWith('admin-a', 'shared', {
    dailyUsd: '10',
    weeklyUsd: '50',
    concurrency: '4',
  });
});
it.each([
  [saveMetaCredentialAction, 'saveKioskMetaCredential'],
  [assignMetaCredentialAction, 'assignKioskMetaCredential'],
  [useSharedMetaCredentialAction, 'clearKioskMetaCredential'],
  [disableMetaCredentialAction, 'disableKioskMetaCredential'],
] as const)('requires billing authorization on every mutation', async (action, name) => {
  vi.mocked(requireKioskBillingAdmin).mockRejectedValue(new Error('Access denied'));
  await expect(action(form())).rejects.toThrow('Access denied');
  expect(credentials[name]).not.toHaveBeenCalled();
});
it('uses the authenticated actor and never includes submitted keys in redirects', async () => {
  await expect(saveMetaCredentialAction(form())).rejects.toThrow('tone=success');
  expect(credentials.saveKioskMetaCredential).toHaveBeenCalledWith(
    expect.objectContaining({ actorUserId: 'admin-a' }),
  );
  vi.mocked(credentials.saveKioskMetaCredential).mockRejectedValue(
    new Error('private-test-credential-key'),
  );
  const failure = await saveMetaCredentialAction(form()).catch((e) => e as Error);
  expect(failure.message).toContain('tone=error');
  expect(failure.message).not.toContain('private-test-credential-key');
  await expect(assignMetaCredentialAction(form())).rejects.toThrow('tone=success');
  expect(credentials.assignKioskMetaCredential).toHaveBeenCalledWith(
    'admin-a',
    'kiosk-a',
    'credential-a',
  );
});
