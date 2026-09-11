import { sleep } from 'workflow';
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
  if (!(await claimGeneration(jobId, attempt))) return;
  try {
    for (let pass = 0; pass < 160; pass++) {
      const result = await advanceGeneration(jobId, attempt, pass);
      if (result.stopped) return;
      if (result.done) {
        await publishGeneration(jobId, attempt);
        await cleanupGeneration(jobId);
        return;
      }
      // Shared leased slots enforce total and per-device concurrency across
      // functions; independent requests do not wait behind arbitrary batches.
      await Promise.all(result.pending.map((id) => runProviderRequest(jobId, attempt, id)));
      await sleep('100ms');
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
