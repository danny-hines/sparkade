// Vision-based likeness (opt-in via config.likeness.smartFeatures). Instead of
// quantizing the face to the game's arbitrary 16 colors — which turns a face
// gray when the palette has no skin tone, and is at the mercy of webcam
// lighting — we read the photo with the model, get the person's true (lighting-
// normalized) skin/hair colours, and build a portrait palette from THOSE. The
// real downscaled face still supplies the structure; only the colours change.
// The photo is sent to the provider only when the opt-in is on.
import type { BuiltPrompt } from '../pipeline/prompts';

export const FACE_ANALYSIS_PROMPT_VERSION = 'face-topology-v6';

export type FaceShape = 'round' | 'oval' | 'square' | 'long' | 'heart';
export type ChinShape = 'round' | 'pointed' | 'square' | 'wide';
export type Size3 = 'small' | 'medium' | 'large';
export type EyeSpacing = 'close' | 'average' | 'wide';
export type EyeShape = 'round' | 'almond' | 'narrow';
export type BrowThickness = 'thin' | 'medium' | 'thick';
export type BrowShape = 'straight' | 'arched' | 'angled';
export type EarProminence = 'hidden' | 'small' | 'average' | 'prominent';
export type FacialHair = 'none' | 'stubble' | 'mustache' | 'goatee' | 'beard';
export type HeadwearType =
  | 'none'
  | 'cap'
  | 'beanie'
  | 'brim'
  | 'flatCap'
  | 'beret'
  | 'topHat'
  | 'wideBrim';
export type HairStyle =
  | 'bald'
  | 'hidden'
  | 'buzz'
  | 'short'
  | 'parted'
  | 'curly'
  | 'afro'
  | 'horseshoe'
  | 'long'
  | 'ponytail';
export type HairLength = 'none' | 'buzz' | 'short' | 'jaw' | 'long' | 'tied';
export type HairTexture = 'none' | 'straight' | 'wavy' | 'curly' | 'coily';
export type HairPart = 'none' | 'left' | 'center' | 'right';
export type HairRegion = 'none' | 'stubble' | 'solid';

export interface FaceTopology {
  /** Visible scalp-hair occupancy only; never infer hair hidden by a hat. */
  scalpHair: {
    crown: boolean;
    temples: boolean;
    belowEars: boolean;
  };
  headwear: {
    crown: 'none' | 'panelled' | 'knit' | 'structured';
    projection: 'none' | 'front-bill' | 'full-brim';
  };
  glasses: {
    frame: 'none' | 'rimless' | 'thin' | 'thick';
    lensShape: 'none' | 'round' | 'oval' | 'rectangular';
    lensTint: 'none' | 'clear' | 'dark';
  };
  facialHair: {
    upperLip: HairRegion;
    chin: HairRegion;
    jaw: HairRegion;
    cheeks: HairRegion;
  };
}

export interface FaceFeatures {
  // Colouring — true tones, normalized for the photo's lighting.
  skinTone: string; // hex
  hairColor: string; // hex when visible, or "none" when bald/fully occluded
  /** High-signal silhouette category; much more visible at 16px than nose/brow detail. */
  hairStyle?: HairStyle;
  /** Orthogonal hair traits used by topology-aware renderers. */
  hairLength?: HairLength;
  hairTexture?: HairTexture;
  hairPart?: HairPart;
  facialHairColor: string; // hex, or "none" (clean-shaven)
  headwearColor: string; // hex, or "none"
  // Accessories.
  glasses: boolean;
  glassesColor?: string; // hex frame colour, or "none"
  headwear: boolean;
  headwearType?: HeadwearType; // cap = flat/curved-brim ballcap · beanie = knit · brim = wide/bucket
  facialHair: FacialHair;
  // Proportions estimated from the photo, so the drawn avatar varies in
  // STRUCTURE (not just colour). Optional — the renderer defaults each.
  faceShape?: FaceShape;
  chin?: ChinShape;
  noseSize?: Size3;
  eyeSpacing?: EyeSpacing;
  eyeShape?: EyeShape;
  eyebrows?: BrowThickness;
  eyebrowShape?: BrowShape;
  ears?: EarProminence;
  /** Canonical visible-region description. Optional on input for legacy payloads. */
  topology?: FaceTopology;
}

/** normalizeFaceFeatures always fills fields that remain optional on legacy input. */
export type NormalizedFaceFeatures = FaceFeatures & {
  hairStyle: HairStyle;
  hairLength: HairLength;
  hairTexture: HairTexture;
  hairPart: HairPart;
  glassesColor: string;
  headwearType: HeadwearType;
  faceShape: FaceShape;
  chin: ChinShape;
  noseSize: Size3;
  eyeSpacing: EyeSpacing;
  eyeShape: EyeShape;
  eyebrows: BrowThickness;
  eyebrowShape: BrowShape;
  ears: EarProminence;
  topology: FaceTopology;
};

export const FACE_SCHEMA: Record<string, unknown> = {
  title: 'Sparkade face likeness analysis',
  type: 'object',
  additionalProperties: false,
  required: [
    'skinTone', 'hairColor', 'hairStyle', 'hairLength', 'hairTexture', 'hairPart', 'facialHairColor', 'headwearColor', 'glasses', 'glassesColor', 'headwear', 'headwearType', 'facialHair', 'topology',
    'faceShape', 'chin', 'noseSize', 'eyeSpacing', 'eyeShape', 'eyebrows', 'eyebrowShape', 'ears',
  ],
  properties: {
    skinTone: { type: 'string', description: "hex of the person's true base skin tone in neutral daylight" },
    hairColor: { type: 'string', description: 'hex of visible hair colour, or "none" if bald, shaved, or fully occluded' },
    hairStyle: {
      enum: ['bald', 'hidden', 'buzz', 'short', 'parted', 'curly', 'afro', 'horseshoe', 'long', 'ponytail'],
      description: 'dominant visible hair silhouette; hidden means no scalp hair pixels are observable because of headwear/cropping and makes no claim about baldness; use bald only when a clearly visible hairless/shaved scalp confirms it',
    },
    hairLength: {
      enum: ['none', 'buzz', 'short', 'jaw', 'long', 'tied'],
      description: 'visible hair length; none means no hair is visible and does not by itself distinguish bald from fully occluded',
    },
    hairTexture: {
      enum: ['none', 'straight', 'wavy', 'curly', 'coily'],
      description: 'dominant visible strand/outline texture; none when no hair is visible',
    },
    hairPart: {
      enum: ['none', 'left', 'center', 'right'],
      description: "visible part from the person's perspective; none when absent, hidden, or uncertain",
    },
    facialHairColor: { type: 'string', description: 'hex of facial-hair colour, or "none" if clean-shaven' },
    headwearColor: { type: 'string', description: 'hex of the headwear, or "none"' },
    glasses: { type: 'boolean' },
    glassesColor: { type: 'string', description: 'hex of the visible glasses frame, or "none" when not wearing glasses' },
    headwear: { type: 'boolean', description: 'true if wearing a hat / cap / head covering' },
    headwearType: {
      enum: ['none', 'cap', 'beanie', 'brim', 'flatCap', 'beret', 'topHat', 'wideBrim'],
      description: 'cap = baseball/snapback; beanie = knit cap; brim is the legacy bucket/fedora category; flatCap, beret, topHat, and wideBrim are more precise shapes; none if bare-headed',
    },
    facialHair: { enum: ['none', 'stubble', 'mustache', 'goatee', 'beard'] },
    faceShape: { enum: ['round', 'oval', 'square', 'long', 'heart'], description: 'overall face outline & height:width ratio' },
    chin: { enum: ['round', 'pointed', 'square', 'wide'] },
    noseSize: { enum: ['small', 'medium', 'large'], description: 'nose size relative to the face' },
    eyeSpacing: { enum: ['close', 'average', 'wide'], description: 'gap between the eyes' },
    eyeShape: { enum: ['round', 'almond', 'narrow'] },
    eyebrows: { enum: ['thin', 'medium', 'thick'], description: 'eyebrow thickness' },
    eyebrowShape: { enum: ['straight', 'arched', 'angled'] },
    ears: { enum: ['hidden', 'small', 'average', 'prominent'], description: 'ear prominence, or "hidden" if covered/not visible' },
    topology: {
      type: 'object',
      additionalProperties: false,
      required: ['scalpHair', 'headwear', 'glasses', 'facialHair'],
      properties: {
        scalpHair: {
          type: 'object',
          additionalProperties: false,
          required: ['crown', 'temples', 'belowEars'],
          properties: {
            crown: { type: 'boolean', description: 'visible hair occupies the crown' },
            temples: { type: 'boolean', description: 'visible hair occupies either temple/sideburn area' },
            belowEars: { type: 'boolean', description: 'visible hair extends below the ears' },
          },
        },
        headwear: {
          type: 'object',
          additionalProperties: false,
          required: ['crown', 'projection'],
          properties: {
            crown: { enum: ['none', 'panelled', 'knit', 'structured'] },
            projection: { enum: ['none', 'front-bill', 'full-brim'] },
          },
        },
        glasses: {
          type: 'object',
          additionalProperties: false,
          required: ['frame', 'lensShape', 'lensTint'],
          properties: {
            frame: { enum: ['none', 'rimless', 'thin', 'thick'] },
            lensShape: { enum: ['none', 'round', 'oval', 'rectangular'] },
            lensTint: { enum: ['none', 'clear', 'dark'] },
          },
        },
        facialHair: {
          type: 'object',
          additionalProperties: false,
          required: ['upperLip', 'chin', 'jaw', 'cheeks'],
          properties: {
            upperLip: { enum: ['none', 'stubble', 'solid'] },
            chin: { enum: ['none', 'stubble', 'solid'] },
            jaw: { enum: ['none', 'stubble', 'solid'] },
            cheeks: { enum: ['none', 'stubble', 'solid'] },
          },
        },
      },
    },
  },
};

export function buildFaceAnalysisPrompt(): BuiltPrompt {
  const system = [
    "You are a character artist. Study the attached photo and describe the person's face as a set of PROPORTIONS and traits, so we can DRAW a faithful pixel-art avatar of them (we do not trace the photo — we redraw from your description). Judge every shape by its proportion relative to the head.",
    '',
    "Colour — report the person's ACTUAL tones, normalized for the photo's lighting (ignore colour casts, flash, and harsh shadows; infer the true colours as in neutral daylight):",
    '- skinTone: hex of the true base skin tone.',
    '- hairColor: hex when hair is visible, otherwise "none".',
    '- hairStyle: bald | hidden | buzz | short | parted | curly | afro | horseshoe | long | ponytail. Choose the dominant OBSERVABLE SILHOUETTE, not a subtle salon label. Use "hidden" whenever a hat, crop, or occlusion leaves no scalp hair pixels visible; this does NOT mean bald. Use "bald" only when exposed scalp clearly confirms bald/shaved hair. Never invent hair beneath headwear. "buzz" is close-cropped; "short" is an even cap; "parted" has a visible side/centre part or asymmetric fringe; "curly" has a visibly textured/bumpy outline; "afro" is a rounded, outward-volume coily silhouette; "horseshoe" is an exposed crown with visible hair around the sides/back; "long" falls beside the jaw; "ponytail" has tied-back length. Hair silhouette is the most important identity cue in a tiny sprite.',
    '- hairLength: none | buzz | short | jaw | long | tied. Length and texture are independent: long curly hair is hairLength "long" AND hairTexture "curly", never collapse one into the other. Use "none" only when no hair pixels are visible.',
    '- hairTexture: none | straight | wavy | curly | coily. Describe the visible outline/texture independently of length.',
    '- hairPart: none | left | center | right, from the person\'s perspective. Use none when hidden or uncertain; do not guess.',
    '- facialHairColor: hex, or "none" if clean-shaven.',
    '- headwearColor: hex, or "none".',
    '- glassesColor: hex of the visible frame, or "none" when glasses is false.',
    '',
    'Accessories:',
    '- glasses / headwear: booleans.',
    '- headwearType: none | cap (baseball/snapback) | beanie (knit) | brim (legacy bucket/fedora) | flatCap | beret | topHat | wideBrim. Set "none" when headwear is false.',
    '- facialHair: none | stubble | mustache | goatee | beard. Be CONSERVATIVE — only report hair that is clearly, unambiguously present. A clean-shaven face, or mere jaw shadow / faint razor shadow, is "none". Use "stubble" only for a visible short all-over shadow; never upgrade stubble to "beard". Most faces are "none".',
    '',
    'Proportions (estimate from the photo):',
    '- faceShape: round | oval | square | long | heart — the overall outline and height:width.',
    '- chin: round | pointed | square | wide.',
    '- noseSize: small | medium | large (relative to the face).',
    '- eyeSpacing: close | average | wide.',
    '- eyeShape: round | almond | narrow.',
    '- eyebrows: thin | medium | thick.',
    '- eyebrowShape: straight | arched | angled.',
    '- ears: hidden | small | average | prominent.',
    '',
    'Visible topology (report pixels that are actually observable; never infer through a hat, hair, glare, or crop):',
    '- topology.scalpHair: crown, temples, belowEars booleans. A cap can make crown false while long visible hair makes belowEars true.',
    '- topology.headwear.crown: none | panelled | knit | structured. topology.headwear.projection: none | front-bill | full-brim. Baseball caps are panelled + front-bill; beanies are knit + none; flat caps are structured + front-bill; berets are structured + none; top hats and wide-brim hats are structured + full-brim.',
    '- topology.glasses.frame: none | rimless | thin | thick; lensShape: none | round | oval | rectangular; lensTint: none | clear | dark. When glasses is false, all three are none.',
    '- topology.facialHair.upperLip / chin / jaw / cheeks: none | stubble | solid. Treat each region independently. Density describes VISIBLE COVERAGE, not hair length: a continuous, clearly bounded moustache band is upperLip "solid" even when the hairs are short and the coarse facialHair label is "stubble". Use upperLip "stubble" only for a sparse or soft upper-lip shadow with skin visibly breaking it up. For chin/jaw/cheeks, use "solid" only for a continuous beard mass with little skin visible through it; use "stubble" whenever skin remains the dominant visible surface, even if the short hairs are dense or gray. Stubble often includes upperLip as well as chin/jaw; never silently omit the moustache region. A common mixed case is upperLip "solid", chin/jaw "stubble", cheeks "none". When facialHair is none, every region is none.',
    '',
    'Be accurate and respectful about skin tone across all ethnicities — never lighten or darken. Do NOT infer age, gender, health, identity, or any other sensitive attribute; describe only the visible geometry and colours. Output only the structured fields.',
  ].join('\n');
  return {
    system,
    user: 'Analyze the attached face photo and return the fields.',
    jsonSchema: FACE_SCHEMA,
    maxTokens: 2000,
  };
}

const HAIR_STYLES = ['bald', 'hidden', 'buzz', 'short', 'parted', 'curly', 'afro', 'horseshoe', 'long', 'ponytail'] as const;
const HAIR_LENGTHS = ['none', 'buzz', 'short', 'jaw', 'long', 'tied'] as const;
const HAIR_TEXTURES = ['none', 'straight', 'wavy', 'curly', 'coily'] as const;
const HAIR_PARTS = ['none', 'left', 'center', 'right'] as const;
const HEADWEAR_TYPES = ['none', 'cap', 'beanie', 'brim', 'flatCap', 'beret', 'topHat', 'wideBrim'] as const;
const FACIAL_HAIR = ['none', 'stubble', 'mustache', 'goatee', 'beard'] as const;
const HEADWEAR_CROWNS = ['none', 'panelled', 'knit', 'structured'] as const;
const HEADWEAR_PROJECTIONS = ['none', 'front-bill', 'full-brim'] as const;
const GLASSES_FRAMES = ['none', 'rimless', 'thin', 'thick'] as const;
const LENS_SHAPES = ['none', 'round', 'oval', 'rectangular'] as const;
const LENS_TINTS = ['none', 'clear', 'dark'] as const;
const HAIR_REGIONS = ['none', 'stubble', 'solid'] as const;
const FACE_SHAPES = ['round', 'oval', 'square', 'long', 'heart'] as const;
const CHIN_SHAPES = ['round', 'pointed', 'square', 'wide'] as const;
const SIZES = ['small', 'medium', 'large'] as const;
const EYE_SPACINGS = ['close', 'average', 'wide'] as const;
const EYE_SHAPES = ['round', 'almond', 'narrow'] as const;
const BROW_THICKNESSES = ['thin', 'medium', 'thick'] as const;
const BROW_SHAPES = ['straight', 'arched', 'angled'] as const;
const EAR_PROMINENCES = ['hidden', 'small', 'average', 'prominent'] as const;

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === 'string' && allowed.includes(value) ? (value as T[number]) : fallback;
}

function optionalEnumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined {
  return typeof value === 'string' && allowed.includes(value) ? (value as T[number]) : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isNone(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'none';
}

/**
 * Providers without strict structured output can return missing, conflicting,
 * or malformed fields. Collapse those states into one deterministic set of
 * renderer invariants before any pixels are drawn.
 */
export function normalizeFaceFeatures(input: unknown): NormalizedFaceFeatures {
  const raw = recordValue(input);
  const rawTopology = recordValue(raw['topology']);
  const rawScalpHair = recordValue(rawTopology['scalpHair']);
  const rawTopologyHeadwear = recordValue(rawTopology['headwear']);
  const rawTopologyGlasses = recordValue(rawTopology['glasses']);
  const rawTopologyFacialHair = recordValue(rawTopology['facialHair']);

  const topologyHeadwearCrown = optionalEnumValue(rawTopologyHeadwear['crown'], HEADWEAR_CROWNS);
  const topologyHeadwearProjection = optionalEnumValue(rawTopologyHeadwear['projection'], HEADWEAR_PROJECTIONS);
  const requestedHeadwearType = optionalEnumValue(raw['headwearType'], HEADWEAR_TYPES);
  const topologySaysHeadwear =
    (topologyHeadwearCrown !== undefined && topologyHeadwearCrown !== 'none') ||
    (topologyHeadwearProjection !== undefined && topologyHeadwearProjection !== 'none');
  const headwear =
    typeof raw['headwear'] === 'boolean'
      ? raw['headwear']
      : (requestedHeadwearType !== undefined && requestedHeadwearType !== 'none') || topologySaysHeadwear;
  const inferredHeadwearType: HeadwearType =
    topologyHeadwearProjection === 'full-brim'
      ? 'brim'
      : topologyHeadwearCrown === 'knit'
        ? 'beanie'
        : topologyHeadwearCrown === 'structured' && topologyHeadwearProjection === 'front-bill'
          ? 'flatCap'
          : topologyHeadwearCrown === 'structured'
            ? 'beret'
            : 'cap';
  const headwearType: HeadwearType = headwear
    ? requestedHeadwearType && requestedHeadwearType !== 'none'
      ? requestedHeadwearType
      : inferredHeadwearType
    : 'none';

  const legacyHairStyle = optionalEnumValue(raw['hairStyle'], HAIR_STYLES);
  const legacyHairDefaults: Record<HairStyle, [HairLength, HairTexture, HairPart]> = {
    bald: ['none', 'none', 'none'],
    hidden: ['none', 'none', 'none'],
    buzz: ['buzz', 'straight', 'none'],
    short: ['short', 'straight', 'none'],
    // The old enum did not preserve which side was parted. Pick one visible
    // direction so legacy `parted` sprites remain distinct from plain short
    // hair; new Muse payloads report the actual side explicitly.
    parted: ['short', 'straight', 'right'],
    curly: ['short', 'curly', 'none'],
    afro: ['short', 'coily', 'none'],
    horseshoe: ['short', 'straight', 'none'],
    long: ['long', 'straight', 'none'],
    ponytail: ['tied', 'straight', 'none'],
  };
  const legacyDefaults = legacyHairDefaults[legacyHairStyle ?? 'short'];
  let hairLength = enumValue(raw['hairLength'], HAIR_LENGTHS, legacyDefaults[0]);
  let hairTexture = enumValue(raw['hairTexture'], HAIR_TEXTURES, legacyDefaults[1]);
  let hairPart = enumValue(raw['hairPart'], HAIR_PARTS, legacyDefaults[2]);
  // A hat can hide the crown while long hair remains visible at the sides.
  // Some provider payloads keep the coarse legacy style `hidden` in that
  // situation; explicit canonical length/topology is the higher-fidelity fact.
  if (
    legacyHairStyle === 'hidden' &&
    hairLength === 'none' &&
    (rawScalpHair['temples'] === true || rawScalpHair['belowEars'] === true)
  ) {
    hairLength = rawScalpHair['belowEars'] === true ? 'long' : 'short';
    if (hairTexture === 'none') hairTexture = 'straight';
  }
  const hasCanonicalHairInput =
    optionalEnumValue(raw['hairLength'], HAIR_LENGTHS) !== undefined ||
    optionalEnumValue(raw['hairTexture'], HAIR_TEXTURES) !== undefined ||
    optionalEnumValue(raw['hairPart'], HAIR_PARTS) !== undefined;
  const styleFromCanonicalHair = (): HairStyle => {
    if (hairLength === 'none') return headwear ? 'hidden' : 'bald';
    if (hairLength === 'buzz') return 'buzz';
    if (hairLength === 'tied') return 'ponytail';
    if (hairLength === 'jaw' || hairLength === 'long') return 'long';
    if (hairTexture === 'curly' || hairTexture === 'coily') return 'curly';
    if (hairPart !== 'none') return 'parted';
    return 'short';
  };
  const canonicalHairIsVisible =
    hairLength !== 'none' || rawScalpHair['crown'] === true || rawScalpHair['temples'] === true || rawScalpHair['belowEars'] === true;
  const requestedHairStyle =
    legacyHairStyle === 'afro' || legacyHairStyle === 'horseshoe'
      ? legacyHairStyle
      : hasCanonicalHairInput && legacyHairStyle !== 'bald' && (legacyHairStyle !== 'hidden' || canonicalHairIsVisible)
      ? styleFromCanonicalHair()
      : (legacyHairStyle ?? styleFromCanonicalHair());
  const noHairColor = isNone(raw['hairColor']);
  // Old providers used hairColor:none as their only no-hair signal. Preserve
  // that behavior when bare-headed, but under headwear it means "not visible",
  // not permission to guess either baldness or a hairstyle.
  const bald =
    requestedHairStyle === 'bald' ||
    (noHairColor && requestedHairStyle !== 'hidden' && !headwear);
  const hidden =
    !bald &&
    (requestedHairStyle === 'hidden' || (noHairColor && headwear));
  if (bald || hidden) {
    hairLength = 'none';
    hairTexture = 'none';
    hairPart = 'none';
  }
  const hairColor = bald || hidden
    ? 'none'
    : normHex(String(raw['hairColor'] ?? ''), '#2a2320');
  const hairStyle: HairStyle = bald ? 'bald' : hidden ? 'hidden' : requestedHairStyle;

  const topologyFacialRegions = ['upperLip', 'chin', 'jaw', 'cheeks'].map((region) =>
    optionalEnumValue(rawTopologyFacialHair[region], HAIR_REGIONS),
  );
  const hasExplicitFacialTopology = topologyFacialRegions.some((region) => region !== undefined);
  const inferredFacialHair: FacialHair =
    topologyFacialRegions[2] === 'solid' || topologyFacialRegions[3] === 'solid'
      ? 'beard'
      : topologyFacialRegions[0] === 'solid' && topologyFacialRegions[1] === 'solid'
        ? 'goatee'
        : topologyFacialRegions.some((region) => region === 'stubble')
          ? 'stubble'
          : topologyFacialRegions[0] === 'solid'
            ? 'mustache'
            : topologyFacialRegions[1] === 'solid'
              ? 'goatee'
              : 'none';
  // Regional topology can express mixed moustache + stubble cases that the
  // legacy enum cannot. When supplied, it is the canonical fact rather than a
  // decoration that a contradictory coarse label is allowed to erase.
  const facialHair = hasExplicitFacialTopology
    ? inferredFacialHair
    : enumValue(raw['facialHair'], FACIAL_HAIR, 'none');
  const facialHairColor =
    facialHair === 'none'
      ? 'none'
      : normHex(String(raw['facialHairColor'] ?? ''), bald || hidden ? '#4a3a2e' : hairColor);

  const topologyGlassesFrame = optionalEnumValue(rawTopologyGlasses['frame'], GLASSES_FRAMES);
  const topologySaysGlasses = topologyGlassesFrame !== undefined && topologyGlassesFrame !== 'none';
  const glasses = typeof raw['glasses'] === 'boolean' ? raw['glasses'] : topologySaysGlasses;
  const glassesColor = glasses
    ? normHex(String(raw['glassesColor'] ?? ''), '#1b1622')
    : 'none';

  const visibleScalpHair = hairStyle !== 'bald' && hairStyle !== 'hidden' && hairLength !== 'none';
  const scalpHair: FaceTopology['scalpHair'] = visibleScalpHair
    ? {
        crown:
          hairStyle === 'horseshoe'
            ? false
            : typeof rawScalpHair['crown'] === 'boolean'
              ? rawScalpHair['crown']
              : true,
        temples: typeof rawScalpHair['temples'] === 'boolean' ? rawScalpHair['temples'] : true,
        belowEars:
          typeof rawScalpHair['belowEars'] === 'boolean'
            ? rawScalpHair['belowEars']
            : hairLength === 'jaw' || hairLength === 'long' || hairLength === 'tied',
      }
    : { crown: false, temples: false, belowEars: false };

  const defaultHeadwearTopology: FaceTopology['headwear'] =
    headwearType === 'cap'
      ? { crown: 'panelled', projection: 'front-bill' }
      : headwearType === 'beanie'
        ? { crown: 'knit', projection: 'none' }
        : headwearType === 'flatCap'
          ? { crown: 'structured', projection: 'front-bill' }
          : headwearType === 'beret'
            ? { crown: 'structured', projection: 'none' }
            : headwearType === 'brim' || headwearType === 'topHat' || headwearType === 'wideBrim'
              ? { crown: 'structured', projection: 'full-brim' }
              : { crown: 'none', projection: 'none' };
  const topologyHeadwear: FaceTopology['headwear'] = headwear
    ? {
        crown:
          topologyHeadwearCrown && topologyHeadwearCrown !== 'none'
            ? topologyHeadwearCrown
            : defaultHeadwearTopology.crown,
        projection:
          topologyHeadwearProjection &&
          (topologyHeadwearProjection !== 'none' || defaultHeadwearTopology.projection === 'none')
            ? topologyHeadwearProjection
            : defaultHeadwearTopology.projection,
      }
    : { crown: 'none', projection: 'none' };

  const topologyGlasses: FaceTopology['glasses'] = glasses
    ? {
        frame:
          topologyGlassesFrame && topologyGlassesFrame !== 'none'
            ? topologyGlassesFrame
            : 'thin',
        lensShape: enumValue(rawTopologyGlasses['lensShape'], LENS_SHAPES, 'rectangular') === 'none'
          ? 'rectangular'
          : enumValue(rawTopologyGlasses['lensShape'], LENS_SHAPES, 'rectangular'),
        lensTint: enumValue(rawTopologyGlasses['lensTint'], LENS_TINTS, 'clear') === 'none'
          ? 'clear'
          : enumValue(rawTopologyGlasses['lensTint'], LENS_TINTS, 'clear'),
      }
    : { frame: 'none', lensShape: 'none', lensTint: 'none' };

  const defaultFacialHairTopology: FaceTopology['facialHair'] =
    facialHair === 'stubble'
      ? { upperLip: 'stubble', chin: 'stubble', jaw: 'stubble', cheeks: 'stubble' }
      : facialHair === 'mustache'
        ? { upperLip: 'solid', chin: 'none', jaw: 'none', cheeks: 'none' }
        : facialHair === 'goatee'
          ? { upperLip: 'solid', chin: 'solid', jaw: 'none', cheeks: 'none' }
          : facialHair === 'beard'
            ? { upperLip: 'solid', chin: 'solid', jaw: 'solid', cheeks: 'solid' }
            : { upperLip: 'none', chin: 'none', jaw: 'none', cheeks: 'none' };
  const topologyFacialHair: FaceTopology['facialHair'] = hasExplicitFacialTopology
    ? {
        upperLip: enumValue(rawTopologyFacialHair['upperLip'], HAIR_REGIONS, 'none'),
        chin: enumValue(rawTopologyFacialHair['chin'], HAIR_REGIONS, 'none'),
        jaw: enumValue(rawTopologyFacialHair['jaw'], HAIR_REGIONS, 'none'),
        cheeks: enumValue(rawTopologyFacialHair['cheeks'], HAIR_REGIONS, 'none'),
      }
    : defaultFacialHairTopology;

  return {
    skinTone: normHex(String(raw['skinTone'] ?? ''), '#c98f6b'),
    hairColor,
    hairStyle,
    facialHairColor,
    headwearColor: headwear
      ? normHex(String(raw['headwearColor'] ?? ''), bald || hidden ? '#33445e' : hairColor)
      : 'none',
    hairLength,
    hairTexture,
    hairPart,
    glasses,
    glassesColor,
    headwear,
    headwearType,
    facialHair,
    faceShape: enumValue(raw['faceShape'], FACE_SHAPES, 'oval'),
    chin: enumValue(raw['chin'], CHIN_SHAPES, 'round'),
    noseSize: enumValue(raw['noseSize'], SIZES, 'medium'),
    eyeSpacing: enumValue(raw['eyeSpacing'], EYE_SPACINGS, 'average'),
    eyeShape: enumValue(raw['eyeShape'], EYE_SHAPES, 'almond'),
    eyebrows: enumValue(raw['eyebrows'], BROW_THICKNESSES, 'medium'),
    eyebrowShape: enumValue(raw['eyebrowShape'], BROW_SHAPES, 'straight'),
    ears: enumValue(raw['ears'], EAR_PROMINENCES, 'average'),
    topology: {
      scalpHair,
      headwear: topologyHeadwear,
      glasses: topologyGlasses,
      facialHair: topologyFacialHair,
    },
  };
}

// ---------------------------------------------------------------- palette ----

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}
function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('');
}
function normHex(hex: string | undefined, fallback: string): string {
  let h = (hex ?? '').trim();
  if (h && h[0] !== '#') h = '#' + h;
  if (/^#[0-9a-fA-F]{3}$/.test(h)) h = '#' + h[1]! + h[1]! + h[2]! + h[2]! + h[3]! + h[3]!;
  return /^#[0-9a-fA-F]{6}$/.test(h) ? h.toLowerCase() : fallback;
}
function shade(hex: string, f: number): string {
  return toHex(parseInt(hex.slice(1, 3), 16) * f, parseInt(hex.slice(3, 5), 16) * f, parseInt(hex.slice(5, 7), 16) * f);
}
function blend(a: string, b: string, t: number): string {
  const mix = (i: number) => parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t;
  return toHex(mix(1), mix(3), mix(5));
}

/**
 * A 16-slot palette centered on the person's real skin + hair, for
 * bakeLikeness to quantize the downscaled face against. Skin/hair land on the
 * right tones; dark features (eyes, glasses, beard) fall to the dark slots.
 * Slot 0 is unused and slot 1 is the outline (bakeSize's conventions).
 */
export function buildPortraitPalette(feat: FaceFeatures): string[] {
  const normalized = normalizeFaceFeatures(feat);
  const skin = normalized.skinTone;
  const noVisibleHair = normalized.hairStyle === 'bald' || normalized.hairStyle === 'hidden';
  const hair = noVisibleHair ? shade(skin, 0.66) : normalized.hairColor;
  const hw =
    normalized.headwear && normalized.headwearColor !== 'none'
      ? normalized.headwearColor
      : hair;
  return [
    '#000000', // 0 unused (transparent)
    shade(skin, 0.24), // 1 outline + darkest features
    shade(skin, 0.6), // 2 skin deep shadow
    shade(skin, 0.8), // 3 skin shadow
    skin, // 4 skin base
    shade(skin, 1.12), // 5 skin highlight
    shade(hair, 0.6), // 6 hair dark
    hair, // 7 hair base
    shade(hair, 1.22), // 8 hair highlight
    blend(skin, '#9c3450', 0.42), // 9 lip / mouth
    '#1b1622', // 10 eye / feature dark
    hw, // 11 headwear
    '#f2f2f4', // 12 white (eye/teeth highlight)
    shade(skin, 0.9), // 13 skin mid
    shade(hair, 0.85), // 14 hair mid
    shade(skin, 0.7), // 15 skin shadow (weight toward skin)
  ];
}
