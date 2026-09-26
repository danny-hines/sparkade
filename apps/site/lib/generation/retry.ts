import type { PipelineState } from '@sparkade/server/pipeline/job-state';
import type { GenerationRow } from './store';

/** Failures a repeat attempt cannot fix: credentials, configuration, cancellation. */
const NON_RETRYABLE_CODES = new Set(['auth', 'canceled', 'image-config', 'suspended']);

/** Transient provider faults back off before re-queuing; paid attempts stay capped at four. */
const TRANSIENT_BACKOFF_S = [5, 20, 60];
const MAX_PROVIDER_WAIT_S = 300;

export function transientProviderDelayMs(providerAttempt: number, retryAfterS: number | null): number {
  const backoff = TRANSIENT_BACKOFF_S[providerAttempt - 1] ?? TRANSIENT_BACKOFF_S.at(-1)!;
  return Math.min(MAX_PROVIDER_WAIT_S, Math.max(backoff, retryAfterS ?? 0)) * 1000;
}

/** Shared by the kiosk Retry endpoint and automatic retries. */
export function resetJobForRetry(state: PipelineState): void {
  state.job!.attempt++;
  state.job!.status = 'queued';
  state.job!.stage = 'queued';
  state.job!.error = undefined;
  state.job!.finishedAt = undefined;
  state.job!.startedAt = undefined;
  state.game!.status = 'queued';
  state.game!.failure = null;
}

/**
 * Kiosk attendees start a game, walk away and follow it on their phone, so a
 * failed first attempt retries once without anyone pressing Retry at the
 * cabinet. The retry resumes from the checkpoint and repays only unfinished
 * work; a second failure stays failed for the kiosk's manual Retry.
 */
export function autoRetryEligible(
  row: Pick<GenerationRow, 'owner' | 'attempt' | 'checkpoint'>,
  code: string | undefined,
): boolean {
  return (
    row.owner.startsWith('kiosk:') &&
    row.attempt === 1 &&
    row.checkpoint !== '' &&
    !NON_RETRYABLE_CODES.has(code ?? '')
  );
}

/**
 * Turns a failed state into the next queued attempt in place, keeping the
 * failure's feed event and noting the automatic pass so kiosks and phones
 * never see a terminal failure. The kiosk's next sync dispatches the queued
 * attempt, exactly like a manual Retry.
 */
export function prepareAutoRetry(state: PipelineState, failure: { code: string; message: string }): void {
  resetJobForRetry(state);
  state.job!.detail = 'Muse is taking another pass…';
  state.events.push({
    id: state.events.length + 1,
    jobId: state.job!.id,
    gameId: state.job!.gameId,
    attempt: state.job!.attempt,
    kind: 'progress',
    stage: 'queued',
    message: 'Muse is taking another pass…',
    payload: { autoRetry: true, code: failure.code, message: failure.message.slice(0, 300) },
    at: new Date().toISOString(),
  });
}
