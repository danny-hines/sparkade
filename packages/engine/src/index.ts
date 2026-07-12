// Sparkade engine substrate — layer 1 of the three-layer architecture.
// Zero DOM access at module load; everything DOM-touching lives inside classes.
export * from './types';
export { Rng } from './rng';
export { GameLoop, STEP } from './loop';
export { InputBroker, MenuRepeater, type RawInputId } from './input';
export { drawText, textWidth, wrapText, GLYPH, type TextOpts } from './font';
export {
  decodeSprite,
  flipCanvas,
  outlineCanvas,
  flashCanvas,
  SpriteStore,
  type ResolvedSprite,
} from './sprites';
export { Renderer, Camera, drawTileLayer } from './renderer';
export {
  BACKDROP_VARIANTS,
  makeBackdrop,
  pickVariant,
  type Backdrop,
  type BackdropVariant,
} from './backdrops';
export { ParticleSystem } from './particles';
export { aabbOverlap, moveAABB, cellsUnder, type AABB, type TileGrid, type Solidity, type MoveResult } from './physics';
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
  PauseOverlay,
  HowToPlayCard,
  ScoreTally,
  InitialsEntry,
  LeaderboardView,
  type LeaderboardRow,
  type PauseAction,
} from './overlays';
export { GameHost, type EngineContext, type ArchetypeRuntime, type GameHostCallbacks } from './gamehost';
export { LIBRARY, missingLibraryIds } from './library/index';
export { FONT_GLYPHS } from './fontdata';
