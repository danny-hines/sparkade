import { LIB_TILE_THEMES } from '@sparkade/shared';
import type { LibraryEntry } from '../types';
import generatedFixtures from './adventure-fixtures.generated.json';
import { TILES_PLATFORMER_HD } from './platformer-hd';

/**
 * Adventure's first high-density pack reuses the reviewed, direction-neutral
 * material studies already checked in for the platformer, plus a dedicated
 * top-down fixture atlas. Adventure-specific edge composition happens in
 * `topdown-tiles`; family-specific silhouettes can replace the shared fixture
 * set later without changing gameplay or sprite assignments.
 */
export const ADVENTURE_HD_TILE_KINDS = [
  'floor',
  'wall',
  'pit',
  'block',
  'hazard',
  'deco',
  'switch',
  'door_open',
  'door_locked',
  'door_boss',
] as const;

export type AdventureHdTileKind = (typeof ADVENTURE_HD_TILE_KINDS)[number];

const SOURCE_KIND: Partial<Record<AdventureHdTileKind, 'solid_inner' | 'hazard'>> = {
  floor: 'solid_inner',
  wall: 'solid_inner',
  pit: 'solid_inner',
  hazard: 'hazard',
};

interface AdventureFixturePackFile {
  version: 1;
  density: number;
  sourcePalette: string[];
  entries: Record<
    'block' | 'deco' | 'switch' | 'door_open' | 'door_locked' | 'door_boss',
    LibraryEntry
  >;
}

const fixtureFile = generatedFixtures as AdventureFixturePackFile;

function fixtureEntry(kind: AdventureHdTileKind): LibraryEntry | null {
  if (
    kind !== 'block' &&
    kind !== 'deco' &&
    kind !== 'switch' &&
    kind !== 'door_open' &&
    kind !== 'door_locked' &&
    kind !== 'door_boss'
  ) {
    return null;
  }
  return { ...fixtureFile.entries[kind], sourcePalette: fixtureFile.sourcePalette };
}

/** Internal density-four twins for the core top-down terrain roles. Namespaced
 * so shared roles such as deco cannot overwrite platformer art in LIBRARY. */
export const TILES_ADVENTURE_HD: Record<string, LibraryEntry> = Object.fromEntries(
  LIB_TILE_THEMES.flatMap((theme) =>
    ADVENTURE_HD_TILE_KINDS.flatMap((kind) => {
      const fixture = fixtureEntry(kind);
      if (fixture) return [[`adventure_${theme}_${kind}_hd`, fixture] as const];
      const sourceKind = SOURCE_KIND[kind];
      const source = sourceKind ? TILES_PLATFORMER_HD[`${theme}_${sourceKind}_hd`] : undefined;
      return source ? [[`adventure_${theme}_${kind}_hd`, source] as const] : [];
    }),
  ),
);

/** Upgrade a themed Adventure ref when its reviewed density-four twin exists. */
export function adventureHdTileRef(ref: string): string {
  const match = /^lib:([a-z][a-z0-9_]*)$/.exec(ref);
  if (!match) return ref;
  const upgraded = `adventure_${match[1]}_hd`;
  return Object.prototype.hasOwnProperty.call(TILES_ADVENTURE_HD, upgraded)
    ? `lib:${upgraded}`
    : ref;
}
