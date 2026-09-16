import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../lib/admin-auth', () => ({ getAdminIdentity: vi.fn(), requireAdminIdentity: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/kiosks', () => ({
  isFeedVisibility: (value: string) => ['listed', 'unlisted'].includes(value),
  PairingCodeError: class extends Error {},
  claimKioskPairing: vi.fn(),
  updateManagedKiosk: vi.fn(),
  revokeManagedKiosk: vi.fn(),
}));
vi.mock('../lib/public-games', () => ({ setPublicGameFeedVisibility: vi.fn() }));
import { getAdminIdentity, requireAdminIdentity } from '../lib/admin-auth';
import { getAdminPageIdentity } from '../app/admin/page-access';
import {
  pairKioskAction,
  renameKioskAction,
  revokeKioskAction,
  setKioskVisibilityAction,
  setGameVisibilityAction,
} from '../app/admin/actions';
import { claimKioskPairing, updateManagedKiosk, revokeManagedKiosk } from '../lib/kiosks';
import { setPublicGameFeedVisibility } from '../lib/public-games';
const identity = {
  userId: 'admin-one',
  email: 'test@example.com',
  displayName: 'Admin',
  authorized: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAdminIdentity).mockResolvedValue(identity);
  vi.mocked(claimKioskPairing).mockResolvedValue({ name: 'Test cabinet' } as Awaited<
    ReturnType<typeof claimKioskPairing>
  >);
  vi.mocked(updateManagedKiosk).mockResolvedValue(true);
  vi.mocked(revokeManagedKiosk).mockResolvedValue(true);
  vi.mocked(setPublicGameFeedVisibility).mockResolvedValue(true);
});
function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    code: 'BCDF-GHJK',
    name: 'Test cabinet',
    kioskId: 'kiosk-one',
    gameId: 'bcd2345',
    defaultFeedVisibility: 'unlisted',
    feedVisibility: 'listed',
  }))
    data.set(key, value);
  return data;
}
describe('admin page access', () => {
  it('preserves the requested page through guest sign-in', async () => {
    vi.mocked(getAdminIdentity).mockResolvedValue(null);
    await expect(getAdminPageIdentity('/admin/creation/bcd2345')).rejects.toThrow(
      'REDIRECT:/sign-in?redirect_url=%2Fadmin%2Fcreation%2Fbcd2345',
    );
  });
  it('does not admit a signed-in non-admin', async () => {
    vi.mocked(getAdminIdentity).mockResolvedValue({ ...identity, authorized: false });
    expect(await getAdminPageIdentity('/admin/invites')).toBeNull();
  });
  it('returns the verified admin identity for data scoping', async () => {
    vi.mocked(getAdminIdentity).mockResolvedValue(identity);
    expect(await getAdminPageIdentity('/admin/kiosks')).toEqual(identity);
  });
});
describe('admin form destinations', () => {
  const cases = [
    ['pair', pairKioskAction, '/admin/kiosks'],
    ['rename', renameKioskAction, '/admin/kiosks'],
    ['kiosk visibility', setKioskVisibilityAction, '/admin/kiosks'],
    ['revoke', revokeKioskAction, '/admin/kiosks'],
    ['game visibility', setGameVisibilityAction, '/admin/games'],
  ] as const;
  it.each(cases)('%s returns to its own section', async (_label, action, path) => {
    await expect(action(form())).rejects.toThrow(`REDIRECT:${path}?notice=`);
  });
  it.each(cases)('%s still authenticates every mutation', async (_label, action) => {
    vi.mocked(requireAdminIdentity).mockRejectedValue(new Error('Access denied'));
    await expect(action(form())).rejects.toThrow('Access denied');
    expect(claimKioskPairing).not.toHaveBeenCalled();
    expect(updateManagedKiosk).not.toHaveBeenCalled();
    expect(revokeManagedKiosk).not.toHaveBeenCalled();
    expect(setPublicGameFeedVisibility).not.toHaveBeenCalled();
  });
  it('keeps failed pairing on Kiosks with an error notice', async () => {
    vi.mocked(claimKioskPairing).mockRejectedValue(new Error('unavailable'));
    await expect(pairKioskAction(form())).rejects.toThrow(
      'REDIRECT:/admin/kiosks?notice=Could+not+pair+that+kiosk.&tone=error',
    );
  });
});
