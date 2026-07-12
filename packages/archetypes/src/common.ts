// Lint helpers shared by all archetypes. Pure logic — runs on the server
// (validation pipeline) and in unit tests; no DOM.
import { LIBRARY, validateMusic } from '@sparkade/engine';
import { LIB_SPRITE_IDS, MIN_DURATION_S, type GameSpec, type LintError } from '@sparkade/shared';

export function err(code: string, path: string, message: string): LintError {
  return { code, path, message };
}

/** Music: every song/jingle pattern parses; all pattern refs resolve. */
export function lintMusic(spec: GameSpec): LintError[] {
  const out: LintError[] = [];
  for (const problem of validateMusic(spec.music)) {
    out.push(err('MUSIC_INVALID', '/music', problem));
  }
  return out;
}

/** Sprite assignments: every ref resolves to a library id or a defined custom sprite. */
export function lintSpriteRefs(spec: GameSpec): LintError[] {
  const out: LintError[] = [];
  const libIds = new Set(LIB_SPRITE_IDS);
  for (const [role, ref] of Object.entries(spec.sprites.assign)) {
    const [kind, id] = ref.split(':', 2) as [string, string];
    if (kind === 'lib' && !libIds.has(id)) {
      out.push(
        err('SPRITE_UNKNOWN_REF', `/sprites/assign/${role}`, `unknown library sprite "${id}"`),
      );
    } else if (kind === 'custom' && !spec.sprites.custom[id]) {
      out.push(
        err('SPRITE_UNKNOWN_REF', `/sprites/assign/${role}`, `custom sprite "${id}" is not defined in sprites.custom`),
      );
    }
    // Terrain slots draw on a fixed 16px grid — anything else leaves holes.
    if (role.startsWith('tile_')) {
      const sprite =
        kind === 'lib' ? LIBRARY[id]?.frames[0] : kind === 'custom' ? spec.sprites.custom[id] : undefined;
      if (sprite && (sprite.w !== 16 || sprite.h !== 16)) {
        out.push(
          err(
            'TILE_SIZE_MISMATCH',
            `/sprites/assign/${role}`,
            `"${ref}" is ${sprite.w}×${sprite.h} but tile slots need exactly 16×16`,
          ),
        );
      }
    }
  }
  return out;
}

/** A musicSong field must reference an existing song. */
export function lintSongRef(song: string, path: string, spec: GameSpec): LintError[] {
  if (!spec.music.songs[song]) {
    return [err('MUSIC_UNKNOWN_SONG', path, `references song "${song}" which is not in music.songs`)];
  }
  return [];
}

/** Shared duration floor check. */
export function lintDuration(estimateS: number): LintError[] {
  if (estimateS < MIN_DURATION_S) {
    return [
      err(
        'DURATION_TOO_SHORT',
        '/levels',
        `estimated interactive play is ~${Math.round(estimateS)}s; the minimum is ${MIN_DURATION_S}s — add content (longer levels, more encounters)`,
      ),
    ];
  }
  return [];
}

/** Parse a tile grid's legend, verifying every non-'.' char is declared. */
export function lintLegendCoverage(
  tiles: string[],
  legend: Record<string, string>,
  path: string,
  code: string,
): LintError[] {
  const out: LintError[] = [];
  const seen = new Set<string>();
  tiles.forEach((row, y) => {
    for (const ch of row) {
      if (ch === '.' || legend[ch] || seen.has(ch)) continue;
      seen.add(ch);
      out.push(err(code, `${path}/tiles/${y}`, `tile char "${ch}" is not in the legend`));
    }
  });
  return out;
}

/** Equal row lengths in a tile grid. */
export function lintRowLengths(tiles: string[], path: string, code: string): LintError[] {
  const w = tiles[0]?.length ?? 0;
  const bad = tiles.findIndex((r) => r.length !== w);
  if (bad > 0) {
    return [err(code, `${path}/tiles/${bad}`, `row ${bad} has length ${tiles[bad]!.length}, expected ${w} (all rows must match row 0)`)];
  }
  return [];
}
