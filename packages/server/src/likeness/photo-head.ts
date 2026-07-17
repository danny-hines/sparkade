// Muse-guided photo likeness: Muse identifies visible traits and annotates the
// real head geometry; deterministic local code crops and pixelizes the source
// photo. Muse never has to "draw" a spatial color grid, and no image-generation
// model is involved.
import sharp from 'sharp';
import type { Provider, ProviderUsage } from '@sparkade/shared';
import { parseModelJson } from '../pipeline/prompts';
import {
  buildPortraitPalette,
  normalizeFaceFeatures,
  type FaceFeatures,
  type HairRegion,
  type NormalizedFaceFeatures,
} from './features';

export const PHOTO_HEAD_SIZES = [16, 20, 24, 28] as const;
export type PhotoHeadSize = (typeof PHOTO_HEAD_SIZES)[number];
export const PHOTO_HEAD_SCANLINES = 16;
export const PHOTO_HEAD_INPUT_SIZE = 512;
export const PHOTO_HEAD_PROMPT_VERSION = 'photo-head-v6';

export interface PhotoHeadPoint {
  /** Coordinates in the exact normalized image sent to Muse, 0..1000. */
  x: number;
  y: number;
}

export interface PhotoHeadSpan {
  /** Coordinates relative to the head box, normalized to 0..1000. */
  left: number;
  right: number;
}

export interface PhotoHeadGeometry {
  /** Coordinates in the exact normalized image sent to Muse, 0..1000. */
  headBox: { x: number; y: number; width: number; height: number };
  /** Facial plane only: cheek-to-cheek and visible forehead/hat edge to chin. */
  faceBox: { x: number; y: number; width: number; height: number };
  landmarks: {
    /** Image-left and image-right, not the person's anatomical left/right. */
    leftEye: PhotoHeadPoint;
    rightEye: PhotoHeadPoint;
    noseTip: PhotoHeadPoint;
    mouthCenter: PhotoHeadPoint;
    chin: PhotoHeadPoint;
  };
  /** One outside silhouette span for each top-to-bottom scanline. */
  rows: PhotoHeadSpan[];
  /** New Muse calls use local photo segmentation; retained for legacy fixtures. */
  contourSource: 'local' | 'muse';
  confidence: 'low' | 'medium' | 'high';
}

export interface PhotoHeadDocument {
  features: NormalizedFaceFeatures;
  geometry: PhotoHeadGeometry;
}

export interface PhotoHeadLikeness extends PhotoHeadDocument {
  pngs: Record<string, Buffer>;
  usage: ProviderUsage;
}

const GEOMETRY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['headBox', 'faceBox', 'landmarks', 'confidence'],
  properties: {
    headBox: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y', 'width', 'height'],
      properties: {
        x: { type: 'integer', minimum: 0, maximum: 1000 },
        y: { type: 'integer', minimum: 0, maximum: 1000 },
        width: { type: 'integer', minimum: 20, maximum: 1000 },
        height: { type: 'integer', minimum: 20, maximum: 1000 },
      },
    },
    faceBox: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y', 'width', 'height'],
      properties: {
        x: { type: 'integer', minimum: 0, maximum: 1000 },
        y: { type: 'integer', minimum: 0, maximum: 1000 },
        width: { type: 'integer', minimum: 20, maximum: 1000 },
        height: { type: 'integer', minimum: 20, maximum: 1000 },
      },
    },
    landmarks: {
      type: 'object',
      additionalProperties: false,
      required: ['leftEye', 'rightEye', 'noseTip', 'mouthCenter', 'chin'],
      properties: Object.fromEntries(
        ['leftEye', 'rightEye', 'noseTip', 'mouthCenter', 'chin'].map((name) => [
          name,
          {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y'],
            properties: {
              x: { type: 'integer', minimum: 0, maximum: 1000 },
              y: { type: 'integer', minimum: 0, maximum: 1000 },
            },
          },
        ]),
      ),
    },
    confidence: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
      description: '0-100 confidence that every coordinate follows the exact source pixels',
    },
  },
};

export const PHOTO_HEAD_SCHEMA: Record<string, unknown> = {
  title: 'Sparkade Muse head geometry',
  type: 'object',
  additionalProperties: false,
  required: ['geometry'],
  properties: {
    geometry: GEOMETRY_SCHEMA,
  },
};

export function buildPhotoHeadPrompt(): {
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
} {
  const geometry = [
    'You are an exact image-annotation system for a deterministic tiny portrait renderer.',
    'Annotate the supplied square image; do not redraw, stylize, describe, or imagine an avatar.',
    'All coordinates are normalized integers from 0 to 1000.',
    '- geometry.headBox is a TIGHT box around the visible HEAD: face, skull/scalp hair, ears, facial hair/chin, and all visible headwear including a projecting cap brim.',
    '- The box bottom must be the chin or lowest beard pixel. Exclude every neck, shoulder, torso, hand, collar, and shirt pixel. For long hair, include only the portion beside the cranial head above the chin line; cut off locks below the chin.',
    '- headBox x/y/width/height use the supplied square image coordinates.',
    '- geometry.faceBox is a tight box around the FACIAL PLANE only: visible forehead or lower hat edge through the chin, cheek edge to cheek edge. Exclude ears, scalp hair, headwear, and background; include beard that lies over the facial plane.',
    '- geometry.landmarks are also in supplied-image 0..1000 coordinates. leftEye/rightEye mean IMAGE-left and IMAGE-right pupil/iris centers (locate them behind clear glasses); noseTip is the nose-tip center; mouthCenter is the lip center beneath any moustache; chin is the lowest central chin/beard point.',
    '- Measure landmarks from the actual pixels and preserve real tilt/perspective. Never force generic symmetry.',
    '- A cap headBox must include its real projecting bill; never turn a cap into a rounded beanie.',
    '- confidence is an integer from 0 to 100 for exact pixel alignment.',
    'Coordinates crop the original pixels, so visual alignment matters more than describing a plausible generic head.',
    'Return the annotation under geometry. Output only the structured fields.',
  ].join('\n');
  return {
    system: geometry,
    user: 'Annotate the exact source-photo head geometry.',
    jsonSchema: PHOTO_HEAD_SCHEMA,
    maxTokens: 3000,
  };
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizedInteger(value: unknown, label: string): number {
  return clamp(Math.round(finiteNumber(value, label)), 0, 1000);
}

type PhotoHeadBox = PhotoHeadGeometry['headBox'];

function normalizeGlobalBox(
  value: unknown,
  label: string,
  minimumSize: number,
  minimumAspect: number,
  maximumAspect: number,
): PhotoHeadBox {
  if (!value || typeof value !== 'object') throw new Error(`${label} is missing`);
  const raw = value as Record<string, unknown>;
  const x = normalizedInteger(raw['x'], `${label}.x`);
  const y = normalizedInteger(raw['y'], `${label}.y`);
  const requestedRight = x + Math.max(0, Math.round(finiteNumber(raw['width'], `${label}.width`)));
  const requestedBottom = y + Math.max(0, Math.round(finiteNumber(raw['height'], `${label}.height`)));
  const width = clamp(requestedRight, x, 1000) - x;
  const height = clamp(requestedBottom, y, 1000) - y;
  if (width < minimumSize || height < minimumSize) throw new Error(`${label} is implausibly small or outside the image`);
  const aspect = width / height;
  if (aspect < minimumAspect || aspect > maximumAspect) throw new Error(`${label} has an implausible aspect ratio`);
  return { x, y, width, height };
}

function fallbackFaceBox(headBox: PhotoHeadBox): PhotoHeadBox {
  return {
    x: Math.round(headBox.x + headBox.width * 0.16),
    y: Math.round(headBox.y + headBox.height * 0.25),
    width: Math.round(headBox.width * 0.68),
    height: Math.round(headBox.height * 0.72),
  };
}

function normalizeFaceBox(value: unknown, headBox: PhotoHeadBox): PhotoHeadBox {
  if (!value || typeof value !== 'object') return fallbackFaceBox(headBox);
  const candidate = normalizeGlobalBox(value, 'geometry.faceBox', 50, 0.35, 1.8);
  const overlapWidth = Math.max(
    0,
    Math.min(candidate.x + candidate.width, headBox.x + headBox.width) - Math.max(candidate.x, headBox.x),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(candidate.y + candidate.height, headBox.y + headBox.height) - Math.max(candidate.y, headBox.y),
  );
  // Do not silently clamp a good facial box to a bad coarse head box. The
  // measured face/landmarks will tighten or expand the head box below.
  if (overlapWidth < candidate.width * 0.5 || overlapHeight < candidate.height * 0.5) {
    return fallbackFaceBox(headBox);
  }
  return candidate;
}

function fallbackLandmarks(faceBox: PhotoHeadBox): PhotoHeadGeometry['landmarks'] {
  const point = (x: number, y: number): PhotoHeadPoint => ({
    x: Math.round(faceBox.x + faceBox.width * x),
    y: Math.round(faceBox.y + faceBox.height * y),
  });
  return {
    leftEye: point(0.32, 0.32),
    rightEye: point(0.68, 0.32),
    noseTip: point(0.5, 0.53),
    mouthCenter: point(0.5, 0.73),
    chin: point(0.5, 0.97),
  };
}

function normalizeLandmarks(value: unknown, faceBox: PhotoHeadBox): PhotoHeadGeometry['landmarks'] {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const fallback = fallbackLandmarks(faceBox);
  const read = (name: keyof PhotoHeadGeometry['landmarks']): PhotoHeadPoint => {
    const point = raw[name];
    if (!point || typeof point !== 'object') return fallback[name];
    const record = point as Record<string, unknown>;
    if (typeof record['x'] !== 'number' || typeof record['y'] !== 'number') return fallback[name];
    return {
      x: clamp(Math.round(record['x']), faceBox.x, faceBox.x + faceBox.width),
      y: clamp(Math.round(record['y']), faceBox.y, faceBox.y + faceBox.height),
    };
  };
  let leftEye = read('leftEye');
  let rightEye = read('rightEye');
  if (leftEye.x > rightEye.x) [leftEye, rightEye] = [rightEye, leftEye];
  const eyeTop = faceBox.y + faceBox.height * 0.12;
  const eyeBottom = faceBox.y + faceBox.height * 0.55;
  leftEye.y = clamp(leftEye.y, eyeTop, eyeBottom);
  rightEye.y = clamp(rightEye.y, eyeTop, eyeBottom);
  const eyeLine = (leftEye.y + rightEye.y) / 2;
  const noseTip = read('noseTip');
  noseTip.y = clamp(noseTip.y, eyeLine + faceBox.height * 0.05, faceBox.y + faceBox.height * 0.75);
  const mouthCenter = read('mouthCenter');
  mouthCenter.y = clamp(mouthCenter.y, noseTip.y + faceBox.height * 0.05, faceBox.y + faceBox.height * 0.9);
  const chin = read('chin');
  chin.y = clamp(chin.y, mouthCenter.y + faceBox.height * 0.06, faceBox.y + faceBox.height);
  return { leftEye, rightEye, noseTip, mouthCenter, chin };
}

export function normalizePhotoHeadGeometry(value: unknown): PhotoHeadGeometry {
  if (!value || typeof value !== 'object') throw new Error('geometry is missing');
  const raw = value as Record<string, unknown>;
  const requestedHeadBox = normalizeGlobalBox(raw['headBox'], 'geometry.headBox', 80, 0.35, 2.5);
  const faceBox = normalizeFaceBox(raw['faceBox'], requestedHeadBox);
  const landmarks = normalizeLandmarks(raw['landmarks'], faceBox);

  const rawRows = raw['rows'];
  if (rawRows !== undefined && (!Array.isArray(rawRows) || rawRows.length !== PHOTO_HEAD_SCANLINES)) {
    throw new Error(`geometry.rows must contain exactly ${PHOTO_HEAD_SCANLINES} scanlines`);
  }
  // A normalized local document carries derived ellipse rows for compatibility
  // with older callers. Rendering normalizes once more, so those derived rows
  // must not be mistaken for rows authored by Muse on the second pass.
  const contourSource: PhotoHeadGeometry['contourSource'] =
    raw['contourSource'] === 'local' ? 'local' : Array.isArray(rawRows) ? 'muse' : 'local';
  const rows = Array.isArray(rawRows)
    ? rawRows.map((row, index): PhotoHeadSpan => {
        if (!row || typeof row !== 'object') throw new Error(`geometry.rows[${index}] is not an object`);
        const record = row as Record<string, unknown>;
        let left = normalizedInteger(record['left'], `geometry.rows[${index}].left`);
        let right = normalizedInteger(record['right'], `geometry.rows[${index}].right`);
        if (left > right) [left, right] = [right, left];
        if (right - left < 10) throw new Error(`geometry.rows[${index}] has no usable silhouette span`);
        return { left, right };
      })
    : Array.from({ length: PHOTO_HEAD_SCANLINES }, (_, index): PhotoHeadSpan => {
        const normalizedY = ((index + 0.5) / PHOTO_HEAD_SCANLINES) * 2 - 1;
        const halfWidth = Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY)) * 470;
        return { left: Math.round(500 - halfWidth), right: Math.round(500 + halfWidth) };
      });
  if (contourSource === 'muse') {
    const meanCoverage = rows.reduce((sum, row) => sum + row.right - row.left, 0) / (rows.length * 1000);
    if (meanCoverage < 0.12 || meanCoverage > 0.98) {
      throw new Error(`geometry.rows has implausible ${(meanCoverage * 100).toFixed(0)}% mean coverage`);
    }
  }
  const verticalPad = Math.max(3, requestedHeadBox.height * 0.012);
  const tightTop = Math.min(requestedHeadBox.y, faceBox.y);
  const tightBottom = clamp(
    Math.ceil(Math.max(faceBox.y + faceBox.height, landmarks.chin.y) + verticalPad),
    tightTop + 80,
    1000,
  );
  let headBox: PhotoHeadBox;
  let normalizedRows: PhotoHeadSpan[];
  if (contourSource === 'local') {
    const requestedRight = requestedHeadBox.x + requestedHeadBox.width;
    const horizontalPad = Math.max(3, faceBox.width * 0.015);
    const tightLeft = clamp(
      Math.floor(Math.min(requestedHeadBox.x, faceBox.x - horizontalPad)),
      0,
      920,
    );
    const tightRight = clamp(
      Math.ceil(Math.max(requestedRight, faceBox.x + faceBox.width + horizontalPad)),
      tightLeft + 80,
      1000,
    );
    headBox = {
      x: tightLeft,
      y: tightTop,
      width: tightRight - tightLeft,
      height: tightBottom - tightTop,
    };
    normalizedRows = rows;
  } else {
    // Legacy Muse-row documents are tightened to the global scanline envelope.
    const requestedRight = requestedHeadBox.x + requestedHeadBox.width;
    const rowLeft = Math.min(
      ...rows.map((row) => requestedHeadBox.x + (row.left / 1000) * requestedHeadBox.width),
    );
    const rowRight = Math.max(
      ...rows.map((row) => requestedHeadBox.x + (row.right / 1000) * requestedHeadBox.width),
    );
    const horizontalPad = Math.max(4, requestedHeadBox.width * 0.018);
    const tightLeft = clamp(
      Math.floor(Math.min(rowLeft - horizontalPad, faceBox.x)),
      requestedHeadBox.x,
      requestedRight - 80,
    );
    const tightRight = clamp(
      Math.ceil(Math.max(rowRight + horizontalPad, faceBox.x + faceBox.width)),
      tightLeft + 80,
      requestedRight,
    );
    headBox = { x: tightLeft, y: tightTop, width: tightRight - tightLeft, height: tightBottom - tightTop };
    normalizedRows = Array.from({ length: PHOTO_HEAD_SCANLINES }, (_, index): PhotoHeadSpan => {
      const globalY = headBox.y + ((index + 0.5) / PHOTO_HEAD_SCANLINES) * headBox.height;
      const position = ((globalY - requestedHeadBox.y) / requestedHeadBox.height) * PHOTO_HEAD_SCANLINES - 0.5;
      const low = clamp(Math.floor(position), 0, PHOTO_HEAD_SCANLINES - 1);
      const high = clamp(low + 1, 0, PHOTO_HEAD_SCANLINES - 1);
      const amount = clamp(position - low, 0, 1);
      const sampledLeft = rows[low]!.left * (1 - amount) + rows[high]!.left * amount;
      const sampledRight = rows[low]!.right * (1 - amount) + rows[high]!.right * amount;
      const globalLeft = requestedHeadBox.x + (sampledLeft / 1000) * requestedHeadBox.width;
      const globalRight = requestedHeadBox.x + (sampledRight / 1000) * requestedHeadBox.width;
      return {
        left: clamp(Math.round(((globalLeft - headBox.x) / headBox.width) * 1000), 0, 1000),
        right: clamp(Math.round(((globalRight - headBox.x) / headBox.width) * 1000), 0, 1000),
      };
    });
  }
  const rawConfidence = raw['confidence'];
  const confidence: PhotoHeadGeometry['confidence'] =
    typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
      ? rawConfidence >= 70
        ? 'high'
        : rawConfidence >= 40
          ? 'medium'
          : 'low'
      : rawConfidence === 'low' || rawConfidence === 'medium' || rawConfidence === 'high'
        ? rawConfidence
        : 'medium';
  return { headBox, faceBox, landmarks, rows: normalizedRows, contourSource, confidence };
}

export function parsePhotoHeadDocument(value: unknown, featuresInput?: FaceFeatures): PhotoHeadDocument {
  const parsed = typeof value === 'string' ? parseModelJson(value) : value;
  if (!parsed || typeof parsed !== 'object') throw new Error('photo-head response is not an object');
  const raw = parsed as Record<string, unknown>;
  return {
    // Features come from the dedicated Muse analysis call already performed on
    // upload; legacy combined documents remain accepted for saved fixtures.
    features: normalizeFaceFeatures(featuresInput ?? raw['features']),
    geometry: normalizePhotoHeadGeometry(raw['geometry']),
  };
}

/** The exact bytes sent to Muse and later sampled by normalized coordinates. */
export async function normalizePhotoHeadInput(photo: Buffer): Promise<Buffer> {
  return sharp(photo)
    .rotate()
    .resize(PHOTO_HEAD_INPUT_SIZE, PHOTO_HEAD_INPUT_SIZE, {
      fit: 'contain',
      background: '#ffffff',
      kernel: sharp.kernel.lanczos3,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92 })
    .toBuffer();
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(value: string, fallback = '#241c1a'): Rgb {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function redmean(a: Rgb, b: Rgb): number {
  const mean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db);
}

function scaleRgb(color: Rgb, amount: number): Rgb {
  return {
    r: clamp(Math.round(color.r * amount), 0, 255),
    g: clamp(Math.round(color.g * amount), 0, 255),
    b: clamp(Math.round(color.b * amount), 0, 255),
  };
}

function mixRgb(a: Rgb, b: Rgb, amount: number): Rgb {
  return {
    r: clamp(Math.round(a.r * (1 - amount) + b.r * amount), 0, 255),
    g: clamp(Math.round(a.g * (1 - amount) + b.g * amount), 0, 255),
    b: clamp(Math.round(a.b * (1 - amount) + b.b * amount), 0, 255),
  };
}

function luminance(color: Rgb): number {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

function isSkinLike(color: Rgb): boolean {
  return (
    color.r >= color.g * 1.02 &&
    color.r >= color.b * 1.06 &&
    color.g >= color.b * 0.78
  );
}

interface FaceToneMap {
  scale: number;
  offset: number;
}

/** Compress photographed face lighting toward Muse's neutral observed tone. */
function normalizeSkinLighting(color: Rgb, neutralSkin: Rgb, toneMap?: FaceToneMap): Rgb {
  // Preserve neutral/dark eyes, brows, frames, and facial hair. Illuminated and
  // shadowed skin remains predominantly red-over-green-over-blue even under a
  // strong webcam cast, which gives us a useful local discriminator.
  if (!isSkinLike(color)) return color;
  const sourceLuminance = luminance(color);
  const neutralLuminance = Math.max(1, luminance(neutralSkin));
  const mappedLuminance = toneMap
    ? clamp(sourceLuminance * toneMap.scale + toneMap.offset, 0, 255)
    : sourceLuminance + clamp((neutralLuminance - sourceLuminance) * 0.27, -24, 42);
  const correction = mappedLuminance - sourceLuminance;
  const shifted = {
    r: clamp(Math.round(color.r + correction), 0, 255),
    g: clamp(Math.round(color.g + correction), 0, 255),
    b: clamp(Math.round(color.b + correction), 0, 255),
  };
  const targetAtLuminance = scaleRgb(neutralSkin, Math.max(0.25, luminance(shifted) / neutralLuminance));
  return mixRgb(shifted, targetAtLuminance, 0.12);
}

/** Deterministic farthest-first initialization followed by fixed Lloyd passes. */
function clusterColors(samples: Rgb[], count: number): Rgb[] {
  if (!samples.length) return [];
  const centers: Rgb[] = [{ ...samples[0]! }];
  while (centers.length < count && centers.length < samples.length) {
    let furthest = samples[0]!;
    let furthestDistance = -1;
    for (const sample of samples) {
      const distance = Math.min(...centers.map((center) => redmean(sample, center)));
      if (distance > furthestDistance) {
        furthest = sample;
        furthestDistance = distance;
      }
    }
    centers.push({ ...furthest });
  }
  for (let iteration = 0; iteration < 6; iteration++) {
    const sums = centers.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
    for (const sample of samples) {
      let nearest = 0;
      let nearestDistance = Infinity;
      centers.forEach((center, index) => {
        const distance = redmean(sample, center);
        if (distance < nearestDistance) {
          nearest = index;
          nearestDistance = distance;
        }
      });
      const sum = sums[nearest]!;
      sum.r += sample.r;
      sum.g += sample.g;
      sum.b += sample.b;
      sum.count++;
    }
    centers.forEach((center, index) => {
      const sum = sums[index]!;
      if (!sum.count) return;
      center.r = Math.round(sum.r / sum.count);
      center.g = Math.round(sum.g / sum.count);
      center.b = Math.round(sum.b / sum.count);
    });
  }
  return centers;
}

function interpolateSpan(rows: PhotoHeadSpan[], y: number, height: number): PhotoHeadSpan {
  const position = ((y + 0.5) / height) * PHOTO_HEAD_SCANLINES - 0.5;
  const low = clamp(Math.floor(position), 0, PHOTO_HEAD_SCANLINES - 1);
  const high = clamp(low + 1, 0, PHOTO_HEAD_SCANLINES - 1);
  const amount = clamp(position - low, 0, 1);
  return {
    left: rows[low]!.left * (1 - amount) + rows[high]!.left * amount,
    right: rows[low]!.right * (1 - amount) + rows[high]!.right * amount,
  };
}

const MASTER_SIZE = 192;
const MASTER_CONTENT_SIZE = 172;

interface PhotoHeadLayout {
  left: number;
  top: number;
  cropWidth: number;
  cropHeight: number;
  drawWidth: number;
  drawHeight: number;
  offsetX: number;
  offsetY: number;
}

function photoHeadLayout(geometry: PhotoHeadGeometry): PhotoHeadLayout {
  const box = geometry.headBox;
  const left = clamp(Math.floor((box.x / 1000) * PHOTO_HEAD_INPUT_SIZE), 0, PHOTO_HEAD_INPUT_SIZE - 1);
  const top = clamp(Math.floor((box.y / 1000) * PHOTO_HEAD_INPUT_SIZE), 0, PHOTO_HEAD_INPUT_SIZE - 1);
  const right = clamp(Math.ceil(((box.x + box.width) / 1000) * PHOTO_HEAD_INPUT_SIZE), left + 1, PHOTO_HEAD_INPUT_SIZE);
  const bottom = clamp(Math.ceil(((box.y + box.height) / 1000) * PHOTO_HEAD_INPUT_SIZE), top + 1, PHOTO_HEAD_INPUT_SIZE);
  const cropWidth = right - left;
  const cropHeight = bottom - top;
  const scale = Math.min(MASTER_CONTENT_SIZE / cropWidth, MASTER_CONTENT_SIZE / cropHeight);
  const drawWidth = Math.max(1, Math.round(cropWidth * scale));
  const drawHeight = Math.max(1, Math.round(cropHeight * scale));
  return {
    left,
    top,
    cropWidth,
    cropHeight,
    drawWidth,
    drawHeight,
    offsetX: Math.round((MASTER_SIZE - drawWidth) / 2),
    offsetY: Math.round((MASTER_SIZE - drawHeight) / 2),
  };
}

async function buildPhotoHeadMaster(
  normalizedPhoto: Buffer,
  features: NormalizedFaceFeatures,
  geometry: PhotoHeadGeometry,
): Promise<Buffer> {
  const { left, top, cropWidth, cropHeight, drawWidth, drawHeight, offsetX, offsetY } = photoHeadLayout(geometry);
  const { data } = await sharp(normalizedPhoto)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize(drawWidth, drawHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const neutralSkin = hexToRgb(features.skinTone, '#c98f6b');
  const neutralLuminance = luminance(neutralSkin);
  const faceLuminances: number[] = [];
  for (let y = 0; y < drawHeight; y++) {
    for (let x = 0; x < drawWidth; x++) {
      const globalX = ((left + ((x + 0.5) / drawWidth) * cropWidth) / PHOTO_HEAD_INPUT_SIZE) * 1000;
      const globalY = ((top + ((y + 0.5) / drawHeight) * cropHeight) / PHOTO_HEAD_INPUT_SIZE) * 1000;
      const faceX =
        (globalX - (geometry.faceBox.x + geometry.faceBox.width / 2)) /
        (geometry.faceBox.width * 0.54);
      const faceY =
        (globalY - (geometry.faceBox.y + geometry.faceBox.height / 2)) /
        (geometry.faceBox.height * 0.53);
      if (faceX * faceX + faceY * faceY > 1) continue;
      const source = (y * drawWidth + x) * 3;
      const color = { r: data[source]!, g: data[source + 1]!, b: data[source + 2]! };
      if (isSkinLike(color)) faceLuminances.push(luminance(color));
    }
  }
  faceLuminances.sort((a, b) => a - b);
  let faceToneMap: FaceToneMap | undefined;
  if (faceLuminances.length >= 20) {
    const at = (fraction: number): number =>
      faceLuminances[Math.min(faceLuminances.length - 1, Math.floor((faceLuminances.length - 1) * fraction))]!;
    const low = at(0.2);
    const median = at(0.5);
    const high = at(0.8);
    if (high - low >= 10) {
      const sourceSpread = high - low;
      const maximumSpread = clamp(neutralLuminance * 0.45, 42, 90);
      const targetSpread = Math.min(sourceSpread, maximumSpread);
      const targetMedian = median + clamp(neutralLuminance - median, -18, 24);
      const scale = clamp(targetSpread / sourceSpread, 0.55, 1.1);
      faceToneMap = { scale, offset: clamp(targetMedian - median * scale, -40, 60) };
    } else {
      faceToneMap = { scale: 1, offset: clamp(neutralLuminance - median, -18, 24) };
    }
  }

  const hull = new Uint8Array(drawWidth * drawHeight);
  const hullLeft = new Int16Array(drawHeight);
  const hullRight = new Int16Array(drawHeight);
  if (geometry.contourSource === 'local') {
    hull.fill(1);
    hullRight.fill(drawWidth - 1);
  } else {
    for (let y = 0; y < drawHeight; y++) {
      const span = interpolateSpan(geometry.rows, y, drawHeight);
      const spanLeft = clamp(Math.floor((span.left / 1000) * drawWidth), 0, drawWidth - 1);
      const spanRight = clamp(Math.ceil((span.right / 1000) * drawWidth), spanLeft, drawWidth - 1);
      hullLeft[y] = spanLeft;
      hullRight[y] = spanRight;
      for (let x = spanLeft; x <= spanRight; x++) hull[y * drawWidth + x] = 1;
    }
  }

  // Pixels outside Muse's hull are certain background samples from the same
  // crop and lighting. Model their colors, then flood only matching pixels that
  // connect back to that known exterior. A very-close-color fallback also
  // removes enclosed holes between curls. Semantic colors protect dark hair on
  // dark backdrops and skin on similarly colored walls.
  const samples: Rgb[] = [];
  const sampleBand = Math.max(3, Math.round(Math.min(drawWidth, drawHeight) * 0.07));
  for (let p = 0; p < hull.length; p += 2) {
    const x = p % drawWidth;
    const y = Math.floor(p / drawWidth);
    const localBorder =
      x < sampleBand || x >= drawWidth - sampleBand || y < sampleBand || y >= drawHeight - sampleBand;
    if (geometry.contourSource === 'local' ? !localBorder : hull[p]) continue;
    samples.push({ r: data[p * 3]!, g: data[p * 3 + 1]!, b: data[p * 3 + 2]! });
  }
  const backgrounds = clusterColors(samples, 8);
  const semanticColor = (value: string): Rgb | undefined =>
    value !== 'none' && /^#[0-9a-f]{6}$/i.test(value) ? hexToRgb(value) : undefined;
  const skinColor = semanticColor(features.skinTone);
  const hairColor = semanticColor(features.hairColor);
  const facialHairColor = semanticColor(features.facialHairColor);
  const headwearColor = semanticColor(features.headwearColor);
  const glassesColor = semanticColor(features.glassesColor);
  // A solid bald/short-haired/hat silhouette has no meaningful background
  // pockets inside it. Trust Muse's outer contour directly in those cases;
  // color-based subtraction can otherwise confuse pale skin with a light wall.
  const subtractInteriorBackground =
    features.topology.scalpHair.belowEars ||
    features.hairTexture === 'curly' ||
    features.hairTexture === 'coily';
  // Even a good 16-row contour is a few source pixels loose at the scalp,
  // ears, and chin. For solid silhouettes, clean only this narrow outer band.
  // That removes a photographed backdrop halo while making it impossible for
  // color matching to tunnel through a cheek, forehead, or pale eye interior.
  const boundaryRadius = Math.max(3, Math.round(Math.min(drawWidth, drawHeight) * 0.06));
  const nearHullBoundary = (x: number, y: number): boolean => {
    if (x - hullLeft[y]! <= boundaryRadius || hullRight[y]! - x <= boundaryRadius) return true;
    const from = Math.max(0, y - boundaryRadius);
    const to = Math.min(drawHeight - 1, y + boundaryRadius);
    if (from !== y - boundaryRadius || to !== y + boundaryRadius) return true;
    for (let yy = from; yy <= to; yy++) {
      if (x < hullLeft[yy]! || x > hullRight[yy]!) return true;
    }
    return false;
  };
  const candidate = new Uint8Array(hull.length);
  const confidentHole = new Uint8Array(hull.length);
  for (let p = 0; p < hull.length; p++) {
    if (!hull[p]) {
      candidate[p] = 1;
      continue;
    }
    if (!backgrounds.length) continue;
    const color = { r: data[p * 3]!, g: data[p * 3 + 1]!, b: data[p * 3 + 2]! };
    const backgroundDistance = Math.min(...backgrounds.map((background) => redmean(color, background)));
    const x = p % drawWidth;
    const y = Math.floor(p / drawWidth);
    const coreX = (x / drawWidth - 0.5) / 0.43;
    const coreY = (y / drawHeight - 0.52) / 0.52;
    const globalX = ((left + ((x + 0.5) / drawWidth) * cropWidth) / PHOTO_HEAD_INPUT_SIZE) * 1000;
    const globalY = ((top + ((y + 0.5) / drawHeight) * cropHeight) / PHOTO_HEAD_INPUT_SIZE) * 1000;
    const measuredFaceX =
      (globalX - (geometry.faceBox.x + geometry.faceBox.width / 2)) /
      (geometry.faceBox.width * 0.54);
    const measuredFaceY =
      (globalY - (geometry.faceBox.y + geometry.faceBox.height / 2)) /
      (geometry.faceBox.height * 0.53);
    const measuredFace = measuredFaceX * measuredFaceX + measuredFaceY * measuredFaceY <= 1;
    const faceCenterX = geometry.faceBox.x + geometry.faceBox.width / 2;
    const faceTop = geometry.faceBox.y;
    const faceBottom = geometry.faceBox.y + geometry.faceBox.height;
    const eyeLine = (geometry.landmarks.leftEye.y + geometry.landmarks.rightEye.y) / 2;
    const earCenterY = eyeLine + geometry.faceBox.height * 0.14;
    const earX = geometry.faceBox.width * 0.13;
    const earY = geometry.faceBox.height * 0.2;
    const inEllipse = (centerX: number, centerY: number, radiusX: number, radiusY: number): boolean => {
      const dx = (globalX - centerX) / Math.max(1, radiusX);
      const dy = (globalY - centerY) / Math.max(1, radiusY);
      return dx * dx + dy * dy <= 1;
    };
    const earMask =
      features.ears !== 'hidden' &&
      (inEllipse(geometry.faceBox.x, earCenterY, earX, earY) ||
        inEllipse(geometry.faceBox.x + geometry.faceBox.width, earCenterY, earX, earY));

    // Semantic colors are useful only inside the material's plausible region.
    // Protecting (for example) a white hat color over the entire crop also
    // protects a white wall, leaving a rectangular halo around the subject.
    const headwearBottom = faceTop + geometry.faceBox.height * 0.12;
    const headwearHeight = Math.max(20, headwearBottom - geometry.headBox.y);
    const headwearCenterY = geometry.headBox.y + headwearHeight / 2;
    const crownEllipse = inEllipse(
      faceCenterX,
      headwearCenterY,
      geometry.faceBox.width * 0.74,
      headwearHeight * 0.58,
    );
    const crownRectangle =
      Math.abs(globalX - faceCenterX) <= geometry.faceBox.width * 0.62 &&
      globalY >= geometry.headBox.y &&
      globalY <= headwearBottom;
    const billBand =
      features.topology.headwear.projection === 'front-bill' &&
      Math.abs(globalX - faceCenterX) <= geometry.faceBox.width * 0.9 &&
      globalY >= faceTop - geometry.faceBox.height * 0.1 &&
      globalY <= faceTop + geometry.faceBox.height * 0.08;
    const brimBand =
      features.topology.headwear.projection === 'full-brim' &&
      Math.abs(globalX - faceCenterX) <= geometry.faceBox.width * 1.15 &&
      globalY >= faceTop - geometry.faceBox.height * 0.12 &&
      globalY <= faceTop + geometry.faceBox.height * 0.08;
    const headwearMask =
      features.headwear &&
      (features.headwearType === 'topHat' ? crownRectangle || brimBand : crownEllipse || billBand || brimBand);

    const crownHairMask =
      features.topology.scalpHair.crown &&
      !features.headwear &&
      inEllipse(
        faceCenterX,
        faceTop + geometry.faceBox.height * 0.04,
        geometry.faceBox.width * 0.7,
        geometry.faceBox.height * 0.32,
      );
    const templeHairMask =
      features.topology.scalpHair.temples &&
      globalY >= faceTop - geometry.faceBox.height * 0.06 &&
      globalY <= faceBottom &&
      Math.abs(globalX - faceCenterX) >= geometry.faceBox.width * 0.32 &&
      Math.abs(globalX - faceCenterX) <= geometry.faceBox.width * 0.82;
    const belowEarHairMask =
      features.topology.scalpHair.belowEars &&
      globalY >= eyeLine - geometry.faceBox.height * 0.08 &&
      globalY <= geometry.headBox.y + geometry.headBox.height &&
      Math.abs(globalX - faceCenterX) >= geometry.faceBox.width * 0.3 &&
      Math.abs(globalX - faceCenterX) <= geometry.faceBox.width * 1.05;
    const hairMask = crownHairMask || templeHairMask || belowEarHairMask;
    const glassesMask =
      features.glasses &&
      globalY >= eyeLine - geometry.faceBox.height * 0.12 &&
      globalY <= eyeLine + geometry.faceBox.height * 0.12 &&
      Math.abs(globalX - faceCenterX) <= geometry.faceBox.width * 0.56;
    const facialHairMask =
      facialHairColor !== undefined &&
      globalY >= geometry.landmarks.noseTip.y &&
      globalY <= faceBottom &&
      Math.abs(globalX - faceCenterX) <= geometry.faceBox.width * 0.54;
    const spatialSemanticColors: Rgb[] = [];
    if ((measuredFace || earMask) && skinColor) spatialSemanticColors.push(skinColor);
    if (hairMask && hairColor) spatialSemanticColors.push(hairColor);
    if (headwearMask && headwearColor) spatialSemanticColors.push(headwearColor);
    if (facialHairMask && facialHairColor) spatialSemanticColors.push(facialHairColor);
    if (glassesMask && glassesColor) spatialSemanticColors.push(glassesColor);
    const semanticDistance = spatialSemanticColors.length
      ? Math.min(...spatialSemanticColors.map((semantic) => redmean(color, semantic)))
      : Infinity;
    const centralFace =
      measuredFace ||
      earMask ||
      (geometry.contourSource === 'muse' && coreX * coreX + coreY * coreY < 1);
    const maySubtract =
      geometry.contourSource === 'local'
        ? !centralFace
        : subtractInteriorBackground
          ? !centralFace
          : nearHullBoundary(x, y);
    // A scanline can occasionally cover a wholly empty top/bottom row. Let a
    // very strong background match form a path back to the exterior even away
    // from the narrow contour band. Unlike `confidentHole`, this cannot erase
    // an enclosed eye white or facial highlight because it still must flood in
    // from the outside, and semantic skin/hair/hat/frame colors stay protected.
    const strongConnectedBackground =
      (!centralFace && backgroundDistance < 24 && semanticDistance > 95) ||
      (backgroundDistance < 14 && semanticDistance > 120);
    if (
      strongConnectedBackground ||
      (maySubtract &&
        backgroundDistance < (geometry.contourSource === 'local' ? 40 : subtractInteriorBackground ? 32 : 50) &&
        semanticDistance > (geometry.contourSource === 'local' ? 55 : subtractInteriorBackground ? 70 : 52))
    ) {
      candidate[p] = 1;
    }
    // Strong global matches handle background pockets enclosed by curls. Never
    // apply that shortcut inside the central face, where a white wall can match
    // eye whites or teeth; those pixels are only removable by exterior flood.
    if (
      !centralFace &&
      !headwearMask &&
      !hairMask &&
      backgroundDistance < 24 &&
      semanticDistance > 90
    ) {
      confidentHole[p] = 1;
    }
  }

  const backgroundMask = new Uint8Array(hull.length);
  const queue: number[] = [];
  const enqueue = (pixel: number) => {
    if (pixel < 0 || pixel >= hull.length || backgroundMask[pixel] || !candidate[pixel]) return;
    backgroundMask[pixel] = 1;
    queue.push(pixel);
  };
  for (let x = 0; x < drawWidth; x++) {
    enqueue(x);
    enqueue((drawHeight - 1) * drawWidth + x);
  }
  for (let y = 0; y < drawHeight; y++) {
    enqueue(y * drawWidth);
    enqueue(y * drawWidth + drawWidth - 1);
  }
  for (let index = 0; index < queue.length; index++) {
    const pixel = queue[index]!;
    const x = pixel % drawWidth;
    const y = Math.floor(pixel / drawWidth);
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < drawWidth) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - drawWidth);
    if (y + 1 < drawHeight) enqueue(pixel + drawWidth);
  }

  const rgba = Buffer.alloc(MASTER_SIZE * MASTER_SIZE * 4);
  for (let y = 0; y < drawHeight; y++) {
    for (let x = 0; x < drawWidth; x++) {
      const sourcePixel = y * drawWidth + x;
      if (!hull[sourcePixel] || backgroundMask[sourcePixel] || confidentHole[sourcePixel]) continue;
      const source = sourcePixel * 3;
      const target = ((offsetY + y) * MASTER_SIZE + offsetX + x) * 4;
      let color = { r: data[source]!, g: data[source + 1]!, b: data[source + 2]! };
      const globalX = ((left + ((x + 0.5) / drawWidth) * cropWidth) / PHOTO_HEAD_INPUT_SIZE) * 1000;
      const globalY = ((top + ((y + 0.5) / drawHeight) * cropHeight) / PHOTO_HEAD_INPUT_SIZE) * 1000;
      const faceX =
        (globalX - (geometry.faceBox.x + geometry.faceBox.width / 2)) /
        (geometry.faceBox.width * 0.54);
      const faceY =
        (globalY - (geometry.faceBox.y + geometry.faceBox.height / 2)) /
        (geometry.faceBox.height * 0.53);
      if (faceX * faceX + faceY * faceY <= 1) {
        color = normalizeSkinLighting(color, neutralSkin, faceToneMap);
      }
      rgba[target] = color.r;
      rgba[target + 1] = color.g;
      rgba[target + 2] = color.b;
      rgba[target + 3] = 255;
    }
  }
  return sharp(rgba, { raw: { width: MASTER_SIZE, height: MASTER_SIZE, channels: 4 } })
    .modulate({ saturation: 1.04, brightness: 1.01 })
    .png()
    .toBuffer();
}

interface NativePoint {
  x: number;
  y: number;
}

function mapImagePoint(point: PhotoHeadPoint, layout: PhotoHeadLayout, size: number): NativePoint {
  const sourceX = (point.x / 1000) * PHOTO_HEAD_INPUT_SIZE;
  const sourceY = (point.y / 1000) * PHOTO_HEAD_INPUT_SIZE;
  return {
    x: Math.round(
      (layout.offsetX + ((sourceX - layout.left) / layout.cropWidth) * layout.drawWidth) *
        (size / MASTER_SIZE),
    ),
    y: Math.round(
      (layout.offsetY + ((sourceY - layout.top) / layout.cropHeight) * layout.drawHeight) *
        (size / MASTER_SIZE),
    ),
  };
}

function darken(color: Rgb, amount: number): Rgb {
  return {
    r: Math.round(color.r * amount),
    g: Math.round(color.g * amount),
    b: Math.round(color.b * amount),
  };
}

/**
 * Reinforce only Muse-observed high-signal topology at the final native grid.
 * Source pixels remain the base artwork; these sparse landmark-anchored marks
 * keep downsampling from erasing pupils, a moustache, or the two-lens structure
 * of glasses. No feature is synthesized unless Muse explicitly reported it.
 */
function refineNativeFeatures(
  source: Buffer,
  evidence: Buffer,
  size: number,
  features: NormalizedFaceFeatures,
  geometry: PhotoHeadGeometry,
): Buffer {
  const result = Buffer.from(source);
  const layout = photoHeadLayout(geometry);
  const landmark = Object.fromEntries(
    Object.entries(geometry.landmarks).map(([name, point]) => [name, mapImagePoint(point, layout, size)]),
  ) as unknown as Record<keyof PhotoHeadGeometry['landmarks'], NativePoint>;
  const faceTopLeft = mapImagePoint({ x: geometry.faceBox.x, y: geometry.faceBox.y }, layout, size);
  const faceBottomRight = mapImagePoint(
    { x: geometry.faceBox.x + geometry.faceBox.width, y: geometry.faceBox.y + geometry.faceBox.height },
    layout,
    size,
  );
  const faceLeft = clamp(Math.min(faceTopLeft.x, faceBottomRight.x), 0, size - 1);
  const faceRight = clamp(Math.max(faceTopLeft.x, faceBottomRight.x), 0, size - 1);
  const faceTop = clamp(Math.min(faceTopLeft.y, faceBottomRight.y), 0, size - 1);
  const faceBottom = clamp(Math.max(faceTopLeft.y, faceBottomRight.y), 0, size - 1);
  const opaque = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < size && y < size && source[(y * size + x) * 4 + 3]! >= 110;
  const evidenced = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < size && y < size && evidence[(y * size + x) * 4 + 3]! >= 110;
  const blendPixel = (x: number, y: number, color: Rgb, amount: number): void => {
    x = Math.round(x);
    y = Math.round(y);
    if (!opaque(x, y)) return;
    const offset = (y * size + x) * 4;
    result[offset] = Math.round(result[offset]! * (1 - amount) + color.r * amount);
    result[offset + 1] = Math.round(result[offset + 1]! * (1 - amount) + color.g * amount);
    result[offset + 2] = Math.round(result[offset + 2]! * (1 - amount) + color.b * amount);
    result[offset + 3] = 255;
  };
  const rowSpan = (y: number): [number, number] | undefined => {
    let left = Math.ceil(faceLeft);
    let right = Math.floor(faceRight);
    while (left <= right && !opaque(left, y)) left++;
    while (right >= left && !opaque(right, y)) right--;
    return left <= right ? [left, right] : undefined;
  };

  const palette = buildPortraitPalette(features);
  const featureDark = hexToRgb(palette[10]!, '#1b1622');
  const lip = hexToRgb(palette[9]!, '#8f4055');
  const eyeSeparation = Math.max(2, landmark.rightEye.x - landmark.leftEye.x);

  // Pupils are true measured points, not generic symmetric dots. They are
  // added last for glasses so clear lenses never turn into a filled visor.
  const drawPupils = (): void => {
    blendPixel(landmark.leftEye.x, landmark.leftEye.y, featureDark, size <= 16 ? 0.76 : 0.94);
    blendPixel(landmark.rightEye.x, landmark.rightEye.y, featureDark, size <= 16 ? 0.76 : 0.94);
  };

  if (features.glasses) {
    const frame = darken(hexToRgb(features.glassesColor, '#25232a'), 0.86);
    const skin = hexToRgb(features.skinTone, '#c98f6b');
    const topology = features.topology.glasses;
    const halfWidth = Math.max(2, Math.round(eyeSeparation * (topology.lensShape === 'round' ? 0.33 : 0.38)));
    const halfHeight = Math.max(1, Math.round(halfWidth * (topology.lensShape === 'rectangular' ? 0.55 : 0.72)));
    const index = size <= 20 ? 0 : size <= 24 ? 1 : 2;
    const frameLimit = topology.frame === 'rimless'
      ? [1, 1, 2][index]!
      : topology.frame === 'thin'
        ? [2, 3, 4][index]!
        : [3, 4, 5][index]!;
    const rankedFrameEvidence = (points: NativePoint[]): Array<NativePoint & { score: number }> => {
      const seen = new Set<number>();
      return points.flatMap((point) => {
        const x = Math.round(point.x);
        const y = Math.round(point.y);
        const key = y * size + x;
        if (seen.has(key) || !opaque(x, y) || !evidenced(x, y)) return [];
        seen.add(key);
        const offset = key * 4;
        const observed = { r: evidence[offset]!, g: evidence[offset + 1]!, b: evidence[offset + 2]! };
        const frameDistance = redmean(observed, frame);
        const skinDistance = redmean(observed, skin);
        const advantage = skinDistance - frameDistance;
        return frameDistance < 105 && advantage > 8
          ? [{ x, y, score: advantage - frameDistance * 0.08 }]
          : [];
      }).sort((a, b) => b.score - a.score);
    };
    const midpoint = Math.round((landmark.leftEye.x + landmark.rightEye.x) / 2);
    if (topology.lensTint === 'clear') {
      const lensInterior = scaleRgb(skin, 1.04);
      for (const center of [landmark.leftEye, landmark.rightEye]) {
        // Downsampling can merge a clear frame's top and bottom edges into one
        // visor-like bar. Restore two tiny openings from the measured eye
        // centers before reapplying evidenced frame pixels and pupils.
        blendPixel(center.x - 1, center.y, lensInterior, size <= 16 ? 0.42 : 0.68);
        blendPixel(center.x + 1, center.y, lensInterior, size <= 16 ? 0.42 : 0.68);
        if (size >= 28) blendPixel(center.x, center.y + 1, lensInterior, 0.48);
      }
    }
    for (const [lensIndex, center] of [landmark.leftEye, landmark.rightEye].entries()) {
      const points: NativePoint[] = [];
      for (let y = center.y - halfHeight; y <= center.y + halfHeight; y++) {
        for (let x = center.x - halfWidth; x <= center.x + halfWidth; x++) {
          if (x === center.x && y === center.y) continue; // pupil, not frame
          if (lensIndex === 0 ? x >= midpoint : x <= midpoint) continue;
          points.push({ x, y });
        }
      }
      for (const point of rankedFrameEvidence(points).slice(0, frameLimit)) {
        blendPixel(point.x, point.y, frame, topology.frame === 'rimless' ? 0.54 : 0.88);
      }
    }
    const bridgeY = Math.round((landmark.leftEye.y + landmark.rightEye.y) / 2);
    const bridge = rankedFrameEvidence([
      { x: midpoint, y: bridgeY - 1 },
      { x: midpoint, y: bridgeY },
      { x: midpoint, y: bridgeY + 1 },
    ])[0];
    if (bridge) blendPixel(bridge.x, bridge.y, frame, 0.72);
  }
  drawPupils();

  const facialTopology = features.topology.facialHair;
  const hasFacialHair = Object.values(facialTopology).some((density) => density !== 'none');
  if (hasFacialHair && features.facialHairColor !== 'none') {
    const reportedHair = hexToRgb(features.facialHairColor, '#493a32');
    const hair = darken(reportedHair, 0.7);
    const skin = hexToRgb(features.skinTone, '#c98f6b');
    const sizeIndex = size <= 16 ? 0 : size <= 20 ? 1 : size <= 24 ? 2 : 3;
    const caps = {
      upperLip: { stubble: [1, 2, 3, 4], solid: [2, 3, 4, 5] },
      chin: { stubble: [1, 1, 2, 2], solid: [2, 2, 3, 4] },
      jaw: { stubble: [0, 1, 1, 2], solid: [1, 2, 3, 4] },
      cheeks: { stubble: [0, 0, 1, 1], solid: [0, 1, 2, 3] },
    } as const;
    const quota = (region: keyof typeof caps, density: HairRegion): number =>
      density === 'none' ? 0 : caps[region][density][sizeIndex]!;
    const paintBestEvidence = (
      candidates: NativePoint[],
      density: HairRegion,
      limit: number,
    ): void => {
      if (density === 'none' || limit <= 0) return;
      const seen = new Set<number>();
      const ranked = candidates.flatMap((point) => {
        const x = Math.round(point.x);
        const y = Math.round(point.y);
        const key = y * size + x;
        if (seen.has(key) || !opaque(x, y) || !evidenced(x, y)) return [];
        seen.add(key);
        const offset = key * 4;
        const observed = { r: evidence[offset]!, g: evidence[offset + 1]!, b: evidence[offset + 2]! };
        const hairDistance = redmean(observed, reportedHair);
        const skinDistance = redmean(observed, skin);
        const advantage = skinDistance - hairDistance;
        const threshold = density === 'stubble' ? 8 : -4;
        return hairDistance < 108 && advantage > threshold
          ? [{ x, y, score: advantage - hairDistance * 0.12 }]
          : [];
      }).sort((a, b) => b.score - a.score);
      for (const point of ranked.slice(0, limit)) {
        blendPixel(point.x, point.y, hair, density === 'solid' ? 0.7 : 0.5);
      }
    };

    const faceWidth = Math.max(1, faceRight - faceLeft + 1);
    const faceHeight = Math.max(1, faceBottom - faceTop + 1);
    const moustacheY = clamp(
      Math.round(landmark.mouthCenter.y - (landmark.mouthCenter.y - landmark.noseTip.y) * 0.32),
      faceTop,
      faceBottom,
    );
    const moustacheHalfWidth = Math.max(1, Math.round(faceWidth * 0.22));
    const moustacheHalfHeight = Math.max(0, Math.round(faceHeight * 0.045));
    const moustacheCandidates: NativePoint[] = [];
    for (let y = moustacheY - moustacheHalfHeight; y <= moustacheY + moustacheHalfHeight; y++) {
      for (let x = landmark.mouthCenter.x - moustacheHalfWidth; x <= landmark.mouthCenter.x + moustacheHalfWidth; x++) {
        moustacheCandidates.push({ x, y });
      }
    }
    paintBestEvidence(
      moustacheCandidates,
      facialTopology.upperLip,
      quota('upperLip', facialTopology.upperLip),
    );

    const beardSpan = Math.max(1, landmark.chin.y - landmark.mouthCenter.y);
    const lowerStart = clamp(Math.round(landmark.mouthCenter.y + beardSpan * 0.15), faceTop, faceBottom);
    const lowerEnd = clamp(landmark.chin.y, lowerStart, faceBottom);
    const leftJaw: NativePoint[] = [];
    const rightJaw: NativePoint[] = [];
    const chinCandidates: NativePoint[] = [];
    for (let y = lowerStart; y <= lowerEnd; y++) {
      const span = rowSpan(y);
      if (!span) continue;
      const [left, right] = span;
      const width = right - left + 1;
      const jawThickness = Math.max(1, Math.round(faceWidth * 0.1));
      for (let inset = 0; inset < jawThickness; inset++) {
        leftJaw.push({ x: left + inset, y });
        rightJaw.push({ x: right - inset, y });
      }
      if (y >= landmark.mouthCenter.y + beardSpan * 0.35) {
        const chinHalfWidth = Math.max(1, Math.round(width * 0.18));
        const center = Math.round((left + right) / 2);
        for (let x = center - chinHalfWidth; x <= center + chinHalfWidth; x++) {
          chinCandidates.push({ x, y });
        }
      }
    }
    paintBestEvidence(leftJaw, facialTopology.jaw, quota('jaw', facialTopology.jaw));
    paintBestEvidence(rightJaw, facialTopology.jaw, quota('jaw', facialTopology.jaw));
    paintBestEvidence(chinCandidates, facialTopology.chin, quota('chin', facialTopology.chin));

    const cheekStart = clamp(
      Math.round(landmark.noseTip.y + (landmark.mouthCenter.y - landmark.noseTip.y) * 0.35),
      faceTop,
      landmark.mouthCenter.y,
    );
    const cheekEnd = clamp(
      Math.round(landmark.mouthCenter.y + beardSpan * 0.35),
      cheekStart,
      faceBottom,
    );
    const leftCheek: NativePoint[] = [];
    const rightCheek: NativePoint[] = [];
    for (let y = cheekStart; y <= cheekEnd; y++) {
      const span = rowSpan(y);
      if (!span) continue;
      const [left, right] = span;
      const strip = Math.max(1, Math.round(faceWidth * 0.13));
      for (let inset = 0; inset < strip; inset++) {
        leftCheek.push({ x: left + inset, y });
        rightCheek.push({ x: right - inset, y });
      }
    }
    paintBestEvidence(leftCheek, facialTopology.cheeks, quota('cheeks', facialTopology.cheeks));
    paintBestEvidence(rightCheek, facialTopology.cheeks, quota('cheeks', facialTopology.cheeks));
  }

  // Reassert a small lip break after the upper-lip hair mark. This is measured
  // at Muse's mouth landmark and prevents beard/moustache pixels merging into a
  // single dark block.
  if (size >= 20) {
    blendPixel(landmark.mouthCenter.x, landmark.mouthCenter.y, lip, 0.48);
    if (eyeSeparation >= 5) blendPixel(landmark.mouthCenter.x - 1, landmark.mouthCenter.y, lip, 0.32);
  }

  return result;
}

function addOutsideOutline(raw: Buffer, size: number, outline: Rgb): Buffer {
  const result = Buffer.from(raw);
  const opaque = (pixel: number) => raw[pixel * 4 + 3]! >= 110;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pixel = y * size + x;
      if (opaque(pixel)) {
        result[pixel * 4 + 3] = 255;
        continue;
      }
      let edge = false;
      for (let oy = -1; oy <= 1 && !edge; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const xx = x + ox;
          const yy = y + oy;
          if (xx >= 0 && yy >= 0 && xx < size && yy < size && opaque(yy * size + xx)) {
            edge = true;
            break;
          }
        }
      }
      result[pixel * 4] = edge ? outline.r : 0;
      result[pixel * 4 + 1] = edge ? outline.g : 0;
      result[pixel * 4 + 2] = edge ? outline.b : 0;
      result[pixel * 4 + 3] = edge ? 255 : 0;
    }
  }
  return result;
}

export async function renderPhotoHeadSprites(
  normalizedPhoto: Buffer,
  featuresInput: FaceFeatures,
  geometryInput: PhotoHeadGeometry,
  sizes: readonly PhotoHeadSize[] = PHOTO_HEAD_SIZES,
): Promise<Record<string, Buffer>> {
  const metadata = await sharp(normalizedPhoto).metadata();
  if (metadata.width !== PHOTO_HEAD_INPUT_SIZE || metadata.height !== PHOTO_HEAD_INPUT_SIZE) {
    throw new Error(`photo-head renderer requires the exact ${PHOTO_HEAD_INPUT_SIZE}x${PHOTO_HEAD_INPUT_SIZE} normalized input`);
  }
  const features = normalizeFaceFeatures(featuresInput);
  const geometry = normalizePhotoHeadGeometry(geometryInput);
  const master = await buildPhotoHeadMaster(normalizedPhoto, features, geometry);
  const outline = hexToRgb(buildPortraitPalette(features)[1]!);
  const entries = await Promise.all(
    sizes.map(async (size) => {
      const { data } = await sharp(master)
        .resize(size, size, { kernel: sharp.kernel.mks2021 })
        .sharpen({ sigma: 0.55, m1: 0.7, m2: 1.2 })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const outlined = addOutsideOutline(data, size, outline);
      const quantizedPng = await sharp(outlined, { raw: { width: size, height: size, channels: 4 } })
        .png({ palette: true, colours: size <= 16 ? 12 : 16, dither: 0 })
        .toBuffer();
      const { data: quantized } = await sharp(quantizedPng)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      // Palette reduction happens first; otherwise the few pixels carrying a
      // frame bridge or moustache can be discarded as statistically rare.
      const refined = refineNativeFeatures(quantized, data, size, features, geometry);
      const png = await sharp(refined, { raw: { width: size, height: size, channels: 4 } })
        .png()
        .toBuffer();
      return [String(size), png] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export async function generatePhotoHeadLikeness(
  photo: Buffer,
  featuresInput: FaceFeatures,
  provider: Provider,
  model: string,
  sizes: readonly PhotoHeadSize[] = PHOTO_HEAD_SIZES,
): Promise<PhotoHeadLikeness> {
  if (!provider.capabilities.imageIn) throw new Error('the configured provider does not support image input');
  const normalizedPhoto = await normalizePhotoHeadInput(photo);
  const prompt = buildPhotoHeadPrompt();
  const response = await provider.complete(
    {
      system: prompt.system,
      user: prompt.user,
      maxTokens: prompt.maxTokens,
      temperature: 0,
      effort: 'minimal',
      jsonSchema: prompt.jsonSchema,
      image: normalizedPhoto,
      timeoutMs: 120_000,
    },
    { model },
  );
  const document = parsePhotoHeadDocument(response.text, featuresInput);
  const pngs = await renderPhotoHeadSprites(normalizedPhoto, document.features, document.geometry, sizes);
  return { ...document, pngs, usage: response.usage };
}
