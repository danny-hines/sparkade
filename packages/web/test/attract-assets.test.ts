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
    expect(attractAssetSpecs('adventure').map((asset) => asset.role)).toContain(
      'adventureEnemyAtlas',
    );
    expect(attractAssetSpecs('adventure').map((asset) => asset.role)).toContain(
      'adventureObjectAtlas',
    );
    expect(attractAssetSpecs('hshooter').map((asset) => asset.role)).toEqual([
      'hshooterPlayerCraft',
      'hshooterEnemyAtlas',
      'hshooterBoss',
    ]);
    expect(attractAssetSpecs('shooter').map(({ role }) => role)).toEqual([
      'shooterPlayerCraft',
      'shooterEnemyAtlas',
      'shooterBoss',
    ]);
  });

  it('crops the H-scroll enemy atlas to one native role cell', () => {
    expect(
      attractAssetSpecs('hshooter').find((asset) => asset.role === 'hshooterEnemyAtlas')?.crop,
    ).toEqual({ x: 0, y: 0, width: 96, height: 96 });
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
