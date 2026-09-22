import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_PLATFORMER_PROPS,
  buildPlatformerPropPrompt,
  processGeneratedPlatformerProp,
  buildPlatformerPropBoardPrompt,
  processGeneratedPlatformerPropBoard,
  platformerPropBoardLayout,
} from '../src/assets/platformer-prop';
import { mockGeneratedImage } from '../src/assets/game-art';

describe('generated platformer props', () => {
  it.each([6, 8])(
    'splits a %i-item sheet into correctly sized independent assets',
    async (count) => {
      const roles = GENERATED_PLATFORMER_PROPS.slice(0, count);
      const prompt = buildPlatformerPropBoardPrompt(
        roles.map((role) => ({
          role,
          gameTitle: 'Moon Orchard',
          tagline: 'Restore the harvest',
          premise: 'A mechanical garden',
          colors: '#f06b42',
        })),
      );
      const cells = await processGeneratedPlatformerPropBoard(
        await mockGeneratedImage(prompt),
        roles,
      );
      expect(cells.map((cell) => cell.role)).toEqual(roles);
      for (const cell of cells) {
        expect(cell.error).toBeUndefined();
        expect(cell.png).toBeDefined();
        expect((await sharp(cell.png!).metadata()).width).toBe(
          cell.role.endsWith('Projectile') && cell.role !== 'powerupProjectile' ? 32 : 48,
        );
      }
    },
  );

  it('rejects an empty or clipped cell while preserving the other cells', async () => {
    const roles = GENERATED_PLATFORMER_PROPS.slice(0, 3);
    const { width, height } = platformerPropBoardLayout(roles.length);
    const object = await sharp({
      create: { width: 180, height: 120, channels: 4, background: '#f06b42' },
    })
      .png()
      .toBuffer();
    const source = await sharp({ create: { width, height, channels: 4, background: '#00ff00' } })
      .composite([
        { input: object, left: 140, top: 150 },
        // The middle cell is empty; the last cell clips against its left edge.
        { input: object, left: 1024, top: 150 },
      ])
      .png()
      .toBuffer();
    const cells = await processGeneratedPlatformerPropBoard(source, roles);
    expect(cells[0]?.png).toBeDefined();
    expect(cells[1]?.error).toBeDefined();
    expect(cells[2]?.error).toContain('boundary');
  });

  it('gives every gameplay role a single-object keyed sprite contract', () => {
    for (const role of GENERATED_PLATFORMER_PROPS) {
      const prompt = buildPlatformerPropPrompt({
        gameTitle: 'Moon Orchard',
        tagline: 'Restore the midnight harvest',
        premise: 'A gardener crosses a mechanical orchard to recover five moon seeds.',
        role,
        colors: '#ffcc44, #334466, #f5f0dd',
      });
      expect(prompt).toContain(`Asset role: ${role}`);
      expect(prompt).toContain('exactly ONE isolated gameplay item sprite');
      expect(prompt).toContain('#00ff00');
      expect(prompt).toContain('NOT a sprite sheet');
    }
  });

  it('carries the selected ability identity into its pickup and projectile art', () => {
    const ability = {
      kind: 'projectile' as const,
      name: 'Acorn Arc',
      visualConcept: 'A brass seed launcher whose glowing acorns trail tiny green sparks',
    };
    const pickup = buildPlatformerPropPrompt({
      gameTitle: 'Moon Orchard',
      tagline: 'Restore the midnight harvest',
      premise: 'A gardener repairs a mechanical orchard.',
      role: 'powerupProjectile',
      colors: '#ffcc44, #334466, #f5f0dd',
      ability,
    });
    const projectile = buildPlatformerPropPrompt({
      gameTitle: 'Moon Orchard',
      tagline: 'Restore the midnight harvest',
      premise: 'A gardener repairs a mechanical orchard.',
      role: 'heroProjectile',
      colors: '#ffcc44, #334466, #f5f0dd',
      ability,
    });
    for (const prompt of [pickup, projectile]) {
      expect(prompt).toContain('Acorn Arc');
      expect(prompt).toContain('brass seed launcher');
    }
  });

  it('keys and normalizes pickup and projectile assets at their native densities', async () => {
    const source = await sharp({
      create: { width: 256, height: 256, channels: 4, background: '#00ff00' },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 120, height: 96, channels: 4, background: '#f06b42' },
          })
            .png()
            .toBuffer(),
          left: 68,
          top: 80,
        },
      ])
      .png()
      .toBuffer();

    const pickup = await processGeneratedPlatformerProp(source, 'collectible');
    const projectile = await processGeneratedPlatformerProp(source, 'heroProjectile');
    await expect(sharp(pickup.png).metadata()).resolves.toMatchObject({ width: 48, height: 48 });
    await expect(sharp(projectile.png).metadata()).resolves.toMatchObject({
      width: 32,
      height: 32,
    });
  });
});
