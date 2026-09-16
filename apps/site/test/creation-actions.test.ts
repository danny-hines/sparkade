import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('../lib/signup-auth', () => ({ getSignupIdentity: vi.fn() }));
vi.mock('../lib/admin-auth', () => ({ getAdminIdentity: vi.fn(), requireAdminIdentity: vi.fn() }));
vi.mock('../lib/website-generation', () => ({
  createWebsiteGame: vi.fn(),
  resumeAdminWebsiteGame: vi.fn(),
  resumeWebsiteGame: vi.fn(),
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
import {
  createWebsiteGame,
  resumeAdminWebsiteGame,
  resumeWebsiteGame,
  retryWebsiteGame,
} from '../lib/website-generation';
import {
  createGameAction,
  retryGameAction,
  startAdminGameAction,
} from '../app/components/arcade-actions';
import { generateGameWorkflow } from '../workflows/generate-game';
import { start } from 'workflow/api';
import { ArcadeError, ActiveGameError } from '../lib/arcade';

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
    jobId: 'existing-job',
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
  vi.mocked(resumeWebsiteGame).mockResolvedValue({ id: 'job-id', attempt: 1 } as NonNullable<
    Awaited<ReturnType<typeof resumeWebsiteGame>>
  >);
  vi.mocked(resumeAdminWebsiteGame).mockResolvedValue({ id: 'job-id', attempt: 1 } as NonNullable<
    Awaited<ReturnType<typeof resumeAdminWebsiteGame>>
  >);
  vi.mocked(retryWebsiteGame).mockResolvedValue({
    id: 'existing-job',
    attempt: 2,
    public_id: 'retried-game',
  } as Awaited<ReturnType<typeof retryWebsiteGame>>);
});
describe('website retry action', () => {
  it('uses the authenticated owner and follows the retried game to its activity feed', async () => {
    await expect(retryGameAction(form())).rejects.toThrow(
      'REDIRECT:/me/games/retried-game?notice=Retry%20queued.',
    );
    expect(retryWebsiteGame).toHaveBeenCalledWith('session-owner', 'existing-job');
    expect(start).toHaveBeenCalledWith(generateGameWorkflow, ['existing-job', 2]);
  });
  it('keeps an accepted retry recoverable on its game page when dispatch fails', async () => {
    vi.mocked(start).mockRejectedValue(new Error('private dispatch error'));
    await expect(retryGameAction(form())).rejects.toThrow(
      'REDIRECT:/me/games/retried-game?notice=Your%20retry%20is%20saved.',
    );
    expect(retryWebsiteGame).toHaveBeenCalledTimes(1);
  });
  it('shows admission errors without dispatching or claiming the retry was saved', async () => {
    vi.mocked(retryWebsiteGame).mockRejectedValue(new ArcadeError('You need more credits.'));
    await expect(retryGameAction(form())).rejects.toThrow(
      'REDIRECT:/me?notice=You%20need%20more%20credits.',
    );
    vi.mocked(retryWebsiteGame).mockRejectedValue(new Error('private database error'));
    await expect(retryGameAction(form())).rejects.toThrow(
      'REDIRECT:/me?notice=Could%20not%20retry%20your%20game.',
    );
    expect(start).not.toHaveBeenCalled();
  });
  it('requires a verified account before holding credits or dispatching a retry', async () => {
    vi.mocked(getSignupIdentity).mockResolvedValue({
      userId: 'session-owner',
      emailVerified: false,
      createdAt: Date.now(),
    });
    await expect(retryGameAction(form())).rejects.toThrow('REDIRECT:/sign-in');
    expect(retryWebsiteGame).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
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
  it('ignores forged form roles and owner; ordinary users dispatch into automated review', async () => {
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
    expect(resumeWebsiteGame).toHaveBeenCalledWith(admin.userId, 'game-id');
    expect(start).toHaveBeenCalledWith(generateGameWorkflow, ['job-id', 1]);
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
    expect(resumeWebsiteGame).toHaveBeenCalledWith(admin.userId, 'game-id');
    expect(start).toHaveBeenCalledWith(generateGameWorkflow, ['job-id', 1]);
  });
  it('uses the authenticated owner regardless of admin identity and does not redispatch a running game', async () => {
    vi.mocked(getAdminIdentity).mockResolvedValue({ ...admin, userId: 'different-admin' });
    await expect(createGameAction({ error: '' }, form())).rejects.toThrow('REDIRECT:');
    expect(start).toHaveBeenCalledTimes(1);
    vi.mocked(start).mockClear();
    vi.mocked(getAdminIdentity).mockResolvedValue(admin);
    vi.mocked(resumeWebsiteGame).mockResolvedValue(null);
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
