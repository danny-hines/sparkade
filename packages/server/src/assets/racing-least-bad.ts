import { RACING_CRAFT_CELL } from '@sparkade/shared';
import sharp from 'sharp';

/**
 * Least-bad racer identity after bounded repairs are spent. The semantic
 * gates stay exactly as strict and still reject; this only decides which
 * already-reviewed candidate ships, so a rejected racer sprite never fails an
 * otherwise complete game. Muse Spark compares every candidate side by side
 * with its own rejection and, for three-pose strips, may publish only the
 * neutral rear so the engine supplies continuous steering lean instead of
 * bad generated banks.
 */

export interface RacingLeastBadCandidate {
  /** Strip-shaped gameplay candidate exactly as the gate reviewed it. */
  png: Buffer;
  /** The gate's rejection guidance for this candidate. */
  rejection: string;
  /** false when the gate classified a bank cell as a non-rear camera. */
  banksUsable?: boolean;
}

export interface RacingLeastBadChoice {
  /** Index into the reviewed candidate list. */
  index: number;
  /** Publish only the chosen neutral-rear cell with engine steering lean. */
  rearOnly: boolean;
  rationale: string;
}

/** meta.racingArt.leastBad entry; `candidate` indexes the reviewed list. */
export interface RacingLeastBadRecord {
  racer: string;
  candidate: number;
  candidates: number;
  rearOnly: boolean;
  rationale: string;
  /** The provider declined the banking edit; the gate-approved rear ships. */
  refused?: true;
}

export const RACING_LEAST_BAD_REAR_REASON =
  'Muse chose the approved rear over rejected banking poses. The neutral sprite uses continuous steering lean.';

const CANDIDATE_IDS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export function racingLeastBadIds(count: number): string[] {
  if (!Number.isInteger(count) || count < 1 || count > CANDIDATE_IDS.length) {
    throw new Error(`Least-bad selection needs 1-${CANDIDATE_IDS.length} candidates, got ${count}`);
  }
  return CANDIDATE_IDS.slice(0, count);
}

/**
 * Labeled candidate rows at 3x nearest-neighbour: the ranking compares small
 * camera and roll details, so it gets a larger board than the roster review.
 */
export async function buildRacingLeastBadBoard(candidates: readonly Buffer[]): Promise<Buffer> {
  const ids = racingLeastBadIds(candidates.length);
  const scale = 3;
  const header = 40;
  const margin = 16;
  const background = { r: 25, g: 31, b: 45, alpha: 1 };
  const arts = await Promise.all(
    candidates.map(async (png) => {
      const { width = RACING_CRAFT_CELL, height = RACING_CRAFT_CELL } = await sharp(png).metadata();
      return sharp(png)
        .resize(width * scale, height * scale, { kernel: sharp.kernel.nearest })
        .png()
        .toBuffer({ resolveWithObject: true });
    }),
  );
  const width = Math.max(...arts.map(({ info }) => info.width)) + margin * 2;
  const rowHeight = Math.max(...arts.map(({ info }) => info.height)) + header + margin;
  const composites = arts.flatMap(({ data }, index) => [
    {
      input: Buffer.from(
        `<svg width="${width}" height="${header}"><rect width="${width}" height="${header}" fill="#0d1320"/><text x="${width / 2}" y="29" text-anchor="middle" font-family="monospace" font-size="26" fill="#ffffff">${ids[index]}</text></svg>`,
      ),
      top: index * rowHeight,
      left: 0,
    },
    { input: data, top: index * rowHeight + header, left: margin },
  ]);
  return sharp({
    create: { width, height: rowHeight * candidates.length, channels: 4, background },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

/** A published rear-only racer is exactly one 64px cell, never a strip. */
export async function isRacingRearOnlySprite(png: Buffer): Promise<boolean> {
  const { width, height } = await sharp(png).metadata();
  return width === RACING_CRAFT_CELL && height === RACING_CRAFT_CELL;
}

/** ArtifactCache key: restores the recorded choice with its approved asset. */
export function racingLeastBadCacheKey(role: string, promptSha256: string): string {
  return `racing-least-bad-v1:${role}:${promptSha256}`;
}

/**
 * `banks` = candidates are neutral/bank-left/bank-right strips (static cups);
 * otherwise each candidate is one neutral rear (foundation cups).
 */
export function buildRacingLeastBadPrompt(options: {
  racerName: string;
  concept: string;
  rejections: readonly string[];
  banks: boolean;
  /** The board carries a top reference panel of the established player. */
  playerReference?: 'photo' | 'artwork';
}): { system: string; user: string } {
  const ids = racingLeastBadIds(options.rejections.length);
  const clause = (text: string) => text.trim().replace(/[\s.]+$/, '');
  return {
    system:
      'You are Muse Spark, the art director choosing which rejected gameplay racer sprite ships. Every candidate already failed review and the repair budget is spent; the game ships with exactly one of them. Return strict JSON.',
    user: [
      `Racer: ${options.racerName}. Concept: ${clause(options.concept)}.`,
      options.banks
        ? `The board shows ${ids.length} candidate strips labeled ${ids.join(', ')}. Each strip has three cells in order: neutral-rear, banking-left, banking-right.`
        : `The board shows ${ids.length} candidate neutral-rear images labeled ${ids.join(', ')}.`,
      options.playerReference
        ? `The TOP PANEL is the established player (${options.playerReference === 'photo' ? 'LEFT source photo for neck-up likeness, RIGHT game character artwork for wardrobe' : 'game character artwork for identity and wardrobe'}); the candidates are in the BOTTOM PANEL. Prefer the candidate that best preserves that rear-visible identity and outfit.`
        : '',
      ...options.rejections.map(
        (rejection, index) =>
          `${ids[index]} was rejected for: ${clause(rejection) || 'unspecified defects'}.`,
      ),
      options.banks
        ? 'Rejection notes can concern any cell and may overstate; judge the pixels yourself.'
        : 'Rejection notes may overstate; judge the pixels yourself.',
      'Choose the candidate that will look best in play at 64 pixels. Prioritize, in order: a true low rear chase camera on the neutral-rear view with the conveyance pointing away, the racer concept and any canonical player identity, a readable silhouette, then clean pixel art.',
      options.banks
        ? 'Set rearOnly true to publish only the chosen neutral-rear cell; the engine then leans it continuously while steering. Prefer rearOnly whenever the chosen bank cells yaw, turn the conveyance sideways, switch to an overhead view, change identity, or otherwise look worse than a leaning rear. Set rearOnly false only when both bank cells are believable opposite rolls of the same subject. When no candidate has believable banks, compare only the neutral-rear cells.'
        : '',
      'Always choose exactly one candidate; never reject them all. rationale is one short sentence.',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

export function buildRacingLeastBadSchema(count: number, banks: boolean): Record<string, unknown> {
  const ids = racingLeastBadIds(count);
  return {
    type: 'object',
    additionalProperties: false,
    required: banks ? ['choice', 'rearOnly', 'rationale'] : ['choice', 'rationale'],
    properties: {
      choice: { type: 'string', enum: ids },
      ...(banks ? { rearOnly: { type: 'boolean' } } : {}),
      rationale: { type: 'string' },
    },
  };
}

/**
 * Bank cells the gate classified as a non-rear camera never ship, whatever
 * the ranking says: the pick keeps only its rear with engine steering lean.
 */
export function enforceRacingLeastBadBanks(
  choice: RacingLeastBadChoice,
  candidates: readonly Pick<RacingLeastBadCandidate, 'banksUsable'>[],
): RacingLeastBadChoice {
  if (choice.rearOnly || candidates[choice.index]?.banksUsable !== false) return choice;
  return {
    ...choice,
    rearOnly: true,
    rationale: `${choice.rationale.replace(/[\s.]+$/, '')}. Its bank cells failed the rear-camera gate, so only its rear ships.`,
  };
}

/**
 * Never throws and never rejects: the gate already failed, so an unusable
 * answer still ships a candidate. The fallback is the latest candidate (it
 * carries the most correction guidance) and, for strips, its rear only — a
 * leaning rear can never show sideways or overhead banks.
 */
export function normalizeRacingLeastBadChoice(
  raw: unknown,
  count: number,
  banks: boolean,
): RacingLeastBadChoice {
  const ids = racingLeastBadIds(count);
  const fallback: RacingLeastBadChoice = {
    index: count - 1,
    rearOnly: banks,
    rationale: 'Unparseable least-bad selection; kept the latest reviewed candidate.',
  };
  if (typeof raw !== 'object' || raw === null) return fallback;
  const { choice, rearOnly, rationale } = raw as {
    choice?: unknown;
    rearOnly?: unknown;
    rationale?: unknown;
  };
  const index = typeof choice === 'string' ? ids.indexOf(choice) : -1;
  if (index < 0) return fallback;
  return {
    index,
    rearOnly: banks && rearOnly !== false,
    rationale:
      typeof rationale === 'string' && rationale.trim()
        ? rationale.trim().slice(0, 300)
        : 'Muse chose the least-bad reviewed candidate.',
  };
}
