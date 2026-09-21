// Single-rear foundation for animated racing cups: one approved
// neutral-rear identity per racer, engine-owned lean, bank-free gate.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SKATEBOARD_TRAVERSAL, type RacingSpec } from '@sparkade/shared';
import { mockRacingCraftRearSource } from '../src/assets/racing-mock';
import {
  RACING_FOUNDATION_IMAGE_CALLS,
  RACING_FOUNDATION_PROMPT_VERSION,
  assembleRacingFoundationStrip,
  buildRacingFoundationJudgePrompt,
  buildRacingFoundationPrompt,
  normalizeRacingFoundationDecision,
  processGeneratedRacingFoundation,
} from '../src/assets/racing-foundation';
import { buildRacingPackPlan } from '../src/assets/racing-pack';

const ONFOOT = { ...SKATEBOARD_TRAVERSAL, rider: 'onFoot', motion: 'stride' } as typeof SKATEBOARD_TRAVERSAL;

describe('racing foundation prompt', () => {
  it('requests one rear view with no strip, bank, or sequence language', () => {
    const prompt = buildRacingFoundationPrompt({
      name: 'Rin',
      concept: 'Rin mid-stride with a six-frame run cycle, opposite arm and leg swing',
      artDirection: 'crisp test cup',
      traversal: ONFOOT,
    });
    expect(prompt).toContain('RACING FOUNDATION:');
    expect(prompt).toContain('exactly ONE isolated rear-view runner');
    expect(prompt).toContain('One subject only.');
    expect(prompt).toMatch(/NOT a strip, turnaround sheet/);
    expect(prompt).toMatch(/No banks, lean variants, or second poses/);
    expect(prompt).not.toMatch(/turnaround strip/);
    expect(prompt).not.toMatch(/THREE (poses|rear-camera views)/);
    expect(prompt).not.toMatch(/banking LEFT/);
    expect(prompt).not.toMatch(/Banking poses may show/);
    // User concept lands verbatim; the contract scopes it, never cuts it.
    expect(prompt).toContain('six-frame run cycle, opposite arm and leg swing');
    expect(prompt).toMatch(/does NOT add poses, frames, or subjects/);
  });

  it('keeps rear-only anatomy and portrait-path likeness for on-foot', () => {
    const prompt = buildRacingFoundationPrompt({
      name: 'Rin',
      concept: 'runner',
      traversal: ONFOOT,
    });
    expect(prompt).toMatch(/back of the head/);
    expect(prompt).toMatch(/heels/);
    expect(prompt).toMatch(/No face, eyes, chest/);
    expect(prompt).toMatch(/separate portrait art/);
    // onFoot has no conveyance to orient; rider-bearing cups keep the axis.
    expect(prompt).not.toMatch(/nose-tail axis/);
    expect(
      buildRacingFoundationPrompt({ name: 'Kai', concept: 'c', traversal: SKATEBOARD_TRAVERSAL }),
    ).toMatch(/nose-tail axis/);
  });

  it('stays label-independent and pins the motion-only lineage', () => {
    const renamed = { ...ONFOOT, label: 'Invented activity' };
    expect(
      buildRacingFoundationPrompt({ name: 'R', concept: 'c', traversal: renamed }),
    ).toBe(buildRacingFoundationPrompt({ name: 'R', concept: 'c', traversal: ONFOOT }));
    expect(RACING_FOUNDATION_PROMPT_VERSION).toBe('racing-foundation-v2');
    expect(RACING_FOUNDATION_IMAGE_CALLS).toBe(1);
  });

  it('owns plan strip entries only for authored non-static motion', () => {
    const golden = JSON.parse(
      readFileSync(join(__dirname, '../../generation/golden/golden-racing.json'), 'utf8'),
    ) as RacingSpec;
    const motionSpec = structuredClone(golden);
    motionSpec.identity!.traversal = { ...ONFOOT, label: 'Test Stride' };
    const motionPlan = buildRacingPackPlan(motionSpec);
    for (const entry of [motionPlan.playerStrip, ...motionPlan.rivalStrips]) {
      expect(entry.promptVersion).toBe('racing-foundation-v2');
      expect(entry.prompt).toContain('RACING FOUNDATION:');
      expect(entry.size).toBe('1024x1024');
    }
    const staticSpec = structuredClone(golden);
    staticSpec.identity!.traversal = { ...ONFOOT, motion: 'static', label: 'Test Static' };
    const staticPlan = buildRacingPackPlan(staticSpec);
    for (const entry of [staticPlan.playerStrip, ...staticPlan.rivalStrips]) {
      expect(entry.promptVersion).not.toBe('racing-foundation-v2');
      expect(entry.prompt).not.toContain('RACING FOUNDATION:');
    }
  });
});

describe('racing foundation processing', () => {
  it('normalizes one rear into a 64px cell plus an HR reference', async () => {
    const { png, reference } = await processGeneratedRacingFoundation(
      await mockRacingCraftRearSource(),
    );
    const cell = await sharp(png).metadata();
    expect({ width: cell.width, height: cell.height }).toEqual({ width: 64, height: 64 });
    const ref = await sharp(reference).metadata();
    expect(ref.width).toBeGreaterThan(64);
    expect(ref.height).toBeGreaterThan(64);
  });

  it('assembles a 192x64 strip repeating only the neutral cell', async () => {
    const { png } = await processGeneratedRacingFoundation(await mockRacingCraftRearSource());
    const strip = await assembleRacingFoundationStrip(png);
    const meta = await sharp(strip).metadata();
    expect({ width: meta.width, height: meta.height }).toEqual({ width: 192, height: 64 });
    const cells = await Promise.all(
      [0, 1, 2].map((i) =>
        sharp(strip).extract({ left: i * 64, top: 0, width: 64, height: 64 }).raw().toBuffer(),
      ),
    );
    // Placeholders repeat the approved rear: no off-axis bank content.
    expect(cells[1]).toEqual(cells[0]);
    expect(cells[2]).toEqual(cells[0]);
  });
});

const SLOTS = [
  { id: 'player', name: 'Rin', concept: 'rear-view runner' },
  { id: 'rival1', name: 'Kai', concept: 'rear-view conveyance with rider' },
];

describe('racing foundation gate', () => {
  it('judges rear truth with no bank assessment', () => {
    const judge = buildRacingFoundationJudgePrompt(SLOTS, [], ONFOOT);
    expect(judge.user).toMatch(/true rear camera/);
    expect(judge.user).toMatch(/never assessed/);
    expect(judge.user).toMatch(/no lean is correct/);
    expect(judge.user).toMatch(/do not demand bank angles/);
    expect(judge.user).not.toMatch(/opposite ROLL/);
  });

  it('accepts a clean unanimous verdict', () => {
    const decision = normalizeRacingFoundationDecision(
      {
        slotReviews: SLOTS.map((s) => ({ id: s.id, cameraViews: ['low-rear'], fatalIssues: [], summary: 'ok', guidance: '' })),
        selection: { accepted: true, rejectedIds: [], rationale: 'ok', retryGuidance: '' },
      },
      SLOTS,
    );
    expect(decision).toMatchObject({ accepted: true, rejectedIds: [] });
  });

  it.each(['overhead', 'front', 'side', 'unclear', undefined])(
    'blocks foundation acceptance when camera evidence is %s', (view) => {
      const result = normalizeRacingFoundationDecision({
        slotReviews: SLOTS.map(s => ({
          id: s.id, cameraViews: s.id === 'player' ? (view ? [view] : undefined) : ['low-rear'],
          fatalIssues: [], summary: 'same subject', guidance: '',
        })),
        selection: { accepted: true, rejectedIds: [], retryGuidance: '' },
      }, SLOTS);
      expect(result.accepted).toBe(false);
      expect(result.rejectedIds).toEqual(['player']);
      expect(result.slotGuidance.player).toContain('low rear chase camera');
    },
  );

  it('fails closed: fatal issues contradict acceptance, unknown shapes reject all', () => {
    const contradict = normalizeRacingFoundationDecision(
      {
        slotReviews: [
          { id: 'player', cameraViews: ['low-rear'], fatalIssues: ['face-on view'], summary: 'bad', guidance: 'turn around' },
          { id: 'rival1', cameraViews: ['low-rear'], fatalIssues: [], summary: 'ok', guidance: '' },
        ],
        selection: { accepted: true, rejectedIds: [], rationale: 'bad', retryGuidance: '' },
      },
      SLOTS,
    );
    expect(contradict.accepted).toBe(false);
    expect(contradict.rejectedIds).toContain('player');
    expect(contradict.slotGuidance['player']).toBe('turn around');
    const garbage = normalizeRacingFoundationDecision({ nope: 1 }, SLOTS);
    expect(garbage).toMatchObject({ accepted: false, rejectedIds: ['player', 'rival1'] });
  });

  it('preserves clean targets when one identity is rejected', () => {
    const decision = normalizeRacingFoundationDecision({
      slotReviews: [
        { id: 'player', cameraViews: ['low-rear'], fatalIssues: [], guidance: '' },
        { id: 'rival1', cameraViews: ['low-rear'], fatalIssues: ['side view'], guidance: 'Rear camera required' },
      ],
      selection: { accepted: false, rejectedIds: ['rival1'], retryGuidance: 'Rear camera required' },
    }, SLOTS);
    expect(decision).toMatchObject({ accepted: false, rejectedIds: ['rival1'] });
  });

  it.each([undefined, null, ['side view', 42]])('rejects malformed fatal issues: %j', (fatalIssues) => {
    const decision = normalizeRacingFoundationDecision({
      slotReviews: SLOTS.map((slot) => ({ id: slot.id, fatalIssues, guidance: '' })),
      selection: { accepted: true, rejectedIds: [], retryGuidance: '' },
    }, SLOTS);
    expect(decision).toMatchObject({ accepted: false, rejectedIds: ['player', 'rival1'] });
  });

  it('rejects an unknown selection target even when acceptance is claimed', () => {
    expect(normalizeRacingFoundationDecision({
      slotReviews: SLOTS.map((slot) => ({ id: slot.id, cameraViews: ['low-rear'], fatalIssues: [], guidance: '' })),
      selection: { accepted: true, rejectedIds: ['unknown'], retryGuidance: '' },
    }, SLOTS)).toMatchObject({ accepted: false, rejectedIds: ['player', 'rival1'] });
  });
});
