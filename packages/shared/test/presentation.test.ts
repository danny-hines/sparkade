import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRESENTATION_FAMILIES,
  PLATFORMER_PLAY_STYLES,
  gamePresentationFamily,
  mechanicalFingerprint,
  platformerMechanics,
  presentationPreference,
  presentationSfx,
  type GameSpec,
  type PlatformerSpec,
} from '../src';

const golden = JSON.parse(
  readFileSync(join(__dirname, '../../generation/golden/golden-platformer.json'), 'utf8'),
) as PlatformerSpec;

describe('independent presentation families', () => {
  it.each(PLATFORMER_PLAY_STYLES)('preserves the %s kit across all three families', (playStyle) => {
    const spec = { ...golden, playStyle };
    const before = structuredClone(spec);
    for (const presentationFamily of PRESENTATION_FAMILIES) {
      const presented = { ...spec, presentationFamily };
      expect(platformerMechanics(presented)).toEqual(platformerMechanics(spec));
      const { presentationFamily: family, ...mechanics } = mechanicalFingerprint(presented);
      expect(mechanics).toEqual(mechanicalFingerprint(spec));
      expect(family).toBe(presentationFamily);
    }
    expect(spec).toEqual(before);
  });

  it('uses only explicit platformer history and gives recent repetition more weight', () => {
    expect(gamePresentationFamily(golden)).toBeUndefined();
    expect(mechanicalFingerprint(golden).presentationFamily).toBeUndefined();
    expect(
      gamePresentationFamily({
        ...golden,
        archetype: 'shooter',
        presentationFamily: 'tech',
      } as unknown as GameSpec),
    ).toBeUndefined();
    expect(
      presentationPreference([
        { archetype: 'platformer', presentationFamily: 'tech' },
        { archetype: 'platformer', presentationFamily: 'arcade' },
        { archetype: 'shooter', presentationFamily: 'storybook' },
        { archetype: 'platformer' },
      ]),
    ).toEqual(['storybook', 'arcade', 'tech']);
  });

  it('changes only interface sounds and preserves the legacy default', () => {
    expect(presentationSfx()).toEqual({});
    for (const family of PRESENTATION_FAMILIES) {
      expect(Object.keys(presentationSfx(family)).sort()).toEqual(['uiBack', 'uiMove', 'uiSelect']);
    }
    expect(new Set(PRESENTATION_FAMILIES.map((f) => presentationSfx(f).uiSelect!.wave)).size).toBe(
      3,
    );
  });
});
