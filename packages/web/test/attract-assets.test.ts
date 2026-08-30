import { describe, expect, it } from 'vitest';
import { GENERATED_FIGHTER_ATLAS_CELL_SIZE } from '@sparkade/shared';
import { attractAssetSpecs } from '../src/attract-assets';

describe('attract screen Muse assets', () => {
  it('selects representative gameplay art for every Muse-backed archetype', () => {
    expect(attractAssetSpecs('platformer').map((asset) => asset.role)).toEqual([
      'platformerIdle',
      'platformerEnemyWalker',
      'platformerEnemyFlyer',
      'platformerBoss',
    ]);
    expect(attractAssetSpecs('adventure').map((asset) => asset.role)).toContain(
      'adventurePlayerDownIdle',
    );
    expect(attractAssetSpecs('hshooter').map((asset) => asset.role)).toEqual([
      'hshooterPlayerCraft',
    ]);
    expect(attractAssetSpecs('shooter').map(({ role }) => role)).toEqual([
      'shooterPlayerCraft',
    ]);
  });

  it('crops fighter atlases to a single native idle cell', () => {
    for (const asset of attractAssetSpecs('fighter')) {
      expect(asset.crop).toEqual({
        x: 0,
        y: 0,
        width: GENERATED_FIGHTER_ATLAS_CELL_SIZE,
        height: GENERATED_FIGHTER_ATLAS_CELL_SIZE,
      });
    }
  });
});
