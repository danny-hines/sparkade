import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SegmentationMaskRecord } from '@meta-sam/parser';
import { describe, expect, it } from 'vitest';
import { GENERATED_GAME_ASSET_FILES } from '@sparkade/shared';
import {
  apply,
  assignParts,
  boneOf,
  buildRigRunInbetweens,
  decodeRigImage,
  encodeRigImage,
  checkRigFrame,
  compose,
  fillHoles,
  invert,
  maskCoverage,
  renderRig,
  rigid,
  RUN_RIG_CONCEPTS,
  RUN_RIG_SAM_INPUT,
  rigidArmsInbetween,
  rigidLimbInbetween,
  samInputPixels,
  SEGMENTS,
  splatAlongField,
  standingHeightGain,
  type Affine,
  type DecodedMask,
  type RigImage,
  type RigMask,
} from '../src/assets/platformer-run-rig';
import {
  alignRgbaFrames,
  buildRunInbetweens,
  runInbetween,
  runInbetweenField,
} from '@sparkade/shared/run-inbetweens';

type Rgb = [number, number, number];
const GRAY: Rgb = [120, 120, 130];
const RED: Rgb = [200, 40, 40];
const PINK: Rgb = [250, 180, 180];
const BLUE: Rgb = [40, 60, 200];
const CYAN: Rgb = [40, 200, 220];

function sprite(width: number, height: number, paint: (x: number, y: number) => Rgb | null) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const rgb = paint(x, y);
      if (rgb) data.set([...rgb, 255], (y * width + x) * 4);
    }
  return { data, width, height } satisfies RigImage;
}

function mask(
  image: RigImage,
  concept: string,
  objectId: string,
  inside: (x: number, y: number) => boolean,
): RigMask {
  const coverage = new Float32Array(image.width * image.height);
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++)
      if (inside(x, y) && image.data[(y * image.width + x) * 4 + 3]! > 8)
        coverage[y * image.width + x] = 1;
  return { concept, objectId, coverage };
}

const colorAt = (image: RigImage, x: number, y: number) => [
  ...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4),
];
const isOpaque = (image: RigImage, x: number, y: number) =>
  image.data[(y * image.width + x) * 4 + 3]! > 8;
const palette = (image: RigImage) => {
  const out = new Set<string>();
  for (let p = 0; p < image.width * image.height; p++)
    if (image.data[p * 4 + 3]! > 8) out.add([...image.data.subarray(p * 4, p * 4 + 3)].join(','));
  return out;
};
const count = (image: RigImage, rgb: Rgb) => {
  let n = 0;
  for (let p = 0; p < image.width * image.height; p++)
    if (image.data[p * 4 + 3]! > 8 && rgb.every((v, k) => image.data[p * 4 + k] === v)) n++;
  return n;
};

/** Body block with an arm bar drawn over it and out to the right (hand at
 * the end), and two legs hanging below. */
function figure(ox = 0) {
  return sprite(32 + ox, 40, (px, y) => {
    const x = px - ox;
    if (y >= 11 && y <= 15 && x >= 25 && x <= 28) return PINK; // hand
    if (y >= 12 && y <= 14 && x >= 13 && x <= 24) return RED; // arm over torso
    if (y >= 4 && y <= 24 && x >= 10 && x <= 19) return GRAY; // head + torso
    if (y >= 25 && x >= 11 && x <= 13) return BLUE; // leg A
    if (y >= 25 && x >= 16 && x <= 18) return CYAN; // leg B
    return null;
  });
}

function figureMasks(image: RigImage, ox = 0): RigMask[] {
  return [
    mask(image, 'head', '0', (_x, y) => y <= 10),
    mask(image, 'arm', '0', (x, y) => y >= 12 && y <= 14 && x - ox >= 13 && x - ox <= 26),
    mask(image, 'hand', '0', (x, y) => y >= 11 && y <= 15 && x - ox >= 25),
    mask(image, 'leg', '0', (x, y) => y >= 25 && x - ox <= 14),
    mask(image, 'leg', '1', (x, y) => y >= 25 && x - ox >= 15),
  ];
}

describe('SAM input and mask coverage', () => {
  it('upscales with nearest neighbor onto a flat padded background', () => {
    const image = sprite(2, 1, (x) => (x === 0 ? RED : null));
    const input = samInputPixels(image, { scale: 3, pad: 1, background: 'gray' });
    expect([input.width, input.height]).toEqual([12, 9]);
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 12; x++) {
        const inside = x >= 3 && x < 6 && y >= 3 && y < 6;
        expect(colorAt(input, x, y), `${x},${y}`).toEqual(
          inside ? [...RED, 255] : [128, 128, 128, 255],
        );
      }
  });

  it('stretches a mask raster over its box and measures each sprite pixel block', () => {
    const image = sprite(4, 3, () => GRAY);
    // Box over sprite pixels x 1..2, y 0..1 (upscaled 2x, pad 1); a 2x2
    // raster with its bottom-right cell empty.
    const decoded: DecodedMask = {
      bounds: { left: 4, top: 2, right: 8, bottom: 6 },
      width: 2,
      height: 2,
      raster: Uint8Array.from([1, 1, 1, 0]),
    };
    const coverage = maskCoverage(decoded, image, { scale: 2, pad: 1 });
    const covered = [...coverage]
      .map((v, p) => (v ? `${p % 4},${Math.floor(p / 4)}` : null))
      .filter(Boolean);
    expect(covered).toEqual(['1,0', '2,0', '1,1']);
    // A box one upscaled pixel wide covers half of a sprite pixel.
    const half = maskCoverage(
      {
        bounds: { left: 4, top: 2, right: 5, bottom: 4 },
        width: 1,
        height: 1,
        raster: Uint8Array.from([1]),
      },
      image,
      { scale: 2, pad: 1 },
    );
    expect(half[1]).toBeCloseTo(0.5);
    // Transparent sprite pixels never count.
    const holed = sprite(4, 3, (x, y) => (x === 1 && y === 0 ? null : GRAY));
    expect(maskCoverage(decoded, holed, { scale: 2, pad: 1 })[1]).toBe(0);
  });
});

describe('part assignment', () => {
  it('gives every opaque pixel exactly one unit, limbs over head/torso, hands to their arm', () => {
    const image = figure();
    const map = assignParts(image, figureMasks(image));
    expect(map.units.map((u) => u.kind)).toEqual(['body', 'arm', 'leg', 'leg']);
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++)
        expect(map.unit[y * image.width + x]! >= 0, `${x},${y}`).toBe(isOpaque(image, x, y));
    const unitAt = (x: number, y: number) => map.unit[y * image.width + x]!;
    expect(unitAt(15, 13)).toBe(1); // arm pixel over the torso
    expect(unitAt(28, 11)).toBe(1); // hand outside the arm mask joins the arm
    expect(SEGMENTS[map.segment[11 * image.width + 28]!]).toBe('hand');
    expect(unitAt(15, 5)).toBe(0); // head
    expect(unitAt(15, 20)).toBe(0); // unmasked torso falls to the body
    expect(SEGMENTS[map.segment[20 * image.width + 15]!]).toBe('body');
    expect(new Set([unitAt(12, 30), unitAt(17, 30)])).toEqual(new Set([2, 3]));
    expect(
      map.units[1]!.pixels + map.units[2]!.pixels + map.units[3]!.pixels + map.units[0]!.pixels,
    ).toBe(
      [...Array(image.width * image.height).keys()].filter((p) => image.data[p * 4 + 3]! > 8)
        .length,
    );
  });

  it('ignores whole-sprite limb masks and joins a limb split end to end', () => {
    const image = figure();
    const masks = [
      ...figureMasks(image),
      mask(image, 'arm', 'all', () => true),
      // A second, tighter leg instance claims the lower half of leg A.
      mask(image, 'leg', 'small', (x, y) => y >= 34 && x <= 14),
    ];
    const map = assignParts(image, masks);
    expect(map.warnings.some((w) => w.startsWith('arm#all: ignored'))).toBe(true);
    expect(map.warnings.some((w) => w.includes('one limb split in two'))).toBe(true);
    const legA = map.units.find((u) => u.sources.includes('leg#small'))!;
    expect(legA.sources).toContain('leg#0');
    expect(map.unit[36 * image.width + 12]).toBe(legA.id);
    expect(map.unit[28 * image.width + 12]).toBe(legA.id);
    // Leg B, beside it rather than below it, stays its own limb.
    expect(map.units.filter((u) => u.kind === 'leg')).toHaveLength(2);
  });

  it('joins a folded arm split at the elbow when a frame has more than two arms', () => {
    const image = sprite(40, 30, (x, y) => {
      if (y >= 2 && y <= 28 && x >= 10 && x <= 19) return GRAY; // torso
      if (y >= 8 && y <= 11 && x >= 20 && x <= 33) return RED; // upper arm, forward
      if (y >= 12 && y <= 15 && x >= 22 && x <= 33) return PINK; // forearm folded back
      if (y >= 9 && y <= 12 && x >= 2 && x <= 9) return BLUE; // back arm
      return null;
    });
    const map = assignParts(image, [
      mask(image, 'upper arm', '0', (x, y) => y <= 11 && x >= 20),
      mask(image, 'arm', '0', (x, y) => y >= 12 && x >= 22),
      mask(image, 'arm', '1', (x) => x <= 9),
    ]);
    const arms = map.units.filter((u) => u.kind === 'arm');
    expect(arms).toHaveLength(2);
    expect(map.unit[9 * image.width + 25]).toBe(map.unit[14 * image.width + 25]);
    expect(map.unit[10 * image.width + 5]).not.toBe(map.unit[9 * image.width + 25]);
  });

  it('gives a near arm its dark outline but leaves an equally dark garment on the body', () => {
    const BLACK: Rgb = [20, 20, 24];
    const image = sprite(40, 30, (x, y) => {
      if (y >= 12 && y <= 14 && x >= 13 && x <= 30) return RED; // near arm
      if ((y === 11 || y === 15) && x >= 13 && x <= 19) return BLACK; // its outline
      if (y >= 2 && y <= 28 && x >= 10 && x <= 19) return y >= 20 ? BLACK : GRAY; // torso, dark trousers
      return null;
    });
    // A leg-less frame: the arm reaches over the torso and out past it.
    const map = assignParts(image, [
      mask(image, 'arm', '0', (x, y) => y >= 12 && y <= 14 && x >= 13),
    ]);
    const arm = map.units.find((u) => u.kind === 'arm')!;
    expect(arm.depth).toBe('near');
    expect(map.unit[11 * image.width + 16]).toBe(arm.id);
    expect(map.unit[15 * image.width + 16]).toBe(arm.id);
    expect(map.unit[10 * image.width + 16]).toBe(0);
    expect(map.unit[22 * image.width + 16]).toBe(0);
  });

  it('joins an arm cut at a wristband, with the band', () => {
    // Shoulder at the left, a 2 px body-colored band, then the hand piece.
    const image = sprite(48, 30, (x, y) => {
      if (y >= 2 && y <= 28 && x >= 2 && x <= 11) return GRAY; // torso
      if (y >= 8 && y <= 11 && x >= 12 && x <= 25) return RED; // upper arm
      if (y >= 8 && y <= 11 && x >= 26 && x <= 27) return GRAY; // band
      if (y >= 7 && y <= 12 && x >= 28 && x <= 38) return PINK; // forearm + hand
      return null;
    });
    const map = assignParts(image, [
      mask(image, 'arm', '0', (x, y) => y >= 8 && y <= 11 && x >= 12 && x <= 25),
      mask(image, 'arm', '1', (x, y) => y >= 7 && y <= 12 && x >= 28),
    ]);
    const arms = map.units.filter((u) => u.kind === 'arm');
    expect(arms).toHaveLength(1);
    expect(map.unit[9 * image.width + 26]).toBe(arms[0]!.id);
    expect(map.unit[9 * image.width + 37]).toBe(arms[0]!.id);
  });

  it('marks the arm drawn over the torso near and the arm sticking out behind far', () => {
    const image = sprite(40, 30, (x, y) => {
      if (y >= 12 && y <= 14 && x >= 14 && x <= 22) return RED; // over the torso
      if (y >= 6 && y <= 8 && x >= 24 && x <= 34) return [90, 30, 30]; // beyond the torso
      if (y >= 2 && y <= 28 && x >= 10 && x <= 23) return GRAY;
      return null;
    });
    const map = assignParts(image, [
      mask(image, 'arm', 'over', (x, y) => y >= 12 && y <= 14 && x >= 14 && x <= 22),
      mask(image, 'arm', 'out', (x, y) => y >= 6 && y <= 8 && x >= 24),
    ]);
    expect(map.units.find((u) => u.sources.includes('arm#over'))!.depth).toBe('near');
    expect(map.units.find((u) => u.sources.includes('arm#out'))!.depth).toBe('far');
  });

  it('finds root, joint and tip along a bent limb', () => {
    // An L: down 12 px from (5,0), then right 12 px; anchor at the top.
    const width = 30;
    const points: number[] = [];
    for (let y = 0; y < 14; y++) for (let x = 4; x < 7; x++) points.push(y * width + x);
    for (let y = 12; y < 15; y++) for (let x = 7; x < 20; x++) points.push(y * width + x);
    const bone = boneOf(points, width, [5, -2]);
    expect(bone.root[1]).toBeLessThan(3);
    expect(bone.tip[0]).toBeGreaterThan(17);
    expect(Math.hypot(bone.joint[0] - 6, bone.joint[1] - 13)).toBeLessThan(4);
  });
});

describe('rigid transforms and compositing', () => {
  it('composes, inverts and rotates about a pivot', () => {
    const quarter = rigid(Math.PI / 2, [10, 10]);
    const moved = apply(quarter, 11, 10);
    expect(moved[0]).toBeCloseTo(10);
    expect(moved[1]).toBeCloseTo(11);
    const m: Affine = compose(rigid(0.3, [4, 5], 2, -1), rigid(-1.1, [7, 2], 3, 3));
    const back = apply(invert(m), ...apply(m, 3.5, -2));
    expect(back[0]).toBeCloseTo(3.5);
    expect(back[1]).toBeCloseTo(-2);
  });

  it('reproduces the source exactly with identity transforms', () => {
    const image = figure();
    const map = assignParts(image, figureMasks(image));
    expect(renderRig(image, map, new Map()).data).toEqual(image.data);
  });

  it('turns one part rigidly with original colors and leaves the rest alone', () => {
    const ox = 12;
    const image = figure(ox);
    const map = assignParts(image, figureMasks(image, ox));
    const legA = map.unit[30 * image.width + ox + 12]!;
    // Swing leg A a quarter turn about its hip, so it points left (clear of
    // the torso, which legs pass behind).
    const out = renderRig(image, map, new Map([[legA, rigid(Math.PI / 2, [ox + 12.5, 26.5])]]));
    expect(count(out, BLUE)).toBe(count(image, BLUE));
    expect([...palette(out)].every((c) => palette(image).has(c))).toBe(true);
    expect(isOpaque(out, ox + 12, 35)).toBe(false); // where the leg hung
    expect(colorAt(out, ox + 4, 26)).toEqual([...BLUE, 255]); // where it points now
    expect(colorAt(out, ox + 17, 35)).toEqual([...CYAN, 255]); // other leg untouched
    expect(colorAt(out, ox + 15, 20)).toEqual([...GRAY, 255]);
  });

  it('draws near arms over the body and far arms behind it', () => {
    const image = sprite(40, 20, (x, y) => {
      if (y >= 8 && y <= 10 && x >= 24 && x <= 34) return RED;
      if (y >= 2 && y <= 18 && x >= 10 && x <= 21) return GRAY;
      return null;
    });
    const map = assignParts(image, [mask(image, 'arm', '0', (x) => x >= 24)]);
    const slide = new Map([[1, rigid(0, [0, 0], -10, 0)]]);
    map.units[1]!.depth = 'near';
    expect(colorAt(renderRig(image, map, slide), 16, 9)).toEqual([...RED, 255]);
    map.units[1]!.depth = 'far';
    expect(colorAt(renderRig(image, map, slide), 16, 9)).toEqual([...GRAY, 255]);
  });

  it('fills small enclosed holes and one-pixel cracks but not open space or big holes', () => {
    const image = sprite(30, 20, (x, y) => {
      if (x === 5 && y === 5) return null; // 1 px hole
      if (x >= 9 && x <= 10 && y >= 9 && y <= 10) return null; // 2x2 hole
      if (x >= 16 && x <= 25 && y >= 4 && y <= 15) return null; // big hole
      if (x >= 2 && x <= 27 && y >= 2 && y <= 17) return GRAY;
      return null;
    });
    const out = fillHoles(image, 16);
    expect(isOpaque(out, 5, 5)).toBe(true);
    expect(isOpaque(out, 10, 10)).toBe(true);
    expect(isOpaque(out, 20, 10)).toBe(false);
    expect(isOpaque(out, 0, 0)).toBe(false);
    expect([...palette(out)]).toEqual([GRAY.join(',')]);
  });
});

/** A body block with one leg: angled forward in the contact, straight
 * down in the idle. Feet on the bottom row. */
function legFrames() {
  const leg = (angle: number) => (x: number, y: number) => {
    if (y < 31) return false;
    const along = (x + 0.5 - 30) * Math.cos(angle) + (y + 0.5 - 31) * Math.sin(angle);
    const across = -(x + 0.5 - 30) * Math.sin(angle) + (y + 0.5 - 31) * Math.cos(angle);
    return along >= 0 && Math.abs(across) <= 1.6;
  };
  const frame = (angle: number) =>
    sprite(64, 60, (x, y) =>
      y >= 10 && y <= 30 && x >= 22 && x <= 37 ? GRAY : leg(angle)(x, y) ? BLUE : null,
    );
  const contact = frame(Math.PI / 3);
  const idle = frame(Math.PI / 2);
  const legMask = (image: RigImage) => mask(image, 'leg', '0', (_x, y) => y >= 31);
  return {
    contact,
    idle,
    contactMap: assignParts(contact, [legMask(contact)]),
    idleMap: assignParts(idle, [legMask(idle)]),
  };
}

describe('rigid-limb in-between', () => {
  const rowsOf = (image: RigImage, rgb?: Rgb) => {
    const rows: number[] = [];
    for (let p = 0; p < image.width * image.height; p++)
      if (image.data[p * 4 + 3]! > 8 && (!rgb || rgb.every((v, k) => image.data[p * 4 + k] === v)))
        rows.push(Math.floor(p / image.width));
    return { top: Math.min(...rows), bottom: Math.max(...rows) };
  };

  it('turns limbs rigidly toward straight down and raises the figure to keep feet down', () => {
    const { contact, contactMap } = legFrames();
    const result = rigidLimbInbetween(contact, contactMap, 1 / 3);
    const out = result.image;
    expect([...palette(out)].every((c) => palette(contact).has(c))).toBe(true);
    expect(count(out, GRAY)).toBe(count(contact, GRAY));
    expect(result.limbs).toHaveLength(1);
    // The leg points about 60° from the hip: a third of the way to 90°.
    expect(Math.abs((result.limbs[0]!.turn * 180) / Math.PI - 10)).toBeLessThan(1);
    expect(result.rise).toBeGreaterThan(0);
    expect(out.height).toBe(contact.height + result.grownTop);
    expect(rowsOf(out).bottom).toBe(out.height - 1);
    expect(rowsOf(out, GRAY).top).toBe(rowsOf(contact, GRAY).top + result.grownTop - result.rise);
  });

  it('caps the rise by squashing the fully turned legs, keeping the canvas', () => {
    const { contact, contactMap, idle } = legFrames();
    const free = rigidLimbInbetween(contact, contactMap, 1 / 3);
    const half = rigidLimbInbetween(contact, contactMap, 1 / 3, { riseCap: free.rise / 2 });
    expect(half.limbs[0]!.turn).toBeCloseTo(free.limbs[0]!.turn);
    expect(half.legSquash).toBeGreaterThan(0.8);
    expect(half.legSquash).toBeLessThan(1);
    expect(half.rise).toBeLessThanOrEqual(Math.ceil(free.rise / 2) + 1);
    // The figure stands no taller than it strides, so nothing may rise.
    expect(standingHeightGain(contact, idle)).toBe(0);
    const none = rigidLimbInbetween(contact, contactMap, 1 / 3, { riseCap: 0 });
    expect(none.limbs[0]!.turn).toBeCloseTo(free.limbs[0]!.turn);
    expect(none.rise).toBeLessThanOrEqual(1);
    expect(none.grownTop).toBe(0);
    expect(none.image.height).toBe(contact.height);
    expect(count(none.image, GRAY)).toBe(count(contact, GRAY));
    expect(rowsOf(none.image).bottom).toBe(contact.height - 1);
  });

  /** A wide robe (rows 10–30) with two legs starting under it 28 px apart,
   * splayed 30° from vertical, feet on the bottom row. */
  function robeFrame() {
    const leg = (hipX: number, angle: number) => (x: number, y: number) => {
      const along = (x + 0.5 - hipX) * Math.cos(angle) + (y + 0.5 - 31) * Math.sin(angle);
      const across = -(x + 0.5 - hipX) * Math.sin(angle) + (y + 0.5 - 31) * Math.cos(angle);
      return y >= 31 && along >= 0 && Math.abs(across) <= 2;
    };
    const back = leg(16, (2 * Math.PI) / 3);
    const front = leg(44, Math.PI / 3);
    const image = sprite(64, 56, (x, y) =>
      y >= 10 && y <= 30 && x >= 8 && x <= 52
        ? GRAY
        : back(x, y)
          ? CYAN
          : front(x, y)
            ? BLUE
            : null,
    );
    const map = assignParts(image, [
      mask(image, 'leg', '0', (x, y) => y >= 31 && x < 30),
      mask(image, 'leg', '1', (x, y) => y >= 31 && x >= 30),
    ]);
    return { image, map };
  }

  it('extends legs up under the body so turning them opens no gap at the hem', () => {
    const { image, map } = robeFrame();
    // Hidden at rest: with no turn the frame is unchanged.
    expect(rigidLimbInbetween(image, map, 0).image.data).toEqual(image.data);
    // Turned 30° → 20° from vertical about a hip 15 px inward, each leg's top
    // would drop about 4 rows; the hidden extension keeps it against the robe.
    const out = rigidLimbInbetween(image, map, 1 / 3).image;
    const body = rowsOf(out, GRAY).bottom;
    expect(rowsOf(out, CYAN).top).toBe(body + 1);
    expect(rowsOf(out, BLUE).top).toBe(body + 1);
  });

  it('checks legs and arms separately', () => {
    const image = figure();
    const both = checkRigFrame(image, assignParts(image, figureMasks(image)));
    expect(both.ok).toBe(true);
    // Arm found, legs not: the arms can still swing rigidly.
    const armOnly = checkRigFrame(
      image,
      assignParts(
        image,
        figureMasks(image).filter((m) => m.concept !== 'leg'),
      ),
    );
    expect(armOnly.ok).toBe(false);
    expect(armOnly.arms.ok).toBe(true);
    expect(armOnly.legs.reasons).toContain('0 of 2 legs found');
    const { contact, contactMap } = legFrames();
    expect(checkRigFrame(contact, contactMap).legs.reasons).toContain('1 of 2 legs found');
  });

  it('rejects arms whose hands are in pieces', () => {
    const image = figure();
    // A second hand piece on the arm (a bracelet read as a hand).
    const split = checkRigFrame(
      image,
      assignParts(image, [
        ...figureMasks(image),
        mask(image, 'hand', '1', (x, y) => y >= 12 && y <= 14 && x >= 22 && x <= 24),
      ]),
    );
    expect(split.arms.ok).toBe(false);
    expect(split.arms.reasons).toContain('arm 1 has 2 hand pieces');
    expect(split.legs.ok).toBe(true);
    // A hand far from every arm stays on the body when the arm swings.
    const loose = checkRigFrame(
      image,
      assignParts(image, [
        ...figureMasks(image).filter((m) => m.concept !== 'hand'),
        mask(image, 'hand', '9', (x, y) => y >= 36 && x >= 16 && x <= 18),
      ]),
    );
    expect(loose.arms.reasons).toContain('hand#9 attached to no arm');
  });

  it('turns both legs about one shared hip pivot', () => {
    const image = figure();
    const result = rigidLimbInbetween(image, assignParts(image, figureMasks(image)), 1 / 3);
    const legs = result.limbs.filter((l) => l.kind === 'leg');
    expect(legs).toHaveLength(2);
    expect(new Set(legs.map((l) => l.pivot.join()))).toEqual(new Set([result.hip!.join()]));
  });
});

describe('rigid arms over pixel shift', () => {
  // Contact and idle on one canvas; the idle stands 2 px further right.
  const [contact, idle] = alignRgbaFrames([figure(0), figure(4)]) as RigImage[];

  it('moves a frame along pixel shift’s field exactly as pixel shift does', () => {
    const field = runInbetweenField(contact!, idle!);
    expect(splatAlongField(contact!, field, 1 / 3).data).toEqual(
      runInbetween(contact!, idle!, 1 / 3).data,
    );
  });

  it('keeps pixel shift’s legs and swings the arm rigidly toward straight down', () => {
    const map = assignParts(
      contact!,
      figureMasks(contact!, 2).filter((m) => m.concept !== 'leg'),
    );
    const result = rigidArmsInbetween(contact!, map, idle!, 1 / 3);
    const pixel = runInbetween(contact!, idle!, 1 / 3);
    const row = (image: RigImage, y: number) =>
      image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4);
    for (let y = 26; y < contact!.height; y++) expect(row(result.image, y)).toEqual(row(pixel, y));
    const meanY = (image: RigImage, rgb: Rgb) => {
      const ys: number[] = [];
      for (let p = 0; p < image.width * image.height; p++)
        if (image.data[p * 4 + 3]! > 8 && rgb.every((v, k) => image.data[p * 4 + k] === v))
          ys.push(Math.floor(p / image.width));
      return ys.reduce((a, b) => a + b, 0) / ys.length;
    };
    expect(result.limbs).toHaveLength(1);
    expect(result.limbs[0]!.turn).toBeGreaterThan(0);
    expect(meanY(result.image, PINK)).toBeGreaterThan(meanY(pixel, PINK) + 2);
  });
});

describe('rig run in-betweens for generation', () => {
  const frames = () => {
    const { contact, idle } = legFrames();
    return { walk1: contact, sideIdle: idle, walk2: contact };
  };

  it('starts every SAM call together and keeps pixel shift where SAM found no limbs', async () => {
    let inFlight = 0;
    let most = 0;
    const concepts: string[] = [];
    const result = await buildRigRunInbetweens(frames(), async (_png, concept) => {
      concepts.push(concept);
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return { masks: [] };
    });
    expect(result.samCalls).toBe(2 * RUN_RIG_CONCEPTS.length);
    expect(concepts.sort()).toEqual([...RUN_RIG_CONCEPTS, ...RUN_RIG_CONCEPTS].sort());
    expect(most).toBe(2 * RUN_RIG_CONCEPTS.length);
    const pixel = buildRunInbetweens(frames());
    expect(result.runMid1.method).toBe('pixel shift');
    expect(result.runMid1.reasons).toContain('0 of 2 legs found');
    expect(result.runMid1.image.data).toEqual(pixel.runMid1.data);
    expect(result.runMid2.image.data).toEqual(pixel.runMid2.data);
  });

  it('rejects when a SAM call fails, so the caller can skip the frames', async () => {
    await expect(
      buildRigRunInbetweens(frames(), async (_png, concept) => {
        if (concept === 'leg') throw new Error('SAM unavailable');
        return { masks: [] };
      }),
    ).rejects.toThrow('SAM unavailable');
  });
});

describe('golden-platformer run in-betweens', () => {
  it('match what the rig computes from its recorded SAM responses', async () => {
    const dir = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../generation/golden/golden-platformer.assets',
    );
    const recorded = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          'fixtures/golden-platformer-run-rig-sam.json',
        ),
        'utf8',
      ),
    ) as { frames: Record<'walk-1' | 'walk-2', Record<string, SegmentationMaskRecord[]>> };
    const read = (file: string) => decodeRigImage(readFileSync(join(dir, file)));
    const frames = {
      walk1: await read(GENERATED_GAME_ASSET_FILES.platformerWalk1),
      sideIdle: await read(GENERATED_GAME_ASSET_FILES.platformerSideIdle),
      walk2: await read(GENERATED_GAME_ASSET_FILES.platformerWalk2),
    };
    const [walk1] = alignRgbaFrames([frames.walk1, frames.sideIdle, frames.walk2]) as RigImage[];
    const first = await encodeRigImage(samInputPixels(walk1!, RUN_RIG_SAM_INPUT));
    const result = await buildRigRunInbetweens(frames, async (png, concept) => ({
      masks: recorded.frames[png.equals(first) ? 'walk-1' : 'walk-2'][concept]!,
    }));
    expect([result.runMid1.method, result.runMid2.method]).toEqual(['rigid', 'rigid']);
    // Changing the rig's output needs a new PLATFORMER_RUN_RIG_VERSION and
    // regenerated golden frames (scripts/backfill-run-rig.mts --golden --live).
    expect(result.runMid1.image.data).toEqual(
      (await read(GENERATED_GAME_ASSET_FILES.platformerRunMid1)).data,
    );
    expect(result.runMid2.image.data).toEqual(
      (await read(GENERATED_GAME_ASSET_FILES.platformerRunMid2)).data,
    );
  });
});
