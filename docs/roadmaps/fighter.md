# Fighter

## First combat-profile slice

Fighter now separates appearance from a bounded combat kit. New designs select
`fighterStyle` for the player and `combatProfile` for all five roster members.
The three ladder opponents cover all three profiles; the boss uses one of them.
Build, costume and palette remain independent visual choices.

| Profile         | Signature                                                                                     | Counterplay                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `rushdown`      | Faster approach and a confirmed low-punch → high-punch → high-kick chain                      | Guard or bait a miss, then retaliate during recovery                              |
| `counter`       | A fresh 160 ms guard window negates contact and grants 900 ms to start a stronger retaliation | Bait the guard and attack after its window; holding guard cannot repeatedly parry |
| `rangedControl` | Guard + high punch releases a telegraphed energy pulse; slower normal attacks                 | Interrupt the windup, guard, jump or duck, then approach during recovery          |

All profiles retain the normal high/low punches, kicks and aerial attacks. All
can confirm low punch into high punch; only rushdown cancels into the kick.
Whiffs and blocked hits do not unlock chains. Successive hits scale to 75% and
55%; a third hit pushes the defender away and grants a short escape window.
The pulse has a 280 ms windup, two-second cooldown and one active projectile
per fighter. The engine owns these values; generation cannot invent frame data.
Profiled fighters have a roughly 90 px jump apex so they can clear pulses at the
generated character's hand height. Legacy ladders keep their original jump.

The cabinet controls card waits for confirmation. Matchup cards teach the
player's signature and the current opponent's counterplay, while the fight HUD
shows profiles, chain feedback, counter readiness and pulse cooldown. Special
effects use small pixel clusters. AI rushes and chains, guards and retaliates,
or maintains distance and uses pulses according to its profile.

The existing thirteen-state atlas remains sufficient: punchHigh releases a
pulse and block anchors timed guard. Generation prompts adapt pose direction
to the selected kit, without baking projectile effects into character images.
There are no additional paid pose roles in this slice.

Specs without `fighterStyle` and roster profiles retain the shared-normal
legacy ladder. Their controls and art requirements remain compatible. New
generation requires every profile and preserves the player choice through
repair. Mechanical fingerprints include player kit and opponent composition.

## Playtest before expanding

Use `?dev=playtest&fighterStyle=rushdown`, `counter` or `rangedControl` to compare
the kits with the same roster art. Automated ladder replays retain active AI and
real damage/round progression, but restore player health and stage approach
distance. They verify completion, not human difficulty or controller feel.
Physical-cabinet playtesting should focus on chain timing, counter readability,
fair openings against each opponent, and the ranged fighter's corner behavior.

Next candidates, after that feedback:

- Give AI explicit, bounded responses to incoming projectiles and measured
  reaction delays; tune difficulty from recorded human sessions.
- Add a fourth grappler profile only with a clear throw tell, escape rule and
  matching throw/received-throw artwork. Avoid invisible new hit rules.
- Consider roster selection or branching rival order as a separate progression
  slice, with persisted selection and rematch coverage.
- Expand profile-specific presentation or finishers after shared kit balance
  proves stable; keep costumes independent of mechanical strength.

Long command strings, freeform generated moves, combined profiles and new input
buttons are outside this slice.
