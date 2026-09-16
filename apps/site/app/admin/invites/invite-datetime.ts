// Pure expiry datetime helpers shared by the admin server actions and the
// browser expiry form. This module must stay dependency-free (no '@/lib'
// imports) so the client bundle never pulls in server-only code.
//
// Timezone contract: the server renders the current expiry as a canonical
// ISO instant; the browser converts it to a datetime-local value in the
// OPERATOR's zone, and converts an edited selection back to ISO using the
// zone rules in force on THAT date (never the current offset). Submitting an
// untouched form sends the original ISO byte-for-byte, preserving
// sub-minute precision that datetime-local cannot represent.

export class InviteExpiryError extends Error {
  readonly code = 'invite_expiry_invalid';
}

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const LOCAL_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// Note: the submittable ISO shape (full ISO-8601 with an explicit zone; a
// bare datetime-local value is NOT accepted because the server cannot know
// which zone the operator meant) is enforced field-by-field inside
// parseInviteExpiryIso so rolled-over values cannot slip through
// Date.parse normalization.

/** Parse a datetime-local string into parts; null when malformed. */
export function parseLocalInputValue(raw: string): LocalDateParts | null {
  const match = LOCAL_INPUT_PATTERN.exec(raw.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  return { year, month, day, hour, minute };
}

const pad = (part: number) => String(part).padStart(2, '0');

/**
 * Format an ISO instant as a datetime-local value in the LOCAL zone of
 * whoever runs this (the operator's browser). Call only client-side after
 * mount to avoid server/client hydration mismatch.
 */
export function isoToLocalInputValue(iso: string): string | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Convert local wall-clock parts to a canonical ISO instant using the zone
 * rules in force on that date. Returns null for nonexistent local times
 * (DST spring-forward gap) and rolled-over inputs (month 13, Feb 30):
 * constructing with out-of-range or gap components does not round-trip, so
 * the comparison rejects them explicitly instead of silently shifting.
 */
export function localPartsToIso(parts: LocalDateParts): string | null {
  const date = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  if (
    date.getFullYear() !== parts.year ||
    date.getMonth() !== parts.month - 1 ||
    date.getDate() !== parts.day ||
    date.getHours() !== parts.hour ||
    date.getMinutes() !== parts.minute
  ) {
    return null;
  }
  return date.toISOString();
}

/**
 * Strict server-side validation for the canonical ISO the form submits.
 * Calendar fields are range-checked BEFORE Date.parse normalization so
 * rolled-over values (Feb 30, hour 24) are rejected instead of silently
 * shifting to a different instant. Real leap days and valid explicit
 * offsets are accepted.
 */
export function parseInviteExpiryIso(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) throw new InviteExpiryError('Enter an expiry date and time.');
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-](\d{2}):?(\d{2}))$/.exec(
      text,
    );
  if (!match) throw new InviteExpiryError('Enter a valid expiry date and time.');
  const [
    ,
    yearRaw,
    monthRaw,
    dayRaw,
    hourRaw,
    minuteRaw,
    secondRaw,
    ,
    ,
    offsetHourRaw,
    offsetMinuteRaw,
  ] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = secondRaw === undefined ? 0 : Number(secondRaw);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const calendarOk =
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59;
  const offsetOk =
    offsetHourRaw === undefined || (Number(offsetHourRaw) <= 23 && Number(offsetMinuteRaw) <= 59);
  if (!calendarOk || !offsetOk) {
    throw new InviteExpiryError('Enter a valid expiry date and time.');
  }
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new InviteExpiryError('Enter a valid expiry date and time.');
  return new Date(time).toISOString();
}
