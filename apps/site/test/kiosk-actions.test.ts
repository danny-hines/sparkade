import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_KIOSK_DISPLAY_COPY } from '@sparkade/shared';

vi.mock('../lib/admin-auth', () => ({ requireAdminIdentity: vi.fn() }));
vi.mock('../lib/kiosks', () => ({ updateManagedKiosk: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import { requireAdminIdentity } from '../lib/admin-auth';
import { updateManagedKiosk } from '../lib/kiosks';
import { setKioskDisplayCopyAction } from '../app/admin/actions';

function form(title = 'Event Arcade', tagline = 'Welcome!') {
  const data = new FormData();
  data.set('kioskId', 'kiosk-1');
  data.set('title', title);
  data.set('tagline', tagline);
  // The action must take ownership from the signed-in identity, never this value.
  data.set('ownerUserId', 'someone-else');
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAdminIdentity).mockResolvedValue({
    userId: 'admin-1',
    email: 'admin@example.com',
    displayName: 'Admin',
    authorized: true,
  });
  vi.mocked(updateManagedKiosk).mockResolvedValue(true);
});

it('authenticates display copy updates and scopes them to the current owner', async () => {
  await expect(setKioskDisplayCopyAction(form())).rejects.toThrow('tone=success');
  expect(updateManagedKiosk).toHaveBeenCalledWith({
    kioskId: 'kiosk-1',
    ownerUserId: 'admin-1',
    displayCopy: { title: 'Event Arcade', tagline: 'Welcome!' },
  });
});

it('rejects unauthenticated and invalid updates', async () => {
  await expect(setKioskDisplayCopyAction(form('x'.repeat(41)))).rejects.toThrow('tone=error');
  expect(updateManagedKiosk).not.toHaveBeenCalled();
  vi.mocked(requireAdminIdentity).mockRejectedValue(new Error('Sign in required'));
  await expect(setKioskDisplayCopyAction(form())).rejects.toThrow('Sign in required');
  expect(updateManagedKiosk).not.toHaveBeenCalled();
});

it('supports restoring defaults and reports rejected ownership or revoked kiosks', async () => {
  await expect(setKioskDisplayCopyAction(form('', ''))).rejects.toThrow('tone=success');
  expect(updateManagedKiosk).toHaveBeenCalledWith(
    expect.objectContaining({ displayCopy: DEFAULT_KIOSK_DISPLAY_COPY }),
  );
  vi.mocked(updateManagedKiosk).mockResolvedValue(false);
  await expect(setKioskDisplayCopyAction(form())).rejects.toThrow('tone=error');
});
