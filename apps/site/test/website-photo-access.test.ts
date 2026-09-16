import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('../lib/admin-auth', () => ({ getAdminIdentity: vi.fn() }));
vi.mock('../lib/website-photo', () => ({ readWebsitePhoto: vi.fn() }));
import { auth } from '@clerk/nextjs/server';
import { getAdminIdentity } from '../lib/admin-auth';
import { readWebsitePhoto } from '../lib/website-photo';
import { GET } from '../app/api/me/games/[id]/photo/route';

const request = () =>
  GET(new Request('http://localhost/api/me/games/game-a/photo'), {
    params: Promise.resolve({ id: 'game-a' }),
  });
beforeEach(() => vi.resetAllMocks());
function session(userId: string | null) {
  vi.mocked(auth).mockResolvedValue({ userId } as Awaited<ReturnType<typeof auth>>);
}
describe('source photo authorization', () => {
  it('denies anonymous reads without loading a photo', async () => {
    session(null);
    expect((await request()).status).toBe(404);
    expect(readWebsitePhoto).not.toHaveBeenCalled();
  });
  it('serves an owner’s source with private cache and image headers', async () => {
    session('owner');
    vi.mocked(readWebsitePhoto).mockResolvedValue(Buffer.from('photo'));
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('photo');
    expect(readWebsitePhoto).toHaveBeenCalledWith('game-a', 'owner');
    expect(getAdminIdentity).not.toHaveBeenCalled();
  });
  it('does not give another signed-in user admin access', async () => {
    session('other');
    vi.mocked(readWebsitePhoto).mockResolvedValue(null);
    vi.mocked(getAdminIdentity).mockResolvedValue(null);
    expect((await request()).status).toBe(404);
    expect(readWebsitePhoto).toHaveBeenCalledTimes(1);
  });
  it('allows an authorized reviewer to load the source', async () => {
    session('reviewer');
    vi.mocked(readWebsitePhoto)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(Buffer.from('photo'));
    vi.mocked(getAdminIdentity).mockResolvedValue({
      authorized: true,
      userId: 'reviewer',
      email: '',
      displayName: 'Admin',
    });
    expect((await request()).status).toBe(200);
    expect(readWebsitePhoto).toHaveBeenLastCalledWith('game-a', 'reviewer', true);
  });
});
