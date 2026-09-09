import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdate } from '../src/system/update';

const { git } = vi.hoisted(() => ({ git: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: git, spawn: vi.fn() }));

const current = '0.1.0';
const installed = '1'.repeat(40);
const newer = '2'.repeat(40);
const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
const failed = (stderr: string) => ({ status: 128, stdout: '', stderr });

beforeEach(() => {
  git.mockReset();
});

describe('software update checks', () => {
  it.each([
    { remote: newer, available: true, latest: 'main' },
    { remote: installed, available: false, latest: current },
  ])('compares fetched main commits (available=$available)', ({ remote, available, latest }) => {
    git
      .mockReturnValueOnce(ok())
      .mockReturnValueOnce(ok(installed))
      .mockReturnValueOnce(ok(remote))
      .mockReturnValueOnce(failed('fatal: No names found, cannot describe anything.'));

    expect(checkForUpdate(current)).toEqual({ current, latest, available });
  });

  it('compares a release tag when one exists', () => {
    git
      .mockReturnValueOnce(ok())
      .mockReturnValueOnce(ok(installed))
      .mockReturnValueOnce(ok(newer))
      .mockReturnValueOnce(ok('v0.2.0\n'))
      .mockReturnValueOnce(ok(newer));

    expect(checkForUpdate(current)).toEqual({ current, latest: 'v0.2.0', available: true });
  });

  it('reports a fetch failure without comparing stale refs', () => {
    git.mockReturnValueOnce(failed('fatal: Could not resolve host: github.com\n'));

    expect(checkForUpdate(current)).toEqual({
      current,
      latest: null,
      available: false,
      error: 'fatal: Could not resolve host: github.com',
    });
    expect(git).toHaveBeenCalledTimes(1);
  });

  it('reports process errors when Git produces no stderr', () => {
    git.mockReturnValueOnce({
      status: null,
      stdout: null,
      stderr: null,
      error: new Error('ETIMEDOUT'),
    });

    expect(checkForUpdate(current)).toMatchObject({ latest: null, error: 'ETIMEDOUT' });
  });

  it.each(['HEAD', 'origin/main', 'v0.2.0'])('reports an unreadable %s revision', (ref) => {
    git.mockImplementation((_command: string, args: string[]) => {
      const [operation, ...rest] = args.slice(2);
      if (operation === 'fetch') return ok();
      if (operation === 'describe') return ok('v0.2.0');
      if (rest.includes(`${ref}^{commit}`)) return failed(`fatal: invalid revision ${ref}`);
      return ok(installed);
    });

    expect(checkForUpdate(current)).toEqual({
      current,
      latest: null,
      available: false,
      error: `fatal: invalid revision ${ref}`,
    });
  });

  it.each(['', 'HEAD^{commit}'])(
    'rejects an unresolved revision even with a successful exit (%j)',
    (ref) => {
      git.mockReturnValueOnce(ok()).mockReturnValueOnce(ok(ref));

      expect(checkForUpdate(current)).toMatchObject({
        latest: null,
        available: false,
        error: 'Could not read Git revision HEAD',
      });
    },
  );
});
