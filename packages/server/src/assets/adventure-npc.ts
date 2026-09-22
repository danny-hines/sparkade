import sharp from 'sharp';
import { ArtifactCache } from '../pipeline/artifact-cache';
import { imagePromptHash } from './manifest';
import {
  bestAdventureObjectCandidateId,
  buildAdventureObjectJudgeBoard,
  buildAdventureObjectJudgePrompt,
  buildAdventureObjectJudgeSchema,
  normalizeAdventureObjectJudgeDecision,
  processAdventureObject,
  type AdventureObjectCandidate,
  type AdventureObjectJudgeDecision,
  type AdventureObjectPromptOptions,
} from './adventure-object';

export const ADVENTURE_NPC_REPAIR_VERSION = 'adventure-npc-repair-v1';

/** Reference the hero's rendering/camera, not their personal identity or outfit. */
export async function buildAdventureNpcReference(keyArt: Buffer, hero: Buffer): Promise<Buffer> {
  return sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#10131f' } })
    .composite([
      {
        input: await sharp(keyArt)
          .resize(960, 540, { fit: 'contain', background: '#10131f' })
          .png()
          .toBuffer(),
        left: 32,
        top: 45,
      },
      {
        input: await sharp(hero)
          .resize(280, 320, { fit: 'contain', kernel: sharp.kernel.nearest })
          .png()
          .toBuffer(),
        left: 372,
        top: 670,
      },
      {
        input: Buffer.from(
          '<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><text x="512" y="30" text-anchor="middle" fill="white" font-family="monospace" font-size="24">TOP: WORLD ART / PIXEL STYLE</text><text x="512" y="635" text-anchor="middle" fill="white" font-family="monospace" font-size="22">BOTTOM: HERO CAMERA / BODY SCALE — NOT NPC IDENTITY</text></svg>',
        ),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
}

export function buildAdventureNpcPrompt(
  options: AdventureObjectPromptOptions,
  guidance = '',
): string {
  return [
    'ADVENTURE NPC FULL-BODY REPAIR: Create exactly ONE isolated friendly adult NPC gameplay sprite.',
    `World: ${options.gameTitle}. ${options.tagline}. NPC concept: ${options.npcConcept}.`,
    'The TOP reference panel supplies the world materials, palette and pixel style. The BOTTOM is the approved gameplay hero: match that overhead three-quarter camera, adult head-to-body proportions, complete-body framing, outline weight and pixel density. Create a distinct inhabitant, not a duplicate of the hero or their face, costume, equipment or pose.',
    'Show the ENTIRE standing person from the top of the hat or hair through torso, waist, hips, two full legs, ankles and both visible feet. Face front/down toward the bottom of the screen, with a slight overhead view of the head and shoulders. Both feet rest on the same baseline. Relaxed arms, empty hands, no weapon. Keep the head small enough for a complete adult body. If wearing a long coat, still show both lower legs and boots below its hem.',
    'This is a world actor, NEVER a portrait, bust, headshot, waist-up crop, floating torso, seated figure, character emerging from the floor, or giant mascot head. Leave generous blank clearance around the complete body, including below BOTH feet.',
    `High-density retro pixel art for a 96x112 transparent gameplay cell; crisp deliberate pixels and flat colors. Color direction: ${options.colors}.`,
    'Exactly one person, no sheet, collage, reference panels, text, labels, scenery, ground, pedestal, baked shadow, held prop or effect. Entire background including gaps between legs and arms must be perfectly flat solid #00ff00; no key green on the person.',
    guidance
      ? `Correct the rejected candidate: ${guidance.replace(/\s+/g, ' ').slice(0, 700)}`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export class AdventureNpcImageError extends Error {}

/** Keep a good sheet NPC free; repaint only the NPC after structural rejection.
 * Provider errors/refusals propagate. Only pixel failures or completed visual
 * rejections consume the two-candidate repair budget. Successful calls survive resumes. */
export async function ensureAdventureNpc(options: {
  candidates: readonly AdventureObjectCandidate[];
  decision: AdventureObjectJudgeDecision;
  keyArt: Buffer;
  hero: Buffer;
  promptOptions: AdventureObjectPromptOptions;
  cache: ArtifactCache;
  attempt: number;
  generate: (id: string, prompt: string, reference: Buffer) => Promise<Buffer>;
  review: (
    prompt: { system: string; user: string },
    schema: Record<string, unknown>,
    image: Buffer,
  ) => Promise<unknown>;
}): Promise<Buffer> {
  const selectedId = bestAdventureObjectCandidateId('npc', options.decision);
  const selected = options.candidates.find(
    (candidate) => candidate.role === 'npc' && candidate.id === selectedId,
  );
  if (selected) return selected.png;

  const reference = await buildAdventureNpcReference(options.keyArt, options.hero);
  let reason =
    options.decision.candidateReviews
      .filter(({ role }) => role === 'npc')
      .map((review) => `${review.id}: ${review.issues.join('; ')} ${review.summary}`)
      .join(' ') || 'No complete NPC was available in the object sheet.';
  for (let pass = 1; pass <= 2; pass++) {
    const id = `npc-repair-${pass}`;
    const prompt = buildAdventureNpcPrompt(options.promptOptions, reason);
    const key = imagePromptHash(
      JSON.stringify([ADVENTURE_NPC_REPAIR_VERSION, options.attempt, id, prompt]),
      reference,
    );
    const raw = await options.cache.getOrCompute(`${key}:raw`, () =>
      options.generate(id, prompt, reference),
    );
    let candidate: AdventureObjectCandidate;
    try {
      candidate = await options.cache.getOrCompute(`${key}:processed`, async () => {
        const processed = await processAdventureObject(raw, 'npc');
        return { id, role: 'npc' as const, png: processed.png, metrics: processed.metrics };
      });
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
      continue;
    }
    const candidates = [candidate];
    const verdict = await options.cache.getOrCompute(`${key}:review`, async () =>
      options.review(
        buildAdventureObjectJudgePrompt(candidates, options.promptOptions),
        buildAdventureObjectJudgeSchema(candidates),
        await buildAdventureObjectJudgeBoard({
          keyArt: options.keyArt,
          hero: options.hero,
          candidates,
        }),
      ),
    );
    const decision = normalizeAdventureObjectJudgeDecision(verdict, candidates);
    if (bestAdventureObjectCandidateId('npc', decision) === id) return candidate.png;
    reason = decision.candidateReviews
      .map((review) => `${review.issues.join('; ')} ${review.summary}`)
      .join(' ');
  }
  throw new AdventureNpcImageError(
    `NPC failed full-body gameplay review after two repairs: ${reason.slice(0, 300)}`,
  );
}
