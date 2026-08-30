// Compatibility exports for callers that historically reached connected-tile
// rendering through the platformer package. The implementation is now shared
// by every tiled side-view archetype in @sparkade/engine.
export {
  SOLID_EAST,
  SOLID_NEIGHBOR_MASK,
  SOLID_NORTH,
  SOLID_SOUTH,
  SOLID_WEST,
  ConnectedSolidAutotiles as PlatformerSolidAutotiles,
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
} from '@sparkade/engine';
