import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('../lib/signup-auth', () => ({ getSignupIdentity: vi.fn() }));
vi.mock('../lib/admin-auth', () => ({ getAdminIdentity: vi.fn(), requireAdminIdentity: vi.fn() }));
vi.mock('../lib/website-generation', () => ({
  createWebsiteGame: vi.fn(),
  resumeAdminWebsiteGame: vi.fn(),
  cancelWebsiteGame: vi.fn(),
  retryWebsiteGame: vi.fn(),
}));
vi.mock('../workflows/generate-game', () => ({ generateGameWorkflow: vi.fn() }));
vi.mock('workflow/api', () => ({ start: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import { getSignupIdentity } from '../lib/signup-auth';
import { getAdminIdentity, requireAdminIdentity } from '../lib/admin-auth';
import { createWebsiteGame, resumeAdminWebsiteGame } from '../lib/website-generation';
import { createGameAction, startAdminGameAction } from '../app/components/arcade-actions';
import { generateGameWorkflow } from '../workflows/generate-game';
import { start } from 'workflow/api';
import { ActiveGameError } from '../lib/arcade';

const admin = {
  userId: 'session-owner',
  authorized: true,
  email: 'admin@example.test',
  displayName: 'Admin',
};
function form() {
  const f = new FormData();
  Object.entries({
    prompt: 'Moon race',
    archetype: 'racing',
    key: 'submission-key-123',
    heroName: 'Hero',
    userId: 'forged-admin',
    admin_bypass: 'true',
    authorized: 'true',
    id: 'existing-game',
  }).forEach(([k, v]) => f.set(k, v));
  return f;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSignupIdentity).mockResolvedValue({
    userId: admin.userId,
    emailVerified: true,
    createdAt: Date.now(),
  });
  vi.mocked(getAdminIdentity).mockResolvedValue({ ...admin, authorized: false });
  vi.mocked(createWebsiteGame).mockResolvedValue('game-id');
  vi.mocked(resumeAdminWebsiteGame).mockResolvedValue({ id: 'job-id', attempt: 1 } as NonNullable<
    Awaited<ReturnType<typeof resumeAdminWebsiteGame>>
  >);
});
describe('website creation authorization and dispatch', () => {
  it('returns the precise queue limit with the authenticated owner’s progress links', async () => {
    const games = [1, 2, 3].map((n) => ({ id: `game-${n}`, title: `Game ${n}` }));
    vi.mocked(createWebsiteGame).mockRejectedValue(new ActiveGameError(games));
    expect(await createGameAction({ error: '' }, form())).toEqual({
      error:
        'You already have 3 games in progress. Wait for one to finish before starting another.',
      activeGames: games,
    });
    expect(start).not.toHaveBeenCalled();
  });
  it('ignores forged form roles and owner; ordinary users remain subject to review', async () => {
    await expect(createGameAction({ error: '' }, form())).rejects.toThrow(
      'REDIRECT:/me/games/game-id',
    );
    expect(createWebsiteGame).toHaveBeenCalledWith(
      'session-owner',
      'Moon race',
      'racing',
      'submission-key-123',
      'Hero',
      null,
      { ...admin, authorized: false },
    );
    expect(resumeAdminWebsiteGame).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
  it('uses the server admin identity and dispatches accepted games immediately', async () => {
    vi.mocked(getAdminIdentity).mockResolvedValue(admin);
    await expect(createGameAction({ error: '' }, form())).rejects.toThrow(
      'REDIRECT:/me/games/game-id',
    );
    expect(createWebsiteGame).toHaveBeenLastCalledWith(
      'session-owner',
      'Moon race',
      'racing',
      'submission-key-123',
      'Hero',
      null,
      admin,
    );
    expect(resumeAdminWebsiteGame).toHaveBeenCalledWith(admin, 'game-id');
    expect(start).toHaveBeenCalledWith(generateGameWorkflow, ['job-id', 1]);
  });
  it('does not dispatch if the server identities disagree or a duplicate is already running', async () => {
    vi.mocked(getAdminIdentity).mockResolvedValue({ ...admin, userId: 'different-admin' });
    await expect(createGameAction({ error: '' }, form())).rejects.toThrow('REDIRECT:');
    expect(start).not.toHaveBeenCalled();
    vi.mocked(getAdminIdentity).mockResolvedValue(admin);
    vi.mocked(resumeAdminWebsiteGame).mockResolvedValue(null);
    await expect(createGameAction({ error: '' }, form())).rejects.toThrow('REDIRECT:');
    expect(start).not.toHaveBeenCalled();
  });
  it('keeps accepted games recoverable after dispatch failure', async () => {
    vi.mocked(getAdminIdentity).mockResolvedValue(admin);
    vi.mocked(start).mockRejectedValue(new Error('private provider failure'));
    await expect(createGameAction({ error: '' }, form())).rejects.toThrow(
      'REDIRECT:/me/games/game-id?notice=Your%20game%20is%20saved.',
    );
    expect(createWebsiteGame).toHaveBeenCalledTimes(1);
  });
  it('requires verified signup before admission or dispatch', async () => {
    vi.mocked(getSignupIdentity).mockResolvedValue(null);
    await expect(createGameAction({ error: '' }, form())).rejects.toThrow('REDIRECT:/sign-in');
    vi.mocked(getSignupIdentity).mockResolvedValue({
      userId: admin.userId,
      emailVerified: false,
      createdAt: Date.now(),
    });
    expect(await createGameAction({ error: '' }, form())).toEqual({
      error: 'Verify your email before creating a game.',
    });
    expect(createWebsiteGame).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
  it('requires admin authorization to resume and passes only the authenticated identity', async () => {
    vi.mocked(requireAdminIdentity).mockRejectedValue(new Error('Admin access denied'));
    await expect(startAdminGameAction(form())).rejects.toThrow('Admin access denied');
    expect(resumeAdminWebsiteGame).not.toHaveBeenCalled();
    vi.mocked(requireAdminIdentity).mockResolvedValue(admin);
    await expect(startAdminGameAction(form())).rejects.toThrow('REDIRECT:/me/games/existing-game');
    expect(resumeAdminWebsiteGame).toHaveBeenCalledWith(admin, 'existing-game');
    expect(start).toHaveBeenCalledWith(generateGameWorkflow, ['job-id', 1]);
  });
});
