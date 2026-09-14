// Racing generated-art pack: fixed bounded geometry shared by the server
// builders, the future pipeline stage, and the renderer. All layouts are
// exact pixel contracts — validators reject anything else.

/**
 * Wide course panorama above the road horizon (opaque PNG). Full 1536x480
 * keeps distant detail and room for heading parallax at runtime.
 */
export const RACING_PANORAMA_WIDTH = 1536;
export const RACING_PANORAMA_HEIGHT = 480;
/** Exactly three panoramas, keyed by cup race index (not template). */
export const RACING_PANORAMA_COUNT = 3;

/** One scenery/collectible atlas cell (transparent PNG). */
export const RACING_SCENERY_CELL = 96;
export const RACING_SCENERY_COLUMNS = 3;
export const RACING_SCENERY_ROWS = 2;
/** Six independently validated slots: 2 landmarks, 3 dressing, 1 boost. */
export const RACING_SCENERY_CELLS = 6;
export const RACING_SCENERY_ATLAS_WIDTH = RACING_SCENERY_CELL * RACING_SCENERY_COLUMNS;
export const RACING_SCENERY_ATLAS_HEIGHT = RACING_SCENERY_CELL * RACING_SCENERY_ROWS;
/** Atlas slot order: far landmark, near landmark, 3x dressing, boost slot. */
export const RACING_SCENERY_SLOTS = [
  'landmarkFar',
  'landmarkNear',
  'dressingA',
  'dressingB',
  'dressingC',
  'boost',
] as const;
export type RacingScenerySlot = (typeof RACING_SCENERY_SLOTS)[number];

/** One vehicle pose cell (transparent PNG). Player craft reads ~70px. */
export const RACING_CRAFT_CELL = 64;
/** Per-vehicle strip: neutral-rear, banking-left, banking-right, in order. */
export const RACING_CRAFT_POSES = ['rear', 'bankLeft', 'bankRight'] as const;
export type RacingCraftPose = (typeof RACING_CRAFT_POSES)[number];
export const RACING_CRAFT_STRIP_WIDTH = RACING_CRAFT_CELL * RACING_CRAFT_POSES.length;
export const RACING_CRAFT_STRIP_HEIGHT = RACING_CRAFT_CELL;
/** Five strips in fixed roster order: player first, then rivals 1-4. */
export const RACING_CRAFT_ROSTER_SIZE = 5;

/** One material tile at runtime (opaque top-down texture). */
export const RACING_MATERIAL_TILE = 128;
export const RACING_MATERIAL_ATLAS_SIZE = RACING_MATERIAL_TILE * 2;
/** Material quadrant order: road, offroad ground, curb/barrier, boost. */
export const RACING_MATERIAL_SLOTS = ['road', 'ground', 'curb', 'boost'] as const;
export type RacingMaterialSlot = (typeof RACING_MATERIAL_SLOTS)[number];

/** Asset-role suffixes for the five vehicle strips in roster order. */
export const RACING_CRAFT_ROLES = [
  'racingCraftPlayer',
  'racingCraftRival1',
  'racingCraftRival2',
  'racingCraftRival3',
  'racingCraftRival4',
] as const;
export type RacingCraftRole = (typeof RACING_CRAFT_ROLES)[number];

/** Asset roles for the three race-index panoramas. */
export const RACING_PANORAMA_ROLES = [
  'racingPanorama1',
  'racingPanorama2',
  'racingPanorama3',
] as const;
export type RacingPanoramaRole = (typeof RACING_PANORAMA_ROLES)[number];
