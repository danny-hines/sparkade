/** Unlike Promise.all, wait for every branch before propagating a failure.
 * A suspended cloud branch must not leave siblings writing into a checkpoint
 * after the caller has saved it and removed its temporary filesystem. */
export async function settleAll<const T extends readonly unknown[]>(
  values: T,
): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  const results = await Promise.allSettled(values);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return results.map((result) => (result as PromiseFulfilledResult<unknown>).value) as {
    -readonly [P in keyof T]: Awaited<T[P]>;
  };
}
