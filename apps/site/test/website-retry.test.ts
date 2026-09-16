import { describe, expect, it } from 'vitest';
import { websiteRetry } from '../lib/website-retry';
const failed = {
  job_id: 'job',
  job_status: 'failed',
  deleted_at: null,
  moderation: 'pending',
  input_review: 'approved',
  review_policy: 'pg13-v1',
  attempt: 1,
  has_checkpoint: true,
  cleanup_pending: false,
  settlement: 'released',
  price: 10,
};
describe('owner retry availability', () => {
  it('offers the original price after a failure and permits retrying a failed automated input check', () => {
    expect(websiteRetry(failed)).toEqual({ available: true, jobId: 'job', price: 10 });
    expect(websiteRetry({ ...failed, input_review: 'pending' })?.available).toBe(true);
  });
  it.each([
    [{ input_review: 'rejected' }, 'content check'],
    [{ moderation: 'rejected' }, 'content check'],
    [{ attempt: 2 }, 'one retry'],
    [{ has_checkpoint: false }, 'no longer available'],
    [{ cleanup_pending: true }, 'no longer available'],
    [{ settlement: 'held' }, 'refund is still processing'],
    [{ review_policy: 'legacy', input_review: 'pending' }, 'needs review'],
  ])('explains an unavailable retry (%j)', (patch, message) => {
    expect(websiteRetry({ ...failed, ...patch })).toEqual({
      available: false,
      message: expect.stringContaining(message),
    });
  });
  it('never offers retries for active, ready, canceled, deleted or non-website games', () => {
    for (const patch of [
      { job_status: 'running' },
      { job_status: 'done' },
      { job_status: 'canceled' },
      { deleted_at: '2026-09-16' },
      { job_id: null },
    ])
      expect(websiteRetry({ ...failed, ...patch })).toBeNull();
  });
});
