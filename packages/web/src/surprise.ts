import { ARCHETYPE_IDS, type ArchetypeId } from '@sparkade/shared';

const STORAGE_KEY = 'sparkade.surprise-archetype-bag.v1';
const ARCHETYPES = [...ARCHETYPE_IDS];

export interface SurpriseBagState {
  version: 1;
  remaining: ArchetypeId[];
  last: ArchetypeId | null;
}

const isArchetype = (value: unknown): value is ArchetypeId =>
  typeof value === 'string' && ARCHETYPES.includes(value as ArchetypeId);

function normalizeState(value: unknown): SurpriseBagState {
  if (!value || typeof value !== 'object') {
    return { version: 1, remaining: [], last: null };
  }
  const candidate = value as Partial<SurpriseBagState>;
  const remaining = Array.isArray(candidate.remaining)
    ? candidate.remaining.filter(isArchetype).filter((id, index, all) => all.indexOf(id) === index)
    : [];
  return {
    version: 1,
    remaining,
    last: isArchetype(candidate.last) ? candidate.last : null,
  };
}

function shuffledArchetypes(random: () => number, last: ArchetypeId | null): ArchetypeId[] {
  const bag = [...ARCHETYPES];
  for (let index = bag.length - 1; index > 0; index--) {
    const roll = Math.max(0, Math.min(0.9999999999999999, random()));
    const swapIndex = Math.floor(roll * (index + 1));
    [bag[index], bag[swapIndex]] = [bag[swapIndex]!, bag[index]!];
  }

  // A shuffle bag guarantees one of each genre per cycle. This swap also
  // prevents the last genre of one cycle from becoming the first of the next.
  if (bag[0] === last && bag.length > 1) {
    const different = bag.findIndex((id) => id !== last);
    [bag[0], bag[different]] = [bag[different]!, bag[0]!];
  }
  return bag;
}

/** Pure draw used by the UI and tests. Every five draws contain one of each archetype. */
export function drawSurpriseArchetype(
  previous: unknown,
  random: () => number = Math.random,
): { archetype: ArchetypeId; state: SurpriseBagState } {
  const prior = normalizeState(previous);
  const bag = prior.remaining.length > 0
    ? [...prior.remaining]
    : shuffledArchetypes(random, prior.last);
  const archetype = bag.shift()!;
  return {
    archetype,
    state: { version: 1, remaining: bag, last: archetype },
  };
}

let memoryState: SurpriseBagState | null = null;

/** Persist the bag across wizard visits; memory fallback covers blocked storage. */
export function pickSurpriseArchetype(random: () => number = Math.random): ArchetypeId {
  let previous: unknown = memoryState;
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (saved) previous = JSON.parse(saved) as unknown;
  } catch {
    // localStorage can be unavailable in privacy modes; the module state still
    // prevents repeats for the current app session.
  }

  const drawn = drawSurpriseArchetype(previous, random);
  memoryState = drawn.state;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(drawn.state));
  } catch {
    // Session-only fallback already updated above.
  }
  return drawn.archetype;
}
