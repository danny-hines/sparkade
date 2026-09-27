import type { PublicGame } from './public-games';

/** A failed game keeps a slow watch so a retry started at the kiosk shows up
 * on the attendee's phone without a manual refresh. */
export const BUILDING_POLL_MS = 3000;
export const FAILED_POLL_MS = 15_000;
export const FAILED_WATCH_MS = 30 * 60_000;

/** Milliseconds until the phone page polls again, or null to stop. */
export function nextGameStatusPoll(
  status: PublicGame['status'],
  failedSince: number | null,
  now: number,
): number | null {
  if (status === 'ready') return null;
  if (status !== 'failed') return BUILDING_POLL_MS;
  return failedSince !== null && now - failedSince > FAILED_WATCH_MS ? null : FAILED_POLL_MS;
}
