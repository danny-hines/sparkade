import { AsyncLocalStorage } from 'node:async_hooks';

/** A request-local policy follows every HTTP attempt, including provider fallbacks. */
export type ProviderRequestSettlement = ((response: unknown) => Promise<void>) & {
  /** No HTTP request was sent; undo the reservation. */
  cancel?: () => Promise<void>;
  /** Release request capacity even on errors; uncertain charges remain reserved. */
  finish?: () => Promise<void>;
};
export type ProviderRequestPolicy = (
  url: string,
  body: string | FormData | undefined,
  options?: { timeoutMs: number },
) => Promise<ProviderRequestSettlement>;

/** Both guards apply, with rollback if a later guard rejects before dispatch. */
export function combineProviderRequestPolicies(
  ...policies: ProviderRequestPolicy[]
): ProviderRequestPolicy {
  return async (url, body, options) => {
    const settlements: ProviderRequestSettlement[] = [];
    try {
      for (const policy of policies) settlements.push(await policy(url, body, options));
    } catch (error) {
      await Promise.all(settlements.map((settle) => settle.cancel?.()));
      throw error;
    }
    return Object.assign(
      async (response: unknown) => {
        // Reconcile every ledger even when one detects an unexpected charge.
        const results = await Promise.allSettled(settlements.map((settle) => settle(response)));
        const failed = results.find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      },
      {
        cancel: async () => {
          await Promise.all(settlements.map((settle) => settle.cancel?.()));
        },
        finish: async () => {
          await Promise.all(settlements.map((settle) => settle.finish?.()));
        },
      },
    );
  };
}
export const providerRequestPolicy = new AsyncLocalStorage<ProviderRequestPolicy>();
export function withProviderRequestPolicy<T>(
  policy: ProviderRequestPolicy,
  work: () => Promise<T>,
): Promise<T> {
  return providerRequestPolicy.run(policy, work);
}
