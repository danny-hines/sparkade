import { describe, expect, it } from 'vitest';
import type { FighterBuild, FighterOutfit } from '@sparkade/shared';
import {
  FIGHTER_POSES,
  FIGHTER_FOOT_PRESETS,
  FIGHTER_FOOT_SHAPES,
  FIGHTER_HAND_SHAPES,
  FIGHTER_OUTFIT_IDS,
  FIGHTER_OUTFIT_RIG_BOUNDS,
  FIGHTER_OUTFIT_RIG_DOCUMENT,
  FIGHTER_OUTFIT_RIGS,
  cloneFighterOutfitRig,
  cloneFighterOutfitRigs,
  drawFighterAvatarHead,
  drawFighter,
  fighterColorsForPalette,
  fighterIdentitySeed,
  fighterScaleForBuild,
  resolveFighterAvatarHead,
  validateFighterOutfitRig,
  validateFighterOutfitRigDocument,
  validateFighterOutfitRigs,
  type FighterOutfitRig,
  type FigureOpts,
} from '../src';
import { fallbackFighterOutfit } from '../src/fighter/game';

interface DrawEvent {
  op: string;
  args: unknown[];
  lineWidth?: number;
  lineCap?: CanvasLineCap;
  strokeStyle?: string;
  fillStyle?: string;
  filter?: string;
}

class RecordingContext {
  events: DrawEvent[] = [];
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000000';
  lineWidth = 1;
  lineCap: CanvasLineCap = 'butt';
  imageSmoothingEnabled = true;
  filter = 'none';
  private stack: Array<{ filter: string; smoothing: boolean }> = [];
  private path: number[][] = [];

  beginPath(): void {
    this.path = [];
    this.events.push({ op: 'beginPath', args: [] });
  }
  closePath(): void {
    this.events.push({ op: 'closePath', args: [] });
  }
  moveTo(...args: number[]): void {
    this.path.push(args);
    this.events.push({ op: 'moveTo', args });
  }
  lineTo(...args: number[]): void {
    this.path.push(args);
    this.events.push({ op: 'lineTo', args });
  }
  arc(...args: number[]): void {
    this.events.push({ op: 'arc', args });
  }
  stroke(): void {
    this.events.push({
      op: 'stroke',
      args: [...this.path],
      lineWidth: this.lineWidth,
      lineCap: this.lineCap,
      strokeStyle: String(this.strokeStyle),
    });
  }
  fill(): void {
    this.events.push({ op: 'fill', args: [...this.path], fillStyle: String(this.fillStyle) });
  }
  fillRect(...args: number[]): void {
    this.events.push({ op: 'fillRect', args, fillStyle: String(this.fillStyle) });
  }
  save(): void {
    this.stack.push({ filter: this.filter, smoothing: this.imageSmoothingEnabled });
    this.events.push({ op: 'save', args: [] });
  }
  restore(): void {
    const state = this.stack.pop();
    if (state) {
      this.filter = state.filter;
      this.imageSmoothingEnabled = state.smoothing;
    }
    this.events.push({ op: 'restore', args: [] });
  }
  translate(...args: number[]): void {
    this.events.push({ op: 'translate', args });
  }
  rotate(...args: number[]): void {
    this.events.push({ op: 'rotate', args });
  }
  scale(...args: number[]): void {
    this.events.push({ op: 'scale', args });
  }
  drawImage(...args: unknown[]): void {
    this.events.push({ op: 'drawImage', args, filter: this.filter });
  }
}

const colors = {
  body: '#5588cc',
  limb: '#334477',
  skin: '#c98f6b',
  trim: '#f4d35e',
  outline: '#171525',
};

function options(
  outfit: FighterOutfit,
  build: FighterBuild = 'balanced',
  patch: Partial<FigureOpts> = {},
): FigureOpts {
  return {
    cx: 100,
    feetY: 200,
    facing: 1,
    pose: 'idle',
    t: 0,
    anim: 0,
    scale: build === 'nimble' ? 0.94 : build === 'heavy' ? 1.16 : 1.05,
    build,
    outfit,
    avatarHead: resolveFighterAvatarHead(fighterIdentitySeed(1234, 0, 'HERO')),
    colors,
    ...patch,
  };
}

function render(opts: FigureOpts): RecordingContext {
  const recording = new RecordingContext();
  drawFighter(recording as unknown as CanvasRenderingContext2D, opts);
  return recording;
}

describe('fighter figure personalization', () => {
  it('derives stable, order-independent, varied avatar identities without runtime randomness', () => {
    const originalRandom = Math.random;
    Math.random = () => {
      throw new Error('avatar identity must not consume Math.random');
    };
    try {
      const names = ['TILE', 'BRASS', 'VESPER', 'Moth King'];
      const forward = names.map((name, index) => {
        const seed = fighterIdentitySeed(90210, index + 1, name);
        return [name, seed, resolveFighterAvatarHead(seed)] as const;
      });
      const reverse = [...names].reverse().map((name) => {
        const index = names.indexOf(name);
        const seed = fighterIdentitySeed(90210, index + 1, name);
        return [name, seed, resolveFighterAvatarHead(seed)] as const;
      });
      for (const [name, seed, head] of forward) {
        const reversed = reverse.find(([candidate]) => candidate === name)!;
        expect(reversed[1]).toBe(seed);
        expect(reversed[2]).toEqual(head);
      }
      expect(new Set(forward.map(([, , head]) => JSON.stringify(head))).size).toBe(4);
      expect(fighterIdentitySeed(90210, 1, 'TILE')).not.toBe(fighterIdentitySeed(90210, 2, 'TILE'));
      expect(fighterIdentitySeed(90210, 1, 'TILE')).not.toBe(fighterIdentitySeed(90211, 1, 'TILE'));

      const identitySeed = fighterIdentitySeed(77, 3, 'Mutable');
      const first = resolveFighterAvatarHead(identitySeed);
      const expected = { ...first };
      first.hairStyle = first.hairStyle === 'bald' ? 'crop' : 'bald';
      expect(resolveFighterAvatarHead(identitySeed)).toEqual(expected);

      const corpus = Array.from({ length: 128 }, (_, index) =>
        resolveFighterAvatarHead(fighterIdentitySeed(42, index + 1, `RIVAL-${index}`)));
      expect(new Set(corpus.map((head) => JSON.stringify(head))).size).toBeGreaterThanOrEqual(64);
      expect(new Set(corpus.map((head) => head.faceShape)).size).toBe(4);
      expect(new Set(corpus.map((head) => head.hairStyle)).size).toBe(7);
      expect(new Set(corpus.map((head) => head.hairRole)).size).toBe(3);
      expect(new Set(corpus.map((head) => head.facialHair)).size).toBe(4);
      expect(new Set(corpus.map((head) => head.eyeStyle)).size).toBe(3);
      expect(new Set(corpus.map((head) => head.detail)).size).toBe(4);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('draws mirrored and rotated pixel-avatar heads without the legacy circle', () => {
    const head = resolveFighterAvatarHead(fighterIdentitySeed(17, 2, 'VESPER'));
    const right = new RecordingContext();
    const left = new RecordingContext();
    const ko = new RecordingContext();
    drawFighterAvatarHead(
      right as unknown as CanvasRenderingContext2D,
      head,
      'street',
      colors,
      40,
      50,
      1,
    );
    drawFighterAvatarHead(
      left as unknown as CanvasRenderingContext2D,
      head,
      'street',
      colors,
      40,
      50,
      -1,
    );
    drawFighterAvatarHead(
      ko as unknown as CanvasRenderingContext2D,
      head,
      'street',
      colors,
      40,
      50,
      1,
      -Math.PI / 2,
    );

    expect(right.events.some((event) => event.op === 'fill')).toBe(true);
    expect(right.events.some((event) => event.op === 'fillRect')).toBe(true);
    expect(right.events.some((event) => event.op === 'arc')).toBe(false);
    expect(right.events.find((event) => event.op === 'translate')?.args).toEqual([40, 50]);
    expect(right.events.find((event) => event.op === 'scale')?.args).toEqual([1, 1]);
    expect(left.events.find((event) => event.op === 'scale')?.args).toEqual([-1, 1]);
    expect(ko.events.find((event) => event.op === 'rotate')?.args[0]).toBeCloseTo(-Math.PI / 2);

    const withoutTransform = (events: DrawEvent[]): DrawEvent[] =>
      events.filter((event) => !['translate', 'scale', 'rotate'].includes(event.op));
    expect(withoutTransform(left.events)).toEqual(withoutTransform(right.events));

    const white = { body: '#ffffff', limb: '#ffffff', skin: '#ffffff', trim: '#ffffff', outline: '#ffffff' };
    const flashed = new RecordingContext();
    drawFighterAvatarHead(
      flashed as unknown as CanvasRenderingContext2D,
      head,
      'street',
      white,
      40,
      50,
      1,
    );
    const painted = flashed.events.filter((event) => event.op === 'fill' || event.op === 'fillRect');
    expect(painted.length).toBeGreaterThan(0);
    expect(new Set(painted.map((event) => event.fillStyle))).toEqual(new Set(['#ffffff']));
  });

  it('ships a strict, valid, independently cloneable outfit rig document', () => {
    const documentResult = validateFighterOutfitRigDocument(FIGHTER_OUTFIT_RIG_DOCUMENT);
    expect(documentResult.ok).toBe(true);
    expect(Object.keys(FIGHTER_OUTFIT_RIGS)).toEqual(FIGHTER_OUTFIT_IDS);

    const clone = cloneFighterOutfitRigs();
    clone.gi.torso.widthAdd = 3;
    expect(FIGHTER_OUTFIT_RIGS.gi.torso.widthAdd).toBe(0);
    expect(validateFighterOutfitRigs(clone).ok).toBe(true);

    const withExtraKey = {
      ...cloneFighterOutfitRig(FIGHTER_OUTFIT_RIGS.gi),
      extra: true,
    };
    const extraResult = validateFighterOutfitRig(withExtraKey);
    expect(extraResult.ok).toBe(false);
    if (!extraResult.ok) expect(extraResult.errors.join(' ')).toContain('extra');

    const outsideBounds = cloneFighterOutfitRig(FIGHTER_OUTFIT_RIGS.gi);
    outsideBounds.hands.radius = FIGHTER_OUTFIT_RIG_BOUNDS.hands.radius.max + 0.01;
    const boundsResult = validateFighterOutfitRig(outsideBounds);
    expect(boundsResult.ok).toBe(false);
    if (!boundsResult.ok) expect(boundsResult.errors.join(' ')).toContain('hands.radius');
  });

  it('ships normal footwear presets and uses one for every default outfit', () => {
    for (const feet of Object.values(FIGHTER_FOOT_PRESETS)) {
      const rig = cloneFighterOutfitRig(FIGHTER_OUTFIT_RIGS.gi);
      rig.feet = { ...feet };
      expect(validateFighterOutfitRig(rig).ok).toBe(true);
    }

    const presets = Object.values(FIGHTER_FOOT_PRESETS).map((feet) => JSON.stringify(feet));
    for (const outfit of FIGHTER_OUTFIT_IDS) {
      expect(presets).toContain(JSON.stringify(FIGHTER_OUTFIT_RIGS[outfit].feet));
    }
  });

  it('keeps both shoes facing forward while foreshortening the rear foot around its ankle', () => {
    const rig = cloneFighterOutfitRig(FIGHTER_OUTFIT_RIGS.gi);
    rig.feet = { ...FIGHTER_FOOT_PRESETS.sneakers };
    const stanceCases = [
      { pose: 'idle' as const, anim: 0, ankles: [-7, 7] },
      { pose: 'walk' as const, anim: Math.PI / 18, ankles: [-12, 12] },
      { pose: 'walk' as const, anim: Math.PI / 6, ankles: [-2, 2] },
    ];

    for (const build of ['nimble', 'balanced', 'heavy'] as const) {
      const scale = fighterScaleForBuild(build);
      for (const facing of [1, -1] as const) {
        for (const stance of stanceCases) {
          const ctx = render(options('gi', build, {
            facing,
            outfitRig: rig,
            pose: stance.pose,
            anim: stance.anim,
            scale,
          }));
          const shoeUppers = ctx.events.filter(
            (event) => event.op === 'fill'
              && event.fillStyle === colors.trim
              && event.args.length === 6,
          );
          expect(shoeUppers).toHaveLength(2);

          const overhangs = shoeUppers.map((event, index) => {
            const points = event.args as number[][];
            const xs = points.map((point) => (point[0]! - 100) / (facing * scale));
            const ankleX = stance.ankles[index]!;
            return {
              forward: Math.max(...xs) - ankleX,
              backward: ankleX - Math.min(...xs),
            };
          });
          const rear = overhangs[0]!;
          const front = overhangs[1]!;
          expect(rear.forward).toBeGreaterThan(rear.backward);
          expect(rear.forward).toBeLessThanOrEqual(rear.backward + 0.55);
          expect(front.forward).toBeGreaterThan(front.backward + 0.75);
          expect(rear.forward).toBeLessThan(front.forward);
        }
      }
    }
  });

  it('covers butt-ended footwear legs with a centered ankle collar above the sole', () => {
    const rig = cloneFighterOutfitRig(FIGHTER_OUTFIT_RIGS.gi);
    rig.feet = { ...FIGHTER_FOOT_PRESETS.sneakers };
    const legWidths: Record<FighterBuild, number> = { nimble: 4, balanced: 5, heavy: 6.5 };
    const cases: Array<Pick<FigureOpts, 'pose' | 't' | 'anim'>> = [
      { pose: 'idle', t: 0, anim: 0 },
      { pose: 'walk', t: 0, anim: Math.PI / 18 },
      { pose: 'jump', t: 0, anim: 0 },
      { pose: 'kickLow', t: 0.12, anim: 0 },
      { pose: 'kickHigh', t: 0.12, anim: 0 },
      { pose: 'ko', t: 0.12, anim: 0 },
    ];

    for (const build of ['nimble', 'balanced', 'heavy'] as const) {
      const scale = fighterScaleForBuild(build);
      const legLineWidth = legWidths[build] * scale;
      for (const facing of [1, -1] as const) {
        for (const poseCase of cases) {
          const ctx = render(options('gi', build, {
            ...poseCase,
            facing,
            outfitRig: rig,
            scale,
          }));
          const legStrokes = ctx.events.filter(
            (event) => event.op === 'stroke'
              && event.strokeStyle === colors.limb
              && Math.abs((event.lineWidth ?? 0) - legLineWidth) < 0.001,
          );
          const soles = ctx.events.filter(
            (event) => event.op === 'fill'
              && event.fillStyle === colors.outline
              && event.args.length === 4,
          );
          const collars = ctx.events.filter(
            (event) => event.op === 'fill'
              && event.fillStyle === colors.trim
              && event.args.length === 4,
          );
          expect(legStrokes).toHaveLength(poseCase.pose === 'ko' ? 1 : 2);
          expect(soles).toHaveLength(legStrokes.length);
          expect(collars).toHaveLength(legStrokes.length);

          for (let index = 0; index < legStrokes.length; index++) {
            const legStroke = legStrokes[index]!;
            const legPoints = legStroke.args as number[][];
            const solePoints = soles[index]!.args as number[][];
            const collarPoints = collars[index]!.args as number[][];
            const legEndX = legPoints.at(-1)![0]!;
            const legEndY = legPoints.at(-1)![1]!;
            const soleY = Math.max(...solePoints.map((point) => point[1]!));
            const collarXs = collarPoints.map((point) => point[0]!);
            const collarYs = collarPoints.map((point) => point[1]!);
            expect(legStroke.lineCap).toBe('butt');
            expect(legEndY + legLineWidth / 2).toBeLessThanOrEqual(soleY + 0.01);
            expect(Math.min(...collarXs)).toBeLessThan(legEndX);
            expect(Math.max(...collarXs)).toBeGreaterThan(legEndX);
            expect(Math.min(...collarYs)).toBeLessThanOrEqual(legEndY);
            expect(Math.max(...collarYs)).toBeGreaterThan(legEndY);
            expect(Math.abs(collarPoints[1]![0]! - collarPoints[0]![0]!))
              .toBeGreaterThanOrEqual(legLineWidth);
            expect(ctx.events.indexOf(collars[index]!))
              .toBeGreaterThan(ctx.events.indexOf(legStroke));
          }
        }
      }
    }

    const scale = 1.05;
    const ankleXs = [-7, 7].map((x) => 100 + x * scale);
    const noFootRig = cloneFighterOutfitRig(rig);
    noFootRig.feet = { ...FIGHTER_FOOT_PRESETS.none };
    const noFoot = render(options('gi', 'balanced', { outfitRig: noFootRig }));
    const bareLegStrokes = noFoot.events.filter(
      (event) => event.op === 'stroke'
        && event.strokeStyle === colors.limb
        && Math.abs((event.lineWidth ?? 0) - 5 * scale) < 0.001,
    );
    for (let index = 0; index < bareLegStrokes.length; index++) {
      const points = bareLegStrokes[index]!.args as number[][];
      const end = points.at(-1)!;
      expect(bareLegStrokes[index]!.lineCap).toBe('round');
      expect(end[0]).toBeCloseTo(ankleXs[index]!);
      expect(end[1]).toBeCloseTo(200);
    }
  });

  it('shares production build scales and palette color roles with previews', () => {
    expect(fighterScaleForBuild('nimble')).toBe(0.94);
    expect(fighterScaleForBuild('balanced')).toBe(1.05);
    expect(fighterScaleForBuild('heavy')).toBe(1.16);

    const palette = Array.from({ length: 16 }, (_, i) => `slot-${i}`);
    expect(fighterColorsForPalette(palette, 5)).toEqual({
      body: 'slot-5',
      limb: 'slot-4',
      skin: 'slot-7',
      trim: 'slot-14',
      outline: 'slot-1',
    });
    expect(fighterColorsForPalette(palette, 10)).toEqual({
      body: 'slot-10',
      limb: 'slot-9',
      skin: 'slot-10',
      trim: 'slot-14',
      outline: 'slot-1',
    });
  });

  it('renders every public pose, build, outfit, facing, and attack phase combination', () => {
    const builds: FighterBuild[] = ['nimble', 'balanced', 'heavy'];
    const outfits: FighterOutfit[] = ['gi', 'boxer', 'wrestler', 'street', 'robe', 'armor'];

    for (const pose of FIGHTER_POSES) {
      for (const build of builds) {
        for (const outfit of outfits) {
          for (const facing of [1, -1] as const) {
            for (const t of [0, 0.12]) {
              expect(() =>
                render(
                  options(outfit, build, {
                    pose,
                    facing,
                    t,
                    anim: 1.25,
                    scale: fighterScaleForBuild(build),
                  }),
                ),
              ).not.toThrow();
            }
          }
        }
      }
    }
  });

  it('renders every pose and build with valid boundary rigs without non-finite geometry', () => {
    const rigs = cloneFighterOutfitRigs();
    for (let i = 0; i < FIGHTER_OUTFIT_IDS.length; i++) {
      const id = FIGHTER_OUTFIT_IDS[i]!;
      const rig = rigs[id];
      const high = i % 2 === 0;
      const endpoint = (bounds: { min: number; max: number }): number =>
        high ? bounds.max : bounds.min;
      rig.torso.widthAdd = endpoint(FIGHTER_OUTFIT_RIG_BOUNDS.torso.widthAdd);
      rig.torso.shoulderAdd = endpoint(FIGHTER_OUTFIT_RIG_BOUNDS.torso.shoulderAdd);
      rig.torso.hemDrop = endpoint(FIGHTER_OUTFIT_RIG_BOUNDS.torso.hemDrop);
      rig.torso.detailWeight = endpoint(FIGHTER_OUTFIT_RIG_BOUNDS.torso.detailWeight);
      rig.arms.widthAdd = endpoint(FIGHTER_OUTFIT_RIG_BOUNDS.arms.widthAdd);
      rig.arms.sleeveLength = endpoint(FIGHTER_OUTFIT_RIG_BOUNDS.arms.sleeveLength);
      rig.arms.sleeveWidthAdd = endpoint(FIGHTER_OUTFIT_RIG_BOUNDS.arms.sleeveWidthAdd);
      rig.legs.widthAdd = endpoint(FIGHTER_OUTFIT_RIG_BOUNDS.legs.widthAdd);
      rig.hands.radius = endpoint(FIGHTER_OUTFIT_RIG_BOUNDS.hands.radius);
      rig.hands.cuffLength = endpoint(FIGHTER_OUTFIT_RIG_BOUNDS.hands.cuffLength);
      rig.hands.shape = FIGHTER_HAND_SHAPES[i % FIGHTER_HAND_SHAPES.length]!;
      rig.feet.lengthAdd = endpoint(FIGHTER_OUTFIT_RIG_BOUNDS.feet.lengthAdd);
      rig.feet.height = endpoint(FIGHTER_OUTFIT_RIG_BOUNDS.feet.height);
      rig.feet.bootLength = endpoint(FIGHTER_OUTFIT_RIG_BOUNDS.feet.bootLength);
      // Keep every shape represented while pairing one boot with the maximum
      // dimensions and shaft coverage.
      rig.feet.shape = i === 4
        ? 'boot'
        : FIGHTER_FOOT_SHAPES[i % FIGHTER_FOOT_SHAPES.length]!;
    }
    const validation = validateFighterOutfitRigs(rigs);
    expect(validation.ok).toBe(true);

    const builds: FighterBuild[] = ['nimble', 'balanced', 'heavy'];
    for (const pose of FIGHTER_POSES) {
      for (const build of builds) {
        for (const outfit of FIGHTER_OUTFIT_IDS) {
          for (const facing of [1, -1] as const) {
            const ctx = render(
              options(outfit, build, {
                pose,
                facing,
                t: 0.12,
                anim: 1.25,
                scale: fighterScaleForBuild(build),
                outfitRig: rigs[outfit],
                guides: true,
              }),
            );
            for (const event of ctx.events) {
              for (const arg of event.args) {
                if (typeof arg === 'number') expect(Number.isFinite(arg)).toBe(true);
              }
            }
          }
        }
      }
    }
  });

  it('supports preview-only skeleton guides without changing the rig', () => {
    const rig: FighterOutfitRig = cloneFighterOutfitRig(FIGHTER_OUTFIT_RIGS.street);
    const before = JSON.stringify(rig);
    const plain = render(options('street', 'balanced', { outfitRig: rig }));
    const guided = render(options('street', 'balanced', { outfitRig: rig, guides: true }));
    expect(guided.events.length).toBeGreaterThan(plain.events.length);
    expect(JSON.stringify(rig)).toBe(before);
  });

  it('uses a stable, gameplay-RNG-free outfit fallback for legacy specs', () => {
    expect(fallbackFighterOutfit(42, 'HERO', 'balanced', 5)).toBe(
      fallbackFighterOutfit(42, 'HERO', 'balanced', 5),
    );

    const seen = new Set<FighterOutfit>();
    for (let seed = 0; seed < 100; seed++) {
      seen.add(fallbackFighterOutfit(seed, `FIGHTER ${seed}`, 'balanced', 5 + (seed % 6)));
    }
    expect(seen).toEqual(new Set(['gi', 'boxer', 'wrestler', 'street', 'robe', 'armor']));
  });

  it('uses the same pixel-avatar fallback upright and knocked out, never the legacy circle', () => {
    const avatarHead = resolveFighterAvatarHead(fighterIdentitySeed(91, 2, 'BRASS'));
    const upright = render(options('boxer', 'heavy', { avatarHead }));
    const ko = render(options('boxer', 'heavy', { avatarHead, pose: 'ko' }));
    const oldRadius = 7 * fighterScaleForBuild('heavy');

    for (const ctx of [upright, ko]) {
      expect(ctx.events.some(
        (event) => event.op === 'arc'
          && Math.abs((event.args[2] as number) - oldRadius) < 0.001
          && event.args[3] === 0
          && event.args[4] === Math.PI * 2,
      )).toBe(false);
      expect(ctx.events.filter((event) => event.op === 'drawImage')).toHaveLength(0);
      expect(ctx.events.some((event) => event.op === 'fill')).toBe(true);
      expect(ctx.events.some((event) => event.op === 'fillRect')).toBe(true);
    }
    expect(upright.events.find((event) => event.op === 'translate')?.args).toEqual([100, 154]);
    expect(ko.events.find((event) => event.op === 'rotate')?.args[0]).toBeCloseTo(-Math.PI / 2);
  });

  it('draws the 16px side likeness at the head joint and mirrors only its facing', () => {
    const head = {} as CanvasImageSource;
    const right = render(options('gi', 'balanced', { likenessHead: head }));
    const left = render(options('gi', 'balanced', { likenessHead: head, facing: -1 }));

    const rightImage = right.events.find((event) => event.op === 'drawImage');
    const leftImage = left.events.find((event) => event.op === 'drawImage');
    expect(rightImage?.args).toEqual([head, -8, -8, 16, 16]);
    expect(leftImage?.args).toEqual([head, -8, -8, 16, 16]);
    expect(right.events.find((event) => event.op === 'translate')?.args).toEqual([100, 158]);
    expect(left.events.find((event) => event.op === 'translate')?.args).toEqual([100, 158]);
    expect(right.events.find((event) => event.op === 'scale')?.args).toEqual([1, 1]);
    expect(left.events.find((event) => event.op === 'scale')?.args).toEqual([-1, 1]);
    const headStart = right.events.findIndex((event) => event.op === 'save');
    const headEnd = right.events.findIndex((event, index) => index > headStart && event.op === 'restore');
    const headEvents = right.events.slice(headStart, headEnd + 1);
    expect(headEvents.some((event) => event.op === 'drawImage')).toBe(true);
    expect(headEvents.some((event) => event.op === 'fill' || event.op === 'fillRect')).toBe(false);
  });

  it('keeps the likeness silhouette during damage flash and rotates it for KO', () => {
    const head = {} as CanvasImageSource;
    const flashed = render(options('armor', 'balanced', { likenessHead: head, flash: true }));
    expect(flashed.events.find((event) => event.op === 'drawImage')?.filter).toBe(
      'brightness(0) invert(1)',
    );

    const ko = render(options('robe', 'balanced', { likenessHead: head, pose: 'ko', facing: -1 }));
    expect(ko.events.filter((event) => event.op === 'drawImage')).toHaveLength(1);
    expect(ko.events.find((event) => event.op === 'rotate')?.args[0]).toBeCloseTo(Math.PI / 2);
  });

  it('gives every bounded outfit a distinct draw recipe in the same pose', () => {
    const outfits: FighterOutfit[] = ['gi', 'boxer', 'wrestler', 'street', 'robe', 'armor'];
    const recipes = outfits.map((outfit) => {
      const ctx = render(options(outfit));
      return JSON.stringify(
        ctx.events.map(({ op, args, lineWidth }) => [op, args, lineWidth]),
      );
    });
    expect(new Set(recipes).size).toBe(outfits.length);
  });

  it('makes builds visibly wider without changing any pose coordinates', () => {
    const maxStroke = (build: FighterBuild): number =>
      Math.max(
        ...render(options('gi', build)).events
          .filter((event) => event.op === 'stroke')
          .map((event) => event.lineWidth ?? 0),
      );

    expect(maxStroke('nimble')).toBeLessThan(maxStroke('balanced'));
    expect(maxStroke('balanced')).toBeLessThan(maxStroke('heavy'));
  });
});
