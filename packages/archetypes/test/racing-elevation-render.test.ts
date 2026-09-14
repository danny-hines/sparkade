import { describe, expect, it } from 'vitest';
import {
  compileTrackVariant,
  projectRoad,
  projectAtZ,
  RACING_CAM_BACK,
  RACING_CAM_H,
  RACING_FOCAL,
  RACING_HORIZON,
  RACING_Z_NEAR,
  RACING_Z_SPAN,
} from '../src/racing/index';
import {
  buildElevationFrame,
  createElevationFrame,
  elevationClipFor,
  projectElevatedAtZ,
} from '../src/racing/elevation-projection';

function frameAt(s: number, kind: 'rolling' | 'ridge' = 'ridge') {
  const track = compileTrackVariant('coral', { elevation: kind }).track;
  const strips = projectRoad(s, 0, undefined, track);
  const frame = createElevationFrame(300);
  buildElevationFrame(
    frame,
    strips,
    track.heightAt!,
    s - RACING_CAM_BACK,
    RACING_CAM_H + track.heightAt!(s),
    RACING_Z_NEAR,
    RACING_Z_SPAN,
    RACING_HORIZON,
    RACING_FOCAL,
  );
  return { track, strips, frame };
}

describe('elevated road projection', () => {
  it('keeps the player planted and every row tied to actual terrain', () => {
    for (let s = 0; s < 3400; s += 50) {
      const { frame, strips, track } = frameAt(s);
      const p = projectElevatedAtZ(
        strips,
        projectAtZ,
        RACING_CAM_BACK,
        frame.camS,
        frame.camHWorld,
        track.heightAt!,
        RACING_HORIZON,
        RACING_FOCAL,
      )!;
      expect(p.y).toBeCloseTo(RACING_HORIZON + (RACING_CAM_H * RACING_FOCAL) / RACING_CAM_BACK, 7);
      expect(p.cx).toBeCloseTo(256, 7);
      for (let y = 0; y < 300; y++)
        if (frame.rowHit[y]) {
          const z = frame.rowZ[y]!;
          const exactY =
            RACING_HORIZON +
            ((frame.camHWorld - track.heightAt!(frame.camS + z)) * RACING_FOCAL) / z;
          expect(Math.abs(exactY - (y + 0.5))).toBeLessThan(0.15);
          expect(frame.rowPpu[y]).toBeCloseTo(RACING_FOCAL / z, 6);
        }
    }
  });

  it('clips a farther base at the highest nearer silhouette, preserving tall tops', () => {
    let blocked = 0;
    for (let s = 0; s < 3400; s += 40) {
      const { frame } = frameAt(s);
      for (let z = 40; z < 380; z += 20) {
        const clip = elevationClipFor(frame, z);
        if (!clip.blocked) continue;
        blocked++;
        let min = 300;
        for (let i = 0; i < frame.n && frame.sz[i]! < z; i++) min = Math.min(min, frame.sy[i]!);
        expect(clip.clipY).toBe(Math.ceil(min));
        expect(clip.clipY).toBeGreaterThan(0);
      }
    }
    expect(blocked).toBeGreaterThan(0);
  });

  it('reuses buffers and projects continuously through the lap seam', () => {
    const { frame, track, strips } = frameAt(0);
    const rows = frame.rowZ,
      scratch = frame.scratch;
    const before = [...frame.sy];
    buildElevationFrame(
      frame,
      strips,
      track.heightAt!,
      track.length - RACING_CAM_BACK,
      RACING_CAM_H,
      RACING_Z_NEAR,
      RACING_Z_SPAN,
      RACING_HORIZON,
      RACING_FOCAL,
    );
    expect(frame.rowZ).toBe(rows);
    expect(frame.scratch).toBe(scratch);
    frame.sy.forEach((y, i) => expect(y).toBeCloseTo(before[i]!, 8));
  });
});
