import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DesignDoc, RacingSpec } from '@sparkade/shared';
import { buildDesignPrompt } from '../src/pipeline/prompts';
import { racingIdentityProblems } from '../src/pipeline/racing-identity';
import { validateDesignSchema } from '../src/pipeline/validate';
import { MockProvider, mockJetskiRequested } from '../src/providers/mock';
import {
  RACING_CRAFT_STRIP_PROMPT_VERSION,
  RACING_JETSKI_STRIP_PROMPT_VERSION,
  buildRacingCraftStripPrompt,
} from '../src/assets/racing-craft';
import {
  RACING_BANK_PROMPT_VERSION,
  RACING_JETSKI_BANK_PROMPT_VERSION,
  buildRacingBankEditPrompt,
} from '../src/assets/racing-bank';
import {
  RACING_JETSKI_JUDGE_PROMPT_VERSION,
  RACING_JUDGE_PROMPT_VERSION,
  buildRacingPackPlan,
  buildRacingRosterJudgePrompt,
  racingRosterSlots,
} from '../src/assets/racing-pack';
import sharp from 'sharp';
import {
  RACING_MATERIAL_ATLAS_SIZE,
  RACING_MATERIAL_TILE,
  RACING_PANORAMA_HEIGHT,
  RACING_PANORAMA_WIDTH,
} from '@sparkade/shared';
import {
  RACING_JETSKI_PANORAMA_PROMPT_VERSION,
  buildRacingPanoramaPrompt,
  processGeneratedRacingPanorama,
} from '../src/assets/racing-scenery';
import {
  RACING_JETSKI_MATERIAL_TILES_VERSION,
  assembleRacingJetskiMaterialAtlas,
  buildRacingMaterialsPrompt,
  normalizeRacingJetskiMaterialTile,
  racingJetskiMaterialTilePrompts,
} from '../src/assets/racing-materials';
import { racingSceneryObjectPrompts } from '../src/assets/racing-scenery-pack';
import { buildKeyArtPrompt, isJetskiSpec, mockGeneratedImage } from '../src/assets/game-art';

const golden = JSON.parse(
  readFileSync(join(__dirname, '../../generation/fixtures/racing-legacy.json'), 'utf8'),
) as RacingSpec;

const JETSKI_REQUEST =
  'Sunwake Rally: jet skiing across a sunlit limestone lagoon, a tropical stilt-house harbor, and emerald mangroves at sunset. Turquoise water, orange buoys, sand and vegetated banks. Combustion watercraft motors, collectible Tide Cells for boost, no pads.';

let jetskiDesign: DesignDoc;
let hoverDesign: DesignDoc;

beforeAll(async () => {
  const prior = process.env.SPARKADE_MOCK_FAST;
  process.env.SPARKADE_MOCK_FAST = '1';
  try {
    const jetskiPrompt = buildDesignPrompt({
      promptText: JETSKI_REQUEST,
      hasPhoto: true,
      describeInStory: false,
      antiCollision: [],
      creationBrief: {
        version: 1,
        archetype: 'racing',
        heroName: 'Rin',
        details: JETSKI_REQUEST,
      },
    });
    jetskiDesign = JSON.parse((await new MockProvider('jetski-test').complete(jetskiPrompt)).text);
    const hoverPrompt = buildDesignPrompt({
      promptText: 'a hover kart grand prix across crystal dunes',
      hasPhoto: false,
      describeInStory: false,
      antiCollision: [],
    });
    hoverDesign = JSON.parse((await new MockProvider('jetski-test').complete(hoverPrompt)).text);
  } finally {
    if (prior === undefined) delete process.env.SPARKADE_MOCK_FAST;
    else process.env.SPARKADE_MOCK_FAST = prior;
  }
}, 60_000);

function jetskiSpec(): RacingSpec {
  const spec = structuredClone(golden);
  spec.identity = structuredClone(jetskiDesign.racingIdentity!);
  const locales = [
    'Sunlit limestone lagoon with turquoise water and sand banks',
    'Tropical stilt-house harbor with orange buoys',
    'Emerald mangroves at sunset with vegetated banks',
  ];
  spec.levels.forEach((level, k) => {
    level.envConcept = locales[k]!;
    level.materials = {
      road: '#2fa8b8',
      ground: '#7fd4c1',
      curb: '#e8d8a0',
      edge: '#ff8c2e',
      pad: '#35e0ff',
    };
  });
  return spec;
}

describe('jetski cup end-to-end slice', () => {
  it('detects jetski intent from the creation request only', () => {
    expect(mockJetskiRequested(JETSKI_REQUEST)).toBe(true);
    expect(mockJetskiRequested('a hover kart grand prix across crystal dunes')).toBe(false);
    expect(mockJetskiRequested('hovercraft racing through a tropical harbor and lagoon')).toBe(false);
    expect(mockJetskiRequested('a water racing cup')).toBe(true);
  });

  it('flows photo/name/description through the mock design into a jetski identity', () => {
    expect(jetskiDesign.archetype).toBe('racing');
    const identity = jetskiDesign.racingIdentity!;
    expect(identity.discipline).toBe('jetski');
    expect(identity.pilotName).toBe('Rin');
    expect(identity.boost.mode).toBe('pickups');
    expect(identity.boost.displayName).toBe('Tide Cells');
    expect(identity.sound.engine.family).toBe('combustion');
    expect(validateDesignSchema(jetskiDesign)).toEqual([]);
  });

  it('keeps hover designs on the legacy discipline-free path', () => {
    expect(hoverDesign.archetype).toBe('racing');
    expect(hoverDesign.racingIdentity!.discipline).toBeUndefined();
    expect(validateDesignSchema(hoverDesign)).toEqual([]);
  });

  it('keeps legacy saved designs without discipline schema-valid', () => {
    const legacy = structuredClone(jetskiDesign);
    delete legacy.racingIdentity!.discipline;
    expect(validateDesignSchema(legacy)).toEqual([]);
  });

  it('requires a seated rider on jetski strips without banning riders', () => {
    const jetski = buildRacingCraftStripPrompt({
      name: 'Rin',
      vehicleConcept: 'teal compact jet-ski hull with a seated rider',
      artDirection: 'sunlit water cup',
      discipline: 'jetski',
    });
    expect(jetski).toMatch(/SAME seated rider/i);
    expect(jetski).toMatch(/rider sits astride/i);
    expect(jetski).toMatch(/handlebars/i);
    expect(jetski).not.toMatch(/no person, pilot, rider/i);
    const hover = buildRacingCraftStripPrompt({
      name: 'Rookie',
      vehicleConcept: 'twin-pod hovercraft',
      artDirection: 'ember cup',
    });
    expect(hover).toMatch(/no person, pilot, rider/i);
    expect(hover).not.toMatch(/seated rider astride/i);
  });

  it('preserves the rider through jetski bank corrections', () => {
    const jetski = buildRacingBankEditPrompt({
      vehicleName: 'Rin',
      pose: 'bankLeft',
      discipline: 'jetski',
    });
    expect(jetski).toMatch(/seated/i);
    expect(jetski).not.toMatch(/no person, pilot, rider/i);
    const hover = buildRacingBankEditPrompt({ vehicleName: 'Rookie', pose: 'bankLeft' });
    expect(hover).toMatch(/no person, pilot, rider/i);
    expect(jetski).toContain('COUNTERCLOCKWISE by 10 degrees');
    expect(buildRacingBankEditPrompt({ vehicleName: 'Rin', pose: 'bankRight', discipline: 'jetski' }))
      .toContain('CLOCKWISE by 10 degrees');
  });

  it('gates distinct hulls and a required rider in the jetski roster review', () => {
    const slots = racingRosterSlots(jetskiSpec());
    const jetski = buildRacingRosterJudgePrompt(slots, [], 'jetski');
    expect(jetski.user).toMatch(/seated rider/i);
    expect(jetski.user).toMatch(/distinct coherent hulls/i);
    expect(jetski.user).not.toMatch(/no people/i);
    const hover = buildRacingRosterJudgePrompt(slots);
    expect(hover.user).toMatch(/no people/i);
  });

  it('preserves the jetski distant-horizon composition', () => {
    expect(RACING_JETSKI_PANORAMA_PROMPT_VERSION).toBe('racing-jetski-panorama-v3');
    const panorama = buildRacingPanoramaPrompt({
      courseName: 'Lagoon',
      artDirection: 'sunlit water cup',
      worldConcept: 'jetski waterscape',
      envConcept: 'sunlit limestone lagoon',
      discipline: 'jetski',
    });
    expect(panorama).toMatch(/lagoon|harbor|mangrove|shoreline|water/i);
    expect(panorama).toMatch(/sky fills the TOP half/i);
    expect(panorama).toMatch(/complete frame will be fitted/i);
    expect(panorama).toMatch(/buoy lane, course marker/i);
    expect(panorama).toMatch(/foreground dock/i);
    expect(buildRacingPackPlan(jetskiSpec()).panoramas.every(entry => !entry.reference)).toBe(true);
    expect(panorama).not.toMatch(/baked/i);
    const hover = buildRacingPanoramaPrompt({
      courseName: 'Lagoon',
      artDirection: 'sunlit water cup',
      worldConcept: 'jetski waterscape',
      envConcept: 'sunlit limestone lagoon',
    });
    expect(hover).toMatch(/anchored at the BOTTOM/i);
  });

  it('preserves both jetski horizon bands while retaining the hover crop', async () => {
    // Synthetic two-band plate: orange sky on top, teal water below.
    // Geometry fixture only — no claim about live art quality.
    const sky = await sharp({
      create: { width: 1792, height: 512, channels: 4, background: '#ff8c2e' },
    })
      .png()
      .toBuffer();
    const water = await sharp({
      create: { width: 1792, height: 512, channels: 4, background: '#0e5a6e' },
    })
      .png()
      .toBuffer();
    const plate = await sharp({
      create: { width: 1792, height: 1024, channels: 4, background: '#000000' },
    })
      .composite([
        { input: sky, left: 0, top: 0 },
        { input: water, left: 0, top: 512 },
      ])
      .png()
      .toBuffer();
    const sample = async (image: Buffer, y = 240): Promise<{ r: number; g: number; b: number }> => {
      const { data } = await sharp(image)
        .extract({ left: 768, top: y, width: 1, height: 1 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { r: data[0]!, g: data[1]!, b: data[2]! };
    };
    const jetski = await processGeneratedRacingPanorama(plate, 'jetski');
    const jetskiMeta = await sharp(jetski).metadata();
    expect(jetskiMeta.width).toBe(RACING_PANORAMA_WIDTH);
    expect(jetskiMeta.height).toBe(RACING_PANORAMA_HEIGHT);
    expect(await sample(jetski, 100)).toMatchObject({ r: 255, g: 140, b: 46 });
    expect(await sample(jetski, 380)).toMatchObject({ r: 14, g: 90, b: 110 });
    const hoverPlate = await processGeneratedRacingPanorama(plate);
    expect(await sample(hoverPlate)).toMatchObject({ r: 14, g: 90, b: 110 });
  });

  it('keeps jetski scenery objects floating and shoreline-bound', () => {
    const materials = buildRacingMaterialsPrompt({
      artDirection: 'sunlit water cup',
      worldConcept: 'jetski waterscape',
      envContext: 'lagoon course',
      materials: { road: '#2fa8b8', ground: '#7fd4c1', curb: '#e8d8a0', edge: '#ff8c2e', pad: '#35e0ff' },
      boostMode: 'pickups',
      discipline: 'jetski',
    });
    expect(materials).toMatch(/open-water|shallows|shore-edge/i);
    expect(materials).toMatch(/never through flat recolors/i);
    expect(materials).toMatch(/no perspective.*asphalt stripes, curbs, guardrails/is);
    const objects = racingSceneryObjectPrompts(jetskiSpec());
    expect(objects).toHaveLength(6);
    expect(objects.join(' ')).toMatch(/floating|buoy/i);
    expect(objects.join(' ')).toMatch(/without vehicles, riders, wakes, spray, roads, asphalt, curbs, guardrails/i);
    expect(objects.join(' ')).toMatch(/float on the water/i);
  });

  it('generates jetski materials as independent tiles, never a grid', () => {
    expect(RACING_JETSKI_MATERIAL_TILES_VERSION).toBe('racing-jetski-material-tiles-v1');
    const prompts = racingJetskiMaterialTilePrompts(jetskiSpec());
    expect(prompts).toHaveLength(4);
    for (const prompt of prompts) {
      expect(prompt).toMatch(/exactly ONE square top-down seamless water texture tile/i);
      expect(prompt).toMatch(/Tile \d of 4/);
      expect(prompt).toMatch(/wraparound-safe tiling/i);
      expect(prompt).not.toMatch(/2-by-2 grid/i);
    }
    expect(prompts.join('\n')).toMatch(/Tide Cells/);
    const plan = buildRacingPackPlan(jetskiSpec());
    expect(plan.materialTiles).toHaveLength(4);
    for (const entry of plan.materialTiles) {
      expect(entry.role).toBe('racingMaterialAtlas');
      expect(entry.promptVersion).toBe(RACING_JETSKI_MATERIAL_TILES_VERSION);
      expect(entry.size).toBe('1024x1024');
    }
    expect(plan.materialTiles.map((entry) => entry.prompt)).toEqual(prompts);
    // Compatibility entry carries the joined tile prompts, not a sheet prompt.
    expect(plan.materials.role).toBe('racingMaterialAtlas');
    expect(plan.materials.promptVersion).toBe(RACING_JETSKI_MATERIAL_TILES_VERSION);
    expect(plan.materials.prompt).toBe(prompts.join('\n'));
    expect(plan.materials.prompt).not.toMatch(/2-by-2 grid/i);
    const hoverPlan = buildRacingPackPlan(structuredClone(golden));
    expect(hoverPlan.materialTiles).toEqual([]);
    expect(hoverPlan.materials.size).toBe('1024x1024');
    expect(hoverPlan.materials.prompt).toMatch(/2-by-2 grid/i);
  });

  it('normalizes and assembles jetski tiles through the same gates as sheets', async () => {
    // Synthetic textured tile: deterministic checkerboard, high variance.
    // Geometry/gate fixture only — no claim about live art quality.
    const cells = 32;
    const cell = 8;
    const raw = Buffer.alloc(cells * cell * cells * cell * 4);
    for (let y = 0; y < cells * cell; y++) {
      for (let x = 0; x < cells * cell; x++) {
        const o = (y * cells * cell + x) * 4;
        const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
        raw[o] = on ? 20 : 200;
        raw[o + 1] = on ? 90 : 180;
        raw[o + 2] = on ? 110 : 170;
        raw[o + 3] = 255;
      }
    }
    const textured = await sharp(raw, {
      raw: { width: cells * cell, height: cells * cell, channels: 4 },
    })
      .png()
      .toBuffer();
    const tile = await normalizeRacingJetskiMaterialTile(textured, 'road');
    const tileMeta = await sharp(tile).metadata();
    expect(tileMeta.width).toBe(RACING_MATERIAL_TILE);
    expect(tileMeta.height).toBe(RACING_MATERIAL_TILE);
    // Flat fills and non-squares fail instead of shipping.
    const flat = await sharp({
      create: { width: 256, height: 256, channels: 4, background: '#2fa8b8' },
    })
      .png()
      .toBuffer();
    await expect(normalizeRacingJetskiMaterialTile(flat, 'road')).rejects.toThrow(/flat fill/);
    const wide = await sharp({
      create: { width: 256, height: 128, channels: 4, background: '#2fa8b8' },
    })
      .png()
      .toBuffer();
    await expect(normalizeRacingJetskiMaterialTile(wide, 'road')).rejects.toThrow(/square/);
    // Assembly lands each tile in its slot at fixed atlas geometry.
    const paint = async (hex: string): Promise<Buffer> =>
      sharp({ create: { width: 128, height: 128, channels: 4, background: hex } })
        .png()
        .toBuffer();
    const atlas = await assembleRacingJetskiMaterialAtlas([
      await paint('#ff0000'),
      await paint('#00ff00'),
      await paint('#0000ff'),
      await paint('#ffffff'),
    ]);
    const atlasMeta = await sharp(atlas).metadata();
    expect(atlasMeta.width).toBe(RACING_MATERIAL_ATLAS_SIZE);
    expect(atlasMeta.height).toBe(RACING_MATERIAL_ATLAS_SIZE);
    const { data } = await sharp(atlas).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number): [number, number, number] => {
      const o = (y * RACING_MATERIAL_ATLAS_SIZE + x) * 4;
      return [data[o]!, data[o + 1]!, data[o + 2]!];
    };
    expect(at(10, 10)).toEqual([255, 0, 0]);
    expect(at(200, 10)).toEqual([0, 255, 0]);
    expect(at(10, 200)).toEqual([0, 0, 255]);
    expect(at(200, 200)).toEqual([255, 255, 255]);
  });

  it('separates jetski prompt versions so hover approvals reuse correctly', () => {
    expect(RACING_CRAFT_STRIP_PROMPT_VERSION).toBe('racing-craft-strip-v4');
    expect(RACING_JETSKI_STRIP_PROMPT_VERSION).not.toBe(RACING_CRAFT_STRIP_PROMPT_VERSION);
    expect(RACING_BANK_PROMPT_VERSION).toBe('racing-craft-bank-v2');
    expect(RACING_JETSKI_BANK_PROMPT_VERSION).not.toBe(RACING_BANK_PROMPT_VERSION);
    expect(RACING_JUDGE_PROMPT_VERSION).toBe('racing-roster-judge-v2');
    expect(RACING_JETSKI_JUDGE_PROMPT_VERSION).not.toBe(RACING_JUDGE_PROMPT_VERSION);
    expect(RACING_JETSKI_PANORAMA_PROMPT_VERSION).not.toBe('racing-jetski-panorama-v1');
    const plan = buildRacingPackPlan(jetskiSpec());
    expect(plan.playerStrip.promptVersion).toBe(RACING_JETSKI_STRIP_PROMPT_VERSION);
    expect(plan.playerStrip.prompt).toMatch(/seated/i);
    expect(plan.panoramas[0]!.promptVersion).toBe(RACING_JETSKI_PANORAMA_PROMPT_VERSION);
    const hoverSpec = structuredClone(golden);
    const hoverPlan = buildRacingPackPlan(hoverSpec);
    expect(hoverPlan.playerStrip.promptVersion).toBe('racing-craft-strip-v4');
    expect(hoverPlan.playerStrip.prompt).toMatch(/no person, pilot, rider/i);
  });

  it('requires the rider in jetski key art while hover forbids bodies on craft', () => {
    const spec = jetskiSpec();
    expect(isJetskiSpec(spec)).toBe(true);
    expect(isJetskiSpec(structuredClone(golden))).toBe(false);
    const jetskiKey = buildKeyArtPrompt(spec, true, undefined, {
      visualConcept: spec.identity!.playerCraftConcept,
    });
    expect(jetskiKey).toMatch(/seated astride/i);
    expect(jetskiKey).toMatch(/photo likeness/i);
    expect(jetskiKey).not.toMatch(/never put the pilot face, head, or body onto the vehicle/i);
    const hoverKey = buildKeyArtPrompt(structuredClone(golden), true, undefined, {
      visualConcept: 'twin-pod hovercraft',
    });
    expect(hoverKey).toMatch(/never put the pilot face, head, or body onto the vehicle/i);
  });

  it('flags discipline changes through the immutable identity guard', () => {
    const spec = jetskiSpec();
    expect(racingIdentityProblems(spec, jetskiDesign)).toEqual([]);
    const switched = structuredClone(spec);
    delete switched.identity!.discipline;
    expect(racingIdentityProblems(switched, jetskiDesign)).toHaveLength(1);
  });

  it('serves deterministic mock assets for the jetski strip prompt', async () => {
    const prompt = buildRacingCraftStripPrompt({
      name: 'Rin',
      vehicleConcept: 'teal compact jet-ski hull with a seated rider',
      artDirection: 'sunlit water cup',
      discipline: 'jetski',
    });
    const image = await mockGeneratedImage(prompt);
    expect(image.length).toBeGreaterThan(0);
  }, 30_000);
});
