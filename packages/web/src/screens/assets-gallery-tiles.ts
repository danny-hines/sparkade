import {
  inferSolidInnerRef,
  solidNeighborMask,
  solidTileVariant,
} from '@sparkade/archetypes';

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
  const inferredRef = inferSolidInnerRef(`lib:${id}`);
  if (!inferredRef) return null;

  const inferredInnerId = inferredRef.slice(4);
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
