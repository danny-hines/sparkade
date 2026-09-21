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
