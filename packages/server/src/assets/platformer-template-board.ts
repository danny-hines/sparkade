// Experimental template-board recipe for platformer player poses. Pose truth
// comes from pixels (a two-tone mannequin per cell) instead of prose, and the
// identity truth is a single reference cell on the same board, because Muse
// Image edits accept exactly one input image. Lab-only: production generation
// does not import this module.
import sharp, { type OverlayOptions } from 'sharp';
import {
  FIGHTER_POSE_SHEET_SIZE,
  fighterPoseSheetCellRect,
  segmentGeneratedFighterPoseSheet,
  type FighterPoseSheetCellRect,
  type FighterPoseSheetSegmentationMetrics,
} from './fighter-pose-sheet';
import { maskGeneratedFighterPose, type FighterPoseImageMetrics } from './fighter-pose';
import {
  GENERATED_PLATFORMER_POSE_HEIGHT,
  PLATFORMER_RUN_LOWER_BODY_TOP,
  processGeneratedPlatformerPose,
} from './platformer-pose';

// v2: live v1 boards kept gray mannequin bodies under a new head on 7/18
// boards, and dressed boards lost the A/B leg depth (Spark: no visible swap).
// v3: the template description and dressing rule follow the template style.
export const PLATFORMER_TEMPLATE_BOARD_PROMPT_VERSION = 'platformer-template-board-v3';
export const PLATFORMER_TEMPLATE_MANNEQUIN_VERSION = 'platformer-mannequin-v2';

/** `volume` is a filled two-tone mannequin; `outline` draws the same parts as
 * hollow line art; `skeleton` is a stick figure. All share one pose geometry. */
export const PLATFORMER_TEMPLATE_STYLES = ['volume', 'outline', 'skeleton'] as const;
export type PlatformerTemplateStyle = (typeof PLATFORMER_TEMPLATE_STYLES)[number];

/** Board cells 2-6 in row-major order. `runPass` is not a production pose; it
 * probes whether templates can extend the two-contact gait into a cycle. */
export const PLATFORMER_TEMPLATE_POSES = ['sideIdle', 'walk1', 'walk2', 'jump', 'runPass'] as const;
export type PlatformerTemplatePose = (typeof PLATFORMER_TEMPLATE_POSES)[number];

const POSE_CONTRACT: Record<PlatformerTemplatePose, string> = {
  sideIdle:
    'neutral standing side idle facing RIGHT, upright torso, both feet planted beneath the hips, arms relaxed at the sides',
  walk1:
    'running contact A facing RIGHT: the camera-side (near) leg reaches forward to the right, the far leg pushes back to the left, the far arm swings forward and the near arm swings back',
  walk2:
    'running contact B facing RIGHT, the exact inverse of cell 3: the far leg reaches forward to the right, the camera-side (near) leg pushes back to the left, the near arm swings forward and the far arm swings back',
  jump: 'airborne jump facing RIGHT: both feet off the ground, the near knee raised forward, the far leg trailing bent behind, one arm reaching forward-up and the other balancing back',
  runPass:
    'running passing pose facing RIGHT: the camera-side (near) leg supports the body directly under the hips while the far knee drives forward and high, both elbows bent close to the body',
};

interface LimbPose {
  /** Absolute segment angles in degrees: 0 points straight down and positive
   * rotates toward the facing direction (screen right). Foot 90 is level. */
  thigh: number;
  shin: number;
  foot: number;
  upperArm: number;
  forearm: number;
}

interface MannequinPose {
  /** Torso lean in degrees forward of vertical. */
  lean: number;
  /** Airborne clearance as a fraction of standing height. */
  lift: number;
  near: LimbPose;
  far: LimbPose;
}

const CONTACT_FORWARD: LimbPose = { thigh: 30, shin: 10, foot: 100, upperArm: -40, forearm: 30 };
const CONTACT_BACK: LimbPose = { thigh: -30, shin: -45, foot: 30, upperArm: 42, forearm: 105 };

const MANNEQUIN_POSES: Record<PlatformerTemplatePose, MannequinPose> = {
  sideIdle: {
    lean: 0,
    lift: 0,
    near: { thigh: 3, shin: 0, foot: 90, upperArm: 4, forearm: 10 },
    far: { thigh: -5, shin: -3, foot: 90, upperArm: -6, forearm: 4 },
  },
  walk1: { lean: 10, lift: 0, near: CONTACT_FORWARD, far: CONTACT_BACK },
  // The inverse contact: each limb pair swaps depth, so the arm opposite the
  // leading leg still swings forward.
  walk2: { lean: 10, lift: 0, near: CONTACT_BACK, far: CONTACT_FORWARD },
  jump: {
    lean: 8,
    lift: 0.1,
    near: { thigh: 62, shin: 2, foot: 100, upperArm: 115, forearm: 150 },
    far: { thigh: -18, shin: -55, foot: 40, upperArm: -65, forearm: -35 },
  },
  runPass: {
    lean: 8,
    lift: 0,
    near: { thigh: 5, shin: -5, foot: 90, upperArm: -5, forearm: 70 },
    far: { thigh: 50, shin: -40, foot: 60, upperArm: 10, forearm: 80 },
  },
};

// Segment lengths and thicknesses in standing-height units (~5 heads tall,
// close to the generated SNES-style player proportions).
const BODY = {
  thigh: 0.215,
  shin: 0.215,
  foot: 0.085,
  torso: 0.29,
  neck: 0.025,
  headRadius: 0.105,
  upperArm: 0.15,
  forearm: 0.14,
  handRadius: 0.035,
  torsoWidth: 0.135,
  thighWidth: 0.075,
  shinWidth: 0.06,
  footWidth: 0.045,
  upperArmWidth: 0.055,
  forearmWidth: 0.05,
};

type Layer = 'far' | 'body' | 'near';

/** Per style: the color of each depth layer and of the dark accents. Volume
 * lights the near side like a lit figure; line styles follow the drawing
 * convention of dark near lines and pale far lines. */
const STYLE_COLORS: Record<PlatformerTemplateStyle, Record<Layer | 'outline', string>> = {
  volume: { far: '#59606b', body: '#8f98a3', near: '#c9d0d8', outline: '#23272e' },
  outline: { far: '#a3acb9', body: '#1f2430', near: '#1f2430', outline: '#1f2430' },
  skeleton: { far: '#a3acb9', body: '#4a5262', near: '#1f2a44', outline: '#1f2a44' },
};
const KEY_GREEN = '#00ff00';
/** Skeleton line and joint sizes in standing-height units. */
const SKELETON = { limb: 0.03, spine: 0.04, joint: 0.024, hand: 0.03 };

type Point = { x: number; y: number };

interface Capsule {
  from: Point;
  to: Point;
  width: number;
  layer: Layer;
  /** Knee and elbow ends get a joint dot in the skeleton style. */
  joint?: boolean;
}

interface Disc {
  center: Point;
  radius: number;
  layer: Layer;
}

type Part = Capsule | Disc;

const radians = (degrees: number): number => (degrees * Math.PI) / 180;
/** World space is y-up; angle 0 points down, positive rotates toward +x. */
const down = (from: Point, length: number, angle: number): Point => ({
  x: from.x + length * Math.sin(radians(angle)),
  y: from.y - length * Math.cos(radians(angle)),
});
const up = (from: Point, length: number, angle: number): Point => ({
  x: from.x + length * Math.sin(radians(angle)),
  y: from.y + length * Math.cos(radians(angle)),
});

function mannequinParts(pose: MannequinPose, build: number): { parts: Part[]; head: Disc } {
  const limbBuild = Math.sqrt(build);
  const hip: Point = { x: 0, y: 0 };
  const shoulder = up(hip, BODY.torso - 0.02, pose.lean);
  const neckTop = up(hip, BODY.torso + BODY.neck, pose.lean);
  const head = up(neckTop, BODY.headRadius, pose.lean * 0.5);
  const leg = (limbs: LimbPose, layer: Layer): Part[] => {
    const knee = down(hip, BODY.thigh, limbs.thigh);
    const ankle = down(knee, BODY.shin, limbs.shin);
    const toe = down(ankle, BODY.foot, limbs.foot);
    return [
      { from: hip, to: knee, width: BODY.thighWidth * limbBuild, layer, joint: true },
      { from: knee, to: ankle, width: BODY.shinWidth * limbBuild, layer },
      { from: ankle, to: toe, width: BODY.footWidth * limbBuild, layer },
    ];
  };
  const arm = (limbs: LimbPose, layer: Layer): Part[] => {
    const elbow = down(shoulder, BODY.upperArm, limbs.upperArm);
    const wrist = down(elbow, BODY.forearm, limbs.forearm);
    return [
      { from: shoulder, to: elbow, width: BODY.upperArmWidth * limbBuild, layer, joint: true },
      { from: elbow, to: wrist, width: BODY.forearmWidth * limbBuild, layer },
      { center: wrist, radius: BODY.handRadius * limbBuild, layer },
    ];
  };
  const headDisc: Disc = { center: head, radius: BODY.headRadius, layer: 'body' };
  // Painter's order doubles as the depth code the prompt describes.
  return {
    parts: [
      ...arm(pose.far, 'far'),
      ...leg(pose.far, 'far'),
      { from: hip, to: shoulder, width: BODY.torsoWidth * build, layer: 'body' },
      headDisc,
      ...leg(pose.near, 'near'),
      ...arm(pose.near, 'near'),
    ],
    head: headDisc,
  };
}

function partBounds(parts: readonly Part[]): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  let left = Infinity;
  let right = -Infinity;
  let top = -Infinity;
  let bottom = Infinity;
  for (const part of parts) {
    const points = 'center' in part ? [part.center] : [part.from, part.to];
    const radius = 'center' in part ? part.radius : part.width / 2;
    for (const point of points) {
      left = Math.min(left, point.x - radius);
      right = Math.max(right, point.x + radius);
      top = Math.max(top, point.y + radius);
      bottom = Math.min(bottom, point.y - radius);
    }
  }
  return { left, right, top, bottom };
}

export interface PlatformerMannequin {
  /** Native-scale crisp RGBA sprite, cropped to the figure. */
  png: Buffer;
  /** Pixels between the figure's lowest point and the shared ground line. */
  lift: number;
}

/** SVG for one mannequin pose; `px` maps standing-height units to pixels. */
function mannequinSvg(input: {
  parts: Part[];
  head: Disc;
  style: PlatformerTemplateStyle;
  colors: Record<Layer | 'outline', string>;
  scale: number;
  outline: number;
  px: (point: Point) => Point;
  width: number;
  height: number;
}): string {
  const { parts, head, style, colors, scale, outline, px } = input;
  const circle = (center: Point, radius: number, fill: string): string => {
    const c = px(center);
    return `<circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${(radius * scale).toFixed(2)}" fill="${fill}"/>`;
  };
  const line = (from: Point, to: Point, width: number, stroke: string): string => {
    const a = px(from);
    const b = px(to);
    return `<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}" stroke="${stroke}" stroke-width="${(width * scale).toFixed(2)}" stroke-linecap="round"/>`;
  };
  const shape = (part: Part, extra: number, fill: string): string =>
    'center' in part
      ? circle(part.center, part.radius + extra, fill)
      : line(part.from, part.to, part.width + extra * 2, fill);
  // Volume and outline draw each part's border immediately beneath its fill,
  // so a near limb keeps a separating contour where it crosses the torso. The
  // outline style fills with key green, leaving hollow line art on the board.
  const body =
    style === 'skeleton'
      ? parts.map((part) => {
          const color = colors[part.layer];
          if ('center' in part)
            return part === head
              ? circle(part.center, part.radius, colors.body)
              : circle(part.center, SKELETON.hand, color);
          const width = part.layer === 'body' ? SKELETON.spine : SKELETON.limb;
          return (
            line(part.from, part.to, width, color) +
            (part.joint ? circle(part.to, SKELETON.joint, color) : '')
          );
        })
      : parts.map(
          (part) =>
            shape(part, outline, style === 'outline' ? colors[part.layer] : colors.outline) +
            shape(part, 0, style === 'outline' ? KEY_GREEN : colors[part.layer]),
        );
  const eye = px({ x: head.center.x + head.radius * 0.5, y: head.center.y + head.radius * 0.15 });
  const nose = px({ x: head.center.x + head.radius * 0.95, y: head.center.y - head.radius * 0.1 });
  const noseFill = style === 'outline' ? KEY_GREEN : colors.body;
  const eyeFill = style === 'skeleton' ? '#ffffff' : colors.outline;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" shape-rendering="crispEdges">${body.join('')}<circle cx="${nose.x.toFixed(2)}" cy="${nose.y.toFixed(2)}" r="${(BODY.headRadius * 0.28 * scale).toFixed(2)}" fill="${noseFill}" stroke="${colors.outline}" stroke-width="1"/><rect x="${Math.round(eye.x)}" y="${Math.round(eye.y)}" width="${Math.max(1, Math.round(scale * 0.02))}" height="${Math.max(2, Math.round(scale * 0.035))}" fill="${eyeFill}"/></svg>`;
}

/** Hard alpha keeps the mannequin in the same crisp pixel language as the
 * upscaled identity cell, whatever the SVG rasterizer's antialiasing does. */
async function rasterizeMannequin(svg: string, trim: boolean): Promise<Buffer> {
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let offset = 3; offset < data.length; offset += 4)
    data[offset] = data[offset]! >= 128 ? 255 : 0;
  const image = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  return (trim ? image.trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 }) : image)
    .png()
    .toBuffer();
}

/** Units-to-pixels scale that makes the standing volume side idle `height` tall. */
function mannequinScale(height: number, build: number): number {
  const standing = partBounds(mannequinParts(MANNEQUIN_POSES.sideIdle, build).parts);
  return height / (standing.top - standing.bottom);
}

/** Draw one side-view template at native sprite scale. The standing volume
 * side idle defines the units-to-pixels scale for every pose and style, so a
 * crouched stride stays smaller than the idle exactly as the body would. */
export async function renderPlatformerMannequin(
  pose: PlatformerTemplatePose,
  options: { height: number; build?: number; style?: PlatformerTemplateStyle },
): Promise<PlatformerMannequin> {
  const build = options.build ?? 1;
  const style = options.style ?? 'volume';
  const scale = mannequinScale(options.height, build);
  const { parts, head } = mannequinParts(MANNEQUIN_POSES[pose], build);
  const bounds = partBounds(parts);
  const outline = 1 / scale;
  const pad = 2;
  const width = Math.ceil((bounds.right - bounds.left + outline * 2) * scale) + pad * 2;
  const height = Math.ceil((bounds.top - bounds.bottom + outline * 2) * scale) + pad * 2;
  const px = (point: Point): Point => ({
    x: (point.x - bounds.left + outline) * scale + pad,
    y: (bounds.top - point.y + outline) * scale + pad,
  });
  const svg = mannequinSvg({
    parts,
    head,
    style,
    colors: STYLE_COLORS[style],
    scale,
    outline,
    px,
    width,
    height,
  });
  return {
    png: await rasterizeMannequin(svg, true),
    lift: Math.round(MANNEQUIN_POSES[pose].lift * options.height),
  };
}

export const PLATFORMER_CYCLE_MANNEQUIN_VERSION = 'platformer-cycle-mannequin-v1';
/** Label color for far limbs on cycle boards; matches the video script. */
const CYCLE_FAR_MAGENTA = '#d936e6';

/** Hand-posed eight-phase run cycle starting at the near leg's contact:
 * contact, down, passing, and up for the near leg, then the same for the far
 * leg. Arms swing opposite the legs; the body leaves the ground at "up". */
const CYCLE_HALF: Array<Omit<MannequinPose, 'near' | 'far'> & { lead: LimbPose; trail: LimbPose }> =
  [
    // Contact: the lead leg plants ahead and the trail leg stretches back.
    { lean: 10, lift: 0, lead: CONTACT_FORWARD, trail: CONTACT_BACK },
    // Down: the lead knee bends under the body; the trail foot lifts behind.
    {
      lean: 13,
      lift: 0,
      lead: { thigh: 12, shin: -12, foot: 90, upperArm: -22, forearm: 45 },
      trail: { thigh: -22, shin: -85, foot: 15, upperArm: 22, forearm: 90 },
    },
    // Passing: the lead leg supports under the hips; the trail knee swings through.
    {
      lean: 9,
      lift: 0.01,
      lead: { thigh: 3, shin: -3, foot: 90, upperArm: 0, forearm: 70 },
      trail: { thigh: 25, shin: -70, foot: 35, upperArm: 0, forearm: 70 },
    },
    // Up: the lead leg pushes off behind; the trail knee drives forward.
    {
      lean: 9,
      lift: 0.05,
      lead: { thigh: -28, shin: -40, foot: 15, upperArm: 35, forearm: 100 },
      trail: { thigh: 55, shin: 0, foot: 95, upperArm: -35, forearm: 25 },
    },
  ];
const CYCLE_MANNEQUIN_POSES: MannequinPose[] = [
  ...CYCLE_HALF.map(({ lead, trail, ...rest }) => ({ ...rest, near: lead, far: trail })),
  ...CYCLE_HALF.map(({ lead, trail, ...rest }) => ({ ...rest, near: trail, far: lead })),
];

/** The hand-posed cycle as outline templates plus filled silhouettes, all on
 * one canvas with the hips centered and the feet on a shared ground line, so
 * the bob survives exactly as video-derived cycle frames do. */
export async function renderPlatformerCycleTemplates(options: {
  height: number;
  farLines?: PlatformerCycleFarLines;
  build?: number;
}): Promise<{ outline: Buffer[]; silhouette: Buffer[] }> {
  const build = options.build ?? 1;
  const scale = mannequinScale(options.height, build);
  const outline = 1 / scale;
  const standing = partBounds(mannequinParts(MANNEQUIN_POSES.sideIdle, build).parts);
  const unit = standing.top - standing.bottom;
  const poses = CYCLE_MANNEQUIN_POSES.map((pose) => {
    const { parts, head } = mannequinParts(pose, build);
    return { parts, head, bounds: partBounds(parts), lift: pose.lift * unit };
  });
  const half =
    Math.ceil(Math.max(...poses.map((p) => Math.max(-p.bounds.left, p.bounds.right))) * scale + 1) +
    2;
  const width = half * 2;
  const height =
    Math.ceil(
      Math.max(...poses.map((p) => p.bounds.top - p.bounds.bottom + p.lift + outline * 2)) * scale,
    ) + 4;
  const outlineColors = {
    ...STYLE_COLORS.outline,
    far: options.farLines === 'pale' ? STYLE_COLORS.outline.far : CYCLE_FAR_MAGENTA,
  };
  const render = (style: PlatformerTemplateStyle, colors: typeof outlineColors) =>
    Promise.all(
      poses.map((p) =>
        rasterizeMannequin(
          mannequinSvg({
            parts: p.parts,
            head: p.head,
            style,
            colors,
            scale,
            outline,
            width,
            height,
            px: (point) => ({
              x: half + point.x * scale,
              y: height - 2 - (point.y - p.bounds.bottom + p.lift + outline) * scale,
            }),
          }),
          false,
        ),
      ),
    );
  return {
    outline: await render('outline', outlineColors),
    silhouette: await render('volume', STYLE_COLORS.volume),
  };
}

async function opaqueCrop(png: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let right = -1;
  let top = info.height;
  let bottom = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[(y * info.width + x) * 4 + 3]! > 8) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right < 0) throw new Error('template board source sprite is fully transparent');
  const width = right - left + 1;
  const height = bottom - top + 1;
  return {
    png: await sharp(png).extract({ left, top, width, height }).png().toBuffer(),
    width,
    height,
  };
}

/** Ratio of the identity's front-idle width to a typical generated humanoid's
 * (arms held away from the torso, per the idle prompt). Broad robots and
 * animals get a thicker mannequin rather than a stick figure. */
export async function platformerTemplateBuild(identity: Buffer): Promise<number> {
  const { width, height } = await opaqueCrop(identity);
  return Math.min(1.6, Math.max(0.8, width / height / 0.7));
}

const GROUND_MARGIN = 48;
const SIDE_MARGIN = 18;
const TOP_MARGIN = 60;
const MAX_UPSCALE = 3;

export interface PlatformerTemplateBoard {
  board: Buffer;
  /** Integer nearest-neighbor factor shared by the identity and templates. */
  upscale: number;
  build: number;
  /** Native-scale template sprites exactly as placed, for review. */
  templates: Record<PlatformerTemplatePose, Buffer>;
  templateSource: 'mannequin' | 'imported';
  style: PlatformerTemplateStyle;
}

/**
 * Cell 1 holds the identity sprite; cells 2-6 hold pose templates on one
 * shared ground line and pixel scale. Imported templates (for example SAM
 * cutouts of a video-generated mannequin) are scaled uniformly from their
 * side idle so their relative stride heights survive.
 */
export async function buildPlatformerTemplateBoard(input: {
  identity: Buffer;
  templates?: Partial<Record<PlatformerTemplatePose, Buffer>>;
  build?: number;
  /** Code-drawn template style; imported templates are drawn as supplied. */
  style?: PlatformerTemplateStyle;
  /** Imported airborne clearance per pose as a fraction of standing height
   * (for example measured from a video); the jump defaults to 0.1. */
  templateLifts?: Partial<Record<PlatformerTemplatePose, number>>;
}): Promise<PlatformerTemplateBoard> {
  const style = input.style ?? 'volume';
  const identity = await opaqueCrop(input.identity);
  const build = input.build ?? (await platformerTemplateBuild(input.identity));
  const imported = input.templates && Object.keys(input.templates).length > 0;
  if (imported) {
    const missing = PLATFORMER_TEMPLATE_POSES.filter((pose) => !input.templates![pose]);
    if (missing.length) throw new Error(`imported templates are missing ${missing.join(', ')}`);
  }
  const templates = {} as Record<PlatformerTemplatePose, Buffer>;
  const lifts = {} as Record<PlatformerTemplatePose, number>;
  if (imported) {
    const crops = Object.fromEntries(
      await Promise.all(
        PLATFORMER_TEMPLATE_POSES.map(
          async (pose) => [pose, await opaqueCrop(input.templates![pose]!)] as const,
        ),
      ),
    ) as Record<PlatformerTemplatePose, Awaited<ReturnType<typeof opaqueCrop>>>;
    const ratio = identity.height / crops.sideIdle.height;
    for (const pose of PLATFORMER_TEMPLATE_POSES) {
      templates[pose] = await sharp(crops[pose].png)
        .resize(
          Math.max(1, Math.round(crops[pose].width * ratio)),
          Math.max(1, Math.round(crops[pose].height * ratio)),
          { fit: 'fill', kernel: sharp.kernel.nearest },
        )
        .png()
        .toBuffer();
      lifts[pose] = Math.round(
        identity.height * (input.templateLifts?.[pose] ?? (pose === 'jump' ? 0.1 : 0)),
      );
    }
  } else {
    for (const pose of PLATFORMER_TEMPLATE_POSES) {
      const mannequin = await renderPlatformerMannequin(pose, {
        height: identity.height,
        build,
        style,
      });
      templates[pose] = mannequin.png;
      lifts[pose] = mannequin.lift;
    }
  }
  const sizes = await Promise.all(
    PLATFORMER_TEMPLATE_POSES.map(async (pose) => sharp(templates[pose]).metadata()),
  );
  const first = fighterPoseSheetCellRect(0);
  const widest = Math.max(identity.width, ...sizes.map((size) => size.width ?? 0));
  const tallest = Math.max(
    identity.height,
    ...PLATFORMER_TEMPLATE_POSES.map((pose, index) => (sizes[index]!.height ?? 0) + lifts[pose]),
  );
  const upscale = Math.min(
    MAX_UPSCALE,
    Math.floor((first.width - SIDE_MARGIN * 2) / widest),
    Math.floor((first.height - GROUND_MARGIN - TOP_MARGIN) / tallest),
  );
  if (upscale < 1) throw new Error('identity sprite is too large for a template board cell');
  const place = async (
    png: Buffer,
    rect: FighterPoseSheetCellRect,
    lift: number,
  ): Promise<OverlayOptions> => {
    const meta = await sharp(png).metadata();
    const width = meta.width! * upscale;
    const height = meta.height! * upscale;
    return {
      input: await sharp(png)
        .resize(width, height, { kernel: sharp.kernel.nearest })
        .png()
        .toBuffer(),
      left: rect.left + Math.round((rect.width - width) / 2),
      top: rect.top + rect.height - GROUND_MARGIN - lift * upscale - height,
    };
  };
  const overlays = [
    await place(identity.png, first, 0),
    ...(await Promise.all(
      PLATFORMER_TEMPLATE_POSES.map((pose, index) =>
        place(templates[pose], fighterPoseSheetCellRect(index + 1), lifts[pose]),
      ),
    )),
  ];
  const board = await sharp({
    create: {
      width: FIGHTER_POSE_SHEET_SIZE,
      height: FIGHTER_POSE_SHEET_SIZE,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    },
  })
    .composite(overlays)
    .png()
    .toBuffer();
  return {
    board,
    upscale,
    build,
    templates,
    templateSource: imported ? 'imported' : 'mannequin',
    style,
  };
}

function clean(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 500) : null;
}

const STYLE_PROMPT: Record<
  PlatformerTemplateStyle,
  { template: string; depth: string; dressing: string; notDesign: string }
> = {
  volume: {
    template: "a gray, featureless artist's mannequin",
    depth:
      'Depth code: LIGHT-gray limbs are the camera-side (near) arm and leg, drawn in front of the body. DARK-gray limbs are the far-side arm and leg, partly hidden behind the body.',
    dressing:
      "Dress every mannequin completely. Replace every mannequin surface (head, torso, upper arms, forearms, hands, thighs, shins, and feet) with the identity character's own skin or fur, clothing, sleeves, gloves, trousers, and footwear exactly as cell 1 shows them. A finished character head on a gray mannequin body is wrong. Gray appears only where cell 1 itself is gray.",
    notDesign:
      'The mannequin is not a costume, robot, armor, or design element. No mannequin surface, outline, joint, or seam may remain anywhere in the result.',
  },
  outline: {
    template: 'a hollow line-art pose sketch with no fill',
    depth:
      'Depth code: DARK outlines mark the head, torso, and the camera-side (near) arm and leg, drawn in front of the body. PALE gray outlines mark the far-side arm and leg, partly hidden behind the body.',
    dressing:
      "Paint each sketch completely as the identity character: fill every enclosed sketch area with the character's own skin or fur, clothing, sleeves, gloves, trousers, and footwear exactly as cell 1 shows them, at the character's own body volume. No area inside a sketch may stay green.",
    notDesign:
      'The sketch lines are construction guides, not a costume, robot, or design element. No sketch line may remain visible anywhere in the result.',
  },
  skeleton: {
    template:
      'a stick-figure pose skeleton: a round head, a thick spine line, limb lines, and dots at the knees and elbows',
    depth:
      'Depth code: DARK navy lines are the camera-side (near) arm and leg, drawn in front of the body. PALE gray lines are the far-side arm and leg, partly hidden behind the body.',
    dressing:
      "Build the identity character's complete body around each skeleton, with the character's own body volume, skin or fur, clothing, sleeves, gloves, trousers, and footwear exactly as cell 1 shows them. Never draw a thin stick-limbed version of the character.",
    notDesign:
      'The skeleton is a hidden construction guide, not a costume, robot, or design element. No skeleton line, joint dot, or head circle may remain visible anywhere in the result.',
  },
};

/** Rules shared by the pose and run-cycle boards. */
const identityCellRule = (view: 'front' | 'side' | undefined) =>
  `Cell 1 (row 1, column 1) is the IDENTITY REFERENCE: the exact player character${view === 'side' ? ' in right-facing side view' : ', front-facing'}. It is immutable truth for face, head, hair, skin or fur, headwear, costume, footwear, colors, body proportions, and pixel-art technique. Leave cell 1 unchanged.`;
const ANATOMY_RULE =
  "The template's body shape is generic. Keep the identity character's own anatomy and proportions, including head size, body width, ears, snout, tail, wings, hair, and costume volume, and adopt only the template's pose.";
const costumeRule = (heroConcept: string | null) =>
  heroConcept
    ? `Canonical costume contract: ${heroConcept}. Ignore any action, tool, light, weapon, or held or carried object it mentions; both hands stay empty in every cell.`
    : 'Both hands stay empty in every cell.';
const pixelRule = (cells: string) =>
  `Keep the same identity, costume, palette, proportions, and pixel density across all ${cells} cells, matching cell 1's polished 16-bit SNES-era pixel-art technique: crisp square pixel clusters, hard edges, limited flat colors, and no antialiasing, blur, gradients, or photorealism.`;
const ONE_PER_CELL_RULE =
  'Keep exactly one complete, uncropped character inside each cell with generous green clearance on every edge. No body part may cross into another cell.';
const BACKGROUND_RULE =
  'Every background pixel, gutter, and gap enclosed by arms and legs must remain perfectly flat solid #00ff00. Do not draw grid lines, borders, labels, text, numbers, scenery, floors, shadows, effects, props, or extra characters. Do not use #00ff00 or a near-neon imitation in the character.';

export function buildPlatformerTemplateBoardPrompt(
  options: {
    heroConcept?: string;
    colors?: string;
    identityView?: 'front' | 'side';
    style?: PlatformerTemplateStyle;
  } = {},
): string {
  const style = STYLE_PROMPT[options.style ?? 'volume'];
  const heroConcept = clean(options.heroConcept);
  const colors = clean(options.colors);
  const cells = PLATFORMER_TEMPLATE_POSES.map(
    (pose, index) =>
      `Cell ${index + 2} (row ${Math.floor((index + 1) / 3) + 1}, column ${((index + 1) % 3) + 1}): ${POSE_CONTRACT[pose]}.`,
  ).join(' ');
  return [
    'PLATFORMER TEMPLATE BOARD: edit this fixed 3-column by 2-row sprite board in place.',
    identityCellRule(options.identityView),
    `Cells 2 to 6 each contain ${style.template}. Each template is POSE TRUTH ONLY. Replace every template completely with the identity character, redrawn in exactly that template's pose: the same facing, torso lean, head position, limb angles, knee and elbow bends, hand and foot placement, stride width, airborne height, scale, cell position, and ground line.`,
    `${style.depth} Keep exactly that front-to-back layering for every redrawn arm and leg.`,
    'Carry the depth code into the finished art the way classic side-view sprites do: shade the far-side arm and leg one or two tones darker than the camera-side arm and leg, and let the near leg overlap the far leg, so cells 3 and 4 read as opposite strides at a glance.',
    ANATOMY_RULE,
    style.dressing,
    style.notDesign,
    cells,
    'Every redrawn pose faces RIGHT in strict side profile, with the face, eyes, and nose pointing toward the right edge. Never mirror a pose or turn the character toward the viewer.',
    costumeRule(heroConcept),
    colors ? `Costume color direction: ${colors}.` : '',
    pixelRule('six'),
    ONE_PER_CELL_RULE,
    BACKGROUND_RULE,
  ]
    .filter(Boolean)
    .join(' ');
}

export interface PlatformerTemplateCellResult {
  pose: PlatformerTemplatePose;
  rect: FighterPoseSheetCellRect;
  raw: Buffer;
  segmentation: FighterPoseSheetSegmentationMetrics;
  processed?: Buffer;
  metrics?: FighterPoseImageMetrics;
  error?: string;
}

/** Split cells 2-6 with the sheet splitter's component ownership, then run the
 * production platformer keying, fit, and foot anchoring on each one. */
export async function splitPlatformerTemplateBoard(
  image: Buffer,
): Promise<PlatformerTemplateCellResult[]> {
  const segmented = await segmentGeneratedFighterPoseSheet(image);
  return Promise.all(
    PLATFORMER_TEMPLATE_POSES.map(async (pose, index): Promise<PlatformerTemplateCellResult> => {
      const cell = segmented[index + 1]!;
      const base = { pose, rect: cell.rect, raw: cell.raw, segmentation: cell.segmentation };
      if (cell.error) return { ...base, error: cell.error };
      try {
        const processed = await processGeneratedPlatformerPose(cell.raw);
        return { ...base, processed: processed.png, metrics: processed.metrics };
      } catch (error) {
        return {
          ...base,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 800),
        };
      }
    }),
  );
}

export interface PlatformerSilhouetteAgreement {
  iou: number;
  lowerBodyIou: number;
}

/** Alpha-silhouette overlap of two normalized platformer sprites, centered the
 * same way `alignGeneratedPlatformerPoseCanvases` pads them. A broad character
 * matched to a slim mannequin scores lower, so treat this as a pose signal,
 * not a gate. */
export async function measurePlatformerSilhouetteAgreement(
  frame: Buffer,
  template: Buffer,
): Promise<PlatformerSilhouetteAgreement> {
  const [a, b] = await Promise.all(
    [frame, template].map((png) =>
      sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ),
  );
  const width = Math.max(a!.info.width, b!.info.width);
  const height = GENERATED_PLATFORMER_POSE_HEIGHT;
  const opaque = (image: typeof a, x: number, y: number): boolean => {
    const offset = Math.floor((width - image!.info.width) / 2);
    const localX = x - offset;
    if (localX < 0 || localX >= image!.info.width || y >= image!.info.height) return false;
    return image!.data[(y * image!.info.width + localX) * 4 + 3]! > 8;
  };
  const band = (yStart: number): number => {
    let intersection = 0;
    let union = 0;
    for (let y = yStart; y < height; y++)
      for (let x = 0; x < width; x++) {
        const inA = opaque(a, x, y);
        const inB = opaque(b, x, y);
        if (inA && inB) intersection++;
        if (inA || inB) union++;
      }
    return union ? intersection / union : 1;
  };
  return { iou: band(0), lowerBodyIou: band(PLATFORMER_RUN_LOWER_BODY_TOP) };
}

// Mid and light template grays only: the dark line colors would also match
// black hair, outlines, and dark clothing.
const MANNEQUIN_FILLS = [
  ...new Set(
    PLATFORMER_TEMPLATE_STYLES.flatMap((style) =>
      (['far', 'body', 'near'] as const).map((layer) => STYLE_COLORS[style][layer]),
    ),
  ),
]
  .map((hex) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ])
  .filter((rgb) => Math.max(...rgb) >= 80);

/** Fraction of a sprite's opaque pixels that still look like template gray:
 * near-neutral and close to a mid or light template gray. Muse can follow
 * a pose while leaving the body gray, which silhouettes cannot see. Gray
 * costumes also score here, so compare against the identity's own fraction. */
export async function measureMannequinResidue(png: Buffer): Promise<number> {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = 0;
  let residue = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3]! <= 8) continue;
    opaque++;
    const r = data[offset]!;
    const g = data[offset + 1]!;
    const b = data[offset + 2]!;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 24) continue;
    if (MANNEQUIN_FILLS.some(([fr, fg, fb]) => Math.hypot(r - fr!, g - fg!, b - fb!) <= 40))
      residue++;
  }
  return opaque ? residue / opaque : 0;
}

// Run-cycle board: the identity in cell 1 and up to eight consecutive phases
// of one run cycle in the following cells of a 3x3 grid. Unlike the per-pose
// fit above, cycle frames share one scale, ground line, body anchor, and
// palette, so the bob and stride survive and the character does not pulse.

// v2: per-cell stride notes, a no-copy rule, a firmer identity rule, and
// magenta far-limb lines. v1 boards copied strides, drew pale far lines as
// translucent limbs, and sometimes redrew the identity cell.
export const PLATFORMER_CYCLE_BOARD_PROMPT_VERSION = 'platformer-cycle-board-v2';
/** Maximum (and default) phases on one board. */
export const PLATFORMER_CYCLE_FRAMES = 8;
export type PlatformerCycleFarLines = 'pale' | 'magenta';
const CYCLE_COLUMNS = 3;
const CYCLE_GROUND_MARGIN = 30;
const CYCLE_TOP_MARGIN = 24;
const CYCLE_SIDE_MARGIN = 14;
const CYCLE_BLEED_TOLERANCE = 40;
/** Native standing height of imported cycle frames; production fits poses to 112. */
const CYCLE_FRAME_STANDING_HEIGHT = 112;

export function platformerCycleCellRect(index: number): FighterPoseSheetCellRect {
  if (!Number.isInteger(index) || index < 0 || index > PLATFORMER_CYCLE_FRAMES) {
    throw new RangeError(`cycle board cell index must be between 0 and ${PLATFORMER_CYCLE_FRAMES}`);
  }
  const column = index % CYCLE_COLUMNS;
  const row = Math.floor(index / CYCLE_COLUMNS);
  const edge = (n: number) => Math.floor((n * FIGHTER_POSE_SHEET_SIZE) / CYCLE_COLUMNS);
  return {
    index,
    row,
    column,
    left: edge(column),
    top: edge(row),
    width: edge(column + 1) - edge(column),
    height: edge(row + 1) - edge(row),
  };
}

export interface PlatformerCycleBoard {
  board: Buffer;
  upscale: number;
}

/** `frames` share one canvas (for example consecutive video frames cropped
 * to their union), so placing each canvas on the ground line keeps the bob. */
export async function buildPlatformerCycleBoard(input: {
  identity: Buffer;
  frames: readonly Buffer[];
  frameStandingHeight?: number;
}): Promise<PlatformerCycleBoard> {
  if (input.frames.length < 2 || input.frames.length > PLATFORMER_CYCLE_FRAMES) {
    throw new Error(`a cycle board needs 2 to ${PLATFORMER_CYCLE_FRAMES} frames`);
  }
  const identity = await opaqueCrop(input.identity);
  const ratio = identity.height / (input.frameStandingHeight ?? CYCLE_FRAME_STANDING_HEIGHT);
  const frames = await Promise.all(
    input.frames.map(async (png) => {
      const meta = await sharp(png).metadata();
      const width = Math.max(1, Math.round(meta.width! * ratio));
      const height = Math.max(1, Math.round(meta.height! * ratio));
      return {
        width,
        height,
        png: await sharp(png)
          .resize(width, height, { fit: 'fill', kernel: sharp.kernel.nearest })
          .png()
          .toBuffer(),
      };
    }),
  );
  const cell = platformerCycleCellRect(0);
  const upscale = Math.min(
    MAX_UPSCALE,
    Math.floor(
      (cell.width - CYCLE_SIDE_MARGIN * 2) /
        Math.max(identity.width, ...frames.map((f) => f.width)),
    ),
    Math.floor(
      (cell.height - CYCLE_GROUND_MARGIN - CYCLE_TOP_MARGIN) /
        Math.max(identity.height, ...frames.map((f) => f.height)),
    ),
  );
  if (upscale < 1) throw new Error('cycle frames are too large for a 3x3 board cell');
  const place = async (
    image: { png: Buffer; width: number; height: number },
    rect: FighterPoseSheetCellRect,
  ): Promise<OverlayOptions> => ({
    input: await sharp(image.png)
      .resize(image.width * upscale, image.height * upscale, { kernel: sharp.kernel.nearest })
      .png()
      .toBuffer(),
    left: rect.left + Math.round((rect.width - image.width * upscale) / 2),
    top: rect.top + rect.height - CYCLE_GROUND_MARGIN - image.height * upscale,
  });
  const overlays = [
    await place(identity, cell),
    ...(await Promise.all(frames.map((f, i) => place(f, platformerCycleCellRect(i + 1))))),
  ];
  const board = await sharp({
    create: {
      width: FIGHTER_POSE_SHEET_SIZE,
      height: FIGHTER_POSE_SHEET_SIZE,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    },
  })
    .composite(overlays)
    .png()
    .toBuffer();
  return { board, upscale };
}

/** Classic run phases for a cycle that starts at the near leg's contact:
 * contact, down, passing, and up for each leg in turn. */
function cyclePhaseNote(k: number, count: number): string {
  const half = count / 2;
  const [lead, trail] = k < half ? ['camera-side (near)', 'far'] : ['far', 'camera-side (near)'];
  const t = (k % half) / half;
  if (t === 0)
    return `contact: the ${lead} leg reaches forward and plants its heel while the ${trail} leg stretches back; widest stride`;
  if (t < 0.4)
    return `down: the ${lead} leg takes the weight under the body with its knee bending while the ${trail} foot lifts off behind`;
  if (t <= 0.6)
    return `passing: the ${lead} leg supports the body under the hips while the ${trail} leg swings forward past it with the knee bent; narrowest stride`;
  return `up: the ${lead} leg pushes off behind and the body rises while the ${trail} knee drives forward`;
}

export function buildPlatformerCycleBoardPrompt(
  options: {
    heroConcept?: string;
    colors?: string;
    identityView?: 'front' | 'side';
    frameCount?: number;
    farLines?: PlatformerCycleFarLines;
  } = {},
): string {
  const style = STYLE_PROMPT.outline;
  const count = options.frameCount ?? PLATFORMER_CYCLE_FRAMES;
  if (count < 2 || count > PLATFORMER_CYCLE_FRAMES || count % 2)
    throw new RangeError('a cycle board prompt needs an even frame count from 2 to 8');
  const colors = clean(options.colors);
  const lastCell = count + 1;
  const words = ['', '', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const cells = Array.from({ length: count }, (_, k) => {
    const rect = platformerCycleCellRect(k + 1);
    return `Cell ${k + 2} (row ${rect.row + 1}, column ${rect.column + 1}), phase ${k + 1} of ${count}: ${cyclePhaseNote(k, count)}; the arms swing opposite the legs.`;
  }).join(' ');
  const depth =
    options.farLines === 'pale'
      ? `${style.depth} Keep exactly that front-to-back layering in every frame, shading the far-side arm and leg one or two tones darker than the camera-side arm and leg, so the legs visibly trade places through the cycle.`
      : "Depth code: DARK outlines mark the head, torso, and the camera-side (near) arm and leg, drawn in front of the body. MAGENTA outlines mark the far-side arm and leg, partly hidden behind the body. Magenta is only a depth label, never a color, glow, or transparency: draw the far arm and leg fully opaque in the character's own colors, one or two tones darker than the near arm and leg, so the legs visibly trade places through the cycle.";
  return [
    'PLATFORMER RUN-CYCLE BOARD: edit this fixed 3-column by 3-row sprite board in place.',
    identityCellRule(options.identityView),
    "Never change cell 1's skin tone, hair, face, costume, or colors, and match it exactly in every frame.",
    `Cells 2 to ${lastCell}, in reading order (left to right, then top to bottom), are ${words[count]} consecutive frames of ONE continuous running cycle facing RIGHT. Each contains ${style.template}. Each template is POSE TRUTH ONLY. Replace every template completely with the identity character, redrawn in exactly that frame's pose: the same torso lean, head position, limb angles, knee and elbow bends, hand and foot placement, height above the ground, scale, cell position, and ground line.`,
    lastCell < 9
      ? `Cells ${lastCell + 1} to 9 are intentionally empty and stay perfectly flat solid #00ff00.`
      : '',
    depth,
    `Each cell is a different moment of the stride, as listed below. No two cells may show the same pose; copying one stride into several cells is wrong. ${cells}`,
    `Played in order, cells 2 to ${lastCell} must animate as one smooth, looping run. Keep the head, torso, costume details, palette, outline weight, and pixel density identical from frame to frame; only the limbs and the small up-and-down bob may change. Never resize, redesign, or re-pose the character beyond its template.`,
    ANATOMY_RULE,
    style.dressing,
    style.notDesign,
    'Every frame faces RIGHT in strict side profile, with the face, eyes, and nose pointing toward the right edge. Never mirror a frame or turn the character toward the viewer.',
    costumeRule(clean(options.heroConcept)),
    colors ? `Costume color direction: ${colors}.` : '',
    pixelRule(words[count + 1]!),
    ONE_PER_CELL_RULE,
    BACKGROUND_RULE,
  ]
    .filter(Boolean)
    .join(' ');
}

export interface PlatformerCycleCell {
  index: number;
  rect: FighterPoseSheetCellRect;
  /** Owned figure pixels on transparency, cropped to the cell plus bleed. */
  raw: Buffer;
  /** Ground line row within `raw`. */
  ground: number;
  error?: string;
}

/** Key the whole board, label connected figures, and give each one to the
 * cell holding most of its pixels, so a limb crossing a cell edge is neither
 * cut nor duplicated. Specks are dropped; a figure that bleeds far into a
 * neighbor or an empty cell is an error. Returns cells 2-9. */
export async function splitPlatformerCycleBoard(
  image: Buffer,
  frameCount = PLATFORMER_CYCLE_FRAMES,
): Promise<PlatformerCycleCell[]> {
  const size = FIGHTER_POSE_SHEET_SIZE;
  const normalized = await sharp(image)
    .rotate()
    .resize(size, size, { fit: 'fill', kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
  const { data } = await maskGeneratedFighterPose(normalized, { removeGreenSpill: true });
  const cellOf = (x: number, y: number) =>
    Math.min(CYCLE_COLUMNS - 1, Math.floor((y * CYCLE_COLUMNS) / size)) * CYCLE_COLUMNS +
    Math.min(CYCLE_COLUMNS - 1, Math.floor((x * CYCLE_COLUMNS) / size));
  const label = new Int32Array(size * size).fill(-1);
  const components: Array<{ pixels: number[]; owner: number }> = [];
  const stack: number[] = [];
  for (let start = 0; start < size * size; start++) {
    if (label[start] !== -1 || data[start * 4 + 3]! <= 8) continue;
    const id = components.length;
    const pixels: number[] = [];
    const counts = new Array<number>(CYCLE_COLUMNS * CYCLE_COLUMNS).fill(0);
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      pixels.push(p);
      const x = p % size;
      const y = (p - x) / size;
      counts[cellOf(x, y)]!++;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const n = ny * size + nx;
          if (label[n] === -1 && data[n * 4 + 3]! > 8) {
            label[n] = id;
            stack.push(n);
          }
        }
    }
    components.push({ pixels, owner: counts.indexOf(Math.max(...counts)) });
  }
  return Promise.all(
    Array.from({ length: frameCount }, async (_, i): Promise<PlatformerCycleCell> => {
      const index = i + 1;
      const rect = platformerCycleCellRect(index);
      const left = Math.max(0, rect.left - CYCLE_BLEED_TOLERANCE);
      const top = Math.max(0, rect.top - CYCLE_BLEED_TOLERANCE);
      const right = Math.min(size, rect.left + rect.width + CYCLE_BLEED_TOLERANCE);
      const bottom = Math.min(size, rect.top + rect.height + CYCLE_BLEED_TOLERANCE);
      const width = right - left;
      const height = bottom - top;
      const owned = components
        .filter((c) => c.owner === index && c.pixels.length >= 24)
        .sort((a, b) => b.pixels.length - a.pixels.length);
      const raw = Buffer.alloc(width * height * 4);
      let clipped = 0;
      for (const component of owned)
        for (const p of component.pixels) {
          const x = (p % size) - left;
          const y = Math.floor(p / size) - top;
          if (x < 0 || y < 0 || x >= width || y >= height) {
            clipped++;
            continue;
          }
          data.copy(raw, (y * width + x) * 4, p * 4, p * 4 + 4);
        }
      const cell: PlatformerCycleCell = {
        index,
        rect,
        raw: await sharp(raw, { raw: { width, height, channels: 4 } })
          .png()
          .toBuffer(),
        ground: rect.top + rect.height - CYCLE_GROUND_MARGIN - top,
      };
      if (!owned.length) cell.error = 'no figure in this cell';
      else if (clipped > 0)
        cell.error = `figure extends more than ${CYCLE_BLEED_TOLERANCE}px past its cell`;
      return cell;
    }),
  );
}

export interface PlatformerCycleFrameMetrics {
  /** Figure height in native pixels. */
  height: number;
  /** Native pixels between the feet and the cycle's lowest frame. */
  lift: number;
}

/** One scale (the board's upscale), one ground line, one horizontal anchor
 * (head-and-torso centroid), and one 32-color palette for the whole cycle. */
export async function normalizePlatformerCycle(
  cells: readonly PlatformerCycleCell[],
  upscale: number,
): Promise<{ frames: Buffer[]; metrics: PlatformerCycleFrameMetrics[] }> {
  const failed = cells.filter((cell) => cell.error);
  if (failed.length) {
    throw new Error(failed.map((cell) => `cell ${cell.index + 1}: ${cell.error}`).join('; '));
  }
  const figures = await Promise.all(
    cells.map(async (cell) => {
      const crop = await opaqueCrop(cell.raw);
      const { data, info } = await sharp(cell.raw)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let top = info.height;
      let bottom = -1;
      let left = info.width;
      for (let y = 0; y < info.height; y++)
        for (let x = 0; x < info.width; x++)
          if (data[(y * info.width + x) * 4 + 3]! > 8) {
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
            left = Math.min(left, x);
          }
      // Head-and-torso centroid: limbs swing, the upper body should not.
      const upperEnd = top + Math.round((bottom - top) * 0.4);
      let sum = 0;
      let count = 0;
      for (let y = top; y <= upperEnd; y++)
        for (let x = 0; x < info.width; x++)
          if (data[(y * info.width + x) * 4 + 3]! > 8) {
            sum += x;
            count++;
          }
      const width = Math.max(1, Math.round(crop.width / upscale));
      const height = Math.max(1, Math.round(crop.height / upscale));
      return {
        png: await sharp(crop.png)
          .resize(width, height, { fit: 'fill', kernel: sharp.kernel.nearest })
          .png()
          .toBuffer(),
        width,
        height,
        anchor: (sum / count - left) / upscale,
        lift: (cell.ground - 1 - bottom) / upscale,
      };
    }),
  );
  const floor = Math.min(...figures.map((f) => f.lift));
  const half =
    Math.ceil(Math.max(...figures.map((f) => Math.max(f.anchor, f.width - f.anchor)))) + 2;
  const canvasWidth = half * 2;
  const canvasHeight = Math.max(
    GENERATED_PLATFORMER_POSE_HEIGHT,
    Math.ceil(Math.max(...figures.map((f) => f.height + f.lift - floor))) + 2,
  );
  // Quantize the frames side by side so all eight share one palette.
  const strip = await sharp({
    create: {
      width: canvasWidth * figures.length,
      height: canvasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(
      figures.map((f, i) => ({
        input: f.png,
        left: i * canvasWidth + Math.round(half - f.anchor),
        top: canvasHeight - f.height - Math.round(f.lift - floor),
      })),
    )
    .png({ palette: true, colours: 32, dither: 0 })
    .toBuffer();
  const frames = await Promise.all(
    figures.map((_, i) =>
      sharp(strip)
        .extract({ left: i * canvasWidth, top: 0, width: canvasWidth, height: canvasHeight })
        .png({ palette: true, colours: 32, dither: 0 })
        .toBuffer(),
    ),
  );
  return {
    frames,
    metrics: figures.map((f) => ({ height: f.height, lift: Math.round(f.lift - floor) })),
  };
}

/** Alpha overlap of two normalized cycle frames aligned at bottom center. */
export async function measureCycleFrameAgreement(a: Buffer, b: Buffer): Promise<number> {
  const [first, second] = await Promise.all(
    [a, b].map((png) => sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })),
  );
  const width = Math.max(first!.info.width, second!.info.width);
  const height = Math.max(first!.info.height, second!.info.height);
  const opaque = (image: typeof first, x: number, y: number) => {
    const localX = x - Math.floor((width - image!.info.width) / 2);
    const localY = y - (height - image!.info.height);
    if (localX < 0 || localY < 0 || localX >= image!.info.width) return false;
    return image!.data[(localY * image!.info.width + localX) * 4 + 3]! > 8;
  };
  let intersection = 0;
  let union = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inA = opaque(first, x, y);
      const inB = opaque(second, x, y);
      if (inA && inB) intersection++;
      if (inA || inB) union++;
    }
  return union ? intersection / union : 1;
}

/** Mean-color distance between the identity cell of the input and output
 * boards. Muse sometimes redraws cell 1 (for example a darker skin tone), and
 * every frame then inherits the change. */
export async function measureCycleIdentityShift(input: Buffer, output: Buffer): Promise<number> {
  const rect = platformerCycleCellRect(0);
  const mean = async (board: Buffer) => {
    const cell = await sharp(board)
      .resize(FIGHTER_POSE_SHEET_SIZE, FIGHTER_POSE_SHEET_SIZE, {
        fit: 'fill',
        kernel: sharp.kernel.nearest,
      })
      .extract(rect)
      .png()
      .toBuffer();
    const { data } = await maskGeneratedFighterPose(cell, {
      removeGreenSpill: true,
      minGreenFraction: 0,
    });
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let o = 0; o < data.length; o += 4) {
      if (data[o + 3]! <= 8) continue;
      r += data[o]!;
      g += data[o + 1]!;
      b += data[o + 2]!;
      count++;
    }
    return count ? [r / count, g / count, b / count] : [0, 0, 0];
  };
  const [a, b] = await Promise.all([mean(input), mean(output)]);
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

/** Distinct poses among frames (greedy groups at silhouette IoU above 0.9)
 * and their mean pairwise IoU. Copied strides lower the first and raise the
 * second relative to the requested cycle. */
export async function measureCycleDiversity(
  frames: readonly Buffer[],
): Promise<{ distinct: number; meanPairIou: number }> {
  let sum = 0;
  let pairs = 0;
  const iou: number[][] = frames.map(() => []);
  for (let i = 0; i < frames.length; i++)
    for (let j = i + 1; j < frames.length; j++) {
      const value = await measureCycleFrameAgreement(frames[i]!, frames[j]!);
      iou[i]![j] = iou[j]![i] = value;
      sum += value;
      pairs++;
    }
  const groups: number[] = [];
  for (let i = 0; i < frames.length; i++)
    if (!groups.some((g) => iou[i]![g]! > 0.9)) groups.push(i);
  return { distinct: groups.length, meanPairIou: pairs ? sum / pairs : 1 };
}
