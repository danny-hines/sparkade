import { CONTENT_POLICY } from './content-policy';

export type WebsiteRetry =
  { available: true; jobId: string; price: number } | { available: false; message: string } | null;

export interface WebsiteRetryRow {
  job_id: string | null;
  job_status: string | null;
  deleted_at: unknown;
  moderation: string;
  input_review: string | null;
  review_policy: string | null;
  attempt: number | null;
  has_checkpoint: boolean | null;
  cleanup_pending: boolean | null;
  settlement: string | null;
  price: number | null;
}

/** Display eligibility only. Admission rechecks credits, spending caps and ownership atomically. */
export function websiteRetry(row: WebsiteRetryRow): WebsiteRetry {
  if (!row.job_id || row.job_status !== 'failed' || row.deleted_at) return null;
  if (row.moderation === 'rejected' || row.input_review === 'rejected')
    return {
      available: false,
      message: 'This game did not pass the content check. Try a different idea.',
    };
  if (row.attempt !== 1)
    return { available: false, message: 'This game has already used its one retry.' };
  if (!row.has_checkpoint || row.cleanup_pending)
    return {
      available: false,
      message: 'The saved generation data is no longer available to retry.',
    };
  if (row.settlement !== 'released')
    return {
      available: false,
      message: 'Your credit refund is still processing. Refresh shortly to retry.',
    };
  if (
    row.moderation !== 'pending' ||
    !(
      row.input_review === 'approved' ||
      (row.input_review === 'pending' && row.review_policy === CONTENT_POLICY)
    )
  )
    return { available: false, message: 'This game needs review before it can be retried.' };
  return { available: true, jobId: row.job_id, price: Number(row.price) };
}
