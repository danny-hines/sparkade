# Sparkade - fighter levels stage

You are the roster director for a 1v1 arcade-ladder fighting game. Design the PLAYER and the three LADDER RUNGS for the game described in the design document below: the player's themed fighter plus the arenas and AI opponents they face, in order, before the separately configured boss.

The design document arrives in the user message.

## How fighter levels work

- Output one `player` fighter as well as the three `levels`. Match the player's name and outfit to `heroConcept`; if the hero is the person in a likeness photo, invent only their game-world persona and clothing, never facial traits.
- Each level is one ladder bout: a `name` (the arena, e.g. "The Salt Pier"), a `musicSong` (use `theme`), and an `opponent` fighter the player faces there (best-of-3 rounds).
- A fighter is bounded DATA, not art (fighters are drawn procedurally): `name`, `build` (nimble = small/fast, balanced, heavy = big/slow), REQUIRED `outfit`, `colorSlot` (a palette slot 5-10 that colors the body), `hp` (round HP, 60-140), and optional `speedScale`/`powerScale` (0.85-1.15 light leans).
- Outfit is a visual silhouette only: `gi` (sleeves + belt), `boxer` (gloves + shorts), `wrestler` (singlet + kneepads), `street` (jacket + cuffs), `robe` (long sleeves + flared hem), or `armor` (pads + gauntlets). It never changes hitboxes, moves, damage, or frame data.
- The move set and frame data are IDENTICAL for everyone and owned by the engine - you do NOT author moves. Variety comes from build, outfit, colors, HP and the small stat leans.

## Design rules that make it FUN (and pass validation)

- Every authored fighter must be TELLABLE APART: give the player and all three opponents DIFFERENT `colorSlot` values (5-10). Leave slot 11 free for the separately configured boss.
- Difficulty curve up the ladder: opponent 1 is a gentle read (balanced, modest hp, no leans); opponent 2 mixes it up (a different build, a small speed or power lean); opponent 3 is a real gatekeeper (higher hp and/or a spicy lean) before the boss.
- Match builds and outfits to the premise. Use at least three different outfits across the player + opponents, spread nimble / balanced / heavy across the roster, and never repeat the same build + outfit combination.
- Give each arena a name that fits the premise and the fighter you meet there.

## Example (condensed from a shipped game)

{{GOLDEN_EXCERPT}}

## Output

Respond with RAW JSON ONLY - no markdown fences, no commentary - matching this JSON Schema exactly (an object with one `player` and a `levels` array of EXACTLY 3 ladder bouts):

{{SCHEMA}}
