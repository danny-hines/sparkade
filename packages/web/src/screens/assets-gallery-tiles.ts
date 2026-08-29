import { inferSolidInnerRef, solidNeighborMask, solidTileVariant } from '@sparkade/archetypes';

export const GALLERY_TILE_PREVIEW_SIZE = 3;

export interface GallerySolidPreviewCell {
  tx: number;
  ty: number;
  mask: number;
  sourceId: string;
}

export interface GallerySolidPreviewPlan {
  capId: string;
  innerId: string;
  cells: GallerySolidPreviewCell[];
}

export interface GalleryTileDisplaySize {
  width: number;
  height: number;
}

export type GalleryTilePreviewMode = 'heroic' | 'compact' | 'detail';
export const SPATIAL_TERRAIN_ATLAS_PERIOD = 4;
export const SPATIAL_TERRAIN_PREVIEW_SIZE = SPATIAL_TERRAIN_ATLAS_PERIOD * 2;

/** HD inner terrain frames form a spatial 4×4 macrotexture, not an animation. */
export function isSpatialTerrainAtlas(id: string): boolean {
  return id.endsWith('_solid_inner_hd');
}

/** Physical output size after the platformer's world and cabinet transforms. */
export function galleryTileDisplaySize(
  id: string,
  sourceWidth: number,
  sourceHeight: number,
  mode: GalleryTilePreviewMode,
  fallbackZoom: number,
): GalleryTileDisplaySize {
  if (!id.endsWith('_hd')) {
    return { width: sourceWidth * fallbackZoom, height: sourceHeight * fallbackZoom };
  }
  if (mode === 'detail') {
    return { width: sourceWidth * 2, height: sourceHeight * 2 };
  }

  const logicalSize = id.endsWith('_moving_platform_hd')
    ? { width: 24, height: 8 }
    : id.endsWith('_exit_hd')
      ? { width: 16, height: 32 }
      : { width: 16, height: 16 };
  const physicalScale = mode === 'heroic' ? 4 : 2;
  return {
    width: logicalSize.width * physicalScale,
    height: logicalSize.height * physicalScale,
  };
}

/**
 * Describe the same connected solid rectangle the platformer would render.
 * Non-solid assets and single-tile inspection deliberately stay on the raw
 * gallery path; a missing companion reuses the cap just like gameplay.
 */
export function buildSolidPreviewPlan(
  id: string,
  tiled: boolean,
  hasEntry: (candidateId: string) => boolean,
): GallerySolidPreviewPlan | null {
  if (!tiled) return null;
  const inferredInnerId = id.endsWith('_solid_hd')
    ? id.replace(/_solid_hd$/, '_solid_inner_hd')
    : inferSolidInnerRef(`lib:${id}`)?.slice(4);
  if (!inferredInnerId) return null;
  const innerId = hasEntry(inferredInnerId) ? inferredInnerId : id;
  const inside = (tx: number, ty: number): boolean =>
    tx >= 0 && ty >= 0 && tx < GALLERY_TILE_PREVIEW_SIZE && ty < GALLERY_TILE_PREVIEW_SIZE;
  const cells: GallerySolidPreviewCell[] = [];

  for (let ty = 0; ty < GALLERY_TILE_PREVIEW_SIZE; ty++) {
    for (let tx = 0; tx < GALLERY_TILE_PREVIEW_SIZE; tx++) {
      const mask = solidNeighborMask(inside, tx, ty);
      cells.push({
        tx,
        ty,
        mask,
        sourceId: solidTileVariant(mask) === 'inner' ? innerId : id,
      });
    }
  }

  return { capId: id, innerId, cells };
}
