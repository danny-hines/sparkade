// Buried platformer terrain uses the same full-square, two-axis-seamless body
// texture as each family's dungeon wall. These aliases are intentional: wall
// art has no one-off surface cap, while retaining the exact shape language and
// palette semantics of its matching `*_solid` cap. Keeping one shared entry
// also prevents the two identical body assets from drifting apart over time.
import type { LibraryEntry } from '../types';
import { TILES } from './tiles';
import { TILES_ALIEN } from './tiles-alien';
import { TILES_CANDY } from './tiles-candy';
import { TILES_CASTLE } from './tiles-castle';
import { TILES_CAVE } from './tiles-cave';
import { TILES_CLOCKWORK } from './tiles-clockwork';
import { TILES_CORAL } from './tiles-coral';
import { TILES_DESERT } from './tiles-desert';
import { TILES_GARDEN } from './tiles-garden';
import { TILES_ICE } from './tiles-ice';
import { TILES_WASTELAND } from './tiles-wasteland';

export const TILES_SOLID_INNER: Record<string, LibraryEntry> = {
  tile_solid_inner: TILES['tile_wall']!,
  castle_solid_inner: TILES_CASTLE['castle_wall']!,
  cave_solid_inner: TILES_CAVE['cave_wall']!,
  wasteland_solid_inner: TILES_WASTELAND['wasteland_wall']!,
  alien_solid_inner: TILES_ALIEN['alien_wall']!,
  ice_solid_inner: TILES_ICE['ice_wall']!,
  desert_solid_inner: TILES_DESERT['desert_wall']!,
  clockwork_solid_inner: TILES_CLOCKWORK['clockwork_wall']!,
  candy_solid_inner: TILES_CANDY['candy_wall']!,
  coral_solid_inner: TILES_CORAL['coral_wall']!,
  garden_solid_inner: TILES_GARDEN['garden_wall']!,
};
