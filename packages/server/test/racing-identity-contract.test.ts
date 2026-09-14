import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DesignDoc, RacingSpec } from '@sparkade/shared';
import { buildDesignPrompt } from '../src/pipeline/prompts';
import { alignRacingCast, racingIdentityProblems } from '../src/pipeline/racing-identity';
import { validateDesignSchema, validateGameSchema } from '../src/pipeline/validate';
import { MockProvider } from '../src/providers/mock';

const golden = JSON.parse(
  readFileSync(join(__dirname, '../../generation/golden/golden-racing.json'), 'utf8'),
) as RacingSpec;
let racingDesign: DesignDoc;
let otherDesign: DesignDoc;
beforeAll(async () => {
  const prior = process.env.SPARKADE_MOCK_FAST;
  process.env.SPARKADE_MOCK_FAST = '1';
  try {
    for (const archetype of ['racing', 'platformer'] as const) {
      const prompt = buildDesignPrompt({
        promptText: `A ${archetype} game`,
        hasPhoto: false,
        describeInStory: false,
        antiCollision: [],
        creationBrief: { version: 1, archetype, heroName: 'Rin', details: `A ${archetype} game` },
      });
      const response = await new MockProvider('contract-test').complete(prompt);
      const doc = JSON.parse(response.text) as DesignDoc;
      if (archetype === 'racing') racingDesign = doc;
      else otherDesign = doc;
    }
  } finally {
    if (prior === undefined) delete process.env.SPARKADE_MOCK_FAST;
    else process.env.SPARKADE_MOCK_FAST = prior;
  }
});

describe('new racing identity generation contract', () => {
  it('keeps full roster names when a course writer abbreviates them', () => {
    const spec = structuredClone(golden);
    spec.identity!.rivalCrafts[0]!.name = 'Vex Marlowe';
    spec.levels.forEach((level) => {
      level.rivals[0]!.name = 'VEX';
    });
    spec.boss.rivalIndex = 1;
    spec.boss.name = 'VEX';
    const aligned = alignRacingCast(spec) as RacingSpec;
    expect(aligned.identity).toEqual(spec.identity);
    expect(aligned.levels.every((level) => level.rivals[0]!.name === 'Vex Marlowe')).toBe(true);
    expect(aligned.boss.name).toBe('Vex Marlowe');
    expect(aligned.boss.topScale).toBe(spec.boss.topScale);
    expect(spec.levels[0]!.rivals[0]!.name).toBe('VEX');
  });
  it('requires a complete identity in a newly authored racing design', () => {
    expect(validateDesignSchema(racingDesign)).toEqual([]);
    const stripped = structuredClone(racingDesign);
    delete stripped.racingIdentity;
    expect(validateDesignSchema(stripped).some((e) => e.message.includes('racingIdentity'))).toBe(
      true,
    );
  });

  it('does not allow racing identity to leak into another archetype', () => {
    expect(otherDesign.archetype).toBe('platformer');
    expect(validateDesignSchema(otherDesign)).toEqual([]);
    expect(
      validateDesignSchema({ ...otherDesign, racingIdentity: racingDesign.racingIdentity }),
    ).not.toEqual([]);
  });

  it('requires course environments and materials for identity-bearing games', () => {
    expect(validateGameSchema('racing', golden)).toEqual([]);
    for (const field of ['envConcept', 'materials'] as const) {
      const incomplete = structuredClone(golden);
      delete incomplete.levels[1]![field];
      expect(validateGameSchema('racing', incomplete).some((e) => e.message.includes(field))).toBe(
        true,
      );
    }
  });

  it('keeps existing saved racers valid without new presentation fields', () => {
    const legacy = structuredClone(golden);
    delete legacy.identity;
    for (const level of legacy.levels) {
      delete level.envConcept;
      delete level.materials;
    }
    expect(validateGameSchema('racing', legacy)).toEqual([]);
  });

  it('accepts the same committed identity after harmless property reordering', () => {
    const spec = structuredClone(golden);
    const identity = racingDesign.racingIdentity!;
    spec.identity = Object.fromEntries(Object.entries(identity).reverse()) as typeof identity;
    expect(racingIdentityProblems(spec, racingDesign)).toEqual([]);
  });

  it('rejects repair that removes identity or switches the world or boost economy', () => {
    const spec = structuredClone(golden);
    spec.identity = structuredClone(racingDesign.racingIdentity!);
    delete spec.identity;
    expect(racingIdentityProblems(spec, racingDesign)).toHaveLength(1);
    spec.identity = structuredClone(racingDesign.racingIdentity!);
    spec.identity.boost.mode = spec.identity.boost.mode === 'pads' ? 'pickups' : 'pads';
    expect(racingIdentityProblems(spec, racingDesign)).toHaveLength(1);
    spec.identity = structuredClone(racingDesign.racingIdentity!);
    spec.identity.worldConcept = 'An unrelated replacement world';
    expect(racingIdentityProblems(spec, racingDesign)).toHaveLength(1);
  });
});
