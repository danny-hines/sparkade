// Sparkade engine substrate — layer 1 of the three-layer architecture.
// Zero DOM access at module load; everything DOM-touching lives inside classes.
export * from './types';
export {
  harmonizeSourcePalette,
  semanticGamePaletteForSource,
  type LibraryColorMode,
} from './source-palette';
export { Rng } from './rng';
export { GameLoop, STEP } from './loop';
export { InputBroker, MenuRepeater, isTextEntryTarget, type RawInputId } from './input';
export { drawText, textWidth, wrapText, GLYPH, type TextOpts } from './font';
export {
  decodeSprite,
  createSilhouetteAura,
  flipCanvas,
  outlineCanvas,
  outlineRgbaPixels,
  silhouetteAuraRgbaBands,
  flashCanvas,
  SpriteStore,
  anchorSpriteOpaqueTop,
  makeTallHumanoidEntry,
  makeTallHeroEntry,
  makeTallSpriteEntry,
  resolveLikenessHead,
  resolveLibraryEntryArt,
  type ResolvedSprite,
  type ResolvedLibraryArt,
  type SilhouetteAura,
  type SilhouetteAuraBand,
  type SilhouetteAuraPixelBands,
  type SpritePresentation,
  type SpriteResolveOptions,
} from './sprites';
export {
  Renderer,
  Camera,
  worldTransform,
  worldZoomRect,
  drawTileLayer,
  drawObstacleShadows,
  drawObstacleTile,
  type WorldTransform,
  type WorldZoomRect,
} from './renderer';
export {
  BACKDROP_VARIANTS,
  generatedBackdropProgressSourceRect,
  generatedBackdropSourceRect,
  makeBackdrop,
  makeGeneratedBackdrop,
  pickVariant,
  type Backdrop,
  type BackdropVariant,
  type GeneratedBackdropOptions,
  type GeneratedBackdropSourceRect,
} from './backdrops';
export {
  SHOOTER_BACKDROP_VARIANTS,
  makeScrollBackdrop,
  pickScrollVariant,
  type ScrollBackdrop,
  type ScrollBackdropVariant,
} from './scroll-backdrop';
export { WEATHER_KINDS, makeWeather, type Weather, type WeatherKind } from './weather';
export { ParticleSystem } from './particles';
export {
  aabbOverlap,
  moveAABB,
  cellsUnder,
  type AABB,
  type TileGrid,
  type Solidity,
  type MoveResult,
} from './physics';
export { AudioSys } from './audio/audio';
export { ChiptunePlayer } from './audio/music';
export {
  noteToFreq,
  parseNoteChannel,
  parseDrumChannel,
  parsePattern,
  parseSong,
  validateMusic,
  type NoteEvent,
  type DrumEvent,
  type ParsedPattern,
  type ParsedSong,
} from './audio/music-parser';
export { renderSfx, sfxLengthSamples, DEFAULT_SFX, SFX_SAMPLE_RATE } from './audio/sfx-render';
export { SfxSynth } from './audio/sfx';
export { Hud } from './hud';
export { StoryCards, type CardContent } from './storycard';
export {
  SOLID_EAST,
  SOLID_NEIGHBOR_MASK,
  SOLID_NORTH,
  SOLID_SOUTH,
  SOLID_WEST,
  ConnectedSolidAutotiles,
  exposedSolidEdges,
  inferSolidInnerRef,
  isSolidInnerLibraryId,
  renderSolidVariant,
  resolveSolidInnerRef,
  roundedSolidCorners,
  solidNeighborMask,
  solidTileVariant,
  terrainAtlasFrame,
  type SolidCorner,
  type SolidEdge,
  type SolidTileVariant,
} from './connected-tiles';
export {
  TopDownConnectedAutotiles,
  renderTopDownTerrainVariant,
  type TopDownTerrainColors,
  type TopDownTerrainRelief,
} from './topdown-tiles';
export {
  PauseOverlay,
  HowToPlayCard,
  ScoreTally,
  InitialsEntry,
  LeaderboardView,
  type LeaderboardRow,
  type PauseAction,
} from './overlays';
export {
  GameHost,
  type EngineContext,
  type ArchetypeRuntime,
  type GameHostCallbacks,
} from './gamehost';
export { LIBRARY, missingLibraryIds } from './library/index';
export {
  PLATFORMER_HD_TILE_DENSITY,
  PLATFORMER_HD_TILE_KINDS,
  TILES_PLATFORMER_HD,
  platformerHdMovingPlatformRef,
  platformerHdSpringRef,
  highDensityTileRef,
  platformerHdTileRef,
  type PlatformerHdTileKind,
} from './library/platformer-hd';
export {
  ADVENTURE_HD_TILE_KINDS,
  TILES_ADVENTURE_HD,
  adventureHdTileRef,
  type AdventureHdTileKind,
} from './library/adventure-hd';
export { FONT_GLYPHS } from './fontdata';
