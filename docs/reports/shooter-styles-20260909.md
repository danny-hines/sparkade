# Vertical shooter play styles — September 9, 2026

Three permanent weapon kits now change how a vertical shooter plays from its opening waves to its boss. New generation selects `shooterStyle` before authoring stages and assets; the final spec and mechanical fingerprint preserve that choice.

- **Switching assault:** focused double-power fire versus a three-shot spread. Tap X to switch; holding it never cycles repeatedly.
- **Charge specialist:** 0.8-second charge, six damage and piercing through aligned enemies. Charging pauses primary fire and slows movement. Boss openings double charged damage to 12.
- **Lock-on striker:** up to four locks distributed across ships ahead, then stacked on remaining targets. Release tracking missiles for three damage each. Targeting slows movement and pauses primary fire; invalid or recycled targets cannot retain a lock.

Every stage needs two encounters demonstrating its kit, including one by 20 seconds. Switching additionally needs both broad swarms and armored columns. Bosses offer 2.4 seconds of recovery after 4.8 seconds of attacks; switching and lock-on require wing pods. Normal fire stays useful throughout. Existing unstyled vertical games remain loadable and retain their original boss cadence; horizontal shooters retain their current mechanics.

The comparison page reuses golden artwork in three authored games, each with three stages and a boss. New weapon effects use pixel clusters and sprite-derived muzzle anchors, with no additional craft pose image calls. The live comparison uses independently generated worlds and artwork. Results are recorded below.

## Validation

- Full verification: 1,205 tests across 126 files passed. Follow-up shooter/authoring checks (28 tests) and artwork correction checks (5 tests) passed after the final refinements. Final typecheck and production builds passed.
- Controlled browser combat: 28 checks across all three references passed, covering focus/spread, charge suppression/release/piercing, moving missile targets, target distribution, death/restart cleanup, primary damage and boss openings.
- These bounded combat checks exercise the production controller, collision and projectile pools. They establish mechanics and lifecycle correctness, not an unaided full-game victory or final subjective difficulty tuning.

- Full browser suite: 19/19 passed. After the final weapon refinements, the three shooter cases passed again with real keyboard routing, pause and controlled combat checks.
- Two refinements found during verification: spread coverage now reaches separated flank targets; missiles reserve four of the eight shot slots without preventing primary fire in the other four.
- Encounter tagging permits a broad holding swarm to satisfy both its coverage and targeting geometry, matching the generation prompt.
- The first switching game's scout art failed twice because it was too wide. The corrective prompt now gives the same role-specific aspect threshold that the existing validator enforces, including instructions to sweep wings backward. Validation was not relaxed.

## Live comparison

All three live games are ready, with complete required craft/enemy/boss art. Each passed controlled combat checks and a complete authored timeline through all three stages and its boss. No browser errors were observed.

| Game                                                                     | Style              | Combat checks | Simulated completion | Generation cost |
| ------------------------------------------------------------------------ | ------------------ | ------------- | -------------------- | --------------- |
| [Prism Patrol](http://127.0.0.1:5173/?dev=playtest&game=g-1sggrylcgd)    | `weaponSwitch`     | 9/9           | 287.8s               | $0.209          |
| [Ion Pilgrim](http://127.0.0.1:5173/?dev=playtest&game=g-4hkadrktkz)     | `chargeSpecialist` | 9/9           | 292.1s               | $0.169          |
| [Kestrel Command](http://127.0.0.1:5173/?dev=playtest&game=g-tabnqwwmzm) | `lockOnStriker`    | 10/10         | 301.4s               | $0.169          |

Total new spend including both Prism Patrol retries: **$0.547**. Including the earlier platformer experiment, tracked spend is **$7.667 of $10**. The local ledger, combat results, timeline results and screenshots are in `data/experiments/shooter-styles-20260909/` (debug data, excluded from Git).

All three simulations stayed below 24 active foes, eight player projectiles and 48 enemy bullets. Their pilots are invulnerable to isolate progression and bounded resource use from difficulty. Human playtesting remains the next check for pacing, visibility and challenge. Changes are local; deploying the updated runtime to the kiosk is separate.
