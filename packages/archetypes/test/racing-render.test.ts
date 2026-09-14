// M4 renderer corrections: sort permutation, longitudinal materials,
// identity-stable scenery, panorama band/offset, exhaust, body fill, plus
// pack-vs-legacy render integration with a recording canvas.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RacingArtBundle } from '@sparkade/engine';
import type { RacingSpec } from '@sparkade/shared';
import {
  PANORAMA_SOURCE_HEIGHT,
  PANORAMA_SOURCE_WIDTH,
  PANORAMA_SOURCE_Y,
  RACING_CAM_BACK,
  RACING_CAM_H,
  RACING_FOCAL,
  RACING_HORIZON,
  RACING_Z_NEAR,
  RACING_Z_SPAN,
  STRIP_BODY_FILL,
  craftPoseSourceX,
  depthShade,
  exhaustFlame,
  fitTileWorld,
  groundSourceSpans,
  isLandmarkSlot,
  makeArtSpriteQueue,
  materialTileRect,
  panoramaMaxOffset,
  panoramaSourceX,
  perspectiveZ,
  projectRoad,
  rowAtlasRow,
  sampleStripRow,
  sceneryAtlasCell,
  scenerySlotFor,
  selectCraftPose,
  sortArtSprites,
  stableRosterNames,
  stripSourceRuns,
  worldTilePhase,
  type ArtSprite,
  type GroundSpan,
  type SourceRun,
} from '../src/racing/index';
import { RACE_CIRCUITS, createRacingGame } from '../src/racing/index';
import type { GameInstance, InputSnapshot } from '@sparkade/engine';
import type { RacingDevHandle } from '../src/racing/index';

function stubImage(width: number, height: number): CanvasImageSource {
  return { width, height } as unknown as CanvasImageSource;
}

function stubPack(): RacingArtBundle {
  return {
    panoramas: [stubImage(1536, 480), stubImage(1536, 480), stubImage(1536, 480)],
    strips: [
      stubImage(192, 64),
      stubImage(192, 64),
      stubImage(192, 64),
      stubImage(192, 64),
      stubImage(192, 64),
    ],
    sceneryAtlas: stubImage(288, 192),
    materialAtlas: stubImage(256, 256),
  };
}

interface DrawCall {
  img: unknown;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

function recordingCtx(draws: DrawCall[]): Record<string, unknown> {
  const gradient = { addColorStop: () => undefined };
  return new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'createLinearGradient') return () => gradient;
        if (p === 'canvas') return { width: 512, height: 300 };
        if (p === 'drawImage') {
          return (
            img: unknown,
            sx: number,
            sy: number,
            sw: number,
            sh: number,
            dx: number,
            dy: number,
            dw: number,
            dh: number,
          ) => {
            draws.push({ img, sx, sy, sw, sh, dx, dy, dw, dh });
          };
        }
        if (p === 'measureText') return () => ({ width: 10 });
        return (..._args: unknown[]) => undefined;
      },
      set: () => true,
    },
  ) as unknown as Record<string, unknown>;
}

function goldenSpec(): RacingSpec {
  const path = join(__dirname, '..', '..', 'generation', 'golden', 'golden-racing.json');
  return JSON.parse(readFileSync(path, 'utf8')) as RacingSpec;
}

function makeGame(
  pack: RacingArtBundle | null,
  spec?: RacingSpec,
): {
  game: GameInstance & RacingDevHandle;
  draws: DrawCall[];
} {
  const draws: DrawCall[] = [];
  const engine = {
    renderer: { ctx: recordingCtx(draws) },
    racingArt: pack,
  } as unknown as import('@sparkade/engine').EngineContext;
  const game = createRacingGame(engine, spec) as GameInstance & RacingDevHandle;
  return { game, draws };
}

function blankInput(): InputSnapshot {
  const input = {} as InputSnapshot;
  for (const b of ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'X', 'Y', 'L', 'R', 'START'] as const) {
    (input as Record<string, unknown>)[b] = { held: false, pressed: false, released: false };
  }
  return input;
}

describe('sortArtSprites permutation', () => {
  it('sorts the repro depths without collapsing identities', () => {
    const q = makeArtSpriteQueue(3);
    const depths = [10, 30, 20];
    for (let k = 0; k < 3; k++) {
      q[k]!.z = depths[k]!;
      q[k]!.order = k;
      q[k]!.img = stubImage(10 + k, 10);
    }
    sortArtSprites(q, 3);
    expect(q.map((e) => e.z)).toEqual([30, 20, 10]);
    const widths = q.map((e) => (e.img as unknown as { width: number }).width).sort();
    expect(widths).toEqual([10, 11, 12]);
  });

  it('is stable on ties and fixes several inversions', () => {
    const q = makeArtSpriteQueue(6);
    const depths = [5, 40, 20, 40, 10, 30];
    for (let k = 0; k < 6; k++) {
      q[k]!.z = depths[k]!;
      q[k]!.order = k;
      q[k]!.img = stubImage(100 + k, 10);
    }
    sortArtSprites(q, 6);
    expect(q.map((e) => e.z)).toEqual([40, 40, 30, 20, 10, 5]);
    // Stable tie: order 1 before order 3.
    expect(q[0]!.order).toBe(1);
    expect(q[1]!.order).toBe(3);
    expect(new Set(q.map((e) => e.order)).size).toBe(6);
  });

  it('orders mixed scenery/pickup/rival depths far-to-near', () => {
    const q = makeArtSpriteQueue(4);
    const entries: Array<Partial<ArtSprite> & { z: number; order: number }> = [
      { z: 9, order: 3000 }, // player
      { z: 200, order: 4 }, // far scenery
      { z: 50, order: 1001 }, // pickup
      { z: 60, order: 2001 }, // rival
    ];
    for (let k = 0; k < 4; k++) {
      Object.assign(
        q[k]!,
        { img: stubImage(1, 1), sx: 0, sy: 0, sw: 1, sh: 1, alpha: 1 },
        entries[k],
      );
    }
    sortArtSprites(q, 4);
    expect(q.map((e) => e.order)).toEqual([4, 2001, 1001, 3000]);
  });
});

describe('material quadrant mapping', () => {
  it('assigns four distinct sentinel rects', () => {
    const rects = {
      road: materialTileRect('road'),
      ground: materialTileRect('ground'),
      curb: materialTileRect('curb'),
      boost: materialTileRect('boost'),
    };
    expect(rects.road).toEqual({ sx: 0, sy: 0, size: 128 });
    expect(rects.ground).toEqual({ sx: 128, sy: 0, size: 128 });
    expect(rects.curb).toEqual({ sx: 0, sy: 128, size: 128 });
    expect(rects.boost).toEqual({ sx: 128, sy: 128, size: 128 });
  });

  it('samples V longitudinally with lap-seam continuity', () => {
    const out: SourceRun[] = [
      { sy: 0, sh: 0, dyFrac: 0, dhFrac: 0 },
      { sy: 0, sh: 0, dyFrac: 0, dhFrac: 0 },
    ];
    const length = 3200;
    const tile = fitTileWorld(length, 64);
    expect(length / tile).toBe(Math.round(length / tile));
    const vAt = (ws: number): number => ((((ws / tile) * 128) % 128) + 128) % 128;
    // Actual far-near call order: the far edge sits AHEAD of the near edge
    // (wsFarW > wsNearW is the normal case). Adjacent strips meet: V at the
    // shared boundary is identical, and V decreases far→near.
    const a: SourceRun[] = out.map((r) => ({ ...r }));
    const b: SourceRun[] = out.map((r) => ({ ...r }));
    const n1 = stripSourceRuns(116, 100, length, tile, 128, a);
    const n2 = stripSourceRuns(132, 116, length, tile, 128, b);
    expect(n1).toBeGreaterThan(0);
    expect(n2).toBeGreaterThan(0);
    // Regression: the normal order must sample one strip, not the whole lap.
    expect(a[0]!.sh + (n1 > 1 ? a[1]!.sh : 0)).toBeLessThanOrEqual(128);
    expect(b[0]!.sh + (n2 > 1 ? b[1]!.sh : 0)).toBeLessThanOrEqual(128);
    // Shared boundary worldS=116: A's far edge meets B's near edge.
    expect((a[0]!.sy + a[0]!.sh) % 128).toBeCloseTo(vAt(116), 9);
    expect(b[n2 - 1]!.sy % 128).toBeCloseTo(vAt(116), 9);
    // Seam: far just wrapped (56), near still behind (length-8); sampling
    // splits into two runs covering dh fully.
    const c: SourceRun[] = out.map((r) => ({ ...r }));
    const n3 = stripSourceRuns(56, length - 8, length, tile, 128, c);
    expect(n3).toBe(2);
    expect(c[0]!.dhFrac + c[1]!.dhFrac).toBeCloseTo(1, 9);
    // Degenerate span yields nothing.
    expect(
      stripSourceRuns(
        50,
        50,
        length,
        tile,
        128,
        out.map((r) => ({ ...r })),
      ),
    ).toBe(0);
    // Phase is a pure world function (strip-index independent).
    expect(worldTilePhase(500, tile)).toBe(worldTilePhase(500, tile));
  });
});

describe('identity-stable scenery', () => {
  it('maps slots by marker identity only and never the boost cell', () => {
    expect(scenerySlotFor(0)).toBe('landmarkFar');
    expect(scenerySlotFor(6)).toBe('landmarkNear');
    expect(scenerySlotFor(12)).toBe('landmarkFar');
    const seen = new Set<string>();
    for (let k = 0; k < 48; k++) {
      const slot = scenerySlotFor(k);
      seen.add(slot);
      expect(slot).not.toBe('boost');
    }
    expect([...seen].sort()).toEqual([
      'dressingA',
      'dressingB',
      'dressingC',
      'landmarkFar',
      'landmarkNear',
    ]);
    expect(isLandmarkSlot('landmarkFar')).toBe(true);
    expect(isLandmarkSlot('dressingA')).toBe(false);
    expect(sceneryAtlasCell('boost')).toEqual({ sx: 192, sy: 96, size: 96 });
  });
});

describe('panorama band and directional offset', () => {
  it('uses a landmark-bearing band that fits the plate', () => {
    expect(PANORAMA_SOURCE_WIDTH).toBe(1216);
    expect(PANORAMA_SOURCE_HEIGHT).toBe(280);
    expect(PANORAMA_SOURCE_Y).toBe(200);
    expect(PANORAMA_SOURCE_Y + PANORAMA_SOURCE_HEIGHT).toBeLessThanOrEqual(480);
    expect(panoramaMaxOffset()).toBe(1536 - 1216);
    // Band aspect matches the screen sky aspect (512x118).
    expect(PANORAMA_SOURCE_WIDTH / PANORAMA_SOURCE_HEIGHT).toBeCloseTo(512 / 118, 2);
  });

  it('is directional, bounded, and wrap-continuous', () => {
    const max = panoramaMaxOffset();
    expect(panoramaSourceX(Math.PI / 2, max)).toBeCloseTo(max, 9);
    expect(panoramaSourceX(-Math.PI / 2, max)).toBeCloseTo(0, 9);
    expect(panoramaSourceX(0, max)).toBeCloseTo(max / 2, 9);
    expect(Math.abs(panoramaSourceX(Math.PI, max) - panoramaSourceX(-Math.PI, max))).toBeLessThan(
      1e-9,
    );
    for (const h of [-2, -1, 0, 1, 2, 3.5]) {
      const o = panoramaSourceX(h, max);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(max);
    }
  });

  it('stays continuous across a real lap of heading samples', () => {
    const track = RACE_CIRCUITS[0]!.track;
    const max = panoramaMaxOffset();
    let prev: number | null = null;
    let worst = 0;
    const steps = 720;
    let first = 0;
    for (let k = 0; k <= steps; k++) {
      const s = (k / steps) * track.length;
      const o = panoramaSourceX(track.headingAt(s), max);
      if (k === 0) first = o;
      if (prev !== null) worst = Math.max(worst, Math.abs(o - prev));
      prev = o;
    }
    // No full-range jumps between consecutive samples (hairpins move fast
    // but smoothly), and the lap seam meets itself: the start/finish sample
    // pair differs only by closed-loop tangent float noise.
    expect(worst).toBeLessThan(max / 2);
    expect(Math.abs(prev! - first)).toBeLessThan(1);
  });
});

describe('pose, exhaust, and body fill', () => {
  it('keeps stopped craft neutral and banks with steer', () => {
    expect(selectCraftPose(0.9, 0)).toBe('rear');
    expect(selectCraftPose(0, 60)).toBe('rear');
    expect(selectCraftPose(0.5, 60)).toBe('bankRight');
    expect(selectCraftPose(-0.5, 60)).toBe('bankLeft');
    expect(craftPoseSourceX('rear')).toBe(0);
    expect(craftPoseSourceX('bankLeft')).toBe(64);
    expect(craftPoseSourceX('bankRight')).toBe(128);
  });

  it('grades exhaust by boost, cruise, and stop', () => {
    expect(exhaustFlame(0, 0)).toBe(0);
    expect(exhaustFlame(0.5, 0)).toBe(0);
    expect(exhaustFlame(20, 0)).toBe(0);
    expect(exhaustFlame(60, 0)).toBe(1);
    expect(exhaustFlame(60, 0.5)).toBe(2);
    expect(exhaustFlame(0, 0.5)).toBe(2);
  });

  it('compensates the keyed body fill to restore physical width', () => {
    expect(STRIP_BODY_FILL).toBeCloseTo(52 / 64, 12);
  });
});

describe('stable roster names', () => {
  it('overrides per-course names with the identity cast', () => {
    const spec = goldenSpec();
    expect(spec.identity).toBeDefined();
    const names = stableRosterNames(spec, ['YOU', 'A', 'B', 'C', 'D']);
    expect(names[0]).toBe(spec.identity!.pilotName);
    expect(names.slice(1)).toEqual(spec.identity!.rivalCrafts.map((r) => r.name));
  });

  it('passes course names through for legacy specs', () => {
    expect(stableRosterNames(undefined, ['YOU', 'VEX'])).toEqual(['YOU', 'VEX']);
  });
});

describe('pack vs legacy render', () => {
  it('draws the panorama band and strips with body fill, and road quads', () => {
    const pack = stubPack();
    const { game, draws } = makeGame(pack, goldenSpec());
    game.render();
    const pano = draws.filter((d) => d.img === pack.panoramas[0]);
    expect(pano.length).toBeGreaterThan(0);
    expect(pano[0]).toMatchObject({
      sy: PANORAMA_SOURCE_Y,
      sw: PANORAMA_SOURCE_WIDTH,
      sh: PANORAMA_SOURCE_HEIGHT,
    });
    const strips = draws.filter((d) => (pack.strips as unknown[]).includes(d.img));
    expect(strips.length).toBeGreaterThan(0);
    for (const s of strips) {
      expect([0, 64, 128]).toContain(s.sx);
      expect(s.sw).toBe(64);
    }
    // Material sources scroll with travel, so sy roams its quadrant: road
    // stays in the top row (sy+sh<=128), curb/boost in the bottom row.
    // Every surface row samples exactly one atlas row (sh=1) into exactly
    // one integer logical row (dh=1, integer dy) — never fractional
    // overlapping bands. Road/curb/boost span their full quadrant width
    // (sw=128 from the quadrant edge, U anchored across their own surface);
    // ground tiles world-anchored U, so each span just has to stay inside
    // the ground quadrant.
    const mats = draws.filter((d) => d.img === pack.materialAtlas);
    expect(mats.length).toBeGreaterThan(0);
    for (const d of mats) {
      expect(d.sh).toBe(1);
      expect(d.dh).toBe(1);
      expect(Number.isInteger(d.dy)).toBe(true);
      expect(d.sy).toBeGreaterThanOrEqual(0);
      expect(d.sy + d.sh).toBeLessThanOrEqual(d.sy >= 128 ? 256 : 128);
      const quadLeft = d.sy >= 128 ? (d.sx >= 128 ? 128 : 0) : d.sx >= 128 ? 128 : 0;
      expect(d.sx).toBeGreaterThanOrEqual(quadLeft);
      expect(d.sx + d.sw).toBeLessThanOrEqual(quadLeft + 128);
      if (!(d.sx >= 128 && d.sy < 128)) {
        expect(d.sw).toBe(128);
      }
    }
    expect(mats.some((d) => d.sx === 0 && d.sy + d.sh <= 128)).toBe(true);
    expect(mats.some((d) => d.sy >= 128 && d.sy + d.sh <= 256)).toBe(true);
    // Player body restores physical width (wider than the raw world width).
    const snap = game.racingDev.snapshot();
    expect(snap.art.pack).toBe(true);
    expect(snap.art.pose).toBe('rear');
  });

  it('selects bank cells when steering and keeps legacy free of pack draws', () => {
    const pack = stubPack();
    const held = makeGame(pack, goldenSpec());
    const input = blankInput();
    input.A.pressed = true;
    held.game.update(1 / 60, input);
    input.A.pressed = false;
    input.UP.held = true;
    input.RIGHT.held = true;
    for (let f = 0; f < 900; f++) {
      held.game.update(1 / 60, input);
      if (f % 5 === 0) held.game.render();
    }
    held.game.render();
    const banked = held.draws.filter(
      (d) => (pack.strips as unknown[]).includes(d.img) && (d.sx === 128 || d.sx === 64),
    );
    expect(banked.length).toBeGreaterThan(0);
    expect(['rear', 'bankLeft', 'bankRight']).toContain(held.game.racingDev.snapshot().art.pose);

    const legacy = makeGame(null, goldenSpec());
    legacy.game.render();
    expect(legacy.draws).toHaveLength(0);
    expect(legacy.game.racingDev.snapshot().art.pack).toBe(false);
  });

  it('samples boost only in pads mode and never decorates with it', () => {
    const pack = stubPack();
    const pads = makeGame(pack, goldenSpec());
    pads.game.render();
    // Scrolling V means sy roams the boost quadrant ([128,256)), not one row.
    const isBoost = (d: DrawCall): boolean =>
      d.img === pack.materialAtlas && d.sx === 128 && d.sy >= 128 && d.sy + d.sh <= 256;
    // Drive to a pad when the opening frame shows none.
    if (!pads.draws.some(isBoost)) {
      const input = blankInput();
      input.A.pressed = true;
      pads.game.update(1 / 60, input);
      input.A.pressed = false;
      input.B.held = true; // B is the throttle (playerInput maps accel=B).
      for (let f = 0; f < 5400 && !pads.draws.some(isBoost); f++) {
        pads.game.update(1 / 60, input);
        if (f % 4 === 0) pads.game.render();
      }
      pads.game.render();
    }
    expect(pads.draws.some(isBoost)).toBe(true);
    // Scenery atlas sources never touch the boost cell in pads mode.
    const scenery = pads.draws.filter((d) => d.img === pack.sceneryAtlas);
    expect(scenery.length).toBeGreaterThan(0);
    expect(scenery.some((d) => d.sx === 192 && d.sy === 96)).toBe(false);

    const pickupsSpec: RacingSpec = {
      ...goldenSpec(),
      identity: {
        ...goldenSpec().identity!,
        boost: {
          mode: 'pickups',
          displayName: 'Cells',
          appearanceConcept: 'Test cells for render',
        },
      },
    };
    const cells = makeGame(pack, pickupsSpec);
    const cellInput = blankInput();
    cellInput.A.pressed = true;
    cells.game.update(1 / 60, cellInput);
    cellInput.A.pressed = false;
    cellInput.B.held = true; // B is the throttle (playerInput maps accel=B).
    // Drive straight up the middle (missing every lane) toward the cells so
    // at least one near cell renders while still bankable.
    for (let f = 0; f < 1200; f++) {
      cells.game.update(1 / 60, cellInput);
      if (f % 5 === 0) cells.game.render();
    }
    cells.game.render();
    // No boost-quadrant track paint without pads…
    expect(cells.draws.some(isBoost)).toBe(false);
    // …but untaken on-road cells still draw the atlas boost slot.
    expect(
      cells.draws.some((d) => d.img === pack.sceneryAtlas && d.sx === 192 && d.sy === 96),
    ).toBe(true);
  });

  it('keeps every material sample inside its quadrant across the lap seam', () => {
    const pack = stubPack();
    const { game, draws } = makeGame(pack, goldenSpec());
    const input = blankInput();
    input.A.pressed = true;
    game.update(1 / 60, input);
    input.A.pressed = false;
    input.B.held = true; // B is the throttle (playerInput maps accel=B).
    // Drive until the player wraps past the start/finish seam, rendering
    // along the way so strip spans cover both sides of the wrap.
    const startLap = game.racingDev.snapshot().player.lap;
    let prevS = game.racingDev.snapshot().player.s;
    let crossed = false;
    for (let f = 0; f < 20000 && !crossed; f++) {
      game.update(1 / 60, input);
      const snap = game.racingDev.snapshot().player;
      if (snap.lap !== startLap || snap.s < prevS - 1) crossed = true;
      prevS = snap.s;
      if (f % 4 === 0) game.render();
    }
    game.render();
    expect(crossed).toBe(true);
    const mats = draws.filter((d) => d.img === pack.materialAtlas);
    expect(mats.length).toBeGreaterThan(0);
    // Every road/ground/curb/boost sample stays inside its 128px quadrant,
    // sampling one atlas row into one integer logical row.
    for (const d of mats) {
      expect(d.sh).toBe(1);
      expect(d.dh).toBe(1);
      expect(Number.isInteger(d.dy)).toBe(true);
      expect(d.sy).toBeGreaterThanOrEqual(0);
      expect(d.sy + d.sh).toBeLessThanOrEqual(d.sy >= 128 ? 256 : 128);
      const quadLeft = d.sy >= 128 ? (d.sx >= 128 ? 128 : 0) : d.sx >= 128 ? 128 : 0;
      expect(d.sx).toBeGreaterThanOrEqual(quadLeft);
      expect(d.sx + d.sw).toBeLessThanOrEqual(quadLeft + 128);
      if (!(d.sx >= 128 && d.sy < 128)) {
        expect(d.sw).toBe(128);
      }
    }
    expect(mats.some((d) => d.sx === 0 && d.sy + d.sh <= 128)).toBe(true);
    expect(mats.some((d) => d.sx === 0 && d.sy >= 128)).toBe(true);
    expect(mats.some((d) => d.sx === 128 && d.sy + d.sh <= 128)).toBe(true);
    expect(mats.some((d) => d.sx === 128 && d.sy >= 128)).toBe(true);
  });
});

it('keeps completed course art on results and refreshes it for the next course', () => {
  const pack = stubPack();
  const { game, draws } = makeGame(pack, goldenSpec());
  game.racingDev.setAutopilot(true);
  const input = blankInput();
  for (let i = 0; i < 30000 && game.racingDev.snapshot().phase !== 'results'; i++)
    game.update(1 / 60, input);
  expect(game.racingDev.snapshot().phase).toBe('results');
  draws.length = 0;
  game.render();
  expect(draws.some((draw) => draw.img === pack.panoramas[0])).toBe(true);
  expect(draws.some((draw) => draw.img === pack.panoramas[1])).toBe(false);
  game.racingDev.advance();
  draws.length = 0;
  game.render();
  expect(draws.some((draw) => draw.img === pack.panoramas[1])).toBe(true);
  expect(game.racingDev.snapshot().art.race).toBe(1);
});

describe('bounded row projection', () => {
  it('inverts the analytic pinhole depth law at every strip', () => {
    const track = RACE_CIRCUITS[0]!.track;
    const strips = projectRoad(0, 0, undefined, track);
    expect(strips.length).toBeGreaterThan(2);
    for (const s of strips) {
      // Strip depth law is exactly y = HORIZON + CAM_H*FOCAL/z.
      expect(s.y - RACING_HORIZON).toBeCloseTo((RACING_CAM_H * RACING_FOCAL) / s.z, 9);
      // perspectiveZ recovers the same depth from the strip's screen y.
      expect(perspectiveZ(s.y, RACING_HORIZON, RACING_CAM_H, RACING_FOCAL)).toBeCloseTo(s.z, 9);
    }
    // Depth grows strictly toward the horizon; rows below it are clamped.
    for (let k = 1; k < strips.length; k++) {
      expect(strips[k]!.z).toBeGreaterThan(strips[k - 1]!.z);
    }
    expect(perspectiveZ(RACING_HORIZON, RACING_HORIZON, RACING_CAM_H, RACING_FOCAL)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('shades smoothly with depth and never with segment parity', () => {
    expect(depthShade(RACING_Z_NEAR, RACING_Z_NEAR, RACING_Z_SPAN)).toBeCloseTo(1, 12);
    expect(depthShade(RACING_Z_NEAR + RACING_Z_SPAN, RACING_Z_NEAR, RACING_Z_SPAN)).toBeCloseTo(
      0.45,
      12,
    );
    // Smooth across the whole span: no abrupt band step anywhere, including
    // across strip joins (the old floor((camS+z)/SEG_LEN)%2 band flipped the
    // base color there).
    let worst = 0;
    const steps = 400;
    let prev = depthShade(RACING_Z_NEAR, RACING_Z_NEAR, RACING_Z_SPAN);
    for (let k = 1; k <= steps; k++) {
      const z = RACING_Z_NEAR + (RACING_Z_SPAN * k) / steps;
      const cur = depthShade(z, RACING_Z_NEAR, RACING_Z_SPAN);
      expect(cur).toBeLessThanOrEqual(prev);
      worst = Math.max(worst, Math.abs(cur - prev));
      prev = cur;
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('intersects the projected road edges with exact perspective width on curves', () => {
    // Find a real bend on any built-in circuit.
    let bend: { s: number; track: (typeof RACE_CIRCUITS)[number]['track'] } | null = null;
    for (const c of RACE_CIRCUITS) {
      for (let s = 0; s < c.track.length && bend === null; s += 20) {
        if (Math.abs(c.track.curvatureAt(s)) > 0.003) bend = { s, track: c.track };
      }
    }
    expect(bend).not.toBeNull();
    const strips = projectRoad(bend!.s, 0, undefined, bend!.track);
    // A constant bend integrates into a visibly bending centerline (offset
    // growing with distance), not a constant screen shift.
    const range = Math.max(...strips.map((s) => s.cx)) - Math.min(...strips.map((s) => s.cx));
    expect(range).toBeGreaterThan(20);
    // Independent screen-space edge intersection, including near-camera
    // rows where interpolation in strip-index space distorts road width.
    for (let y = Math.ceil(strips.at(-1)!.y); y < 300; y++) {
      const z = (RACING_CAM_H * RACING_FOCAL) / (y + 0.5 - RACING_HORIZON);
      const row = sampleStripRow(strips, z, RACING_Z_NEAR, RACING_Z_SPAN)!;
      const index = strips.findIndex(
        (p, i) => i > 0 && p.y <= y + 0.5 && strips[i - 1]!.y >= y + 0.5,
      );
      const near = strips[index - 1]!,
        far = strips[index]!;
      const t = (y + 0.5 - far.y) / (near.y - far.y);
      expect(row.cx).toBeCloseTo(far.cx + (near.cx - far.cx) * t, 9);
      expect(row.ppu).toBeCloseTo(RACING_FOCAL / z, 9);
      expect(row.half).toBeCloseTo((4 * RACING_FOCAL) / z, 9);
    }
    expect(sampleStripRow(strips, RACING_Z_NEAR - 1, RACING_Z_NEAR, RACING_Z_SPAN)).toBeNull();
  });

  it('keeps world distance monotonic per row with lap-seam phase continuity', () => {
    const track = RACE_CIRCUITS[0]!.track;
    const length = track.length;
    const tile = fitTileWorld(length);
    // Put the start/finish seam mid-view so rows span the wrap.
    const camS = length - 50;
    const zMax = RACING_Z_NEAR + RACING_Z_SPAN;
    const yTop = Math.ceil(RACING_HORIZON + (RACING_CAM_H * RACING_FOCAL) / zMax - 0.5);
    let previousZ: number | null = null;
    for (let y = yTop; y < 300; y++) {
      const z = perspectiveZ(y + 0.5, RACING_HORIZON, RACING_CAM_H, RACING_FOCAL);
      const expectedZ = (RACING_CAM_H * RACING_FOCAL) / (y + 0.5 - RACING_HORIZON);
      expect(z).toBeCloseTo(expectedZ, 10);
      if (previousZ !== null) expect(z).toBeLessThan(previousZ);
      previousZ = z;
      // A distant row may legitimately skip several texture repeats. The
      // invariant is the same world phase before and after wrapping a lap.
      const phase = worldTilePhase(camS + z, tile);
      expect(worldTilePhase(track.wrap(camS + z), tile)).toBeCloseTo(phase, 9);
      expect(rowAtlasRow(track.wrap(camS + z), tile, 128)).toBe(Math.floor(phase * 128));
    }
    expect(rowAtlasRow(0, tile, 128)).toBe(rowAtlasRow(length, tile, 128));
  });

  it('tiles world-anchored ground U inside the quadrant with full coverage', () => {
    const quad = materialTileRect('ground');
    const tile = 64;
    const out: GroundSpan[] = [];
    const spans = groundSourceSpans(0, 512, 256, 8, tile, quad.sx, quad.size, out);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.length).toBeLessThan(16);
    // Contiguous coverage of the screen row, no gaps or overlaps.
    expect(spans[0]!.dx).toBe(0);
    for (let k = 1; k < spans.length; k++) {
      expect(spans[k]!.dx).toBeCloseTo(spans[k - 1]!.dx + spans[k - 1]!.dw, 9);
    }
    const last = spans[spans.length - 1]!;
    expect(last.dx + last.dw).toBeCloseTo(512, 9);
    for (const sp of spans) {
      expect(sp.sx).toBeGreaterThanOrEqual(quad.sx);
      expect(sp.sx + sp.sw).toBeLessThanOrEqual(quad.sx + quad.size);
      expect(sp.sw).toBeGreaterThan(0);
      expect(sp.dw).toBeGreaterThan(0);
    }
    // World-anchored: shifting the road center by one world tile of pixels
    // reproduces the same sampling shifted by exactly one tile.
    const shifted = groundSourceSpans(0, 512, 256 + 8 * tile, 8, tile, quad.sx, quad.size, []);
    expect(shifted.length).toBe(spans.length);
    for (let k = 0; k < spans.length; k++) {
      expect(shifted[k]!.sx).toBeCloseTo(spans[k]!.sx, 9);
      expect(shifted[k]!.dx).toBeCloseTo(spans[k]!.dx, 9);
      expect(shifted[k]!.dw).toBeCloseTo(spans[k]!.dw, 9);
    }
  });

  it('continues ground coverage through a rounded tile boundary', () => {
    const spans = groundSourceSpans(0, 512, 128.694, 1.0080500000000001, 64, 128, 128);
    expect(spans[0]!.dx).toBe(0);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.dx).toBeCloseTo(spans[i - 1]!.dx + spans[i - 1]!.dw, 9);
    }
    const last = spans.at(-1)!;
    // Previously roundoff stopped drawing at x=128.694, leaving the rest
    // of this row flat while neighboring rows remained textured.
    expect(last.dx + last.dw).toBeCloseTo(512, 9);
    expect(spans.every((s) => s.sx >= 128 && s.sx + s.sw <= 256)).toBe(true);
  });
});

describe('rendered rows follow the shared projection', () => {
  function templateGame(): { game: GameInstance & RacingDevHandle; draws: DrawCall[] } {
    // No spec: the cup resolves to the template circuits, so the test knows
    // the exact track geometry for an independent oracle.
    return makeGame(stubPack());
  }

  it('paints one integer road row per screen row with oracle geometry and V', () => {
    const { game, draws } = templateGame();
    game.render();
    const snap = game.racingDev.snapshot();
    const track = RACE_CIRCUITS[0]!.track;
    const camS = snap.player.s - RACING_CAM_BACK;
    const tile = fitTileWorld(track.length);
    const strips = projectRoad(snap.player.s, snap.player.x, undefined, track);
    const rq = materialTileRect('road');
    const zMax = RACING_Z_NEAR + RACING_Z_SPAN;
    const yTop = Math.ceil(strips.at(-1)!.y - 0.5);
    // Road-quadrant draws are exactly (sx=0, sw=128, sy<128): craft cells
    // are 64 wide, scenery cells 96, and the panorama slice 1216.
    const road = draws.filter((d) => d.sx === 0 && d.sw === 128 && d.sy < 128);
    // Exactly one road row per integer screen row: no fractional overlaps,
    // no gaps, dh=1, and the full quadrant across the row's own span.
    expect(road.length).toBe(300 - yTop);
    const byY = new Map(road.map((d) => [d.dy, d]));
    expect(byY.size).toBe(road.length);
    for (let y = yTop; y < 300; y++) {
      const d = byY.get(y);
      expect(d).toBeDefined();
      expect(d!.dh).toBe(1);
      expect(d!.sh).toBe(1);
      const z = Math.max(
        RACING_Z_NEAR,
        Math.min(zMax, perspectiveZ(y + 0.5, RACING_HORIZON, RACING_CAM_H, RACING_FOCAL)),
      );
      const index = strips.findIndex(
        (p, i) => i > 0 && p.y <= y + 0.5 && strips[i - 1]!.y >= y + 0.5,
      );
      const near = strips[index - 1]!,
        far = strips[index]!;
      const t = (y + 0.5 - far.y) / (near.y - far.y);
      const row = { cx: far.cx + t * (near.cx - far.cx), half: (4 * RACING_FOCAL) / z };
      // U anchored across this row's own surface span (the old segment
      // constant bbox fails here on curves); V is the row's world distance.
      expect(d!.dx).toBeCloseTo(row.cx - row.half, 6);
      expect(d!.dw).toBeCloseTo(row.half * 2, 6);
      expect(d!.sy).toBe(rq.sy + rowAtlasRow(track.wrap(camS + z), tile, rq.size));
    }
  });

  it('varies laterally every row instead of freezing per segment', () => {
    const { game, draws } = templateGame();
    game.render();
    const road = draws
      .filter((d) => d.sx === 0 && d.sw === 128 && d.sy < 128)
      .sort((a, b) => a.dy - b.dy);
    expect(road.length).toBeGreaterThan(100);
    // The old constant-rectangle-per-segment blit froze dx/dw across every
    // row of a strip (~150 exact-duplicate neighbors); per-row projection
    // moves every row (up to float-identical far-clamped rows).
    let frozen = 0;
    for (let k = 1; k < road.length; k++) {
      if (road[k]!.dx === road[k - 1]!.dx && road[k]!.dw === road[k - 1]!.dw) frozen++;
    }
    expect(frozen).toBeLessThan(8);
  });
});
