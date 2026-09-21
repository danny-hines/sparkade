# Cloud generation latency improvements

## Baseline

The Portal game [Danny Debugs Meta](https://sparkade.dev/p/hhry98w), job
`j-IBzqClQfJAWW`, took 600.88 seconds from cloud creation to publication on
September 20, 2026. Workflow `wrun_01M2YTVPM1J0620QAM6M1H0SE8` made 61 provider
calls (50 image and 11 text calls).

- Startup, design, levels, entities and music: 94.45 seconds.
- Art generation and visual reviews: 500.83 seconds.
- Final publication: 5.60 seconds.
- The hero identity candidates were available at 177.26 seconds, but their
  review did not start until 338.39 seconds.
- Nine of 25 simultaneous image requests encountered the 16-request owner cap
  and spent approximately 22 seconds waiting for capacity.
- The 16 pipeline advancement steps consumed 142.51 seconds in total.

These are overlapping intervals, not additive estimates of potential savings.
The available evidence covers cloud generation and publication; it does not
establish when the original Portal finished downloading the game.

## Changes

The default concurrent provider allowance per owner (a kiosk for kiosk jobs)
increases from 16 to 128, within the existing configurable 1,024-request global
allowance. Job admission limits are separate.

The workflow advances after any provider request completes instead of waiting
for the entire batch. Completed responses are coalesced between passes and each
request is dispatched once. A missing response suspends only its own branch;
structured joins drain all siblings before snapshotting the temporary filesystem.

Artwork can advance after levels and entities validate while the music request
is still running. A valid temporary soundtrack permits structural validation,
but is never saved as the validated checkpoint or published. The actual music
response must finish before publication. Independent run/jump and action review
batches run concurrently.

Provider response blobs load on demand. Normalized hero candidates are cached
privately across passes; only identity foundations retain full-size reference
images. Existing provider request records are reused, and new records are written
in bounded parallel batches. Completion telemetry uses the persisted start time.

Platformer pickups and projectiles use a single sheet with fixed cell positions.
Each extracted sprite passes the existing normalization checks plus a boundary
check. Invalid cells retry individually while valid cells survive checkpoint
replay. Hero candidates retain their individual images and visual reviews.

## Validation

- All six archetypes complete across fresh temporary filesystems without
  repeating completed provider calls.
- A held music request permits image generation; a held background request
  permits the hero to reach its next dependency.
- Erasing one sheet cell regenerates only that prop, preserving the other cells.
- Workflow tests cover partial completions, coalescing, failure and cancellation.
- Real local PostgreSQL tests verify 128 slots per owner, configured global
  capacity, and slot reuse.
- The full unit run passed 2,187 tests; two image-count assertions needed updating
  from 40 to 36 after batching, and both passed on rerun. 89 tests were skipped
  by their existing environment/fixture gates. PostgreSQL tests ran separately.
- Root and site TypeScript checks, lint, and root/site production builds pass.

A live Muse image test using the original game's key art returned all six props
in **one 19.7-second request**. Every crop passed validation and the normalized
sprites were visually inspected. This measures the sheet request only, not a new
end-to-end game generation. The total latency improvement still needs measuring
on fresh deployed generations; a 4–6 minute target is not a measured result.

Existing workflow runs remain pinned to their original deployment. New runs use
the new behavior after deployment.
