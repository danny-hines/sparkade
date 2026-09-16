import { AsyncLocalStorage } from 'node:async_hooks';

/** A request-local policy follows every HTTP attempt, including provider fallbacks. */
export type ProviderRequestPolicy = (
  url: string,
  body: string | FormData | undefined,
) => Promise<(response: unknown) => Promise<void>>;
export const providerRequestPolicy = new AsyncLocalStorage<ProviderRequestPolicy>();
export function withProviderRequestPolicy<T>(
  policy: ProviderRequestPolicy,
  work: () => Promise<T>,
): Promise<T> {
  return providerRequestPolicy.run(policy, work);
}
