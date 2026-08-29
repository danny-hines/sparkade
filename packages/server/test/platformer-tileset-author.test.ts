import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  buildPlatformerTilesetBodyPrompt,
  buildPlatformerTilesetBodyStyleReference,
  buildPlatformerTilesetFixturePrompt,
  buildPlatformerTilesetFixturePolicyFallbackPrompt,
  buildPlatformerTilesetTerrainPrompt,
  processPlatformerTilesetFixture,
  processPlatformerTilesetTerrain,
} from '../src/assets/platformer-tileset-author';

describe('curated platformer tileset authoring', () => {
  it('separates full-bleed material and keyed fixture contracts', () => {
    const terrain = buildPlatformerTilesetTerrainPrompt('cave', 'wet crystal caverns');
    const moving = buildPlatformerTilesetFixturePrompt(
      'cave',
      'wet crystal caverns',
      'movingPlatform',
    );

    expect(terrain).toContain('continuous macrotexture');
    expect(terrain).toContain('Fill every pixel edge-to-edge');
    expect(terrain).toContain('repeated as a seamless square texture');
    expect(terrain).toContain('absolutely no full-width divider');
    expect(terrain).not.toContain('#00ff00');
    const body = buildPlatformerTilesetBodyPrompt('cave', 'wet crystal caverns');
    expect(body).toContain('seamless tileable game texture');
    expect(body).toContain('no walkable surface, top cap');
    expect(body).toContain('top continues into bottom');
    expect(body).toContain('equally plausible after a 90-degree rotation');
    expect(body).toContain('Every 64-by-64 crop');
    expect(moving).toContain('exact style, material, palette, lighting, and pixel-density');
    expect(moving).toContain('never become a hairline');
    expect(moving).toContain('#00ff00');

    const safeHazard = buildPlatformerTilesetFixturePolicyFallbackPrompt('hazard');
    expect(safeHazard).toContain('family-friendly');
    expect(safeHazard).toContain('non-living, abstract triangular obstacle markers');
    expect(safeHazard).not.toContain('flames');
  });

  it('removes the authored surface from the body style reference', async () => {
    const source = await sharp({
      create: { width: 100, height: 100, channels: 4, background: '#4d3528' },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 100, height: 35, channels: 4, background: '#8a9f45' },
          })
            .png()
            .toBuffer(),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();

    const reference = await buildPlatformerTilesetBodyStyleReference(source);
    const decoded = await sharp(reference).raw().toBuffer({ resolveWithObject: true });
    expect(decoded.info).toMatchObject({ width: 1024, height: 1024 });
    expect([...decoded.data.subarray(0, 3)]).toEqual([77, 53, 40]);
  });

  it('derives both density-four solid atlases from one material study', async () => {
    const source = await sharp({
      create: { width: 512, height: 512, channels: 4, background: '#4d3528' },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 512, height: 100, channels: 4, background: '#8a9f45' },
          })
            .png()
            .toBuffer(),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();

    const pair = await processPlatformerTilesetTerrain(source);
    await expect(sharp(pair.solidCap).metadata()).resolves.toMatchObject({
      width: 256,
      height: 64,
    });
    await expect(sharp(pair.solidInner).metadata()).resolves.toMatchObject({
      width: 256,
      height: 256,
    });
    const innerPixel = await sharp(pair.solidInner).raw().toBuffer();
    expect([...innerPixel.subarray(0, 3)]).toEqual([77, 53, 40]);
  });

  it('uses a dedicated buried-body source without carrying over the surface cap', async () => {
    const surface = await sharp({
      create: { width: 512, height: 512, channels: 4, background: '#4d3528' },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 512, height: 128, channels: 4, background: '#8a9f45' },
          })
            .png()
            .toBuffer(),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const body = await sharp({
      create: { width: 512, height: 512, channels: 4, background: '#68462f' },
    })
      .png()
      .toBuffer();

    const pair = await processPlatformerTilesetTerrain(surface, body);
    const innerPixel = await sharp(pair.solidInner).raw().toBuffer();
    expect([...innerPixel.subarray(0, 3)]).toEqual([104, 70, 47]);
  });

  it('keys and thickens a moving platform candidate', async () => {
    const subject = await sharp({
      create: { width: 512, height: 512, channels: 4, background: '#00ff00' },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 430, height: 18, channels: 4, background: '#a65f37' },
          })
            .png()
            .toBuffer(),
          left: 41,
          top: 210,
        },
      ])
      .png()
      .toBuffer();

    const output = await processPlatformerTilesetFixture(subject, 'movingPlatform');
    const decoded = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const opaqueRows = new Set<number>();
    for (let pixel = 0; pixel < decoded.info.width * decoded.info.height; pixel++) {
      if (decoded.data[pixel * 4 + 3]! > 8) {
        opaqueRows.add(Math.floor(pixel / decoded.info.width));
      }
    }
    expect(decoded.info).toMatchObject({ width: 96, height: 32 });
    expect(opaqueRows.size).toBeGreaterThanOrEqual(18);
    expect(Math.min(...opaqueRows)).toBe(0);
  });
});
