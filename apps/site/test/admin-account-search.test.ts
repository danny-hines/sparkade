import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../lib/admin-auth', () => ({ getAdminIdentity: vi.fn() }));
vi.mock('../lib/admin-account-search', () => ({ searchAdminAccounts: vi.fn() }));
import { getAdminIdentity } from '../lib/admin-auth';
import { searchAdminAccounts } from '../lib/admin-account-search';
import { GET } from '../app/api/admin/accounts/search/route';

const admin = {
  userId: 'admin',
  email: 'admin@example.com',
  displayName: 'Admin',
  authorized: true,
};
const request = (q: string) =>
  new Request(`http://localhost/api/admin/accounts/search?q=${encodeURIComponent(q)}`);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAdminIdentity).mockResolvedValue(admin);
});

describe('private account search endpoint', () => {
  it.each([null, { ...admin, authorized: false }])(
    'rejects unauthorized access before any email lookup',
    async (identity) => {
      vi.mocked(getAdminIdentity).mockResolvedValue(identity);
      const response = await GET(request('pilot'));
      expect(response.status).toBe(identity ? 403 : 401);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(searchAdminAccounts).not.toHaveBeenCalled();
    },
  );
  it.each(['', 'a', '@a'])('does not query the directory for too-short input %s', async (q) => {
    const response = await GET(request(q));
    expect(await response.json()).toEqual({ accounts: [], more: false });
    expect(searchAdminAccounts).not.toHaveBeenCalled();
  });
  it.each(['a'.repeat(255), 'moon\u0000pilot'])(
    'rejects invalid queries before lookup',
    async (q) => {
      expect((await GET(request(q))).status).toBe(400);
      expect(searchAdminAccounts).not.toHaveBeenCalled();
    },
  );
  it('returns only the search result and forbids caching private email data', async () => {
    const result = {
      accounts: [
        { userId: 'a', handle: 'pilot', email: 'a@example.com', balance: 7, suspended: false },
      ],
      more: false,
    };
    vi.mocked(searchAdminAccounts).mockResolvedValue(result);
    const response = await GET(request(' pilot '));
    expect(searchAdminAccounts).toHaveBeenCalledWith('pilot');
    expect(await response.json()).toEqual(result);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('does not expose provider failures or authentication internals', async () => {
    vi.mocked(searchAdminAccounts).mockRejectedValue(new Error('secret database connection'));
    const response = await GET(request('pilot'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Could not search accounts. Please try again.',
    });
    vi.mocked(getAdminIdentity).mockRejectedValue(new Error('secret auth error'));
    expect((await GET(request('pilot'))).status).toBe(503);
  });
});
