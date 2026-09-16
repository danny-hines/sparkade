import { describe, expect, it } from 'vitest';
import { websiteFailure } from '../lib/website-failure';

const failed = { status: 'failed', moderation: 'pending', inputReview: 'approved' };

describe('owner-facing generation failures', () => {
  it.each([
    ['timeout', 'time limit'],
    ['call-timeout', 'time limit'],
    ['image-content-policy', 'image service blocked'],
    ['image-invalid', 'artwork didn’t pass'],
    ['image-provider-error', 'creating the artwork'],
    ['design-invalid', 'playable rules and levels'],
    ['validation-failed', 'playable rules and levels'],
    ['provider-unavailable', 'unavailable'],
    ['provider-error', 'couldn’t complete a request'],
    ['auth', 'configuration problem'],
    ['image-config', 'configuration problem'],
    ['storage', 'couldn’t save'],
    ['interrupted', 'interrupted'],
    ['cloud-step', 'interrupted'],
  ])('explains %s without exposing technical details', (code, expected) => {
    const message = websiteFailure({
      ...failed,
      error: { code, message: 'secret-token https://private.example/photo.jpg $5 stack trace' },
    });
    expect(message).toContain(expected);
    expect(message).not.toMatch(/secret|https|\$|stack/);
  });

  it('distinguishes a service failure from a rejected content review', () => {
    const error = {
      code: 'cloud-step',
      message: 'The content check could not finish. Your credits will be returned.',
    };
    expect(websiteFailure({ ...failed, error })).toContain('service couldn’t finish');
    expect(websiteFailure({ ...failed, error, inputReview: 'rejected' })).toContain('PG-13');
    expect(
      websiteFailure({ ...failed, error, moderation: 'rejected', reviewCategory: 'hate' }),
    ).toContain('hateful or discriminatory');
  });

  it.each([
    ['Website generation paused or provider-spend limit reached.', 'generation limit'],
    ['Provider usage exceeded its reservation; creation has been paused.', 'generation limit'],
    ['Source photo unavailable for content check.', 'photo couldn’t be loaded'],
    ['Generation exceeded its step budget. Retry to continue.', 'too many build steps'],
  ])('recognizes wrapped internal guard errors (%s)', (message, expected) => {
    expect(websiteFailure({ ...failed, error: { code: 'auth', message } })).toContain(expected);
  });

  it('uses an honest fallback for old, missing or unrecognized errors', () => {
    for (const error of [undefined, null, 'raw error', {}, { code: '__proto__', message: '$5' }])
      expect(websiteFailure({ ...failed, error })).toBe(
        'An unexpected technical problem stopped this game from finishing.',
      );
  });

  it('hides stale errors once a retry starts or a game completes', () => {
    for (const status of ['queued', 'running', 'review', 'done', 'canceled', null])
      expect(websiteFailure({ ...failed, status, error: { code: 'timeout' } })).toBeNull();
  });
});
