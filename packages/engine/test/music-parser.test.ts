import { describe, expect, it } from 'vitest';
import {
  noteToFreq,
  parseDrumChannel,
  parseNoteChannel,
  parseSong,
  validateMusic,
} from '@sparkade/engine';
import type { MusicBlock } from '@sparkade/shared';

describe('note parsing', () => {
  it('maps notes to equal-temperament frequencies', () => {
    expect(noteToFreq('A4')).toBeCloseTo(440, 5);
    expect(noteToFreq('C4')).toBeCloseTo(261.626, 2);
    expect(noteToFreq('Eb3')).toBeCloseTo(155.563, 2);
    expect(noteToFreq('F#5')).toBeCloseTo(739.989, 2);
    expect(noteToFreq('C#4')).toBeCloseTo(noteToFreq('Db4'), 6);
  });

  it('rejects malformed notes', () => {
    for (const bad of ['H4', 'C8', 'C', 'c4', 'C4x']) expect(() => noteToFreq(bad)).toThrow();
  });

  it('parses step syntax into timed events', () => {
    const steps = ['C4:2', '-', '-', '-', 'E4:1', ...new Array(11).fill('-')] as string[];
    const events = parseNoteChannel(steps);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ step: 0, durSteps: 2 });
    expect(events[0]!.freq).toBeCloseTo(261.626, 2);
    expect(events[1]).toMatchObject({ step: 4, durSteps: 1 });
  });

  it('parses drums and rejects junk', () => {
    const drums = parseDrumChannel(['K', '-', 'H', '-', 'S', '-', 'H', '-', 'K', '-', 'H', '-', 'S', '-', 'H', 'H']);
    expect(drums.filter((d) => d.kind === 'K')).toHaveLength(2);
    expect(drums.filter((d) => d.kind === 'S')).toHaveLength(2);
    expect(() => parseDrumChannel(['X'])).toThrow();
    expect(() => parseNoteChannel(['C4:0'])).toThrow();
    expect(() => parseNoteChannel(['C4:17'])).toThrow();
  });
});

function makeMusic(): MusicBlock {
  const bar = new Array(16).fill('-') as string[];
  return {
    bpm: 120,
    key: 'C minor',
    instruments: {
      pulse1: { duty: 0.25, vol: 0.5, decay: 0.2 },
      pulse2: { duty: 0.5, vol: 0.3, decay: 0.2 },
      bass: { vol: 0.5, decay: 0.3 },
      drums: { vol: 0.6 },
    },
    patterns: {
      pA: { pulse1: ['C4:4', ...bar.slice(1)], drums: ['K', ...bar.slice(1)] },
      pB: { bass: ['C3:8', ...bar.slice(1)] },
    },
    songs: { theme: ['pA', 'pA', 'pB'], boss: ['pB'] },
    jingles: {
      victory: { pulse1: ['C5:2', ...bar.slice(1)] },
      gameover: { pulse1: ['C3:4', ...bar.slice(1)] },
      levelIntro: { pulse1: ['G4:2', ...bar.slice(1)] },
    },
  };
}

describe('songs', () => {
  it('resolves ordered pattern refs with correct bar timing', () => {
    const song = parseSong(makeMusic(), 'theme');
    expect(song.bars).toHaveLength(3);
    // 120 bpm → 0.5s per beat → 0.125s per 16th; a bar = 2s
    expect(song.secondsPerStep).toBeCloseTo(0.125, 6);
    expect(song.barSeconds).toBeCloseTo(2, 6);
    expect(song.bars[0]!.pulse1[0]!.durSteps).toBe(4);
  });

  it('throws on unknown song/pattern refs', () => {
    expect(() => parseSong(makeMusic(), 'nope')).toThrow();
    const bad = makeMusic();
    bad.songs['theme'] = ['missing'];
    expect(() => parseSong(bad, 'theme')).toThrow(/unknown pattern/);
  });

  it('validateMusic reports every problem without throwing', () => {
    const bad = makeMusic();
    bad.songs['theme'] = ['missing'];
    (bad.patterns['pA'] as { pulse1: string[] }).pulse1[0] = 'X9:99';
    const problems = validateMusic(bad);
    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(problems.join('\n')).toMatch(/unknown pattern/);
  });
});
