import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { BICYCLE_TRAVERSAL, SKATEBOARD_TRAVERSAL, type RacingSpec } from '@sparkade/shared';
import { prepareImageReference } from '../src/assets/game-art';
import { buildRacingIdentityReference } from '../src/assets/racing-craft';
import { buildHShooterIdentityReference } from '../src/assets/hshooter-craft';
import { buildRacingPackPlan, racingRosterSlots } from '../src/assets/racing-pack';
import { buildRacingPhotoReviewReference } from '../src/assets/racing-photo-identity';

it.each(['onFoot', 'standing', 'seated', 'none', 'legacy-jetski', 'legacy-hover'] as const)(
  'conditions photo identity only into the visible player (%s)',
  (rider) => {
    const spec: RacingSpec = JSON.parse(
      readFileSync(join(__dirname, '../../generation/golden/golden-racing.json'), 'utf8'),
    );
    spec.identity = {
      pilotName: 'Danny',
      artDirection: 'Warm desert pixel art',
      worldConcept: 'Desert relay',
      playerCraftConcept: 'Linen vest and shorts',
      rivalCrafts: spec.levels[0]!.rivals.map((rival) => ({
        name: rival.name,
        vehicleConcept: 'Coral rival outfit',
      })),
      sound: { engine: { family: 'electric' } },
      boost: { mode: 'pickups', displayName: 'Sparks', appearanceConcept: 'Amber sparks' },
      ...(rider === 'legacy-jetski' ? { discipline: 'jetski' as const } : {}),
      ...(!rider.startsWith('legacy-')
        ? {
            traversal: {
              ...(rider === 'standing' ? SKATEBOARD_TRAVERSAL : BICYCLE_TRAVERSAL),
              rider: rider as 'onFoot' | 'standing' | 'seated' | 'none',
            },
          }
        : {}),
    };
    const withoutPhoto = buildRacingPackPlan(spec);
    const withPhoto = buildRacingPackPlan(spec, true);
    const visible = rider !== 'none' && rider !== 'legacy-hover';
    expect(withPhoto.playerStrip.prompt.includes('PLAYER PHOTO IDENTITY')).toBe(visible);
    expect(withPhoto.playerStrip.promptVersion.endsWith('-photo-v2')).toBe(visible);
    expect(withPhoto.rivalStrips).toEqual(withoutPhoto.rivalStrips);
    expect(withPhoto.panoramas).toEqual(withoutPhoto.panoramas);
    if (!visible) expect(withPhoto).toEqual(withoutPhoto);
  },
);

it('carries the full canonical wardrobe into gameplay and review even when the traversal omits it', () => {
  const spec: RacingSpec = JSON.parse(readFileSync(join(__dirname, '../../generation/golden/golden-racing.json'), 'utf8'));
  spec.meta.heroConcept = 'Coral-pink singlet with white trim, navy shorts, white socks and mint racing shoes plus a gold wristband';
  spec.identity!.traversal = { label: 'Foot sprint', handling: 'flow', surface: 'ground', rider: 'onFoot', propulsion: 'human', motion: 'stride' };
  // Long traversal text used to omit, or crowd out, the actual costume.
  spec.identity!.playerCraftConcept = 'Runner mid-stride, no vehicle. '.repeat(12);
  const prompt = buildRacingPackPlan(spec, true).playerStrip.prompt;
  const review = racingRosterSlots(spec)[0]!.vehicleConcept;
  for (const value of [prompt, review]) {
    expect(value).toContain(spec.meta.heroConcept);
    expect(value).toContain('wardrobe overrides conflicting clothing');
  }
  expect(prompt).toContain('RIGHT PANEL');
  expect(prompt).toContain('Copy their exact garment types');
  expect(buildRacingPackPlan(spec).playerStrip.prompt).toContain('reference image is');
});

it('preserves headwear at the top of a portrait-oriented photo through generation and review boards', async () => {
  // A cap-colored band on the top edge would disappear with the old cover crops.
  const cap = await sharp({ create: { width: 80, height: 24, channels: 3, background: '#ff0000' } })
    .png()
    .toBuffer();
  const photo = await sharp({
    create: { width: 80, height: 160, channels: 3, background: '#0044ff' },
  })
    .composite([{ input: cap, top: 0, left: 0 }])
    .png()
    .toBuffer();
  const target = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#ffe100' },
  })
    .png()
    .toBuffer();
  const normalized = await prepareImageReference(photo);
  const identity = await buildRacingIdentityReference(normalized, target);
  const shooterIdentity = await buildHShooterIdentityReference(normalized, target);
  const review = await buildRacingPhotoReviewReference(normalized, target);
  for (const image of [normalized, identity, shooterIdentity, review]) {
    const { data, info } = await sharp(image)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 1024, height: 1024 });
    const pixel = (20 * info.width + 512) * 3;
    expect([...data.subarray(pixel, pixel + 3)]).toEqual([255, 0, 0]);
  }
});
