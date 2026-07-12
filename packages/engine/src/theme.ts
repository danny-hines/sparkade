// Per-game UI theme. The substrate chrome (HUD, story cards, pause menu, boss
// bar, score/leaderboard screens) used to be one fixed navy/gold look. These
// roles are derived from the game's own 16-color palette so each game's shell
// feels like *that* game. Roles map to palette slots; the palette-legibility
// system guarantees these slots stay readable against one another, so
// re-tinting the chrome is safe.

export interface UiTheme {
  heading: string; // titles, score, keys — palette gold (13)
  text: string; // primary text — near-white (15)
  dim: string; // secondary text — light (14)
  accent: string; // (A) prompts, portrait frame, active bars — bg-light (4)
  cursor: string; // selection caret — warm (12)
  danger: string; // boss-bar fill, game-over accent — hazard (11)
  bossName: string; // boss name — enemy secondary (9)
  barBg: string; // bar/track backgrounds — outline (1)
  barMid: string; // inactive bar fill — bg-mid (3)
  panelBg: string; // overlay panel fill — darkened bg-dark (2)
  panelBorder: string; // overlay panel border — bg-light (4)
  screenBg: string; // full-screen clears (tally/leaderboard) — darkened bg-dark
}

function darken(hex: string, f: number): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return hex;
  const r = Math.round(parseInt(h.slice(0, 2), 16) * f);
  const g = Math.round(parseInt(h.slice(2, 4), 16) * f);
  const b = Math.round(parseInt(h.slice(4, 6), 16) * f);
  return `rgb(${r},${g},${b})`;
}

export function makeUiTheme(pal: readonly string[]): UiTheme {
  const g = (i: number, fallback: string): string => pal[i] ?? fallback;
  const bgDark = g(2, '#29366f');
  return {
    heading: g(13, '#ffd75e'),
    text: g(15, '#f4f4f4'),
    dim: g(14, '#94b0c2'),
    accent: g(4, '#41a6f6'),
    cursor: g(12, '#ffa300'),
    danger: g(11, '#e04040'),
    bossName: g(9, '#ef7d57'),
    barBg: g(1, '#1a1c2c'),
    barMid: g(3, '#3b5dc9'),
    panelBg: darken(bgDark, 0.5),
    panelBorder: g(4, '#41a6f6'),
    screenBg: darken(bgDark, 0.3),
  };
}

/** Default (the original navy/gold) — used before a game's palette is set. */
export const DEFAULT_THEME: UiTheme = makeUiTheme([
  '#000000', '#1a1c2c', '#29366f', '#3b5dc9', '#41a6f6', '#38b764', '#a7f070',
  '#ffcd75', '#b13e53', '#ef7d57', '#5d275d', '#e04040', '#ffa300', '#ffd75e',
  '#94b0c2', '#f4f4f4',
]);
