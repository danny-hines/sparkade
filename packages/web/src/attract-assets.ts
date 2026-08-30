import {
  GENERATED_FIGHTER_ATLAS_CELL_SIZE,
  GENERATED_GAME_ASSET_FILES,
  type ArchetypeId,
  type GeneratedGameAssetRole,
} from '@sparkade/shared';

export interface AttractAssetSpec {
  role: GeneratedGameAssetRole;
  filename: string;
  big?: boolean;
  crop?: { x: number; y: number; width: number; height: number };
}

const asset = (
  role: GeneratedGameAssetRole,
  options: Omit<AttractAssetSpec, 'role' | 'filename'> = {},
): AttractAssetSpec => ({ role, filename: GENERATED_GAME_ASSET_FILES[role], ...options });

const fighterIdleCrop = {
  x: 0,
  y: 0,
  width: GENERATED_FIGHTER_ATLAS_CELL_SIZE,
  height: GENERATED_FIGHTER_ATLAS_CELL_SIZE,
};

const ATTRACT_ASSETS: Partial<Record<ArchetypeId, readonly AttractAssetSpec[]>> = {
  platformer: [
    asset('platformerIdle'),
    asset('platformerEnemyWalker'),
    asset('platformerEnemyFlyer'),
    asset('platformerBoss', { big: true }),
  ],
  fighter: [
    asset('fighterPlayerAtlas', { crop: fighterIdleCrop }),
    asset('fighterOpponent1Atlas', { crop: fighterIdleCrop }),
    asset('fighterBossAtlas', { crop: fighterIdleCrop, big: true }),
  ],
  adventure: [asset('adventurePlayerDownIdle'), asset('adventureBoss', { big: true })],
  hshooter: [asset('hshooterPlayerCraft')],
};

/** A small, representative set of actual gameplay art for the attract screen.
 * Large atlases are cropped to one readable idle pose. */
export function attractAssetSpecs(archetype: ArchetypeId): readonly AttractAssetSpec[] {
  return ATTRACT_ASSETS[archetype] ?? [];
}
