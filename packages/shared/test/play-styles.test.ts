import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BICYCLE_TRAVERSAL,
  mechanicalFingerprint,
  platformerStylePreference,
  type PlatformerSpec,
  type RacingSpec,
} from '../src';

function golden(): PlatformerSpec {
  return JSON.parse(
    readFileSync(join(__dirname, '../../generation/golden/golden-platformer.json'), 'utf8'),
  );
}

describe('mechanical diversity', () => {
  it('distinguishes racing handling, surface and boost supply without counting rider reskins', () => {
    const spec: RacingSpec = JSON.parse(
      readFileSync(join(__dirname, '../../generation/golden/golden-racing.json'), 'utf8'),
    );
    spec.identity = {
      pilotName: 'Rin',
      artDirection: 'Pixel art',
      worldConcept: 'Courier town',
      playerCraftConcept: 'Bicycle',
      rivalCrafts: spec.levels[0]!.rivals.map((r) => ({ name: r.name, vehicleConcept: 'Bicycle' })),
      sound: { engine: { family: 'electric' } },
      boost: { mode: 'none', displayName: 'Second Wind', appearanceConcept: 'A brief sprint' },
      traversal: { ...BICYCLE_TRAVERSAL },
    };
    const baseline = mechanicalFingerprint(spec);
    spec.identity.traversal = {
      ...BICYCLE_TRAVERSAL,
      label: 'Invented sport',
      rider: 'standing',
      propulsion: 'magic',
    };
    expect(mechanicalFingerprint(spec)).toEqual(baseline);
    spec.identity.traversal.handling = 'flow';
    expect(mechanicalFingerprint(spec)).not.toEqual(baseline);
    spec.identity.traversal = { ...BICYCLE_TRAVERSAL, surface: 'water' };
    expect(mechanicalFingerprint(spec)).not.toEqual(baseline);
    spec.identity.traversal = { ...BICYCLE_TRAVERSAL };
    spec.identity.boost.mode = 'pickups';
    expect(mechanicalFingerprint(spec)).not.toEqual(baseline);
  });

  it('counts per-course elevation and ramps as mechanics, omitting flat/none defaults', () => {
    const spec: RacingSpec = JSON.parse(
      readFileSync(join(__dirname, '../../generation/golden/golden-racing.json'), 'utf8'),
    );
    for (const level of spec.levels) {
      delete level.elevation;
      delete level.jumps;
      delete level.forks;
    }
    const baseline = mechanicalFingerprint(spec);
    // Legacy omission is byte-identical to explicit flat/none defaults.
    for (const level of spec.levels) {
      level.elevation = 'flat';
      level.jumps = 'none';
    }
    expect(mechanicalFingerprint(spec)).toEqual(baseline);
    // Cosmetic reskins with the same course mechanics stay identical.
    spec.meta.title = 'A reskinned cup with identical hills';
    spec.levels[0]!.name = 'A different coat of paint';
    expect(mechanicalFingerprint(spec)).toEqual(baseline);
    // Real hill and ramp mechanics change the fingerprint in canonical form.
    spec.levels[0]!.elevation = 'rolling';
    spec.levels[2]!.elevation = 'ridge';
    spec.levels[1]!.jumps = 'ramps';
    spec.levels[0]!.forks = 'split';
    const hilly = mechanicalFingerprint(spec);
    expect(hilly).not.toEqual(baseline);
    expect(hilly.encounters).toEqual(
      expect.arrayContaining(['elevation:rolling', 'elevation:ridge', 'jumps:ramps', 'forks:split']),
    );
  });

  it('ignores reskins and distinguishes permanent weapons and vertical traversal', () => {
    const spec = golden();
    const baseline = mechanicalFingerprint(spec);
    spec.meta.title = 'An entirely different brand';
    spec.palette.reverse();
    spec.story.intro = ['A new premise'];
    expect(mechanicalFingerprint(spec)).toEqual(baseline);
    spec.playStyle = 'runAndGun';
    expect(mechanicalFingerprint(spec).weapons).toContain('startingBlaster');
    expect(mechanicalFingerprint(spec).weapons).not.toContain('stomp');
    spec.playStyle = 'towerClimber';
    expect(mechanicalFingerprint(spec)).toMatchObject({
      objective: 'summit',
      topology: 'verticalCourse',
    });
  });

  it('prefers unused packages and discounts older repetitions', () => {
    const spec = golden();
    const acrobat = mechanicalFingerprint(spec);
    const gun = mechanicalFingerprint({ ...spec, playStyle: 'runAndGun' });
    expect(platformerStylePreference([acrobat, gun])).toEqual([
      'towerClimber',
      'meleeAction',
      'armedClimber',
      'runAndGun',
      'acrobat',
    ]);
    expect(platformerStylePreference([gun, acrobat])).toEqual([
      'towerClimber',
      'meleeAction',
      'armedClimber',
      'acrobat',
      'runAndGun',
    ]);
  });
});
