import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mechanicalFingerprint, platformerStylePreference, type PlatformerSpec } from '../src';

function golden(): PlatformerSpec {
  return JSON.parse(
    readFileSync(join(__dirname, '../../generation/golden/golden-platformer.json'), 'utf8'),
  );
}

describe('mechanical diversity', () => {
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
