// M2 racing asset builders: prompt contracts, fixed geometry, and
// green-key/opaque normalization. Synthetic sources come only from the
// MOCK-ONLY ./racing-mock module; the real provider path is never touched.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_GAME_ASSET_FILES,
  RACING_CRAFT_CELL,
  RACING_CRAFT_POSES,
  RACING_CRAFT_ROLES,
  RACING_MATERIAL_ATLAS_SIZE,
  RACING_PANORAMA_HEIGHT,
  RACING_PANORAMA_ROLES,
  RACING_PANORAMA_WIDTH,
  RACING_SCENERY_ATLAS_HEIGHT,
  RACING_SCENERY_ATLAS_WIDTH,
  RACING_SCENERY_CELL,
  RACING_SCENERY_SLOTS,
} from '@sparkade/shared';
import {
  RACING_CRAFT_STRIP_PROMPT_VERSION,
  buildRacingCraftStripPrompt,
  buildRacingIdentityReference,
  processGeneratedRacingCraftReference,
  processGeneratedRacingCraftStrip,
  processGeneratedRacingCraftStripReference,
  validateRacingCraftStrip,
} from '../src/assets/racing-craft';
import {
  RACING_PANORAMA_PROMPT_VERSION,
  RACING_SCENERY_PROMPT_VERSION,
  buildRacingPanoramaPrompt,
  buildRacingSceneryPrompt,
  processGeneratedRacingPanorama,
  processGeneratedRacingSceneryAtlas,
  validateRacingPanorama,
  validateRacingSceneryAtlas,
} from '../src/assets/racing-scenery';
import {
  RACING_MATERIALS_PROMPT_VERSION,
  buildRacingMaterialsPrompt,
  processGeneratedRacingMaterials,
  validateRacingMaterialAtlas,
} from '../src/assets/racing-materials';
import {
  mockRacingCraftRearSource,
  mockRacingCraftStripCroppedSource,
  mockRacingCraftStripEdgeSource,
  mockRacingCraftStripEmptySource,
  mockRacingCraftStripMergedSource,
  mockRacingCraftStripSource,
  mockRacingMaterialsSource,
  mockRacingPanoramaSource,
  mockRacingScenerySheetSource,
} from '../src/assets/racing-mock';

const CONCEPTS = {
  artDirection: 'Flat-shaded dusk-ember hover cup: glassy blacks, hot orange, cyan surge light',
  worldConcept: 'A dusk-ember hover cup through lava fields, coral coast, and a night stadium',
  playerCraft: 'Privateer twin-pod hovercraft in ember-orange over charcoal weave, rear view',
  rivals: [
    'Matte black dart with ember-orange fangs and a high tail fin, rear view',
    'Pearl-white wedge with coral-pink side pods and a low canopy, rear view',
    'Mint-green twinpod with yellow checker tail and round pods, rear view',
    'Deep violet wedge with violet-gold trim and a wide rear skirt, rear view',
  ],
  envConcepts: [
    'Ember fields at dusk: cooling lava veins between black glass ridges',
    'Coral coast morning: pale reef walls and spray arches over a causeway',
    'Ratchet stadium at night: tight chicane walls under floodlight towers',
  ],
  materials: {
    road: '#5c5e6e',
    ground: '#2f4a26',
    curb: '#d8d8cc',
    edge: '#35e0ff',
    pad: '#35e0ff',
  },
  boost: {
    displayName: 'Ember Cells',
    appearanceConcept: 'Small floating ember-orange octahedrons caged in cyan light',
  },
};

async function alphaAt(png: Buffer, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * 4 + 3]!;
}

describe('racing asset roles and geometry', () => {
  it('registers the full pack with stable filenames', () => {
    expect(GENERATED_GAME_ASSET_FILES.racingPanorama1).toBe('racing-panorama-1.png');
    expect(GENERATED_GAME_ASSET_FILES.racingSceneryAtlas).toBe('racing-scenery-atlas.png');
    expect(GENERATED_GAME_ASSET_FILES.racingCraftPlayer).toBe('racing-craft-player.png');
    expect(GENERATED_GAME_ASSET_FILES.racingCraftRival4).toBe('racing-craft-rival-4.png');
    expect(GENERATED_GAME_ASSET_FILES.racingMaterialAtlas).toBe('racing-material-atlas.png');
    expect(RACING_PANORAMA_ROLES).toHaveLength(3);
    expect(RACING_CRAFT_ROLES).toHaveLength(5);
    expect(RACING_SCENERY_SLOTS).toHaveLength(6);
    expect(RACING_CRAFT_POSES).toEqual(['rear', 'bankLeft', 'bankRight']);
  });
});

describe('racing craft strip prompt', () => {
  it('carries the authored concept with rear-camera and no-pilot constraints', () => {
    const prompt = buildRacingCraftStripPrompt({
      name: 'VEX',
      vehicleConcept: CONCEPTS.rivals[0]!,
      artDirection: CONCEPTS.artDirection,
      colors: '#101522, #ff5a2e, #35e0ff',
    });
    expect(prompt).toContain(CONCEPTS.rivals[0]);
    expect(prompt).toContain(CONCEPTS.artDirection);
    expect(prompt).toContain('low chase-camera height directly behind');
    expect(prompt).toContain('point directly AWAY');
    expect(prompt).toContain('neutral-rear cruise, banking LEFT, banking RIGHT');
    expect(prompt).toContain('no person, pilot, rider, passenger, face, head');
    expect(prompt).toContain('#00ff00');
    expect(prompt).toContain('never mirror an asymmetric livery');
    expect(prompt).toContain('8-12 degrees');
    expect(prompt).toContain('ample clear green gutters and margins');
    expect(prompt).toContain('No baked boost exhaust flames');
    expect(prompt).toContain('runtime owns all throttle and boost VFX');
    expect(RACING_CRAFT_STRIP_PROMPT_VERSION).toBe('racing-craft-strip-v4');
  });

  it('authors five distinct roster strips from the identity cast', () => {
    const prompts = [
      buildRacingCraftStripPrompt({
        name: 'ROOKIE',
        vehicleConcept: CONCEPTS.playerCraft,
        artDirection: CONCEPTS.artDirection,
      }),
      ...CONCEPTS.rivals.map((vehicleConcept, k) =>
        buildRacingCraftStripPrompt({
          name: `RIVAL${k + 1}`,
          vehicleConcept,
          artDirection: CONCEPTS.artDirection,
        }),
      ),
    ];
    expect(prompts).toHaveLength(5);
    for (const [k, prompt] of prompts.entries()) {
      const own = k === 0 ? CONCEPTS.playerCraft : CONCEPTS.rivals[k - 1]!;
      expect(prompt).toContain(own);
      for (const other of [...CONCEPTS.rivals, CONCEPTS.playerCraft]) {
        if (other !== own) expect(prompt).not.toContain(other);
      }
    }
  });
});

describe('racing craft strip processing', () => {
  it('keys and normalizes a valid strip with coherent per-pose cells', async () => {
    const { poses, png } = await processGeneratedRacingCraftStrip(
      await mockRacingCraftStripSource(),
    );
    await validateRacingCraftStrip(png);
    expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 192, height: 64 });
    for (const pose of RACING_CRAFT_POSES) {
      expect(await sharp(poses[pose]!.png).metadata()).toMatchObject({
        format: 'png',
        width: RACING_CRAFT_CELL,
        height: RACING_CRAFT_CELL,
      });
      const b = poses[pose]!.metrics.sourceBounds;
      expect(b.width).toBeGreaterThan(0);
    }
    // Real availability: transparent corners, opaque subject center.
    expect(await alphaAt(png, 2, 2)).toBe(0);
    expect(await alphaAt(poses.rear!.png, 32, 40)).toBeGreaterThan(200);
    // No pose substitution: asymmetric banks stay distinct.
    expect(poses.bankLeft!.png.equals(poses.bankRight!.png)).toBe(false);
  });

  it('rescues uneven spacing at true gutters instead of cutting craft', async () => {
    // Middle pose starts before the mathematical third divider (live #3):
    // gutter extraction must still isolate three complete silhouettes.
    const { poses } = await processGeneratedRacingCraftStrip(
      await mockRacingCraftStripCroppedSource(),
    );
    for (const pose of RACING_CRAFT_POSES) {
      expect(poses[pose]!.metrics.sourceBounds.width).toBeGreaterThan(0);
    }
  });

  it('rejects empty, merged, edge-cropped, backgroundless, and scale-warped strips', async () => {
    await expect(
      processGeneratedRacingCraftStrip(await mockRacingCraftStripEmptySource()),
    ).rejects.toThrow(/rear|bankLeft|bankRight/);
    await expect(
      processGeneratedRacingCraftStrip(await mockRacingCraftStripMergedSource()),
    ).rejects.toThrow(/no clear gutter/);
    await expect(
      processGeneratedRacingCraftStrip(await mockRacingCraftStripEdgeSource()),
    ).rejects.toThrow(/sheet edge/);
    const opaque = await sharp({
      create: { width: 384, height: 128, channels: 3, background: '#334455' },
    })
      .png()
      .toBuffer();
    await expect(processGeneratedRacingCraftStrip(opaque)).rejects.toThrow(/green/);
    // One pose far smaller than its siblings: scale incoherence fails.
    async function blobCell(size: number, color: string): Promise<Buffer> {
      return sharp({ create: { width: 200, height: 128, channels: 4, background: '#00ff00' } })
        .composite([
          {
            input: await sharp({
              create: {
                width: size,
                height: Math.round(size * 0.7),
                channels: 4,
                background: color,
              },
            })
              .png()
              .toBuffer(),
            left: Math.round((200 - size) / 2),
            top: Math.round((128 - size * 0.7) / 2),
          },
        ])
        .png()
        .toBuffer();
    }
    const warped = await sharp({
      create: { width: 600, height: 128, channels: 4, background: '#00ff00' },
    })
      .composite([
        { input: await blobCell(120, '#3a6fd8'), left: 0, top: 0 },
        { input: await blobCell(30, '#3a6fd8'), left: 200, top: 0 },
        { input: await blobCell(120, '#3a6fd8'), left: 400, top: 0 },
      ])
      .png()
      .toBuffer();
    await expect(processGeneratedRacingCraftStrip(warped)).rejects.toThrow(/scale/);
  });

  it('preserves a separated banking fin whose X extent overlaps the next pose', async () => {
    const source = await sharp(
      Buffer.from(`<svg width="600" height="200">
      <rect width="600" height="200" fill="#00ff00"/>
      <rect x="30" y="55" width="150" height="90" fill="#334488"/>
      <rect x="220" y="50" width="175" height="90" fill="#334488"/>
      <rect x="390" y="56" width="28" height="2" fill="#334488"/>
      <rect x="415" y="78" width="150" height="90" fill="#334488"/>
    </svg>`),
    )
      .png()
      .toBuffer();
    const strip = await processGeneratedRacingCraftStrip(source);
    expect(strip.poses.bankLeft.metrics.sourceBounds.width).toBe(198);
    expect(strip.poses.bankRight.metrics.sourceBounds.width).toBe(150);
  });

  it('allows tall rounded reference silhouettes but still rejects tiny ones', async () => {
    const ellipse = (w: number, h: number, color: string): string =>
      `<svg width="400" height="400"><rect width="400" height="400" fill="#00ff00"/><ellipse cx="200" cy="200" rx="${w / 2}" ry="${h / 2}" fill="${color}"/></svg>`;
    const tall = await sharp(Buffer.from(ellipse(150, 280, '#3a6fd8')))
      .png()
      .toBuffer();
    const reference = await processGeneratedRacingCraftReference(tall);
    expect(await sharp(reference).metadata()).toMatchObject({
      format: 'png',
      width: 1024,
      height: 512,
    });
    const tiny = await sharp(Buffer.from(ellipse(30, 24, '#3a6fd8')))
      .png()
      .toBuffer();
    await expect(processGeneratedRacingCraftReference(tiny)).rejects.toThrow();
  });

  it('builds a vehicle-first presentation reference and identity board', async () => {
    const reference = await processGeneratedRacingCraftReference(await mockRacingCraftRearSource());
    expect(await sharp(reference).metadata()).toMatchObject({
      format: 'png',
      width: 1024,
      height: 512,
    });
    // The pipeline reference comes from raw strip pixels, never the 64px cell.
    const stripReference = await processGeneratedRacingCraftStripReference(
      await mockRacingCraftStripSource(),
    );
    expect(await sharp(stripReference).metadata()).toMatchObject({
      format: 'png',
      width: 1024,
      height: 512,
    });
    const primary = await sharp({
      create: { width: 480, height: 270, channels: 3, background: '#203050' },
    })
      .png()
      .toBuffer();
    for (const board of [
      await buildRacingIdentityReference(primary, reference),
      await buildRacingIdentityReference(undefined, reference),
    ]) {
      expect(await sharp(board).metadata()).toMatchObject({
        format: 'png',
        width: 1024,
        height: 1024,
      });
    }
  });
});

describe('racing panorama prompt and processing', () => {
  it('carries per-course environment with opaque no-prop constraints', () => {
    for (const [k, envConcept] of CONCEPTS.envConcepts.entries()) {
      const prompt = buildRacingPanoramaPrompt({
        courseName: `Course ${k + 1}`,
        artDirection: CONCEPTS.artDirection,
        worldConcept: CONCEPTS.worldConcept,
        envConcept,
      });
      expect(prompt).toContain(envConcept);
      expect(prompt).toContain(CONCEPTS.worldConcept);
      expect(prompt).toContain(CONCEPTS.artDirection);
      expect(prompt).toContain('ABOVE the road horizon');
      expect(prompt).toContain('No painted road, track, lane, vehicle');
      expect(prompt).toContain('FULLY OPAQUE');
      expect(prompt).not.toContain('#00ff00');
    }
    expect(RACING_PANORAMA_PROMPT_VERSION).toBe('racing-panorama-v3');
  });

  it('cover-crops wide plates to 1536x480 and rejects narrow or transparent ones', async () => {
    const png = await processGeneratedRacingPanorama(await mockRacingPanoramaSource());
    await validateRacingPanorama(png);
    expect(await sharp(png).metadata()).toMatchObject({
      format: 'png',
      width: RACING_PANORAMA_WIDTH,
      height: RACING_PANORAMA_HEIGHT,
    });
    expect(RACING_PANORAMA_WIDTH).toBe(1536);
    expect(RACING_PANORAMA_HEIGHT).toBe(480);
    // Normal provider-native 2:1 plates are accepted, not rejected.
    const wide = await sharp({
      create: { width: 1024, height: 512, channels: 3, background: '#223344' },
    })
      .png()
      .toBuffer();
    const cropped = await processGeneratedRacingPanorama(wide);
    expect(await sharp(cropped).metadata()).toMatchObject({ width: 1536, height: 480 });
    const square = await sharp({
      create: { width: 256, height: 256, channels: 3, background: '#223344' },
    })
      .png()
      .toBuffer();
    await expect(processGeneratedRacingPanorama(square)).rejects.toThrow(/genuinely wide/);
    const transparent = await sharp({
      create: {
        width: 512,
        height: 160,
        channels: 4,
        background: { r: 34, g: 51, b: 68, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    await expect(processGeneratedRacingPanorama(transparent)).rejects.toThrow(/opaque/);
  });
});

describe('racing scenery prompt and atlas', () => {
  it('adapts the boost slot to the cup supply mode', () => {
    const pickups = buildRacingSceneryPrompt({
      artDirection: CONCEPTS.artDirection,
      worldConcept: CONCEPTS.worldConcept,
      boostSlot: 'collectible',
      boostDisplayName: CONCEPTS.boost.displayName,
      boostAppearanceConcept: CONCEPTS.boost.appearanceConcept,
    });
    expect(pickups).toContain(CONCEPTS.boost.displayName);
    expect(pickups).toContain(CONCEPTS.boost.appearanceConcept);
    expect(pickups).toContain('bankable boost collectible');
    const pads = buildRacingSceneryPrompt({
      artDirection: CONCEPTS.artDirection,
      worldConcept: CONCEPTS.worldConcept,
      boostSlot: 'padTrim',
    });
    expect(pads).toContain('boost-pad track trim');
    expect(pads).not.toContain(CONCEPTS.boost.displayName);
    const none = buildRacingSceneryPrompt({
      artDirection: CONCEPTS.artDirection,
      worldConcept: CONCEPTS.worldConcept,
      boostSlot: 'landmark',
    });
    expect(none).toContain('nothing boost-shaped');
    for (const prompt of [pickups, pads, none]) {
      expect(prompt).toContain('3-by-2 grid');
      expect(prompt).toContain('#00ff00');
      expect(prompt).not.toContain('posts/pines/crystals');
    }
    expect(RACING_SCENERY_PROMPT_VERSION).toBe('racing-scenery-atlas-v2');
  });

  it('keys six slots independently and rejects a gutted sheet', async () => {
    const { slots, png } = await processGeneratedRacingSceneryAtlas(
      await mockRacingScenerySheetSource(),
    );
    await validateRacingSceneryAtlas(png);
    expect(await sharp(png).metadata()).toMatchObject({
      format: 'png',
      width: RACING_SCENERY_ATLAS_WIDTH,
      height: RACING_SCENERY_ATLAS_HEIGHT,
    });
    expect(Object.keys(slots)).toHaveLength(6);
    for (const [index, slot] of RACING_SCENERY_SLOTS.entries()) {
      expect(await sharp(slots[slot]!.png).metadata()).toMatchObject({
        width: RACING_SCENERY_CELL,
        height: RACING_SCENERY_CELL,
      });
      const cx = (index % 3) * RACING_SCENERY_CELL + 48;
      const cy = Math.floor(index / 3) * RACING_SCENERY_CELL + 48;
      expect(await alphaAt(png, cx, cy)).toBeGreaterThan(0);
    }
    const allGreen = await sharp({
      create: { width: 576, height: 384, channels: 4, background: '#00ff00' },
    })
      .png()
      .toBuffer();
    await expect(processGeneratedRacingSceneryAtlas(allGreen)).rejects.toThrow();
  });
});

describe('uneven racing scenery rows', () => {
  it('keeps a tall landmark that crosses the nominal half-height grid', async () => {
    const source = await sharp(
      Buffer.from(`<svg width="600" height="400">
      <rect width="600" height="400" fill="#00ff00"/>
      <rect x="30" y="10" width="100" height="230" fill="#334488"/>
      <rect x="205" y="80" width="170" height="140" fill="#883344"/>
      <rect x="430" y="65" width="135" height="135" fill="#448833"/>
      <rect x="20" y="285" width="135" height="100" fill="#334488"/>
      <rect x="220" y="285" width="115" height="100" fill="#883344"/>
      <rect x="430" y="285" width="140" height="100" fill="#334488"/>
    </svg>`),
    )
      .png()
      .toBuffer();
    const result = await processGeneratedRacingSceneryAtlas(source);
    expect(result.slots.landmarkFar.metrics.sourceBounds.height).toBe(230);
    expect(result.slots.landmarkNear.metrics.sourceBounds.width).toBe(170);
    expect(result.slots.boost.metrics.sourceBounds.width).toBe(140);
  });
});

describe('racing materials prompt and atlas', () => {
  it('roots every quadrant in the world, locale, and hex palette', () => {
    for (const mode of ['pads', 'pickups', 'none'] as const) {
      const prompt = buildRacingMaterialsPrompt({
        artDirection: CONCEPTS.artDirection,
        worldConcept: CONCEPTS.worldConcept,
        envContext: CONCEPTS.envConcepts[0]!,
        materials: CONCEPTS.materials,
        boostMode: mode,
      });
      expect(prompt).toContain(CONCEPTS.worldConcept);
      expect(prompt).toContain(CONCEPTS.envConcepts[0]!);
      for (const hex of Object.values(CONCEPTS.materials)) expect(prompt).toContain(hex);
      expect(prompt).toContain(
        'road surface, offroad ground, curb/barrier material, boost-surface material',
      );
      expect(prompt).toContain('No perspective');
      expect(prompt).toContain('FULLY OPAQUE');
      expect(prompt).not.toContain('#00ff00');
    }
    expect(RACING_MATERIALS_PROMPT_VERSION).toBe('racing-materials-v1');
  });

  it('normalizes textured sheets and rejects flat or misshapen input', async () => {
    const png = await processGeneratedRacingMaterials(await mockRacingMaterialsSource());
    await validateRacingMaterialAtlas(png);
    expect(await sharp(png).metadata()).toMatchObject({
      format: 'png',
      width: RACING_MATERIAL_ATLAS_SIZE,
      height: RACING_MATERIAL_ATLAS_SIZE,
    });
    const flat = await sharp({
      create: { width: 256, height: 256, channels: 3, background: '#5c5e6e' },
    })
      .png()
      .toBuffer();
    await expect(processGeneratedRacingMaterials(flat)).rejects.toThrow(/flat fill/);
    const wide = await sharp({
      create: { width: 512, height: 256, channels: 3, background: '#5c5e6e' },
    })
      .png()
      .toBuffer();
    await expect(processGeneratedRacingMaterials(wide)).rejects.toThrow(/square/);
  });
});

describe('racing mock sources', () => {
  it('are deterministic and stay on the mock path', async () => {
    expect((await mockRacingCraftStripSource()).equals(await mockRacingCraftStripSource())).toBe(
      true,
    );
    expect(
      (await mockRacingScenerySheetSource()).equals(await mockRacingScenerySheetSource()),
    ).toBe(true);
    // Mock strip is a green-key source the real validator accepts…
    await validateRacingCraftStrip(
      (await processGeneratedRacingCraftStrip(await mockRacingCraftStripSource())).png,
    );
    // …while the opaque mock panorama never touches the green-key path.
    const pano = await mockRacingPanoramaSource();
    const { data, info } = await sharp(pano)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let transparent = 0;
    for (let pixel = 0; pixel < info.width * info.height; pixel++) {
      if (data[pixel * 4 + 3]! < 250) transparent++;
    }
    expect(transparent).toBe(0);
  });
});

const LIVE_ATTEMPT_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  'data',
  'experiments',
  'racing-identity',
  'live',
  'neon',
  'raw-attempt-2',
);
const liveSamplesPresent =
  existsSync(join(LIVE_ATTEMPT_DIR, '3.png')) && existsSync(join(LIVE_ATTEMPT_DIR, '4.png'));

describe('live host samples (ignored report only, never fixtures)', () => {
  const maybeIt = liveSamplesPresent ? it : it.skip;
  maybeIt('processes neon attempt-2 #3/#4 end to end', async () => {
    const report: Record<string, unknown> = {
      promptVersion: RACING_CRAFT_STRIP_PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
      samples: {},
    };
    for (const n of ['3', '4']) {
      const raw = await readFile(join(LIVE_ATTEMPT_DIR, `${n}.png`));
      const meta = await sharp(raw).metadata();
      const strip = await processGeneratedRacingCraftStrip(raw);
      const reference = await processGeneratedRacingCraftStripReference(raw);
      const refMeta = await sharp(reference).metadata();
      const spans = RACING_CRAFT_POSES.map((pose) => {
        const b = strip.poses[pose]!.metrics.sourceBounds;
        return `${b.width}x${b.height}`;
      });
      (report.samples as Record<string, unknown>)[n] = {
        source: `${meta.width}x${meta.height}`,
        poseSpans: spans,
        reference: `${refMeta.width}x${refMeta.height}`,
        status: 'accepted',
      };
      await validateRacingCraftStrip(strip.png);
    }
    await writeFile(
      join(LIVE_ATTEMPT_DIR, 'normalization-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    expect(Object.keys(report.samples as Record<string, unknown>)).toEqual(['3', '4']);
  });
});
