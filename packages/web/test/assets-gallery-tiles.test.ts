import { describe, expect, it } from 'vitest';
import {
  buildSolidPreviewPlan,
  galleryTileDisplaySize,
  isSpatialTerrainAtlas,
  SPATIAL_TERRAIN_ATLAS_PERIOD,
  SPATIAL_TERRAIN_PREVIEW_SIZE,
} from '../src/screens/assets-gallery-tiles';

describe('asset gallery connected solid previews', () => {
  it('treats HD inner terrain as a spatial atlas rather than animation frames', () => {
    expect(isSpatialTerrainAtlas('garden_solid_inner_hd')).toBe(true);
    expect(isSpatialTerrainAtlas('garden_solid_hd')).toBe(false);
    expect(isSpatialTerrainAtlas('garden_solid_inner')).toBe(false);
    expect(SPATIAL_TERRAIN_ATLAS_PERIOD).toBe(4);
    expect(SPATIAL_TERRAIN_PREVIEW_SIZE).toBe(8);
  });

  it('models heroic and compact physical output while preserving a detail mode', () => {
    expect(galleryTileDisplaySize('garden_solid_hd', 64, 64, 'heroic', 5)).toEqual({
      width: 64,
      height: 64,
    });
    expect(galleryTileDisplaySize('garden_exit_hd', 64, 128, 'heroic', 5)).toEqual({
      width: 64,
      height: 128,
    });
    expect(galleryTileDisplaySize('garden_moving_platform_hd', 96, 32, 'heroic', 5)).toEqual({
      width: 96,
      height: 32,
    });
    expect(galleryTileDisplaySize('garden_solid_hd', 64, 64, 'compact', 5)).toEqual({
      width: 32,
      height: 32,
    });
    expect(galleryTileDisplaySize('garden_solid_hd', 64, 64, 'detail', 5)).toEqual({
      width: 128,
      height: 128,
    });
    expect(galleryTileDisplaySize('garden_solid', 16, 16, 'heroic', 5)).toEqual({
      width: 80,
      height: 80,
    });
  });

  it('uses cap art on top, inner art below, and the exact 3x3 perimeter masks', () => {
    const ids = new Set(['ice_solid', 'ice_solid_inner']);
    const plan = buildSolidPreviewPlan('ice_solid', true, (id) => ids.has(id));

    expect(plan).not.toBeNull();
    expect(plan!.innerId).toBe('ice_solid_inner');
    expect(plan!.cells.map((cell) => cell.mask)).toEqual([6, 14, 12, 7, 15, 13, 3, 11, 9]);
    expect(plan!.cells.map((cell) => cell.sourceId)).toEqual([
      'ice_solid',
      'ice_solid',
      'ice_solid',
      'ice_solid_inner',
      'ice_solid_inner',
      'ice_solid_inner',
      'ice_solid_inner',
      'ice_solid_inner',
      'ice_solid_inner',
    ]);
  });

  it('retains connected masks but reuses the cap when a companion is unavailable', () => {
    const plan = buildSolidPreviewPlan('custom_theme_solid', true, () => false);

    expect(plan).not.toBeNull();
    expect(plan!.innerId).toBe('custom_theme_solid');
    expect(new Set(plan!.cells.map((cell) => cell.sourceId))).toEqual(
      new Set(['custom_theme_solid']),
    );
    expect(plan!.cells.map((cell) => cell.mask)).toEqual([6, 14, 12, 7, 15, 13, 3, 11, 9]);
  });

  it('pairs density-four HD caps with their checked-in HD body atlas', () => {
    const ids = new Set(['garden_solid_hd', 'garden_solid_inner_hd']);
    const plan = buildSolidPreviewPlan('garden_solid_hd', true, (id) => ids.has(id));

    expect(plan?.innerId).toBe('garden_solid_inner_hd');
    expect(plan?.cells.slice(0, 3).map((cell) => cell.sourceId)).toEqual([
      'garden_solid_hd',
      'garden_solid_hd',
      'garden_solid_hd',
    ]);
    expect(plan?.cells.slice(3).every((cell) => cell.sourceId === 'garden_solid_inner_hd')).toBe(
      true,
    );
  });

  it('leaves raw inspection unchanged outside connected solid previews', () => {
    const exists = () => true;

    expect(buildSolidPreviewPlan('ice_solid', false, exists)).toBeNull();
    expect(buildSolidPreviewPlan('ice_solid_inner', true, exists)).toBeNull();
    expect(buildSolidPreviewPlan('ice_platform', true, exists)).toBeNull();
  });
});
