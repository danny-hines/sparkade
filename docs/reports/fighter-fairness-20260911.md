# Fighter fairness and themed projectiles — 2026-09-11

Follow-up to the first Fighter slice on `codex/fighter-combat-styles`.

## Gameplay changes

- Reactive guard and anti-air have a visible reaction floor per difficulty:
  240 ms chill, 190 ms standard, 140 ms spicy. Higher boss aggression cannot
  shorten these floors. A previously chosen guard remains valid.
- Anti-air rolls once per observed jump, replacing per-frame rerolls.
- AI observes an emitted projectile once and may choose its profile's response:
  rushdown jumps forward, counter guards, ranged control ducks. Decision success
  is bounded at 40/55/70% per difficulty; a declined response cannot reroll into
  immunity. Defense cannot cancel an attack or bypass existing recovery.
- Committed defenses leave 180 ms of recovery afterward. Ranged retreat speed
  is reduced so a slow player can close distance against a fast opponent.
- Existing normal attacks, combo scaling, three-hit escape rules, pulse damage,
  windup and cooldown remain intact. Legacy unprofiled ladders keep their AI.

## Projectile presentation and generation

Every newly generated ranged character must have a named projectile chosen to
fit its power source and plot. The schema accepts five bounded visual kinds:

| Kind          | Presentation                                                     |
| ------------- | ---------------------------------------------------------------- |
| `energyBlast` | Bright plasma core, breathing highlights, blue particle trail    |
| `fireball`    | Flame silhouette, orange/yellow core, trailing and rising embers |
| `frostShard`  | Pointed crystal silhouette, cold glints, shattering fragments    |
| `arcBolt`     | Jagged bolt, crawling arcs, electric streaks                     |
| `spiritOrb`   | Hollow mystic orb, orbiting motes, purple spectral fragments     |

All use animated pixel windup, flight and impact effects. Move names appear in
controls, matchup advice and the HUD. The model cannot supply damage or other
combat values through the projectile object. Repair prompts retain the authored
name/kind; the publication gate rejects missing projectile metadata in a new
ranged roster. Saved ranged specs without metadata get the energy-blast default.

Effects are hand-authored runtime pixel art selected by generation. No extra
image-generation roles or changes to the thirteen-state character atlas are
required. The art prompt explains the selected power source and keeps the
projectile itself out of the character PNG.

## Verification

- `npm run verify`: typecheck, lint, **1,295 tests**, and production builds pass.
- Full Playwright suite: **27 tests pass**, including all three complete Fighter
  ladders and the five-theme keyboard/renderer/collision check.
- Seventeen new ordinary-health scenarios cover delayed guards at extreme
  aggression, one anti-air roll, successful and failed projectile defense,
  regained corner guard, approaching ranged opponents, and real punish windows
  against each profile in the final boss's last rage phase. Player health is
  never restored during these scenarios.
- Browser projectile checks fire through cabinet keyboard bindings, verify a
  substantial rendered body and visible animation, distinguish all five visual
  results, confirm actual damage and matching impact effects, clear state on
  round reset, and check 1024×600 layout.
- Saved-game compatibility, required generation metadata, bounded names,
  rejection of model-authored damage, and repair context are covered by tests.

These tests demonstrate combat openings and progression. Human playtesting on
the physical controller is still needed to judge enjoyment and difficulty.
The full-ladder pilot still restores health and stages approach distance; its
completion result is separate from the ordinary-health fairness scenarios.

## Live game and cost

**Ember Oath** (`g-wiff7m81ll`) was generated with the configured Meta providers
in an isolated local pipeline with public publication disabled. It published
all five character atlases and preserved these requested attacks:

| Character        | Profile        | Named attack                |
| ---------------- | -------------- | --------------------------- |
| Sera             | Ranged control | Phoenix Flare — fireball    |
| Ash              | Rushdown       | Normal chain                |
| Stone            | Counter        | Timed guard and retaliation |
| Volt             | Ranged control | Storm Coil — arc bolt       |
| Frost Oathkeeper | Ranged control | Winter Lance — frost shard  |

The final live-game pilot won all four bouts across eight rounds with 178
damaging contacts and no leftover projectiles. Screenshots of controls and
projectile windup, flight and impact were reviewed at cabinet resolution.

This generation cost **$0.5142286**, bringing tracked experiment spend to
**$9.49711095 of the $10 budget**. Ledger, generated files, replay result and
screenshots remain under `data/experiments/fighter-fairness-20260911/` in this
worktree. The ready game is also copied into its `data/fighter-styles` playtest
library, served by API 8094 and browser app 5194. Nothing was published to the
gallery or physical kiosk.
