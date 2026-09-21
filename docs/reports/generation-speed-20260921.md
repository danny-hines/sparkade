# Generation speed follow-up

This follows the three concurrent platformer measurements in
[the September 20 report](generation-speed-20260920.md). The earlier two successful
first attempts took 5:48 and 5:50; the third failed one required upward-shot pose
and recovered with one image and one review in another 61 seconds.

## Implemented changes

- Platformer actions get four candidates per pose per job attempt. A durable
  repair record preserves the consumed budget and review guidance across resumes.
  An explicit user retry starts another bounded budget for unfinished poses.
  Upward-shot repairs receive an arm-geometry diagram alongside the approved
  character. Identity, costume, pose and technical acceptance thresholds remain.
- Processed action candidates and review boards persist. Review batch membership
  is frozen when dispatched, so later image completions cannot replace an
  in-flight review with another paid review of overlapping candidates.
- Large checkpoint files use content-addressed private packs and small file
  references. Unchanged files and staging-to-publication renames reuse their
  stored bytes. Reads validate integrity, support old inline checkpoints, use
  bounded parallel requests and an optional bounded in-memory cache. Publication
  and individual previews load only their required files/packs.
- Each saved pipeline pass records restore, execution, collection, checkpoint
  read/write and provider-response read timings, plus file bytes, reused bytes,
  uploaded bytes and new pack count. Response-read time is cumulative and may
  overlap; it is not additive wall time.

## Archetype audit, in priority order

### Racing

The historical first-attempt production run `j-pnmqcxjX-WeS` took 20:22 before
these changes. Roster review waited for panoramas, scenery and materials, and
optional animation processed five racers serially. The roster now advances
independently of the world pack; independent rival repairs and animation branches
run concurrently. All branches drain before a checkpoint or failure, and the
same required identity and optional-motion gates still apply.

### Fighter

The historical production run `j-4PuEei9sn7xz` took 15:32. Every identity candidate
waited for the boss story illustration. Each fighter now starts from its own
available reference, allowing the player and three opponents to start while
the boss illustration is pending. The complete-roster review remains. Normalized
identity/pose candidates and split pose sheets are cached across resumes.

The first live preview exposed another repeated step: once one atlas finished,
the smaller unfinished roster caused another identity selection, sometimes
changing foundations and requesting new sheets. The follow-up persists the
approved selection for the full source/roster/attempt fingerprint. A staggered
completion regression test verifies that only one identity board is reviewed;
six additional fighter pipeline/retry tests pass.

### Adventure

Story art and portraits can start from the approved hero foundation while the
remaining animation set finishes. Final publication still requires the full set.
The foundation's exact identity is retained across downstream assets.

The audit also found a partial-completion problem: one finished sheet caused a
later pass to skip another in-flight sheet and request individual repairs. Sheet
attempt markers now distinguish a workflow resume from an explicit game retry.
The former resumes the sheet; the latter preserves healthy poses and repairs
only missing ones. Candidate identities persist, and a completed-set marker
prevents locally normalized poses from bypassing the set-review stage on resume.

The live audit also found that a completed individual repair changed the initial
review pool while a sibling repair was still pending. That caused new guidance
and repeated image requests. The initial pool now persists per job attempt;
resuming reuses its review, exact references and in-flight repair requests. A
staggered two-candidate repair regression failed before this correction (a
duplicate R1 image) and passes afterward. The live adventure timing below
precedes this final correction.

### Horizontal and vertical shooters

Their craft-before-key-art dependency is intentional: it supplies the approved
vehicle identity. Candidate normalization is now cached. Missing enemy roles
previously repaired serially; those repairs run together in stable role order.
Enemy-board splitting and replacement normalization also persist across passes.
Existing multi-enemy image boards remain in use.

## Verification

- Restart tests cover all six archetypes without repeating completed provider
  requests. Delayed scenery, boss art and adventure sheets demonstrate independent
  progress. Erasing two shooter enemy roles dispatches both repairs together.
- Action tests cover exhaustion across resumes, explicit retries, fourth-candidate
  automatic repair, reuse while review is pending, and stable in-flight batches.
- Checkpoint tests cover legacy reads, unchanged files, changed files, renames,
  deletions, cold reads, selected-file reads and recovery after corrupt/missing
  storage. Unchanged large files require no new pack uploads.
- Local PostgreSQL verification passed 55 website/capacity tests.
- The full suite passed 2,195 tests; 90 were skipped behind their existing
  environment/fixture gates (the 55 PostgreSQL tests ran separately). Root and
  site typechecks, lint, root build, and the preview deployment build passed.

Historical timings above are small-sample observations from older deployments,
not measurements of the optimized implementation. Live preview results will be
recorded below after verification; production rollout is separate.

## Live preview audit

Preview `dpl_HeUzuz1muyKuQvFFFbNkMzkHXBbY` runs commit `80d5615`. Six games use
one test owner, with at most three active concurrently. Racing, fighter and
adventure start first; horizontal shooter, vertical shooter and platformer fill
the freed slots in that order. These are fresh, no-photo games. Platformer uses
the earlier Danny/Meta prompt; the other archetypes use a fictional courier or
inventor premise. Timings cover cloud creation to publication, not Portal
download or installation. Individual results are diagnostic samples, not p50/p90
or reliability estimates.

| Archetype | Published game | Cloud → ready | Calls (images) | Passes | Checkpoint read / write |
| --- | --- | ---: | ---: | ---: | ---: |
| racing | [Solar Sprint Cup](https://sparkade.dev/p/zmkzyrx) | 6:54 | 45 (30) | 30 | 9.53s / 7.48s |
| fighter | [Tide Crown Tourney](https://sparkade.dev/p/nk2dkqv) | 11:49 | 75 (53) | 40 | 56.05s / 12.60s |
| adventure | [Solmar Lighthouse](https://sparkade.dev/p/m8vswf3) | 10:25 | 49 (37) | 31 | 35.82s / 11.78s |
| hshooter | [Solar Harbor Run](https://sparkade.dev/p/b88bcpc) | 5:41 | 24 (16) | 17 | 2.10s / 3.45s |
| shooter | [Solar Harbor Run](https://sparkade.dev/p/kbszmvv) | 4:05 | 25 (17) | 18 | 2.63s / 4.36s |
| platformer | [Danny Debugs Meta](https://sparkade.dev/p/vs6mf6m) | 5:32 | 52 (39) | 28 | 3.89s / 6.70s |

All six completed on attempt 1, with no failed provider calls recorded. This
does not imply every image candidate passed quality checks. The 100 published
assets were fetched through the public game's returned asset URLs; every file
matched its manifest hash and dimensions, and all six bundles passed the
Portal compatibility/manifest validator. This is not a playthrough or a local
Portal installation test.

The platformer chose **acrobat**, with four action poses, despite using the same
original prompt and brief. Earlier benchmark games used **runAndGun**. Its 5:32
time must not be described as a controlled improvement over their 5:48–5:50.
A separate explicitly requested run-and-gun fixture checks the upward poses.

Racing approved animated locomotion for the player and one rival. Three rivals
used the existing approved neutral fallback after motion review. Their reviews
reported opaque panels, and some also reported scale or temporal-motion issues.
Those rejections need a separate visual/alpha audit before treating the faster
run as a complete animation-quality success; the gate was not weakened.

Adventure generated each of its two player sheets once, but all eleven
non-foundation cells needed local recovery. The first semantic set review at
5:39 then requested three pose repairs; further candidates/reviews extended
completion to 10:25. Improving sheet validity and repair yield is the strongest
remaining adventure opportunity.

The first fighter run performed five identity selections as the pending roster
shrunk and repeated eight pose-sheet calls. Commit `1fa1db5` persists the
approved selection. A new live run on preview `dpl_3DCRsJHD16paUXLWCJdMFmra9toY`
checks this correction separately, preserving the first run's measurements.

The fighter recheck, [Harbor Circuit Clash](https://sparkade.dev/p/v2v58xx),
published in **7:00** (420.206 seconds), using **53 calls** across 26 passes.
The captured request catalog contains one identity review and all ten pose sheets
exactly once, versus eight repeated sheet calls in the first run. All five fighter
atlases and the arena are generated, and all eleven published assets passed hash
and dimension verification. Different generated art/repairs prevent treating the
wall-time difference as a controlled effect size; the eliminated duplicate calls
are directly verified.

Checkpoint reuse in the first fighter run avoided re-uploading 1.38 GB of
unchanged decoded file content across passes. Its checkpoint writes totaled
12.60 seconds. Adventure reused 769 MB, platformer 170 MB, and racing 160 MB.
These are cumulative decoded bytes reused, not peak memory or a comparison
with wire bytes (packs contain base64 JSON). Reads remain measurable—56 seconds
across the first fighter run—so selective filesystem restoration is a potential
later improvement.

## Image-call batching and remaining work

Keep small prop/enemy boards and pose sheets where their cells survive validation.
The platformer prop board needed one individual projectile replacement in this
sample; the vertical-shooter enemy board also needed one individual replacement.
Bigger sheets alone are not a speed win: adventure's two sheets failed local
validation for every non-foundation cell and were followed by individual calls.

The next useful experiments are improving adventure sheet layout/validation
agreement, auditing racing motion-review backgrounds against the actual alpha
channel, and then trying a small per-character identity-candidate board. Measure
accepted assets per image call and total repair time alongside wall time. Keep
required pose/identity gates and individual-cell repairs; avoid making one bad
cell require regenerating an entire approved sheet.
