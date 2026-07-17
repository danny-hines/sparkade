// Prompt template loading + rendering, and golden-game access for few-shot
// excerpts. Templates are .md files (see ../prompts) with {{PLACEHOLDER}}
// slots; the JSON Schemas they embed come verbatim from @sparkade/shared.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArchetypeId, GameSpec, MusicBlock, SpecStage } from '@sparkade/shared';

/** packages/generation root (works from source via tsx and from the server bundle via cwd fallback). */
function generationRoot(): string {
  // When bundled into the server, import.meta.url points at the bundle; walk
  // from the repo root instead (the service runs with cwd=/opt/sparkade).
  const fromModule = join(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    readdirSync(join(fromModule, 'prompts'));
    return fromModule;
  } catch {
    return join(process.cwd(), 'packages', 'generation');
  }
}

export type TemplateName =
  | 'design'
  | 'levels-platformer'
  | 'levels-shooter'
  | 'levels-adventure'
  | 'levels-hshooter'
  | 'levels-fighter'
  | 'entities'
  | 'music'
  | 'repair';

const templateCache = new Map<string, string>();

export function loadTemplate(name: TemplateName): string {
  let t = templateCache.get(name);
  if (!t) {
    t = readFileSync(join(generationRoot(), 'prompts', `${name}.md`), 'utf8');
    templateCache.set(name, t);
  }
  return t;
}

/** Replace {{NAME}} placeholders. Unknown placeholders throw — templates and code must agree. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  const rendered = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, name: string) => {
    const v = vars[name];
    if (v === undefined) throw new Error(`template placeholder {{${name}}} has no value`);
    return v;
  });
  return rendered;
}

// ---------------------------------------------------------------------------
// Golden games
// ---------------------------------------------------------------------------

const goldenCache = new Map<ArchetypeId, GameSpec>();

export function loadGolden(archetype: ArchetypeId): GameSpec {
  let g = goldenCache.get(archetype);
  if (!g) {
    g = JSON.parse(
      readFileSync(join(generationRoot(), 'golden', `golden-${archetype}.json`), 'utf8'),
    ) as GameSpec;
    goldenCache.set(archetype, g);
  }
  return g;
}

export function goldenIds(): string[] {
  return readdirSync(join(generationRoot(), 'golden'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

/**
 * Condensed few-shot excerpt of the golden game for one stage — small enough
 * to keep prompts lean, complete enough to teach the format.
 */
export function goldenExcerpt(archetype: ArchetypeId, stage: SpecStage | 'design'): string {
  const g = loadGolden(archetype);
  switch (stage) {
    case 'design': {
      return JSON.stringify(
        {
          title: g.meta.title,
          tagline: g.meta.tagline,
          archetype: g.archetype,
          palette: g.palette,
          story: { intro: g.story.intro.slice(0, 1), levelIntros: g.story.levelIntros, bossIntro: g.story.bossIntro },
          scoring: g.scoring,
        },
        null,
        1,
      );
    }
    case 'levels': {
      if (g.archetype === 'adventure') {
        const d = g.levels[0]!;
        return JSON.stringify(
          {
            levels: [
              {
                rooms: d.rooms.slice(0, 2),
                items: d.items,
                bossRoom: d.bossRoom,
                startRoom: d.startRoom,
                NOTE: `...the real dungeon continues to ${d.rooms.length} rooms...`,
              },
            ],
          },
          null,
          1,
        );
      }
      if (g.archetype === 'fighter') {
        return JSON.stringify(
          {
            player: g.player,
            levels: [g.levels[0]],
            NOTE: 'plus two more ladder bouts in the real spec',
          },
          null,
          1,
        );
      }
      if (g.archetype === 'platformer') {
        const level = g.levels[0]!;
        const engineOwnedChars = new Set(
          Object.entries(level.legend)
            .filter(([, kind]) => kind === 'decoration' || kind === 'exit')
            .map(([ch]) => ch),
        );
        const tiles = level.tiles.map((row) =>
          [...row].map((ch) => (engineOwnedChars.has(ch) ? '.' : ch)).join(''),
        );
        const legend = Object.fromEntries(
          Object.entries(level.legend).filter(([, kind]) => kind !== 'decoration' && kind !== 'exit'),
        );
        return JSON.stringify(
          {
            levels: [{ ...level, tiles, legend }],
            NOTE: 'plus two more levels in the real spec; decoration and the exit door are engine-placed',
          },
          null,
          1,
        );
      }
      const level = g.levels[0]!;
      const trimmed =
        'tiles' in level
          ? { ...level, tiles: [...level.tiles.slice(0, 8), '...remaining rows omitted...'] }
          : level;
      return JSON.stringify({ levels: [trimmed], NOTE: 'plus two more levels in the real spec' }, null, 1);
    }
    case 'entities': {
      const custom = Object.entries(g.sprites.custom).slice(0, 1);
      return JSON.stringify(
        {
          sprites: { custom: Object.fromEntries(custom), assign: g.sprites.assign },
          boss: g.boss,
          ...(g.sfx ? { sfx: Object.fromEntries(Object.entries(g.sfx).slice(0, 2)) } : {}),
        },
        null,
        1,
      );
    }
    case 'music': {
      const music: MusicBlock = g.music;
      const patterns = Object.fromEntries(Object.entries(music.patterns).slice(0, 2));
      return JSON.stringify(
        {
          music: {
            bpm: music.bpm,
            key: music.key,
            instruments: music.instruments,
            patterns,
            songs: music.songs,
            jingles: { victory: music.jingles.victory },
          },
        },
        null,
        1,
      );
    }
  }
}
