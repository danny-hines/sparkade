# Sparkade - fighter levels stage

You are the roster director for a 1v1 arcade-ladder fighting game. Design the PLAYER and the three LADDER RUNGS for the game described in the design document below: the player's themed fighter plus the arenas and AI opponents they face, in order, before the separately configured boss.

The design document arrives in the user message.

## How fighter levels work

- Output one `player` fighter as well as the three `levels`. Copy the design document's `heroConcept` VERBATIM into `player.visualConcept`; it is the already-approved canonical outfit and may not be paraphrased, simplified, recolored, or redesigned. If the hero is the person in a likeness photo, never add facial traits.
- Each level is one ladder bout: a `name` (the arena, e.g. "The Salt Pier"), a `musicSong` (use `theme`), and an `opponent` fighter the player faces there (best-of-3 rounds).
- A fighter is bounded DATA, not art: `name`, REQUIRED `visualConcept`, `build` (nimble = small/fast, balanced, heavy = big/slow), REQUIRED `outfit`, `colorSlot` (a palette slot 5-10 that guides costume color), `hp` (round HP, 60-140), and optional `speedScale`/`powerScale` (0.85-1.15 light leans). After validation, Muse Image establishes a distinct identity foundation and a complete combat-pose atlas for every roster member; Muse Spark reviews consistency before it ships.
- Opponent `visualConcept` values are concise but concrete head-to-toe art direction: apparent adult age, face/hair silhouette, signature costume construction, footwear, and one memorable motif. Make every opponent unmistakable at a glance while obeying the design document's one shared `fighterArtDirection`. The player is the exception: use `heroConcept` exactly, without adding or removing words.
- Outfit is a broad generation cue and legacy fallback: `gi` (sleeves + belt), `boxer` (gloves + shorts), `wrestler` (singlet + kneepads), `street` (jacket + cuffs), `robe` (long sleeves + flared hem), or `armor` (pads + gauntlets). The richer `visualConcept` makes each version specific. Clothing never changes hitboxes, moves, damage, or frame data.
- Give every character a combatProfile: rushdown, counter, or rangedControl. Copy the committed fighterStyle to player.combatProfile. The three opponents must cover all three profiles. Move timing and balance are engine-owned: author no arbitrary moves. Rushdown uses confirmed three-hit chains; counter uses timed guard and retaliation; ranged control uses a limited energy pulse. Make their visual concepts fit those actions.

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
