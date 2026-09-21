import { afterEach, expect, it, vi } from 'vitest';
import { httpJson } from '../src/providers/base';
import {
  combineProviderRequestPolicies,
  withProviderRequestPolicy,
} from '../src/providers/request-policy';
const request = (signal?: AbortSignal) =>
  httpJson('https://api.meta.ai/v1/chat/completions', {
    headers: {},
    body: '{}',
    timeoutMs: 1000,
    signal,
  });
const settlement = () =>
  Object.assign(
    vi.fn(async () => {}),
    { cancel: vi.fn(async () => {}), finish: vi.fn(async () => {}) },
  );
afterEach(() => vi.unstubAllGlobals());
it('rolls back earlier reservations when a later guard rejects before dispatch', async () => {
  const settled = settlement(),
    fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(
    withProviderRequestPolicy(
      combineProviderRequestPolicies(
        async () => settled,
        async () => {
          throw new Error('Not allowed');
        },
      ),
      request,
    ),
  ).rejects.toThrow('Not allowed');
  expect(settled.cancel).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
});
it('releases capacity on a provider error while retaining an uncertain reservation', async () => {
  const settled = settlement();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('failure', { status: 500 })),
  );
  await expect(withProviderRequestPolicy(async () => settled, request)).rejects.toThrow('500');
  expect(settled.finish).toHaveBeenCalledOnce();
  expect(settled.cancel).not.toHaveBeenCalled();
  expect(settled).not.toHaveBeenCalled();
});
it('cancels all reservations when aborted during admission', async () => {
  const first = settlement(),
    second = settlement(),
    controller = new AbortController(),
    fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(
    withProviderRequestPolicy(
      combineProviderRequestPolicies(
        async () => first,
        async () => {
          controller.abort();
          return second;
        },
      ),
      () => request(controller.signal),
    ),
  ).rejects.toThrow('aborted');
  expect(first.cancel).toHaveBeenCalledOnce();
  expect(second.cancel).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
});
it('reconciles both ledgers and releases capacity even if one detects unexpected usage', async () => {
  const first = settlement(),
    second = settlement();
  first.mockRejectedValueOnce(new Error('Unexpected charge'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ usage: { prompt_tokens: 10 } })),
  );
  await expect(
    withProviderRequestPolicy(
      combineProviderRequestPolicies(
        async () => first,
        async () => second,
      ),
      request,
    ),
  ).rejects.toThrow('Unexpected charge');
  expect(second).toHaveBeenCalledOnce();
  expect(first.finish).toHaveBeenCalledOnce();
  expect(second.finish).toHaveBeenCalledOnce();
});
