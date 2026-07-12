// Inline SVG icons + gamepad-button glyphs. The kiosk Chromium on the Pi has a
// minimal font set with no color-emoji and spotty symbol coverage, so any emoji
// or fancy Unicode glyph rendered as a tofu box (▯). Everything here draws with
// vector paths in `currentColor`, so it renders identically everywhere and
// inherits the surrounding (per-game themed) text color.
import type { ComponentChildren } from 'preact';

export type IconName =
  | 'sparkle'
  | 'refresh'
  | 'play'
  | 'close'
  | 'plus'
  | 'check'
  | 'chevronRight'
  | 'arrowRight'
  | 'arrowLeft'
  | 'arrowUp'
  | 'arrowDown'
  | 'warning'
  | 'timer'
  | 'dot'
  | 'ring'
  | 'lock'
  | 'camera'
  | 'mic'
  | 'cards'
  | 'keyboard'
  | 'joystick'
  | 'gear'
  | 'disk'
  | 'folder';

/* 24×24 viewBox. Stroked icons use fill=none + stroke=currentColor; solid ones
   fill=currentColor. Kept blocky/simple to sit well next to the pixel font. */
const PATHS: Record<IconName, ComponentChildren> = {
  sparkle: <path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" fill="currentColor" />,
  refresh: (
    <path
      d="M20 12 a8 8 0 1 1 -2.3 -5.6 M20 3 l0 4 -4 0"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  ),
  play: <path d="M6 4 L20 12 L6 20 Z" fill="currentColor" />,
  close: (
    <path d="M5 5 L19 19 M19 5 L5 19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
  ),
  plus: (
    <path d="M12 4 L12 20 M4 12 L20 12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
  ),
  check: (
    <path d="M4 12 L10 18 L20 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
  ),
  chevronRight: (
    <path d="M9 5 L16 12 L9 19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
  ),
  arrowRight: (
    <path d="M4 12 L20 12 M13 5 L20 12 L13 19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
  ),
  arrowLeft: (
    <path d="M20 12 L4 12 M11 5 L4 12 L11 19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
  ),
  arrowUp: (
    <path d="M12 20 L12 4 M5 11 L12 4 L19 11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
  ),
  arrowDown: (
    <path d="M12 4 L12 20 M5 13 L12 20 L19 13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
  ),
  warning: (
    <>
      <path d="M12 3 L22 20 L2 20 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      <path d="M12 9 L12 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
      <circle cx="12" cy="17" r="1.1" fill="currentColor" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M12 13 L12 8 M9 3 h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="6" fill="currentColor" />,
  ring: <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="1.5" fill="currentColor" />
      <path d="M8 10 V7 a4 4 0 0 1 8 0 V10" fill="none" stroke="currentColor" stroke-width="2.2" />
    </>
  ),
  camera: (
    <>
      <path d="M3 7 h4 l1.5 -2 h7 l1.5 2 h4 v12 h-19 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      <circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="2" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M6 12 a6 6 0 0 0 12 0 M12 18 v3 M8 21 h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </>
  ),
  cards: (
    <>
      <rect x="4" y="6" width="11" height="15" rx="1.5" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(-8 9 13)" />
      <rect x="10" y="4" width="11" height="15" rx="1.5" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(8 15 11)" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M6 10 h.01 M10 10 h.01 M14 10 h.01 M18 10 h.01 M8 14 h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </>
  ),
  joystick: (
    <>
      <path d="M12 4 v7" fill="none" stroke="currentColor" stroke-width="2.2" />
      <circle cx="12" cy="4" r="2.4" fill="currentColor" />
      <path d="M5 12 h14 l-2 8 h-10 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
    </>
  ),
  gear: (
    <>
      <path d="M12 2 l1.6 3 3.3 -.6 -.6 3.3 3 1.6 -3 1.6 .6 3.3 -3.3 -.6 -1.6 3 -1.6 -3 -3.3 .6 .6 -3.3 -3 -1.6 3 -1.6 -.6 -3.3 3.3 .6 Z" fill="currentColor" />
      <circle cx="12" cy="12" r="3" fill="var(--bg-panel, #0b1020)" />
    </>
  ),
  disk: (
    <>
      <path d="M4 4 h13 l3 3 v13 h-16 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      <rect x="8" y="4" width="7" height="5" fill="currentColor" />
      <rect x="7" y="13" width="10" height="7" fill="none" stroke="currentColor" stroke-width="2" />
    </>
  ),
  folder: (
    <path d="M3 6 h6 l2 2 h10 v12 h-18 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
  ),
};

/** An inline SVG icon that scales to the current font size and inherits color. */
export function Icon(props: { name: IconName; class?: string; size?: number }): ComponentChildren {
  const s = props.size ?? 24;
  return (
    <svg
      class={`icon-svg${props.class ? ' ' + props.class : ''}`}
      viewBox="0 0 24 24"
      width={s}
      height={s}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[props.name]}
    </svg>
  );
}

/** A gamepad button glyph (e.g. A/B/X/Y) — a bordered circle with the ASCII
 *  letter, so it reads as a button without depending on the Ⓐ Unicode glyph. */
export function Btn(props: { children: ComponentChildren; class?: string }): ComponentChildren {
  return <span class={`btn-glyph${props.class ? ' ' + props.class : ''}`}>{props.children}</span>;
}

/** Wi-Fi signal strength as four vector bars (replaces ▂▄▆█ block glyphs). */
export function SignalBars(props: { level: number }): ComponentChildren {
  // level 0..4 bars lit
  const lit = Math.max(0, Math.min(4, props.level));
  return (
    <svg class="icon-svg" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={2 + i * 5.5}
          y={18 - (i + 1) * 3.6}
          width="3.6"
          height={(i + 1) * 3.6}
          fill="currentColor"
          opacity={i < lit ? 1 : 0.28}
        />
      ))}
    </svg>
  );
}
