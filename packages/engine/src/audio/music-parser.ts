// Pure music parsing: pattern step syntax -> timed note events. No WebAudio here
// (unit-tested on Node).
import type { MusicBlock, MusicPattern } from '@sparkade/shared';

export interface NoteEvent {
  /** Step index 0-15 within the bar. */
  step: number;
  freq: number;
  /** Duration in steps (16ths). */
  durSteps: number;
}

export type DrumKind = 'K' | 'S' | 'H';

export interface DrumEvent {
  step: number;
  kind: DrumKind;
}

export interface ParsedPattern {
  pulse1: NoteEvent[];
  pulse2: NoteEvent[];
  bass: NoteEvent[];
  drums: DrumEvent[];
}

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4" | "Eb3" | "F#5" -> frequency in Hz. Throws on malformed input. */
export function noteToFreq(note: string): number {
  const m = /^([A-G])(#|b)?([1-7])$/.exec(note);
  if (!m) throw new Error(`bad note: ${note}`);
  let semi = SEMITONES[m[1]!]!;
  if (m[2] === '#') semi += 1;
  if (m[2] === 'b') semi -= 1;
  const octave = parseInt(m[3]!, 10);
  const midi = (octave + 1) * 12 + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Parse one note channel (16 steps of "-" | "<note><octave>:<dur>"). */
export function parseNoteChannel(steps: readonly string[] | undefined): NoteEvent[] {
  if (!steps) return [];
  const events: NoteEvent[] = [];
  steps.forEach((s, i) => {
    if (s === '-') return;
    const m = /^([A-G][#b]?[1-7]):(\d{1,2})$/.exec(s);
    if (!m) throw new Error(`bad step "${s}" at ${i}`);
    const dur = parseInt(m[2]!, 10);
    if (dur < 1 || dur > 16) throw new Error(`bad duration in "${s}"`);
    events.push({ step: i, freq: noteToFreq(m[1]!), durSteps: dur });
  });
  return events;
}

export function parseDrumChannel(steps: readonly string[] | undefined): DrumEvent[] {
  if (!steps) return [];
  const events: DrumEvent[] = [];
  steps.forEach((s, i) => {
    if (s === '-') return;
    if (s !== 'K' && s !== 'S' && s !== 'H') throw new Error(`bad drum step "${s}" at ${i}`);
    events.push({ step: i, kind: s });
  });
  return events;
}

export function parsePattern(p: MusicPattern): ParsedPattern {
  return {
    pulse1: parseNoteChannel(p.pulse1),
    pulse2: parseNoteChannel(p.pulse2),
    bass: parseNoteChannel(p.bass),
    drums: parseDrumChannel(p.drums),
  };
}

export interface ParsedSong {
  /** Bars in playback order. */
  bars: ParsedPattern[];
  /** Seconds per 16th step at the piece's bpm. */
  secondsPerStep: number;
  barSeconds: number;
}

/** Resolve a song (ordered pattern refs) into parsed bars. Unknown refs throw. */
export function parseSong(music: MusicBlock, songName: string): ParsedSong {
  const order = music.songs[songName];
  if (!order) throw new Error(`unknown song: ${songName}`);
  const cache = new Map<string, ParsedPattern>();
  const bars = order.map((ref) => {
    let parsed = cache.get(ref);
    if (!parsed) {
      const pattern = music.patterns[ref];
      if (!pattern) throw new Error(`song ${songName} references unknown pattern ${ref}`);
      parsed = parsePattern(pattern);
      cache.set(ref, parsed);
    }
    return parsed;
  });
  const secondsPerStep = 60 / music.bpm / 4; // 16 steps = 4 beats
  return { bars, secondsPerStep, barSeconds: secondsPerStep * 16 };
}

/** Every pattern referenced by any song or jingle parses cleanly (used by validators). */
export function validateMusic(music: MusicBlock): string[] {
  const problems: string[] = [];
  for (const [name, pattern] of Object.entries(music.patterns)) {
    try {
      parsePattern(pattern);
    } catch (e) {
      problems.push(`pattern ${name}: ${(e as Error).message}`);
    }
  }
  for (const [song, order] of Object.entries(music.songs)) {
    for (const ref of order)
      if (!music.patterns[ref]) problems.push(`song ${song} references unknown pattern ${ref}`);
  }
  for (const [name, pattern] of Object.entries(music.jingles)) {
    try {
      parsePattern(pattern);
    } catch (e) {
      problems.push(`jingle ${name}: ${(e as Error).message}`);
    }
  }
  return problems;
}
