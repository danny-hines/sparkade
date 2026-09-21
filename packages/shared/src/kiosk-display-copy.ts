import type { KioskDisplayCopy } from './types';

export const DEFAULT_KIOSK_DISPLAY_COPY: KioskDisplayCopy = {
  title: 'Sparkade',
  tagline: 'The arcade that dreams up its own games',
};

export const KIOSK_TITLE_MAX_LENGTH = 40;
export const KIOSK_TAGLINE_MAX_LENGTH = 120;

function copyText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length > maxLength) return null;
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return null;
  }
  return text;
}

/** Blank fields explicitly restore the built-in copy; invalid payloads are rejected. */
export function parseKioskDisplayCopy(value: unknown): KioskDisplayCopy | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const title = copyText(input.title, KIOSK_TITLE_MAX_LENGTH);
  const tagline = copyText(input.tagline, KIOSK_TAGLINE_MAX_LENGTH);
  if (title === null || tagline === null) return null;
  return {
    title: title || DEFAULT_KIOSK_DISPLAY_COPY.title,
    tagline: tagline || DEFAULT_KIOSK_DISPLAY_COPY.tagline,
  };
}

/** Older servers and unavailable/invalid updates must not discard the last good copy. */
export function resolveKioskDisplayCopy(
  value: unknown,
  fallback: KioskDisplayCopy = DEFAULT_KIOSK_DISPLAY_COPY,
): KioskDisplayCopy {
  return parseKioskDisplayCopy(value) ?? fallback;
}
