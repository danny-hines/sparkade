import type { FighterOutfit } from '@sparkade/shared';
import rawOutfitDocument from './outfits.json';

export const FIGHTER_OUTFIT_IDS = [
  'gi',
  'boxer',
  'wrestler',
  'street',
  'robe',
  'armor',
] as const satisfies readonly FighterOutfit[];

export const FIGHTER_COLOR_ROLES = [
  'body',
  'limb',
  'skin',
  'trim',
  'outline',
] as const;
export type FighterColorRole = (typeof FIGHTER_COLOR_ROLES)[number];

export const FIGHTER_TORSO_DETAILS = [
  'none',
  ...FIGHTER_OUTFIT_IDS,
] as const;
export type FighterTorsoDetail = (typeof FIGHTER_TORSO_DETAILS)[number];

export const FIGHTER_LEG_ACCENTS = ['none', 'kneePads'] as const;
export type FighterLegAccent = (typeof FIGHTER_LEG_ACCENTS)[number];

export const FIGHTER_HAND_SHAPES = ['round', 'square', 'mitten'] as const;
export type FighterHandShape = (typeof FIGHTER_HAND_SHAPES)[number];

export const FIGHTER_FOOT_SHAPES = ['none', 'bare', 'shoe', 'boot'] as const;
export type FighterFootShape = (typeof FIGHTER_FOOT_SHAPES)[number];

export interface FighterOutfitRig {
  torso: {
    widthAdd: number;
    shoulderAdd: number;
    hemDrop: number;
    detail: FighterTorsoDetail;
    detailWeight: number;
  };
  arms: {
    widthAdd: number;
    baseColor: FighterColorRole;
    sleeveColor: FighterColorRole;
    sleeveLength: number;
    sleeveWidthAdd: number;
  };
  legs: {
    widthAdd: number;
    color: FighterColorRole;
    accent: FighterLegAccent;
  };
  hands: {
    shape: FighterHandShape;
    radius: number;
    color: FighterColorRole;
    cuffLength: number;
  };
  feet: {
    shape: FighterFootShape;
    lengthAdd: number;
    height: number;
    color: FighterColorRole;
    bootLength: number;
  };
}

export const FIGHTER_FOOT_PRESETS = {
  none: {
    shape: 'none',
    lengthAdd: 0,
    height: 2,
    color: 'limb',
    bootLength: 0,
  },
  barefoot: {
    shape: 'bare',
    lengthAdd: 0.5,
    height: 1.75,
    color: 'skin',
    bootLength: 0,
  },
  sneakers: {
    shape: 'shoe',
    lengthAdd: 1,
    height: 2,
    color: 'trim',
    bootLength: 0,
  },
  ankleBoots: {
    shape: 'boot',
    lengthAdd: 1.25,
    height: 2.25,
    color: 'body',
    bootLength: 0.1,
  },
  tallBoots: {
    shape: 'boot',
    lengthAdd: 1.5,
    height: 2.5,
    color: 'limb',
    bootLength: 0.225,
  },
} as const satisfies Record<string, FighterOutfitRig['feet']>;
export type FighterFootPreset = keyof typeof FIGHTER_FOOT_PRESETS;

export type FighterOutfitRigMap = Record<FighterOutfit, FighterOutfitRig>;

export interface FighterOutfitRigDocument {
  version: 1;
  outfits: FighterOutfitRigMap;
}

interface NumberBounds {
  min: number;
  max: number;
}

export const FIGHTER_OUTFIT_RIG_BOUNDS = {
  torso: {
    widthAdd: { min: -2, max: 4 },
    shoulderAdd: { min: 0, max: 4 },
    hemDrop: { min: 0, max: 12 },
    detailWeight: { min: 0.5, max: 2 },
  },
  arms: {
    widthAdd: { min: -1, max: 3 },
    sleeveLength: { min: 0, max: 1 },
    sleeveWidthAdd: { min: 0, max: 2 },
  },
  legs: {
    widthAdd: { min: -1.5, max: 2.5 },
  },
  hands: {
    radius: { min: 1.5, max: 4 },
    cuffLength: { min: 0, max: 3 },
  },
  feet: {
    lengthAdd: { min: 0, max: 4 },
    height: { min: 1.5, max: 5 },
    bootLength: { min: 0, max: 0.35 },
  },
} as const satisfies Record<string, Record<string, NumberBounds>>;

export type FighterOutfitValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkExactObject(
  value: unknown,
  path: string,
  expectedKeys: readonly string[],
  errors: string[],
): value is Record<string, unknown> {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  const actualKeys = Object.keys(value);
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push(`${path}.${key} is required`);
    }
  }
  for (const key of actualKeys) {
    if (!expectedKeys.includes(key)) {
      errors.push(`${path}.${key} is not allowed`);
    }
  }
  return true;
}

function checkNumber(
  value: unknown,
  path: string,
  bounds: NumberBounds,
  errors: string[],
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path} must be a finite number`);
    return;
  }
  if (value < bounds.min || value > bounds.max) {
    errors.push(`${path} must be between ${bounds.min} and ${bounds.max}`);
  }
}

function checkEnum(
  value: unknown,
  path: string,
  choices: readonly string[],
  errors: string[],
): void {
  if (typeof value !== 'string' || !choices.includes(value)) {
    errors.push(`${path} must be one of: ${choices.join(', ')}`);
  }
}

export function cloneFighterOutfitRig(rig: FighterOutfitRig): FighterOutfitRig {
  return {
    torso: { ...rig.torso },
    arms: { ...rig.arms },
    legs: { ...rig.legs },
    hands: { ...rig.hands },
    feet: { ...rig.feet },
  };
}

export function cloneFighterOutfitRigs(
  rigs: FighterOutfitRigMap = FIGHTER_OUTFIT_RIGS,
): FighterOutfitRigMap {
  return Object.fromEntries(
    FIGHTER_OUTFIT_IDS.map((id) => [id, cloneFighterOutfitRig(rigs[id])]),
  ) as FighterOutfitRigMap;
}

export function cloneFighterOutfitRigDocument(
  document: FighterOutfitRigDocument = FIGHTER_OUTFIT_RIG_DOCUMENT,
): FighterOutfitRigDocument {
  return { version: 1, outfits: cloneFighterOutfitRigs(document.outfits) };
}

export function validateFighterOutfitRig(
  value: unknown,
  path = 'rig',
): FighterOutfitValidationResult<FighterOutfitRig> {
  const errors: string[] = [];
  if (
    !checkExactObject(
      value,
      path,
      ['torso', 'arms', 'legs', 'hands', 'feet'],
      errors,
    )
  ) {
    return { ok: false, errors };
  }

  const torso = value.torso;
  if (
    checkExactObject(
      torso,
      `${path}.torso`,
      ['widthAdd', 'shoulderAdd', 'hemDrop', 'detail', 'detailWeight'],
      errors,
    )
  ) {
    checkNumber(torso.widthAdd, `${path}.torso.widthAdd`, FIGHTER_OUTFIT_RIG_BOUNDS.torso.widthAdd, errors);
    checkNumber(torso.shoulderAdd, `${path}.torso.shoulderAdd`, FIGHTER_OUTFIT_RIG_BOUNDS.torso.shoulderAdd, errors);
    checkNumber(torso.hemDrop, `${path}.torso.hemDrop`, FIGHTER_OUTFIT_RIG_BOUNDS.torso.hemDrop, errors);
    checkEnum(torso.detail, `${path}.torso.detail`, FIGHTER_TORSO_DETAILS, errors);
    checkNumber(torso.detailWeight, `${path}.torso.detailWeight`, FIGHTER_OUTFIT_RIG_BOUNDS.torso.detailWeight, errors);
  }

  const arms = value.arms;
  if (
    checkExactObject(
      arms,
      `${path}.arms`,
      ['widthAdd', 'baseColor', 'sleeveColor', 'sleeveLength', 'sleeveWidthAdd'],
      errors,
    )
  ) {
    checkNumber(arms.widthAdd, `${path}.arms.widthAdd`, FIGHTER_OUTFIT_RIG_BOUNDS.arms.widthAdd, errors);
    checkEnum(arms.baseColor, `${path}.arms.baseColor`, FIGHTER_COLOR_ROLES, errors);
    checkEnum(arms.sleeveColor, `${path}.arms.sleeveColor`, FIGHTER_COLOR_ROLES, errors);
    checkNumber(arms.sleeveLength, `${path}.arms.sleeveLength`, FIGHTER_OUTFIT_RIG_BOUNDS.arms.sleeveLength, errors);
    checkNumber(arms.sleeveWidthAdd, `${path}.arms.sleeveWidthAdd`, FIGHTER_OUTFIT_RIG_BOUNDS.arms.sleeveWidthAdd, errors);
  }

  const legs = value.legs;
  if (
    checkExactObject(
      legs,
      `${path}.legs`,
      ['widthAdd', 'color', 'accent'],
      errors,
    )
  ) {
    checkNumber(legs.widthAdd, `${path}.legs.widthAdd`, FIGHTER_OUTFIT_RIG_BOUNDS.legs.widthAdd, errors);
    checkEnum(legs.color, `${path}.legs.color`, FIGHTER_COLOR_ROLES, errors);
    checkEnum(legs.accent, `${path}.legs.accent`, FIGHTER_LEG_ACCENTS, errors);
  }

  const hands = value.hands;
  if (
    checkExactObject(
      hands,
      `${path}.hands`,
      ['shape', 'radius', 'color', 'cuffLength'],
      errors,
    )
  ) {
    checkEnum(hands.shape, `${path}.hands.shape`, FIGHTER_HAND_SHAPES, errors);
    checkNumber(hands.radius, `${path}.hands.radius`, FIGHTER_OUTFIT_RIG_BOUNDS.hands.radius, errors);
    checkEnum(hands.color, `${path}.hands.color`, FIGHTER_COLOR_ROLES, errors);
    checkNumber(hands.cuffLength, `${path}.hands.cuffLength`, FIGHTER_OUTFIT_RIG_BOUNDS.hands.cuffLength, errors);
  }

  const feet = value.feet;
  if (
    checkExactObject(
      feet,
      `${path}.feet`,
      ['shape', 'lengthAdd', 'height', 'color', 'bootLength'],
      errors,
    )
  ) {
    checkEnum(feet.shape, `${path}.feet.shape`, FIGHTER_FOOT_SHAPES, errors);
    checkNumber(feet.lengthAdd, `${path}.feet.lengthAdd`, FIGHTER_OUTFIT_RIG_BOUNDS.feet.lengthAdd, errors);
    checkNumber(feet.height, `${path}.feet.height`, FIGHTER_OUTFIT_RIG_BOUNDS.feet.height, errors);
    checkEnum(feet.color, `${path}.feet.color`, FIGHTER_COLOR_ROLES, errors);
    checkNumber(feet.bootLength, `${path}.feet.bootLength`, FIGHTER_OUTFIT_RIG_BOUNDS.feet.bootLength, errors);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: cloneFighterOutfitRig(value as unknown as FighterOutfitRig) };
}

export function validateFighterOutfitRigs(
  value: unknown,
  path = 'outfits',
): FighterOutfitValidationResult<FighterOutfitRigMap> {
  const errors: string[] = [];
  if (!checkExactObject(value, path, FIGHTER_OUTFIT_IDS, errors)) {
    return { ok: false, errors };
  }

  const rigs = {} as FighterOutfitRigMap;
  for (const id of FIGHTER_OUTFIT_IDS) {
    const result = validateFighterOutfitRig(value[id], `${path}.${id}`);
    if (result.ok) rigs[id] = result.value;
    else errors.push(...result.errors);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: rigs };
}

export function validateFighterOutfitRigDocument(
  value: unknown,
  path = 'document',
): FighterOutfitValidationResult<FighterOutfitRigDocument> {
  const errors: string[] = [];
  if (!checkExactObject(value, path, ['version', 'outfits'], errors)) {
    return { ok: false, errors };
  }
  if (value.version !== 1) errors.push(`${path}.version must equal 1`);
  const rigs = validateFighterOutfitRigs(value.outfits, `${path}.outfits`);
  if (!rigs.ok) errors.push(...rigs.errors);
  if (errors.length > 0 || !rigs.ok) return { ok: false, errors };
  return { ok: true, value: { version: 1, outfits: rigs.value } };
}

const shippedDocument = validateFighterOutfitRigDocument(rawOutfitDocument);
if (!shippedDocument.ok) {
  throw new Error(`Invalid shipped fighter outfit rigs: ${shippedDocument.errors.join('; ')}`);
}

export const FIGHTER_OUTFIT_RIG_DOCUMENT: FighterOutfitRigDocument = shippedDocument.value;
export const FIGHTER_OUTFIT_RIGS: FighterOutfitRigMap = FIGHTER_OUTFIT_RIG_DOCUMENT.outfits;
