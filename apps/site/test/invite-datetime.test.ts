// Run under America/New_York so DST spring-gap / fall-back behavior is
// deterministic regardless of the machine running the suite.
process.env.TZ = 'America/New_York';

import { describe, expect, it } from 'vitest';
import {
  InviteExpiryError,
  isoToLocalInputValue,
  localPartsToIso,
  parseInviteExpiryIso,
  parseLocalInputValue,
} from '../app/admin/invites/invite-datetime';

describe('expiry datetime helpers', () => {
  it('round-trips an instant through the operator zone, preserving sub-minute precision', () => {
    const iso = '2027-05-01T12:34:56.789Z';
    const local = isoToLocalInputValue(iso);
    expect(local).toBe('2027-05-01T08:34');
    const parts = parseLocalInputValue(local ?? '');
    expect(parts).toEqual({ year: 2027, month: 5, day: 1, hour: 8, minute: 34 });
    // Minute-precision wall time maps back to the same minute; the untouched
    // form resubmits the original ISO, so seconds survive end to end.
    expect(Date.parse(localPartsToIso(parts ?? { year: 0, month: 0, day: 0, hour: 0, minute: 0 }) ?? '')).toBe(
      Date.parse('2027-05-01T12:34:00.000Z'),
    );
    expect(Date.parse(iso)).toBe(Date.parse('2027-05-01T12:34:56.789Z'));
  });

  it("uses each date's own zone rules instead of the current offset", () => {
    const winter = localPartsToIso({ year: 2026, month: 1, day: 15, hour: 10, minute: 0 });
    const summer = localPartsToIso({ year: 2026, month: 7, day: 15, hour: 10, minute: 0 });
    expect(winter).toBe('2026-01-15T15:00:00.000Z');
    expect(summer).toBe('2026-07-15T14:00:00.000Z');
  });

  it('rejects the DST spring-forward gap explicitly', () => {
    // 2026-03-08 02:30 never occurs in America/New_York.
    expect(localPartsToIso({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 })).toBeNull();
    // Times on either side of the gap remain valid.
    expect(localPartsToIso({ year: 2026, month: 3, day: 8, hour: 1, minute: 30 })).toBe(
      '2026-03-08T06:30:00.000Z',
    );
    expect(localPartsToIso({ year: 2026, month: 3, day: 8, hour: 3, minute: 30 })).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });

  it('accepts the DST fall-back hour', () => {
    expect(localPartsToIso({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 })).not.toBeNull();
  });

  it('rejects malformed and rolled-over local values', () => {
    expect(parseLocalInputValue('not-a-date')).toBeNull();
    expect(parseLocalInputValue('')).toBeNull();
    expect(parseLocalInputValue('2027-01-01T10:00:00')).toBeNull();
    expect(localPartsToIso({ year: 2027, month: 13, day: 1, hour: 10, minute: 0 })).toBeNull();
    expect(localPartsToIso({ year: 2027, month: 2, day: 30, hour: 10, minute: 0 })).toBeNull();
    expect(localPartsToIso({ year: 2027, month: 1, day: 1, hour: 25, minute: 0 })).toBeNull();
  });

  it('strictly validates the canonical ISO the form submits', () => {
    expect(parseInviteExpiryIso('2027-01-01T10:00:00.000Z')).toBe('2027-01-01T10:00:00.000Z');
    expect(parseInviteExpiryIso('2027-01-01T10:00:00+02:00')).toBe('2027-01-01T08:00:00.000Z');
    expect(() => parseInviteExpiryIso('')).toThrow(InviteExpiryError);
    expect(() => parseInviteExpiryIso('not-a-date')).toThrow(InviteExpiryError);
    // Bare datetime-local carries no zone: the server must not guess.
    expect(() => parseInviteExpiryIso('2027-01-01T10:00')).toThrow(InviteExpiryError);
  });

  it('rejects calendar rollover instead of normalizing it', () => {
    // Feb 30 would silently become March 2 via Date.parse alone.
    expect(() => parseInviteExpiryIso('2027-02-30T10:00:00.000Z')).toThrow(InviteExpiryError);
    expect(() => parseInviteExpiryIso('2027-02-29T10:00:00.000Z')).toThrow(InviteExpiryError);
    // Hour 24 would silently become the next day.
    expect(() => parseInviteExpiryIso('2027-01-01T24:00:00Z')).toThrow(InviteExpiryError);
    expect(() => parseInviteExpiryIso('2027-13-01T10:00:00Z')).toThrow(InviteExpiryError);
    expect(() => parseInviteExpiryIso('2027-01-00T10:00:00Z')).toThrow(InviteExpiryError);
    expect(() => parseInviteExpiryIso('2027-01-01T10:61:00Z')).toThrow(InviteExpiryError);
    expect(() => parseInviteExpiryIso('2027-01-01T10:00:00+25:00')).toThrow(InviteExpiryError);
  });

  it('accepts real leap days and valid explicit offsets', () => {
    expect(parseInviteExpiryIso('2028-02-29T10:00:00.000Z')).toBe('2028-02-29T10:00:00.000Z');
    expect(parseInviteExpiryIso('2028-02-29T15:30:00+05:30')).toBe('2028-02-29T10:00:00.000Z');
    expect(parseInviteExpiryIso('2027-06-15T08:00:00-08:00')).toBe('2027-06-15T16:00:00.000Z');
    expect(parseInviteExpiryIso('2027-12-31T23:59:59Z')).toBe('2027-12-31T23:59:59.000Z');
  });
});
