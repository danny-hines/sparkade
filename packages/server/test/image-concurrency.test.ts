import { afterEach, describe, expect, it } from 'vitest';
import { GenerationRunner } from '../src/pipeline/runner';

const originalLimit = process.env.SPARKADE_IMAGE_CONCURRENCY;

afterEach(() => {
  if (originalLimit === undefined) delete process.env.SPARKADE_IMAGE_CONCURRENCY;
  else process.env.SPARKADE_IMAGE_CONCURRENCY = originalLimit;
});

type SlotRunner = {
  withImageCallSlot<T>(signal: AbortSignal, call: () => Promise<T>): Promise<T>;
};

type InspectableSlotRunner = SlotRunner & {
  maxConcurrentImageCalls: number;
};

function runnerWithLimit(limit: number): SlotRunner {
  process.env.SPARKADE_IMAGE_CONCURRENCY = String(limit);
  return new GenerationRunner(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  ) as unknown as SlotRunner;
}

async function settleMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('Muse Image call concurrency', () => {
  it('defaults to the cabinet-safe image call ceiling', () => {
    delete process.env.SPARKADE_IMAGE_CONCURRENCY;
    const runner = new GenerationRunner(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ) as unknown as InspectableSlotRunner;

    expect(runner.maxConcurrentImageCalls).toBe(16);
  });

  it('caps provider requests across all jobs while preserving FIFO progress', async () => {
    const runner = runnerWithLimit(2);
    const abort = new AbortController();
    const releases: Array<() => void> = [];
    const started: number[] = [];
    let active = 0;
    let peak = 0;

    const calls = [0, 1, 2, 3].map((index) =>
      runner.withImageCallSlot(abort.signal, async () => {
        started.push(index);
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => {
          releases.push(() => {
            active--;
            resolve();
          });
        });
      }),
    );

    await settleMicrotasks();
    expect(started).toEqual([0, 1]);
    expect(peak).toBe(2);

    releases.shift()?.();
    releases.shift()?.();
    await settleMicrotasks();
    expect(started).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(2);

    releases.shift()?.();
    releases.shift()?.();
    await expect(Promise.all(calls)).resolves.toEqual([undefined, undefined, undefined, undefined]);
  });

  it('removes an aborted waiter without consuming a slot', async () => {
    const runner = runnerWithLimit(1);
    const firstAbort = new AbortController();
    let releaseFirst!: () => void;
    const first = runner.withImageCallSlot(firstAbort.signal, async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    });
    await settleMicrotasks();

    const queuedAbort = new AbortController();
    const queued = runner.withImageCallSlot(queuedAbort.signal, async () => undefined);
    queuedAbort.abort();
    await expect(queued).rejects.toThrow('image request canceled');

    releaseFirst();
    await expect(first).resolves.toBeUndefined();
    await expect(
      runner.withImageCallSlot(new AbortController().signal, async () => 'next'),
    ).resolves.toBe('next');
  });
});
