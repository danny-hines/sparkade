// Behavior contract for the longitudinal conveyance-axis invariant:
// a deck or board must run nose-to-tail with travel into the screen
// (rear closest, nose farthest, foreshortened), even under a sideways
// rider stance — and reviews must reject a wrong base orientation rather
// than accepting frames that merely copy it. All wording stays generic
// and enum-driven: no sport or label branches.
import { describe, expect, it } from 'vitest';
import {
  BICYCLE_TRAVERSAL,
  MAGIC_BOARD_TRAVERSAL,
  SKATEBOARD_TRAVERSAL,
  type RacingTraversal,
} from '@sparkade/shared';
import {
  RACING_CRAFT_STRIP_PROMPT_VERSION,
  RACING_JETSKI_STRIP_PROMPT_VERSION,
  RACING_TRAVERSAL_STRIP_PROMPT_VERSION,
  buildRacingCraftStripPrompt,
  processGeneratedRacingCraftStrip,
} from '../src/assets/racing-craft';
import { mockGeneratedImage } from '../src/assets/game-art';
import {
  RACING_BANK_PROMPT_VERSION,
  RACING_JETSKI_BANK_PROMPT_VERSION,
  RACING_TRAVERSAL_BANK_PROMPT_VERSION,
  buildRacingBankEditPrompt,
} from '../src/assets/racing-bank';
import {
  RACING_LOCOMOTION_VERSION,
  buildRacingLocomotionPrompt,
  racingLocomotionJudgePrompt,
} from '../src/assets/racing-locomotion';
import {
  RACING_JETSKI_JUDGE_PROMPT_VERSION,
  RACING_JUDGE_PROMPT_VERSION,
  RACING_TRAVERSAL_JUDGE_PROMPT_VERSION,
  buildRacingRosterJudgePrompt,
} from '../src/assets/racing-pack';
import { racingTraversalCameraLock } from '../src/assets/racing-traversal-art';

const CONCEPT = 'distinctive teal conveyance with its rider';
const STRIDE_TRAVERSAL: RacingTraversal = {
  ...SKATEBOARD_TRAVERSAL,
  rider: 'onFoot',
  motion: 'stride',
};
const PUSH_TRAVERSAL: RacingTraversal = { ...SKATEBOARD_TRAVERSAL, motion: 'push' };
const SLOTS = [
  { id: 'player', name: 'Rin', vehicleConcept: CONCEPT },
  { id: 'rival1', name: 'Kai', vehicleConcept: 'distinctive coral conveyance with its rider' },
];

function strip(traversal: RacingTraversal): string {
  return buildRacingCraftStripPrompt({
    name: 'Rin',
    vehicleConcept: CONCEPT,
    artDirection: 'crisp test cup',
    traversal,
  });
}

describe('racing conveyance-axis contract', () => {
  it('requires the longitudinal axis in traversal strips with no sport or label branches', () => {
    for (const traversal of [BICYCLE_TRAVERSAL, SKATEBOARD_TRAVERSAL, MAGIC_BOARD_TRAVERSAL]) {
      const prompt = strip(traversal);
      expect(prompt).toMatch(/nose-tail axis/);
      expect(prompt).toMatch(/rear closest/);
      expect(prompt).toMatch(/foreshortened/);
      expect(prompt).toMatch(/sideways across the road/);
      expect(prompt).not.toMatch(/skateboard/i);
      expect(prompt).not.toContain(traversal.label);
    }
    // A sideways rider stance never turns the deck sideways.
    expect(strip(SKATEBOARD_TRAVERSAL)).toMatch(
      /perpendicular to the deck without making the deck perpendicular/,
    );
  });

  it('keeps traversal strip, bank and locomotion prompts label-independent', () => {
    const renamed = { ...PUSH_TRAVERSAL, label: 'Invented activity' };
    expect(strip(renamed)).toBe(strip(PUSH_TRAVERSAL));
    expect(
      buildRacingBankEditPrompt({ vehicleName: 'Rin', pose: 'bankLeft', traversal: renamed }),
    ).toBe(
      buildRacingBankEditPrompt({ vehicleName: 'Rin', pose: 'bankLeft', traversal: PUSH_TRAVERSAL }),
    );
    expect(buildRacingLocomotionPrompt(renamed, CONCEPT, 'art')).toBe(
      buildRacingLocomotionPrompt(PUSH_TRAVERSAL, CONCEPT, 'art'),
    );
  });

  it('carries the axis through bank edits and the pack camera lock', () => {
    for (const pose of ['bankLeft', 'bankRight'] as const) {
      const prompt = buildRacingBankEditPrompt({
        vehicleName: 'Rin',
        pose,
        traversal: SKATEBOARD_TRAVERSAL,
      });
      expect(prompt).toMatch(/nose-tail axis/);
      expect(prompt).toMatch(/sideways across the road/);
    }
    expect(racingTraversalCameraLock('standing')).toMatch(/nose-tail/);
    expect(racingTraversalCameraLock('onFoot')).not.toMatch(/deck or board/);
  });

  it('requires the axis in the locomotion prompt only when a conveyance exists', () => {
    const push = buildRacingLocomotionPrompt(PUSH_TRAVERSAL, CONCEPT, 'art');
    expect(push).toMatch(/nose-tail axis/);
    expect(push).toMatch(/perpendicular to the deck/);
    const stride = buildRacingLocomotionPrompt(STRIDE_TRAVERSAL, CONCEPT, 'art');
    expect(stride).toContain('SIX temporal frames');
    expect(stride).not.toMatch(/nose-tail/);
  });

  it('makes the locomotion review reject frames that copy a wrong reference', () => {
    const judge = racingLocomotionJudgePrompt('push');
    expect(judge).toMatch(/sideways/);
    expect(judge).toMatch(/wrong reference/);
    expect(judge).toMatch(/never excuses a sideways deck/);
  });

  it('makes the roster review reject a wrong base as vehicle, never banking', () => {
    const judge = buildRacingRosterJudgePrompt(SLOTS, [], 'hover', SKATEBOARD_TRAVERSAL);
    expect(judge.user).toMatch(/nose-tail axis/);
    expect(judge.user).toMatch(/sideways across the road/);
    expect(judge.user).toMatch(/copying a wrong neutral base/);
    expect(judge.user).toMatch(/never "banking"/);
    expect(judge.user).toMatch(/a sideways deck/);
    expect(judge.user).toContain('fatal');
    expect(judge.user).toContain('opposite ROLL');
  });

  it('versions every camera-sensitive generation and review lineage', () => {
    expect(RACING_TRAVERSAL_STRIP_PROMPT_VERSION).toBe('racing-traversal-strip-v4');
    expect(RACING_TRAVERSAL_BANK_PROMPT_VERSION).toBe('racing-traversal-bank-v4');
    expect(RACING_TRAVERSAL_JUDGE_PROMPT_VERSION).toBe('racing-traversal-judge-v3');
    expect(RACING_LOCOMOTION_VERSION).toBe('racing-locomotion-v5');
    expect(RACING_CRAFT_STRIP_PROMPT_VERSION).toBe('racing-craft-strip-v4');
    expect(RACING_JETSKI_STRIP_PROMPT_VERSION).toBe('racing-jetski-strip-v2');
    expect(RACING_BANK_PROMPT_VERSION).toBe('racing-craft-bank-v2');
    expect(RACING_JETSKI_BANK_PROMPT_VERSION).toBe('racing-jetski-bank-v3');
    expect(RACING_JUDGE_PROMPT_VERSION).toBe('racing-roster-judge-v2');
    expect(RACING_JETSKI_JUDGE_PROMPT_VERSION).toBe('racing-jetski-judge-v2');
    const legacy = [
      buildRacingCraftStripPrompt({ name: 'R', vehicleConcept: CONCEPT, artDirection: 'a' }),
      buildRacingCraftStripPrompt({
        name: 'R',
        vehicleConcept: CONCEPT,
        artDirection: 'a',
        discipline: 'jetski',
      }),
      buildRacingBankEditPrompt({ vehicleName: 'R', pose: 'bankLeft' }),
      buildRacingBankEditPrompt({ vehicleName: 'R', pose: 'bankLeft', discipline: 'jetski' }),
      buildRacingRosterJudgePrompt(SLOTS).user,
      buildRacingRosterJudgePrompt(SLOTS, [], 'jetski').user,
    ];
    for (const prompt of legacy) expect(prompt).not.toMatch(/nose-tail/);
  });

  it('frames the traversal strip as a rear-camera steering strip with per-cell roll', () => {
    for (const traversal of [BICYCLE_TRAVERSAL, SKATEBOARD_TRAVERSAL, MAGIC_BOARD_TRAVERSAL, STRIDE_TRAVERSAL]) {
      const prompt = strip(traversal);
      expect(prompt).toContain('rear-view steering strip');
      expect(prompt).not.toMatch(/turnaround strip/);
      expect(prompt).toMatch(/SAME rear view direction/);
      expect(prompt).toMatch(/screen-left edge low, screen-right edge high/);
      expect(prompt).toMatch(/screen-right edge low, screen-left edge high/);
      expect(prompt).toMatch(/front\/side\/back turnaround sheet/);
      // The concept's motion wording is scoped by the contract, never cut.
      expect(prompt).toMatch(/does NOT add poses/);
      expect(prompt).not.toContain(traversal.label);
    }
  });

  it('freezes one stride phase with rear-only anatomy for on-foot strips', () => {
    const animatedConcept =
      'Rin mid-stride with a six-frame run cycle, opposite arm and leg swing, footfalls and breath';
    const prompt = buildRacingCraftStripPrompt({
      name: 'Rin',
      vehicleConcept: animatedConcept,
      artDirection: 'crisp test cup',
      traversal: STRIDE_TRAVERSAL,
    });
    // User text lands verbatim — the contract below, not sanitizing, owns orientation.
    expect(prompt).toContain(animatedConcept);
    expect(prompt).toMatch(/ONE identical mid-stride phase/);
    expect(prompt).toMatch(/Do NOT advance the stride across cells/);
    expect(prompt).toMatch(/produced separately from the approved strip/);
    expect(prompt).toMatch(/back of the head/);
    expect(prompt).toMatch(/heels/);
    expect(prompt).toMatch(/No face, eyes, chest/);
    expect(prompt).toContain('Preserve rear-visible identity, including headwear and hair');
    expect(prompt).not.toContain('separate portrait art');
  });

  it('keeps on-foot steering sentences out of conveyance strips', () => {
    for (const traversal of [BICYCLE_TRAVERSAL, SKATEBOARD_TRAVERSAL, MAGIC_BOARD_TRAVERSAL]) {
      const prompt = strip(traversal);
      expect(prompt).not.toMatch(/ONE identical mid-stride phase/);
      expect(prompt).not.toMatch(/separate portrait art/);
      // Generic steering contract still applies to every traversal.
      expect(prompt).toContain('rear-view steering strip');
      expect(prompt).toMatch(/does NOT add poses/);
    }
  });

  it('still routes traversal steering strips to strip fixtures in mock', async () => {
    for (const traversal of [SKATEBOARD_TRAVERSAL, STRIDE_TRAVERSAL]) {
      const processed = await processGeneratedRacingCraftStrip(
        await mockGeneratedImage(strip(traversal)),
      );
      expect(processed.png.length).toBeGreaterThan(0);
    }
  });
});
