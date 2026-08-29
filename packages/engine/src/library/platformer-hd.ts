import type { LibraryEntry } from '../types';
import { LIB_PLATFORMER_ONLY_TILE_THEMES, LIB_PLATFORMER_TILE_KINDS } from '@sparkade/shared';
import generated from './platformer-hd.generated.json';

export const PLATFORMER_HD_TILE_KINDS = [
  'solid',
  'solid_inner',
  'platform',
  'hazard',
  'checkpoint',
  'exit',
  'deco',
  'moving_platform',
] as const;

export type PlatformerHdTileKind = (typeof PLATFORMER_HD_TILE_KINDS)[number];

interface PlatformerHdTilePackFile {
  version: 1;
  density: number;
  themes: Record<
    string,
    {
      source?: { model?: string; note?: string };
      sourcePalette?: string[];
      entries: Partial<Record<PlatformerHdTileKind, LibraryEntry>>;
    }
  >;
}

const file = generated as PlatformerHdTilePackFile;

/** Internal library entries authored once with Muse Image and checked in. */
export const TILES_PLATFORMER_HD: Record<string, LibraryEntry> = Object.fromEntries(
  Object.entries(file.themes).flatMap(([theme, pack]) =>
    Object.entries(pack.entries).map(([kind, entry]) => {
      const resolved = entry as LibraryEntry;
      return [
        `${theme}_${kind}_hd`,
        pack.sourcePalette ? { ...resolved, sourcePalette: pack.sourcePalette } : resolved,
      ];
    }),
  ),
);

function compactFrame(frame: LibraryEntry['frames'][number]): LibraryEntry['frames'][number] {
  const width = 16;
  const height = 16;
  return {
    w: width,
    h: height,
    rows: Array.from({ length: height }, (_, y) => {
      const sourceY = Math.min(frame.h - 1, Math.floor((y * frame.h) / height));
      const source = frame.rows[sourceY] ?? '.'.repeat(frame.w);
      return Array.from({ length: width }, (_, x) => {
        const sourceX = Math.min(frame.w - 1, Math.floor((x * frame.w) / width));
        return source[sourceX] ?? '.';
      }).join('');
    }),
  };
}

/** Validation-compatible 16px refs for platformer-only families. Gameplay
 * immediately upgrades these refs to their density-four counterparts. */
export const TILES_PLATFORMER_HD_BASES: Record<string, LibraryEntry> = Object.fromEntries(
  LIB_PLATFORMER_ONLY_TILE_THEMES.flatMap((theme) =>
    LIB_PLATFORMER_TILE_KINDS.flatMap((kind) => {
      const entry = TILES_PLATFORMER_HD[`${theme}_${kind}_hd`];
      if (!entry) return [];
      return [
        [
          `${theme}_${kind}`,
          {
            ...entry,
            frames: entry.frames.map(compactFrame),
            sourceFrames: entry.sourceFrames?.map(compactFrame),
          },
        ] as const,
      ];
    }),
  ),
);

export const PLATFORMER_HD_TILE_DENSITY = file.density;

/** Upgrade a validated library ref only when a curated platformer-HD twin exists. */
export function platformerHdTileRef(ref: string): string {
  const match = /^lib:([a-z][a-z0-9_]*)$/.exec(ref);
  if (!match) return ref;
  const upgraded = `${match[1]}_hd`;
  return Object.prototype.hasOwnProperty.call(TILES_PLATFORMER_HD, upgraded)
    ? `lib:${upgraded}`
    : ref;
}

/** Infer the curated moving-platform entry from an assigned solid family. */
export function platformerHdMovingPlatformRef(solidRef: string): string | null {
  const match = /^lib:([a-z][a-z0-9_]*)_solid$/.exec(solidRef);
  if (!match) return null;
  const id = `${match[1]}_moving_platform_hd`;
  return Object.prototype.hasOwnProperty.call(TILES_PLATFORMER_HD, id) ? `lib:${id}` : null;
}
