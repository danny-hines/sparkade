import { beforeEach, describe, expect, it, vi } from 'vitest';

const steps = vi.hoisted(() => ({
  claimGeneration: vi.fn(),
  advanceGeneration: vi.fn(),
  runProviderRequest: vi.fn(),
  publishGeneration: vi.fn(),
  cleanupGeneration: vi.fn(),
  failGeneration: vi.fn(),
}));
vi.mock('../lib/generation/steps', () => steps);
import { generateGameWorkflow } from '../workflows/generate-game';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const pass = (pending: string[], completed: string[] = [], done = false) => ({
  pending,
  completed,
  done,
  stopped: false,
});
beforeEach(() => {
  vi.resetAllMocks();
  steps.claimGeneration.mockResolvedValue(true);
});

describe('cloud generation scheduling', () => {
  it('unlocks the hero review while scenery is still running and never dispatches twice', async () => {
    const hero = deferred(),
      scenery = deferred(),
      review = deferred();
    steps.runProviderRequest.mockImplementation(
      (_job, _attempt, id) =>
        ({
          hero: hero.promise,
          scenery: scenery.promise,
          review: review.promise,
        })[id as 'hero' | 'scenery' | 'review'],
    );
    steps.advanceGeneration
      .mockResolvedValueOnce(pass(['hero', 'scenery']))
      .mockResolvedValueOnce(pass(['scenery', 'review'], ['hero']))
      .mockResolvedValueOnce(pass(['scenery'], ['hero', 'review']))
      .mockResolvedValueOnce(pass([], ['hero', 'scenery', 'review'], true));
    const run = generateGameWorkflow('job', 1);
    await vi.waitFor(() => expect(steps.runProviderRequest).toHaveBeenCalledTimes(2));
    hero.resolve();
    await vi.waitFor(() =>
      expect(steps.runProviderRequest).toHaveBeenCalledWith('job', 1, 'review'),
    );
    expect(steps.publishGeneration).not.toHaveBeenCalled();
    review.resolve();
    await vi.waitFor(() => expect(steps.advanceGeneration).toHaveBeenCalledTimes(3));
    scenery.resolve();
    await run;
    expect(steps.runProviderRequest.mock.calls.map((args) => args[2])).toEqual([
      'hero',
      'scenery',
      'review',
    ]);
    expect(steps.publishGeneration).toHaveBeenCalledOnce();
    expect(steps.cleanupGeneration).toHaveBeenCalledOnce();
    expect(steps.failGeneration).not.toHaveBeenCalled();
  });

  it('coalesces responses that finish during checkpoint processing', async () => {
    const first = deferred(),
      second = deferred(),
      next = deferred();
    steps.runProviderRequest.mockImplementation(
      (_job, _attempt, id) =>
        ({
          first: first.promise,
          second: second.promise,
          next: next.promise,
        })[id as 'first' | 'second' | 'next'],
    );
    steps.advanceGeneration
      .mockResolvedValueOnce(pass(['first', 'second']))
      .mockImplementationOnce(async () => {
        second.resolve();
        return pass(['next'], ['first', 'second']);
      })
      .mockResolvedValueOnce(pass([], ['first', 'second', 'next'], true));
    const run = generateGameWorkflow('job', 1);
    await vi.waitFor(() => expect(steps.runProviderRequest).toHaveBeenCalledTimes(2));
    first.resolve();
    await vi.waitFor(() => expect(steps.runProviderRequest).toHaveBeenCalledTimes(3));
    expect(steps.advanceGeneration).toHaveBeenCalledTimes(2);
    next.resolve();
    await run;
    expect(steps.advanceGeneration).toHaveBeenCalledTimes(3);
  });

  it('persists provider failure without publishing and handles outstanding rejections', async () => {
    const a = deferred(),
      b = deferred();
    steps.advanceGeneration.mockResolvedValue(pass(['a', 'b']));
    steps.runProviderRequest.mockImplementation((_job, _attempt, id) =>
      id === 'a' ? a.promise : b.promise,
    );
    const run = generateGameWorkflow('job', 2);
    await vi.waitFor(() => expect(steps.runProviderRequest).toHaveBeenCalledTimes(2));
    a.reject(new Error('Provider unavailable'));
    await run;
    b.reject(new Error('Second failure'));
    expect(steps.failGeneration).toHaveBeenCalledWith('job', 2, 'Provider unavailable');
    expect(steps.publishGeneration).not.toHaveBeenCalled();
  });

  it('stops canceled work without publishing', async () => {
    steps.advanceGeneration.mockResolvedValue({ ...pass([]), stopped: true });
    await generateGameWorkflow('job', 1);
    expect(steps.runProviderRequest).not.toHaveBeenCalled();
    expect(steps.publishGeneration).not.toHaveBeenCalled();
  });
});
