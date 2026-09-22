import {
  claimGeneration,
  advanceGeneration,
  runProviderRequest,
  publishGeneration,
  failGeneration,
  cleanupGeneration,
} from '@/lib/generation/steps';

export async function generateGameWorkflow(jobId: string, attempt: number) {
  'use workflow';
  const requests = new Map<string, Promise<{ id: string; error?: unknown }>>();
  const dispatched = new Set<string>();
  const allRequests: Array<Promise<{ id: string; error?: unknown }>> = [];
  try {
    if (!(await claimGeneration(jobId, attempt))) return;
    for (let pass = 0; pass < 512; pass++) {
      const result = await advanceGeneration(jobId, attempt, pass);
      if (result.stopped) return;
      // Several siblings may finish while a checkpoint is being processed.
      // Consume that whole snapshot instead of replaying once per old result.
      for (const id of result.completed ?? []) requests.delete(id);
      if (result.done) {
        // Drain any no-longer-needed optional work before publication/cleanup.
        const remaining = await Promise.all(allRequests);
        for (const request of remaining) if (request.error) throw request.error;
        await publishGeneration(jobId, attempt);
        await cleanupGeneration(jobId);
        return;
      }
      for (const id of result.pending) {
        if (dispatched.has(id)) continue;
        dispatched.add(id);
        const request = runProviderRequest(jobId, attempt, id).then(
          () => ({ id }),
          (error: unknown) => ({ id, error }),
        );
        requests.set(id, request);
        allRequests.push(request);
      }
      if (!requests.size) throw new Error('Generation made no progress');
      // Keep one checkpoint writer, but resume it as soon as any dependency is
      // ready. Other provider steps continue and are never dispatched twice.
      const completed = await Promise.race(requests.values());
      requests.delete(completed.id);
      if (completed.error) throw completed.error;
    }
    await failGeneration(jobId, attempt, 'Generation exceeded its step budget. Retry to continue.');
  } catch (error) {
    await failGeneration(
      jobId,
      attempt,
      error instanceof Error ? error.message : 'Generation failed',
    );
  }
}
