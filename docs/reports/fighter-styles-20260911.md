# Fighter combat profiles — 2026-09-11

Implemented on `codex/fighter-combat-styles`, based on the committed cloud
generation work at `6626b95`. No deployment or physical-kiosk update is part of
this checkpoint.

## Result

New Fighter designs select a rushdown, counter or ranged-control player. Each
opponent has its own profile; every ladder introduces all three before the
boss. Rushdown confirms a three-hit chain, counter rewards a fresh timed guard,
and ranged control releases a telegraphed pulse with guard + high punch.

Normal attacks, movement and guard remain available to every profile. Chains
require unblocked hits and scale damage; the third hit grants an escape window.
Perfect guard has a cooldown and holding guard cannot repeatedly reopen it.
Pulse windup can be interrupted, cooldown starts at commitment, and only one
pulse per fighter can exist. Round changes clear all transient kit state.

Controls group the directional stick, wait for confirmation, and describe the
selected kit. Matchup cards explain the player signature and opponent
counterplay. HUD feedback shows kits, chains, retaliation readiness and pulse
cooldown. Effects use small pixel clusters. The live-art review corrected
pulse/guard placement from the old short-character geometry to the generated
fighters' upper bodies. Profiled fighters have enough jump height to clear the
new pulse lane across all builds; legacy jump behavior is preserved.

The generator uses existing thirteen-state atlases, with kit-aware art guidance
for the five roster members. No extra pose roles were added. Saved specs with
no profiles retain the legacy shared-normal ladder and its fingerprint.

## Verification

- Full `npm run verify` passed: typecheck, lint, 1,271 tests and production builds.
- Fighter runtime tests exercise confirmed chains, misses, blocks, scaling,
  escape windows, held versus fresh guard, one-use retaliation, interruption,
  cooldown, reset and profile-specific AI behavior.
- Projectile checks cover all nine body-size pairings, standing hits, chip
  damage, ducking, jumping, expiry and knockback after the owner turns around.
  Separate physics tests prove every profile can actually reach the necessary
  jump height and land again.
- All three styles pass design → roster/boss → scoped repair contract tests and
  the complete mock generation pipeline, including five published atlases.
- All three authored styles complete the four-bout ladder through the browser,
  with keyboard movement, controls confirmation and pause/resume checks.
- The wider 26-case browser run passed 25 cases; a hot reload during active
  source editing disposed the lock-on Shooter host mid-test. All six Fighter
  and Shooter cases passed together after editing stopped. The three Fighter
  cases passed again after the final pulse/jump alignment change.

The completion pilot restores player health and stages approach distance. It
keeps AI active and uses real strikes, damage, cooldowns, knockback, round wins
and bout transitions. These checks prove progression, not human difficulty or
physical-cabinet input feel.

## Live generation

**Cinder Circuit** (`g-heawxkbz41`) was generated with the existing configured
Meta providers in an isolated local pipeline, with public publishing disabled.
Its counter player faces rushdown, counter and ranged-control ladder opponents,
then a ranged-control boss. All five full character atlases and the arena/art
set published successfully. It completed eight rounds and four bouts in the
final controller replay, winning with 216 damaging contacts and no remaining
projectiles. Controls, matchup text, HUD, guard and pulse screenshots were
inspected at cabinet resolution.

Cost was **$0.372275**, bringing tracked experiment spend to **$8.98288235 of the
$10 budget**. This is one fresh mixed-roster game, plus three authored kit
comparisons sharing artwork, rather than three separate paid art generations.

Local debug artifacts, cost ledger, generated game, replay report and screenshots
remain under `data/experiments/fighter-styles-20260911/` in this worktree. A copy
of the ready game is in the isolated `data/fighter-styles` library, served by the
development API on 8094 and browser app on 5194. It has not been copied to the
public gallery or physical kiosk.

## Next feedback

Play the three kits on the cabinet before adding more. Focus on whether a new
player understands hit confirmation, can read the counter window, and can
close distance against pulses. AI projectile responses, human difficulty tuning
and any grappler/throw expansion are follow-up work described in the
[Fighter roadmap](../roadmaps/fighter.md).
