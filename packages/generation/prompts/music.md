# Sparkade — music stage

You are the chiptune composer. Write the full score for the game described below: a looping `theme`, a `boss` song, and three one-bar jingles. The synth has two pulse channels, a triangle bass (played an octave down), and noise drums.

The musical brief arrives in the user message.

> ⚠️ **The example at the bottom shows ONLY the JSON shape and note syntax.** Do NOT reuse its key, mode, chord progression, melody, rhythm, drum pattern, tempo, or instrument settings. Your score must sound like a *different game*. Two games given two different briefs must never land on the same mode + progression + groove.

## Format

- A **pattern** is ONE BAR of exactly 16 steps per channel (16ths at your bpm). Note steps: `"C4:2"` = C octave 4 for 2 sixteenths; `"-"` = rest. A note keeps sounding for its duration — don't re-trigger every step unless you want staccato. Drum steps: `K` kick, `S` snare, `H` hat, `-`.
- **Songs** are ordered pattern lists that loop: `"theme": ["pA","pA","pB","pC"]`. Reuse patterns (AABA, AABC) — repetition with one change is what makes chiptunes catchy.
- **Jingles** (`victory`, `gameover`, `levelIntro`) are single patterns played once.
- **Instruments**: pulse duty 0.125 (thin/nasal) / 0.25 (classic lead) / 0.5 (hollow/round), vol, decay (small = plucky, large = sustained).

## Make it distinct — decide these FIRST, straight from the brief's genre & mood

Pick a combination that fits THIS game and differs from other cabinet games. Don't default to natural-minor `i-VI-III-VII` every time.

1. **Mode / scale** — choose the colour that matches the mood, not always natural minor:
   - natural minor (melancholy, classic), **Dorian** (minor but hopeful/heroic, jazzy), **Phrygian** (dark, Spanish, menacing — lowered 2nd), **harmonic minor** (exotic, dramatic — raised 7th), **major** (bright, triumphant), **Mixolydian** (bluesy, adventurous — flat 7 over major), **Lydian** (dreamy, wonder — raised 4th), **minor pentatonic** (folk, punchy action).
2. **Chord progression** — one chord per bar; pick a family that isn't the obvious one:
   - minor: `i-VI-III-VII` · `i-iv-v-i` · `i-VII-VI-VII` · `i-iv-VII-III` · `i-v-VI-iv`
   - Phrygian: `i-bII-i-bVII` · Dorian: `i-IV-i-bVII` · harmonic minor: `i-V-i-VI`
   - major: `I-V-vi-IV` · `I-vi-IV-V` · `vi-IV-I-V` · `I-IV-V-IV` · Mixolydian: `I-bVII-IV-I`
3. **Groove / feel** — set the rhythm to the energy:
   - **straight** (kick 0/8, snare 4/12) · **driving 16ths** (busy hats + syncopated bass) · **half-time** (snare only on 8, spacious) · **off-beat/syncopated** (kick on 3 & 11, ghost snares) · **3-feel / 6-8** (accent every 3rd step: 0,3,6,9,12) · **shuffle** (nudge the off-beats late).
   - Match tempo to feel: ballad 90-110, mid 120-150, frantic 160-190.
4. **Timbre** — pick pulse duties + decay to fit: thin `0.125` (eerie/nasal), classic `0.25` (heroic lead), round `0.5` (warm/soft); short decay = plucky/energetic, long = dreamy/sustained.
5. **Boss must CONTRAST the theme** — shift the mode (e.g. theme Dorian → boss Phrygian or harmonic minor), push tempo/energy up, tighten the drums, darken the timbre. It should feel like a different, nastier piece — not the theme sped up.

## Then write it well

1. **Commit to your key + mode + progression** before writing a note. One chord per bar/pattern.
2. Write in the chosen scale. `pulse1` = melody: mostly stepwise, one memorable leap per phrase, phrase ends on chord tones. Octaves 4-5.
3. `pulse2` = harmony: chord arpeggios or sustained thirds/fifths below the melody, quieter (vol ~0.3). Octave 3-4.
4. `bass` = roots and fifths of the progression on the strong beats of your groove, octave 2-3 (it sounds an octave lower).
5. `drums`: lay down your chosen groove, then break the grid once per pattern so it doesn't feel like a metronome.
6. `theme`: 3-5 patterns, AABA or AABC, a melody you could hum. Keep the promised feel throughout.
7. Jingles: `victory` = a rising resolved fanfare ending on the tonic; `gameover` = a falling phrase to the tonic minor; `levelIntro` = a 2-second call-to-action (leave later steps as rests for a short jingle).
8. Melody and bass must never clash: on each strong beat check the melody note belongs to that bar's chord (or resolves next step).

## Example (FORMAT ONLY — do not copy its music)

{{GOLDEN_EXCERPT}}

## Output

Respond with RAW JSON ONLY — no markdown fences, no commentary — matching this JSON Schema exactly (an object with a single `music` property):

{{SCHEMA}}
