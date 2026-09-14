import { describe, expect, it } from 'vitest';
import { projectAtZ, projectRoad, RACING_CAM_BACK } from '../src/racing/game';
import { createRaceFor, stepRacer } from '../src/racing/simulation';
import { RACE_CIRCUITS, type CompiledTrack } from '../src/racing/track';

const circuit = RACE_CIRCUITS[0]!;
const constant = (curve: number): CompiledTrack => ({ ...circuit.track, curvatureAt: () => curve });

describe('visible racing bends', () => {
  it('renders straight roads straight and sustained bends as curves', () => {
    const departure = (curve: number): number => {
      const strips = projectRoad(100, 0, undefined, constant(curve));
      const near = projectAtZ(strips, 20)!;
      const middle = projectAtZ(strips, 80)!;
      const far = projectAtZ(strips, 160)!;
      const lineX = far.cx + (near.cx - far.cx) * (middle.y - far.y) / (near.y - far.y);
      return middle.cx - lineX;
    };
    expect(departure(0)).toBeCloseTo(0, 8);
    // A mere sideways shift or rotation of a straight road fails this.
    expect(Math.abs(departure(0.01))).toBeGreaterThan(30);
    expect(Math.abs(departure(0.019))).toBeGreaterThan(Math.abs(departure(0.003)) * 3);
  });

  it('shows the bend direction, mirrors it, and anchors the road at the craft', () => {
    for (const curve of [0.003, 0.01, 0.019]) {
      const right = projectRoad(100, 0, undefined, constant(curve));
      const left = projectRoad(100, 0, undefined, constant(-curve));
      expect(projectAtZ(right, 80)!.cx).toBeGreaterThan(256 + 15);
      expect(projectAtZ(left, 80)!.cx).toBeLessThan(256 - 15);
      for (let i = 0; i < right.length; i++) {
        expect(right[i]!.cx + left[i]!.cx).toBeCloseTo(512, 8);
      }
      for (const x of [-4, 0, 4]) {
        const player = projectAtZ(projectRoad(100, x, undefined, constant(curve)), RACING_CAM_BACK)!;
        expect(player.cx + x * player.ppu).toBeCloseTo(256, 8);
      }
    }
  });

  it('brings an upcoming bend closer and clears it after passing', () => {
    const track = { ...circuit.track, curvatureAt: (s: number) => s >= 200 && s < 400 ? 0.01 : 0 };
    const at = (s: number): number => projectAtZ(projectRoad(s, 0, undefined, track), 80)!.cx;
    expect(at(50)).toBeCloseTo(256, 8);
    expect(at(160)).toBeGreaterThan(256 + 10);
    expect(at(450)).toBeCloseTo(256, 8);
  });

  it('remains continuous across each real circuit seam', () => {
    for (const { track } of RACE_CIRCUITS) {
      const before = projectRoad(track.length - 0.001, 0, undefined, track);
      const after = projectRoad(0.001, 0, undefined, track);
      for (let i = 0; i < before.length; i++) {
        expect(Math.abs(before[i]!.cx - after[i]!.cx)).toBeLessThan(0.5);
        expect(Number.isFinite(after[i]!.cx)).toBe(true);
      }
    }
  });
});

function tap(speed: number, curve = 0, hz = 60, duration = 0.25): number {
  const race = createRaceFor({ ...circuit, pads: [], track: constant(curve) }, 0);
  const player = race.racers[0]!;
  player.s = player.gateS = 100;
  player.x = 0;
  player.speed = speed;
  if (speed > 80) player.boostT = 1;
  for (let f = 0; f < Math.round(duration * hz); f++) {
    stepRacer(race, player, { steer: 1, accel: false, brake: false, boost: false, drift: false }, 1 / hz);
  }
  return player.x;
}

describe('cornering response at different speeds', () => {
  it('gives the same steering press more authority at corner pace', () => {
    const fast = tap(80);
    expect(tap(40)).toBeGreaterThan(fast * 1.4);
    expect(tap(50)).toBeGreaterThan(fast * 1.3);
    // Boost keeps useful steering, and stopped craft stay still.
    expect(tap(128)).toBeGreaterThan(fast * 0.85);
    expect(tap(0)).toBe(0);
  });

  it('turns into a sharp bend at entry pace while full speed pushes wide', () => {
    expect(tap(40, 0.01)).toBeGreaterThan(0.3);
    expect(tap(80, 0.01)).toBeLessThan(-2);
  });

  it('preserves reverse steering and consistent frame-rate response', () => {
    expect(tap(-20)).toBeLessThan(0);
    const values = [30, 60, 120].map(hz => tap(40, 0.01, hz, 0.5));
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(0.15);
  });
});
