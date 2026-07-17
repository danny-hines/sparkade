import { describe, expect, it } from 'vitest';
import { buildSolidPreviewPlan } from '../src/screens/assets-gallery-tiles';

describe('asset gallery connected solid previews', () => {
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

  it('leaves raw inspection unchanged outside connected solid previews', () => {
    const exists = () => true;

    expect(buildSolidPreviewPlan('ice_solid', false, exists)).toBeNull();
    expect(buildSolidPreviewPlan('ice_solid_inner', true, exists)).toBeNull();
    expect(buildSolidPreviewPlan('ice_platform', true, exists)).toBeNull();
  });
});
