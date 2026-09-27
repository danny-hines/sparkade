import { describe, expect, it } from 'vitest';
import {
  BUILDING_POLL_MS,
  FAILED_POLL_MS,
  FAILED_WATCH_MS,
  nextGameStatusPoll,
} from '../lib/public-game-polling';
import { generationFailureCopy } from '../lib/website-failure';

describe('attendee phone page', () => {
  it('keeps watching a failed game so a kiosk retry appears, then stops', () => {
    expect(nextGameStatusPoll('generating', null, 0)).toBe(BUILDING_POLL_MS);
    expect(nextGameStatusPoll('queued', null, 0)).toBe(BUILDING_POLL_MS);
    expect(nextGameStatusPoll('failed', 1000, 1000 + FAILED_WATCH_MS)).toBe(FAILED_POLL_MS);
    expect(nextGameStatusPoll('failed', 1000, 1001 + FAILED_WATCH_MS)).toBeNull();
    expect(nextGameStatusPoll('ready', null, 0)).toBeNull();
  });

  it('shows fixed copy instead of a raw provider error', () => {
    const raw = {
      code: 'image-invalid',
      message: 'Player vehicle review rejected the strip: Repaint banking cells…',
    };
    expect(generationFailureCopy(raw)).toBe(
      'Some generated artwork didn’t pass the checks needed to work in the game.',
    );
    expect(
      generationFailureCopy({ code: 'image-content-policy', message: 'provider HTTP 400: {...}' }),
    ).not.toContain('provider');
  });
});
