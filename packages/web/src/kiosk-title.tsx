import type { ComponentChildren } from 'preact';
import { DEFAULT_KIOSK_DISPLAY_COPY } from '@sparkade/shared';

/** Preserve the cabinet's original two-tone wordmark when using the default title. */
export function KioskTitle({ title }: { title: string }): ComponentChildren {
  return title === DEFAULT_KIOSK_DISPLAY_COPY.title ? (
    <>
      SPARK<span style="color:var(--spark)">ADE</span>
    </>
  ) : (
    title
  );
}
