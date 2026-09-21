/** Shared capacity is an operational limit, independent of the spending budget.
 * Keep it configurable as provider quotas and measured throughput grow. */
function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647 ? parsed : fallback;
}

export function generationLimits() {
  const requests = positiveInteger(process.env.SPARKADE_CLOUD_CONCURRENCY, 1024);
  return {
    requests,
    ownerRequests: Math.min(
      requests,
      positiveInteger(process.env.SPARKADE_CLOUD_OWNER_CONCURRENCY, 128),
    ),
    pendingJobs: positiveInteger(process.env.SPARKADE_CLOUD_MAX_PENDING_JOBS, 10_000),
  };
}
