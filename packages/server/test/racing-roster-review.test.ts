// Roster review target/reference contract: frozen approvals ride the board
// labeled reference-only, the schema and rejected ids cover targets only,
// and fatalIssues contradicting an acceptance fail closed.
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  acceptedReviewIds,
  buildRacingRosterJudgeBoard,
  buildRacingRosterJudgePrompt,
  buildRacingRosterJudgeSchema,
  normalizeRacingRosterJudgeDecision,
  racingRosterSlots,
  reviewPendingRacingStrips,
  type RacingRosterSlotDescriptor,
} from '../src/assets/racing-pack';
import { mockRacingCraftStripSource } from '../src/assets/racing-mock';

const spec = {
  archetype: 'racing',
  palette: ['#111111'],
  identity: {
    pilotName: 'Pippa Vane',
    playerCraftConcept: 'cyan dart',
    artDirection: 'test',
    worldConcept: 'test',
    rivalCrafts: [
      { name: 'R1', vehicleConcept: 'red wedge' },
      { name: 'R2', vehicleConcept: 'green orb' },
    ],
    boost: { mode: 'pads', displayName: 'P', appearanceConcept: 'c' },
  },
} as unknown as Parameters<typeof racingRosterSlots>[0];

const allSlots = racingRosterSlots(spec);
const targets = allSlots.slice(1);
const references = allSlots.slice(0, 1);

function decision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slotReviews: targets.map((s) => ({
      id: s.id,
      concept: 5,
      orientation: 5,
      coherence: 5,
      readability: 5,
      technical: 5,
      cameraViews: ['low-rear', 'low-rear', 'low-rear'],
      fatalIssues: [],
      summary: 'clean',
    })),
    selection: {
      accepted: true,
      rejectedIds: [],
      rationale: 'ok',
      retryGuidance: '',
      ...overrides,
    },
  };
}

describe('roster review target/reference split', () => {
  it('judges targets with references labeled frozen and out of scope', () => {
    const prompt = buildRacingRosterJudgePrompt(targets, references);
    expect(prompt.user).toContain('TARGET');
    expect(prompt.user).toContain('Frozen REFERENCE rows');
    expect(prompt.user).toContain('player');
    expect(prompt.user).not.toContain('player concept');
    // Opposite banking rolls are explicit: lean direction per cell, no yaw/mirror.
    expect(prompt.user).toContain('left side low, right side high');
    expect(prompt.user).toContain('right side low, left side high');
    expect(prompt.user).toContain('never yaw');
    expect(prompt.user).toContain('mirrored');
    // No references → no frozen-row language, same judged shape.
    const solo = buildRacingRosterJudgePrompt(targets);
    expect(solo.user).not.toContain('REFERENCE');
    expect(solo.user).toContain('left side low, right side high');
  });

  it('excludes reference ids from the schema enums and lengths', () => {
    const schema = buildRacingRosterJudgeSchema(targets) as {
      properties: {
        slotReviews: {
          minItems: number;
          maxItems: number;
          items: { properties: { id: { enum: string[] } } };
        };
        selection: { properties: { rejectedIds: { items: { enum: string[] } } } };
      };
    };
    expect(schema.properties.slotReviews.minItems).toBe(targets.length);
    expect(schema.properties.slotReviews.maxItems).toBe(targets.length);
    expect(schema.properties.slotReviews.items.properties.id.enum).toEqual(
      targets.map((s) => s.id),
    );
    expect(schema.properties.slotReviews.items.properties.id.enum).not.toContain('player');
    expect(schema.properties.selection.properties.rejectedIds.items.enum).not.toContain('player');
  });

  it('fails closed when fatalIssues contradict an acceptance', () => {
    const raw = decision();
    (raw.slotReviews as Array<Record<string, unknown>>)[0]!.fatalIssues = ['both banks yaw left'];
    const out = normalizeRacingRosterJudgeDecision(raw, targets);
    expect(out.accepted).toBe(false);
    expect(out.rejectedIds).toContain(targets[0]!.id);
  });

  it.each(
    [['overhead', 'overhead', 'overhead'], ['unclear', 'low-rear', 'low-rear'], undefined, []].map(
      (cameraViews) => ({ cameraViews }),
    ),
  )(
    'rejects a bad or missing neutral camera assessment despite acceptance: %j',
    ({ cameraViews }) => {
      const raw = decision();
      const row = (raw.slotReviews as Array<Record<string, unknown>>)[0]!;
      row.cameraViews = cameraViews;
      row.correction = 'banking';
      const out = normalizeRacingRosterJudgeDecision(raw, targets);
      expect(out.accepted).toBe(false);
      expect(out.rejectedIds).toEqual([targets[0]!.id]);
      expect(out.correctionKinds[targets[0]!.id]).toBe('vehicle');
    },
  );

  it('rejects an overhead bank while preserving a valid neutral for bank repair', () => {
    const raw = decision();
    (raw.slotReviews as Array<Record<string, unknown>>)[0]!.correction = 'banking';
    (raw.slotReviews as Array<Record<string, unknown>>)[0]!.cameraViews = [
      'low-rear',
      'overhead',
      'low-rear',
    ];
    const out = normalizeRacingRosterJudgeDecision(raw, targets);
    expect(out.accepted).toBe(false);
    expect(out.rejectedIds).toEqual([targets[0]!.id]);
    expect(out.correctionKinds[targets[0]!.id]).toBe('banking');
  });

  it('rejects absent target reviews rather than trusting the selection', () => {
    const raw = decision();
    raw.slotReviews = [];
    expect(normalizeRacingRosterJudgeDecision(raw, targets).rejectedIds).toEqual(
      targets.map((s) => s.id),
    );
  });

  it('drops reference ids from rejectedIds and rejects unknown shapes', () => {
    const raw = decision({ accepted: false, rejectedIds: ['player', targets[1]!.id] });
    const out = normalizeRacingRosterJudgeDecision(raw, targets);
    expect(out.rejectedIds).toEqual([targets[1]!.id]);
    expect(normalizeRacingRosterJudgeDecision(null, targets).accepted).toBe(false);
    expect(normalizeRacingRosterJudgeDecision(null, targets).rejectedIds).toEqual(
      targets.map((s) => s.id),
    );
  });

  it('keeps accepted target ids for immediate immutable persist', () => {
    expect(acceptedReviewIds(['rival1', 'rival2'], ['rival2'])).toEqual(['rival1']);
    expect(acceptedReviewIds(['rival1'], [])).toEqual(['rival1']);
  });

  it('checkpoints partial approvals, resumes only rejected candidates, and skips a fully reviewed roster', async () => {
    const approved = new Map<string, Buffer>([['player', Buffer.from('frozen-player')]]);
    const buffers = [approved.get('player')!, Buffer.from('rival-one'), Buffer.from('rival-two')];
    const seen: { targets: string[]; references: string[] }[] = [];
    const run = () =>
      reviewPendingRacingStrips({
        slots: allSlots,
        buffers,
        approvedIds: new Set(approved.keys()),
        review: async (images, slots, references) => {
          seen.push({
            targets: slots.map((s) => s.id),
            references: references.map((r) => r.slot.id),
          });
          expect(images).toEqual(
            slots.map((s) => buffers[allSlots.findIndex((a) => a.id === s.id)]),
          );
          return seen.length === 1
            ? {
                accepted: false,
                rejectedIds: ['rival2'],
                retryGuidance: 'fix rival2 banking',
                correctionKinds: { rival1: 'none', rival2: 'banking' },
                slotGuidance: { rival1: '', rival2: 'roll the banks opposite ways' },
              }
            : {
                accepted: true,
                rejectedIds: [],
                retryGuidance: '',
                correctionKinds: { rival1: 'none', rival2: 'none' },
                slotGuidance: { rival1: '', rival2: '' },
              };
        },
        approve: async (id, png) => {
          approved.set(id, png);
        },
      });
    expect((await run()).accepted).toBe(false);
    expect([...approved.keys()]).toEqual(['player', 'rival1']);
    buffers[2] = Buffer.from('corrected-rival-two');
    expect((await run()).accepted).toBe(true);
    expect((await run()).accepted).toBe(true);
    expect(seen).toEqual([
      { targets: ['rival1', 'rival2'], references: ['player'] },
      { targets: ['rival2'], references: ['player', 'rival1'] },
    ]);
    expect(approved.get('player')).toBe(buffers[0]);
    expect(approved.get('rival1')).toBe(buffers[1]);
    expect(approved.get('rival2')).toBe(buffers[2]);
  });

  it('boards targets with explicitly labeled reference rows', async () => {
    const strip = await mockRacingCraftStripSource();
    const board = await buildRacingRosterJudgeBoard([
      { id: targets[0]!.id, png: strip },
      { id: references[0]!.id, png: strip, referenceOnly: true },
    ]);
    const meta = await sharp(board).metadata();
    expect({ width: meta.width, height: meta.height }).toEqual({ width: 320, height: 256 });
  });

  it('describes the full five-slot roster in pack order', () => {
    expect(allSlots.map((s: RacingRosterSlotDescriptor) => s.id)).toEqual([
      'player',
      'rival1',
      'rival2',
    ]);
  });
});

describe('roster review correction categories', () => {
  it('requires per-slot correction and guidance in the schema', () => {
    const schema = buildRacingRosterJudgeSchema(targets) as {
      properties: {
        slotReviews: {
          items: { required: string[]; properties: { correction: { enum: string[] } } };
        };
      };
    };
    const items = schema.properties.slotReviews.items;
    expect(items.required).toContain('correction');
    expect(items.required).toContain('guidance');
    expect(items.properties.correction.enum).toEqual(['none', 'banking', 'vehicle']);
  });

  it('instructs banking-only-when-neutral-accepted in the prompt', () => {
    const prompt = buildRacingRosterJudgePrompt(targets, references);
    expect(prompt.user).toContain('"banking" ONLY');
    expect(prompt.user).toContain('neutral-rear cell is accepted');
    expect(prompt.user).toContain('"vehicle"');
    expect(prompt.user).toContain('per-row fix in guidance');
  });

  it('keeps explicit banking and falls back to vehicle when unclassified', () => {
    const raw = decision({
      accepted: false,
      rejectedIds: [targets[0]!.id, targets[1]!.id],
      retryGuidance: 'redesign rejected rows to be visually distinct',
    });
    const reviews = raw.slotReviews as Array<Record<string, unknown>>;
    reviews[0]!.correction = 'banking';
    reviews[0]!.guidance = 'roll the banks opposite ways';
    reviews[0]!.fatalIssues = ['both banks yaw left'];
    // rival2 carries no correction field: unclassified rejection.
    const out = normalizeRacingRosterJudgeDecision(raw, targets);
    expect(out.accepted).toBe(false);
    expect(out.correctionKinds).toEqual({
      [targets[0]!.id]: 'banking',
      [targets[1]!.id]: 'vehicle',
    });
    expect(out.slotGuidance).toEqual({
      [targets[0]!.id]: 'roll the banks opposite ways',
      [targets[1]!.id]: '',
    });
  });

  it('marks accepted slots none with empty guidance', () => {
    const out = normalizeRacingRosterJudgeDecision(decision(), targets);
    expect(out.accepted).toBe(true);
    for (const slot of targets) {
      expect(out.correctionKinds[slot.id]).toBe('none');
      expect(out.slotGuidance[slot.id]).toBe('');
    }
  });

  it('rejects an invalid correction value back to vehicle', () => {
    const raw = decision({ accepted: false, rejectedIds: [targets[0]!.id] });
    (raw.slotReviews as Array<Record<string, unknown>>)[0]!.correction = 'repaint';
    const out = normalizeRacingRosterJudgeDecision(raw, targets);
    expect(out.correctionKinds[targets[0]!.id]).toBe('vehicle');
  });

  it('assigns a vehicle correction when a rejection omits rejected ids', () => {
    const out = normalizeRacingRosterJudgeDecision(decision({ accepted: false }), targets);
    expect(out.rejectedIds).toEqual(targets.map((s) => s.id));
    expect(out.correctionKinds).toEqual({ rival1: 'vehicle', rival2: 'vehicle' });
  });
});
