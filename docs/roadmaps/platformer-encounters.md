# Platformer encounter variety and fairness

Accepted September 8, 2026. Branch: `codex/platformer-encounters`, based on checkpoint `aa8134d`.

This run adds twelve bounded encounter patterns, composition and recency guidance, route/placement
checks, and readable enemy/boss openings. Existing game specs remain supported. The morning
deliverable is a reviewable branch and two live examples of each of the five styles, with a combined
$10 generation cap, a comparison report, and explicit failures or verification limits.

| Pattern | Decision it creates |
| --- | --- |
| Bounce run | Patrol spacing and optional bounce shortcuts |
| Stepped route | Changing landing heights and approach direction |
| High/low route | Upper rewards versus the supported lower route |
| Cover advance | Shoot, cross cover, and advance between volleys |
| Overhead targets | Aim upward or take the elevated approach |
| Patrol duel | Read a patrol, strike, and recover in open space |
| Jump-in approach | Use the upper perch for an active landing strike |
| Crossfire break | Use separated cover and staggered threats |
| Wall ascent | A continuous face with a supported rest bridge |
| Switchback climb | Change which wall leads to the next landing |
| Sheltered climb | Intermediate rest ledges and cover |
| Armed ascent | Combine wall movement with elevated ranged threats |

Each level starts with an introduction and ends with a test, with distinct middle encounters.
Variants change authored geometry; the AI selects the pattern sequence, variants, enemy types, and
rewards. The compiler produces ordinary tiles/entities plus bounded encounter provenance. Validation
checks the compiled result, style compatibility, placement, and provenance after repairs.

Verification will include all pattern variants, full composed routes, unsafe-placement regressions,
runtime attack timing, and a live batch. Automated reachability and conservative fairness checks do
not establish subjective difficulty or prove a full combat playthrough. Browsers must be muted and
closed after use. Work stays on this branch for review; the currently deployed baseline stays available.

Implementation checkpoint: the compiler and schema are integrated with initial generation, repair,
mock generation, saved specs, and mechanical history. New generation uses only encounterRoute;
legacy tileRuns and towerRoute compilation remains available for saved work. Delivery metadata is
checked against recompiled geometry so a repair cannot keep misleading pattern labels.

Combat pacing is opt-in via encounterVersion: turrets wait for a full visible firing interval and
show a sparse pixel warning; chasers wait until the player approaches their elevation; final boss
phases retain kit-specific telegraphs and recovery windows. Placement checks reserve safe anchors
and supported enemy approach/retreat space. Browser automation is muted.

Verification at this checkpoint: 980 tests across 122 files, typecheck, lint and production builds
pass. The 11 browser end-to-end tests also pass. The 81 encounter tests exercise all twelve patterns,
three variants, both directions, whole games for every style, unsafe edits, schema compilation and
history. Live comparisons and their costs are recorded separately in the completion report.
