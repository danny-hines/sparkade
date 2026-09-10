# Adventure objective styles and kiosk closeout — September 10, 2026

Adventure now supports three committed objectives throughout design, level/entity generation,
repair, runtime controls, and saved mechanical fingerprints:

- **Dungeon expedition:** branch through a tool-and-key dungeon, then defeat the guardian.
- **Puzzle quest:** solve at least four block-and-plate seals, including a final puzzle instead of
  boss combat. Three compiled patterns support mirrored variants. Puzzle rooms are enemy-free;
  other rooms have lower combat pressure. X resets an unsolved room without restoring health or score.
- **Rescue raid:** rescue captive NPCs with A, meet a quota, defeat the guardian, and return to the
  entrance beacon to extract. An extra optional captive gives a route/score choice. Rescued NPCs
  disappear immediately; there is no moving escort companion in this slice.

Seals, their completed block positions, and rescued NPCs persist through room changes and death.
The objective HUD and map show progress. Controls use the actual equipment names, explain reset or
extraction where relevant, and wait for Begin. The pause controls panel expands to fit these actions.

Validation now checks every legal key-spending order rather than accepting a single successful
order. Door approaches and required interactions must share a safe room route. Style-specific
checks protect preliminary seal access, early teaching/rescue opportunities, exact puzzle geometry,
enemy pressure, and the entrance extraction area. Repair cannot change the selected objective.

## Kiosk behavior

On startup, ready platformers without a presentation family receive a deterministic theme-matched
storybook, tech, or arcade family. The migration saves the exact original spec as
`presentation-before-v1.json`, writes the updated spec atomically, and refreshes its mechanical
fingerprint. Repeated startup is safe, including recovery after a power cut between writes. Existing
explicit family choices are retained. Gameplay fields, artwork, game IDs, and score records are not
changed. The built-in golden platformer now explicitly uses the storybook family.

Settings → System shows the running server's seven-character build commit beside its version.
Production embeds the commit at build time, so a later pull cannot relabel the running server.
This batch must still be deployed before the physical kiosk receives these changes.

## Verification

Three authored references reuse golden Adventure art and are accessible from the playtest style
navigation. Their controller replays walk through actual room geometry, collect keys and the tool,
spend keys at doors, push the puzzle blocks, rescue NPCs, exercise death persistence, and complete
all three victory paths. Combat uses an invulnerable pilot with controlled positioning to exercise
actual primary-attack collision. These checks establish progression and runtime behavior, not
unaided victory or final human difficulty balance.

- Full verification passed: 1,232 tests across 129 files, typecheck, lint, and production builds.
- All 23 browser regression tests passed after the final controls changes. Thirty focused
  presentation, objective, migration, and pose-recovery tests also passed.
- The three Adventure browser cases also pass after the final controls changes and negative checks:
  a key plus tool cannot bypass an unmet objective, standing on a pressure plate cannot permanently
  solve a seal, and reset grants neither health nor score.

All three real-provider games are ready with their required generated assets. Each passed a
complete controller replay without browser errors. Lantern Rescue's pilot deliberately rescued
exactly the quota and left the extra captive behind, then defeated the guardian and walked back
to the entrance to extract. Screenshots of controls, room/objective HUD, map, pause, and extraction
were inspected at the cabinet's 1024×600 resolution. Rescue prompts sit above the NPC artwork,
and both captive and extraction labels use dark pixel backings for contrast over pale floors.

| Live game                                                                | Style               | Controller checks | Cost, including retries |
| ------------------------------------------------------------------------ | ------------------- | ----------------- | ----------------------- |
| [Bramble Key](http://127.0.0.1:5173/?dev=playtest&game=g-v5hyvrx1es)     | `dungeonExpedition` | 5/5               | $0.316                  |
| [Clockwork Seals](http://127.0.0.1:5173/?dev=playtest&game=g-c3swhilagj) | `puzzleQuest`       | 12/12             | $0.304                  |
| [Lantern Rescue](http://127.0.0.1:5173/?dev=playtest&game=g-r3nhaw1mgr)  | `rescueRaid`        | 12/12             | $0.324                  |

The live batch used the existing configured Meta providers in an isolated server/data directory
with public publication disabled. Ready games were copied into the normal local testing library;
the isolated ledger, checkpoints, screenshots, and controller reports remain under
`data/experiments/adventure-styles-20260910/` (ignored debug data).

New spend totals **$0.944006894**, including Bramble Key's failed first attempt and retry. Together
with the previous experiments, tracked spend is **$8.61060735 of the $10 budget**. These games have
not been copied to the physical kiosk or public gallery.

## Artwork recovery

The first live Bramble Key attempt failed the complete hero height-consistency check. Its twelve
processed poses were foot-anchored, but one wide side-facing secondary action was twelve pixels
shorter than the tallest pose, exceeding the ten-pixel tolerance. A targeted recovery now finds at
most three outliers around the identity anchor, repaints them with narrower action silhouettes,
and reviews the complete combination again. The existing tolerance is unchanged. Retrying this job
preserved eleven healthy checkpoints and regenerated the one geometric outlier; normal semantic
review may also request its existing bounded pose improvements.

Clockwork Seals and Lantern Rescue each recovered eleven individual poses after their grouped
sheets failed local extraction checks. Both ultimately published complete generated hero sets;
no image validator was loosened. Sheet reliability remains a useful future efficiency improvement.
