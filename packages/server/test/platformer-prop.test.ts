import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_PLATFORMER_PROPS,
  buildPlatformerPropPrompt,
  processGeneratedPlatformerProp,
} from '../src/assets/platformer-prop';

describe('generated platformer props', () => {
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
