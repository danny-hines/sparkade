// Built-in sprite library — the hand-authored quality floor. Every id in
// LIB_SPRITE_IDS (shared/constants.ts) must exist here; a unit test enforces it.
import { LIB_SPRITE_IDS } from '@sparkade/shared';
import type { LibraryEntry } from '../types';
import { HEROES } from './heroes';
import { HEROES_PLATFORMER } from './heroes-platformer';
import { HEROES_ADVENTURE } from './heroes-adventure';
import { SHIPS } from './ships';
import { ENEMIES } from './enemies';
import { ENEMIES_GROUND } from './enemies-ground';
import { FOES_SHOOTER } from './foes-shooter';
import { BOSSES } from './bosses';
import { BOSSES_PLATFORMER } from './bosses-platformer';
import { BOSSES_SHOOTER } from './bosses-shooter';
import { BOSSES_ADVENTURE } from './bosses-adventure';
import { BOSSES_EXTRA } from './bosses-extra';
import { OBJECTS } from './objects';
import { NPCS } from './npcs';
import { TILES } from './tiles';
import { TILES_CASTLE } from './tiles-castle';
import { TILES_CAVE } from './tiles-cave';
import { TILES_WASTELAND } from './tiles-wasteland';
import { TILES_ALIEN } from './tiles-alien';
import { TILES_ICE } from './tiles-ice';
import { TILES_DESERT } from './tiles-desert';
import { TILES_CLOCKWORK } from './tiles-clockwork';
import { TILES_CANDY } from './tiles-candy';
import { TILES_CORAL } from './tiles-coral';
import { TILES_GARDEN } from './tiles-garden';
import { TILES_SOLID_INNER } from './tiles-solid-inner';

export const LIBRARY: Record<string, LibraryEntry> = {
  ...HEROES,
  ...HEROES_PLATFORMER,
  ...HEROES_ADVENTURE,
  ...SHIPS,
  ...ENEMIES,
  ...ENEMIES_GROUND,
  ...FOES_SHOOTER,
  ...BOSSES,
  ...BOSSES_PLATFORMER,
  ...BOSSES_SHOOTER,
  ...BOSSES_ADVENTURE,
  ...BOSSES_EXTRA,
  ...OBJECTS,
  ...NPCS,
  ...TILES,
  ...TILES_CASTLE,
  ...TILES_CAVE,
  ...TILES_WASTELAND,
  ...TILES_ALIEN,
  ...TILES_ICE,
  ...TILES_DESERT,
  ...TILES_CLOCKWORK,
  ...TILES_CANDY,
  ...TILES_CORAL,
  ...TILES_GARDEN,
  ...TILES_SOLID_INNER,
};

/** Ids present in constants but missing from the library (must be empty; unit-tested). */
export function missingLibraryIds(): string[] {
  return LIB_SPRITE_IDS.filter((id) => !(id in LIBRARY));
}

export type { LibraryEntry };
