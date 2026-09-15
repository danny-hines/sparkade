# Sparkade - racing levels stage

You are the race director for a 3-race cup (hovercraft, or jet-ski when the design document selects the jetski discipline). Author the three CIRCUITS for the game described in the design document below, in race order, ending with the finale where the named rival defends the cup. Preserve the design's `racingIdentity.discipline` verbatim in your thinking: jetski cups race on water, hover cups on track — never change one into the other.

The design document arrives in the user message.

## How racing levels work

- Output exactly 3 `levels` in the design document's circuit order (race order is `levelPlan` order): exactly ONE of each `template` (`ember`, `coral`, `ratchet`) in that authored order — any template may open the cup and any template may host the finale. Do not reorder the design circuits; keep each race's narrative aligned: race N illustrates `levelPlan[N]` and `story.levelIntros[N]`. Repeating or skipping a template fails validation.
- Each level is one circuit: a varied short `name` (never reuse another circuit's name), its `template`, `laps` (always 3), a `musicSong` (use `theme` for races 1-2, `boss` for the finale), and exactly 4 `rivals` in grid order.
- NEVER invent track geometry. The `template` selects a proven closed circuit: `ember` (hairpin + S-curves), `coral` (fast double-apex sweepers), `ratchet` (tight chicanes). All cornering, lengths (~2800-3600 units), pads, and scenery defaults come from the template.
- THE CUP CAST NEVER CHANGES: the SAME 4 rival driver names must appear in the SAME slots in all 3 races (slot 1 in race 1 is slot 1 in races 2-3). A rename mid-cup fails validation and corrupts cup scoring.
- A rival is bounded DATA, not art: `name` and `topScale` (0.7-1.0 — rivals may never outrun player top speed). Keep names short, distinct, printable ASCII. Pace the field fairly: lead rivals 0.9+, backmarkers 0.7-0.85, finale lead rival up to 0.985. Match the design `difficulty`: chill calms every scale ~0.92x, spicy sharpens ~1.03x (still clamped at 1.0).
- Optionally set `theme` (vary `scenery` posts/pines/crystals and sky/sun/ridge/ground/accent colors per circuit so the three races look distinct) and `timeoutS` (220-400 — a 3-lap race must stay winnable with margin; below 220 fails validation). Omit both for template defaults.
- Author per-circuit world dressing from the design's `racingIdentity` + `levelPlan`: each circuit gets an `envConcept` (one concrete locale sentence rooted in the cup's `worldConcept` — the image pipeline paints this course's panorama from it, never geometry) and `materials` (road/ground/curb/edge/pad hex colors). The cup shares one generated material atlas; course colors and panoramas provide local variation. Keep them coherent with the shared `artDirection`, distinct across the three races. For jetski cups every `envConcept` is a water locale (lagoon, harbor, mangroves, open water) and `materials` are water roles: road = open water, ground = shallows bank, curb = shore edge, edge/pad = waterline/boost-surface water. Never author asphalt, stripes, curbs, or guardrails for a jetski cup.
- Bounded variation (all optional, all validated): `length` 2800-3600 rescales the template lap; `mirror: true` reverses turn direction; `craftShape` (dart/twinpod/wedge) picks the player's procedural silhouette for that race. Craft liveries always come from the game palette (hero slot for you, enemy slots per rival index). Never invent geometry beyond these knobs.
- Bounded verticality (all optional, all validated — omit for legacy flat racing exactly): `elevation` picks one periodic hill profile for the course — `flat` (default), `rolling` (paired rises over the lap), or `ridge` (one dominant climb per lap). The engine owns amplitude and grade; never author height points, control points, or numeric grades. Water courses stay `flat` by default (waves, not hills) unless the design explicitly asks for swells. `jumps` is `none` (default) or `ramps`: 1-2 deterministic centered ramp zones with an avoidance line on each side. Racers launch off the lip at speed and land back on the same circuit — never promise free flight, tricks, air control stunts, or a hop button. Optional `forks` is `none` (default) or `split`: a wider safe left route and narrower right route with the authored boost supply, sharing the same lap progress. For split use length 3600 and jumps none on that course; all three templates support tested variants. Elevation may coexist. Never promise a shorter shortcut, high/low branch, overpass, or combat obstacle. Teach the route choice before increasing corner difficulty.
- New cups use the five generated craft strips from `racingIdentity` consistently across all three races. `craftShape` applies only to legacy cups without generated art; hero/boss sprite assigns are unused schema placeholders.

## Example (condensed from a shipped game)

{{GOLDEN_EXCERPT}}

## Output

Respond with RAW JSON ONLY - no markdown fences, no commentary - matching this JSON Schema exactly (an object with a `levels` array of EXACTLY 3 circuits):

{{SCHEMA}}
