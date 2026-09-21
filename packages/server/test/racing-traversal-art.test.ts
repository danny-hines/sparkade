import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BICYCLE_TRAVERSAL,
  SKATEBOARD_TRAVERSAL,
  MAGIC_BOARD_TRAVERSAL,
  type RacingSpec,
  type RacingTraversal,
} from '@sparkade/shared';
import {
  buildRacingPackPlan,
  buildRacingRosterJudgePrompt,
  racingPackDiscipline,
  racingRosterSlots,
} from '../src/assets/racing-pack';
import { buildRacingBankEditPrompt } from '../src/assets/racing-bank';
import { buildKeyArtPrompt, buildStoryArtPrompt, buildStoryArtPolicyFallbackPrompt } from '../src/assets/game-art';
function fixture(traversal: RacingTraversal): RacingSpec {
  const spec: RacingSpec = JSON.parse(
    readFileSync(join(__dirname, '../../generation/golden/golden-racing.json'), 'utf8'),
  );
  spec.identity = {
    pilotName: 'Rin',
    artDirection: 'Crisp original pixel art',
    worldConcept: 'A fantastical courier town',
    playerCraftConcept: 'Distinct teal rider and conveyance',
    rivalCrafts: spec.levels[0]!.rivals.map((r) => ({
      name: r.name,
      vehicleConcept: 'Distinct coral rival and conveyance',
    })),
    sound: { engine: { family: 'electric' } },
    boost: { mode: 'pickups', displayName: 'Sparks', appearanceConcept: 'Floating amber sparks' },
    traversal,
  };
  return spec;
}
describe('composable racing art contracts', () => {
  it.each([BICYCLE_TRAVERSAL, SKATEBOARD_TRAVERSAL, MAGIC_BOARD_TRAVERSAL])(
    'keeps $rider $propulsion subjects consistent across strip, bank edit and full review',
    (traversal) => {
      const spec = fixture(traversal),
        plan = buildRacingPackPlan(spec);
      const bank = buildRacingBankEditPrompt({ vehicleName: 'Rin', pose: 'bankLeft', traversal });
      const judge = buildRacingRosterJudgePrompt(racingRosterSlots(spec), [], 'hover', traversal);
      for (const text of [
        plan.playerStrip.prompt,
        ...plan.rivalStrips.map((e) => e.prompt),
        bank,
        judge.user,
      ]) {
        expect(text.toLowerCase()).toMatch(
          traversal.rider === 'standing' ? /stands|standing/ : /seated/,
        );
        expect(text).not.toContain('no people');
        expect(text).not.toContain('no person, pilot, rider');
        expect(text.toLowerCase()).toContain(traversal.propulsion === 'human' ? 'human' : 'magic');
      }
      expect(judge.user).toContain('fatal');
      expect(judge.user).toContain('opposite ROLL');
    },
  );
  it('routes an invented water activity with no legacy discipline through water artwork', () => {
    const spec = fixture({ ...MAGIC_BOARD_TRAVERSAL, label: 'Completely invented activity' }),
      plan = buildRacingPackPlan(spec);
    expect(spec.identity!.discipline).toBeUndefined();
    expect(racingPackDiscipline(spec)).toBe('jetski');
    expect(plan.materialTiles).toHaveLength(4);
    for (const p of plan.panoramas) {
      expect(p.prompt).toContain('water course');
      expect(p.reference).toBeUndefined();
    }
    const renamed = fixture({ ...spec.identity!.traversal!, label: 'Another unrelated name' });
    expect(buildRacingPackPlan(renamed)).toEqual(plan);
  });
  it('lets presentation artwork show the personalized rider naturally while retaining gameplay rear views', () => {
    const spec = fixture(SKATEBOARD_TRAVERSAL);
    const prompt = buildKeyArtPrompt(spec, true, undefined, {
      visualConcept: spec.identity!.playerCraftConcept,
    });
    expect(prompt).toContain('photo likeness');
    expect(prompt).toContain(spec.identity!.artDirection);
    expect(prompt).not.toContain("wholly separate from the pilot's likeness");
    for (const scene of [buildStoryArtPrompt, buildStoryArtPolicyFallbackPrompt]) {
      const story = scene(spec, 'intro', undefined, { visualConcept: spec.identity!.playerCraftConcept });
      expect(story).toContain(spec.identity!.artDirection);
      expect(story).toContain('headwear');
      expect(story).toContain('including in rear views');
    }
    expect(prompt).toContain('standing');
    expect(prompt).not.toContain('never render the rider seated, detached, or facing the camera');
    expect(buildRacingPackPlan(spec).playerStrip.prompt).toContain('AWAY toward the horizon');
  });
});
