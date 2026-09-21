# Art generation latency follow-up

This builds on [the first speed audit](generation-speed-20260921.md). The goal is
to reduce the time to a fully generated game without removing pose, identity,
equipment or sprite validation. Under two minutes remains a target, not a
measured claim.

## Changes

- Platformer action poses start from the common front/side identity while the
  run and jump candidates are still being generated and reviewed. Wall attacks
  retain their dependency on the approved wall slide. The original identity
  buffers persist separately so later alignment of the movement sprites cannot
  change action hashes and repeat paid calls on resume.
- Photo-based platformers start identity generation directly from the photo.
  They no longer wait for cover art that is not used as their identity source.
  No-photo games still use cover art as identity truth.
- Art review schemas omit repeated `summary` and `rationale` prose. Candidate
  IDs, scores, selections, pair counts, fatal issues and repair guidance remain.
  Only image reviews in the asset stage use compact output. Gameplay generation,
  content moderation, acceptance thresholds, reasoning effort and token ceilings
  remain unchanged.
- Adventure sheet references explicitly use green contain-resize padding.
  Sharp's default opaque black letterboxing had placed two black bars in every
  cell; Muse copied these bars, and the sprite validator rejected the resulting
  disconnected subjects or rectangular panels. The fix changes the input board,
  not the validator. Prompt/cache version advances to v5.
- A final follow-up starts wall attacks immediately when wall-slide is accepted,
  even if unrelated ground/air attacks are still in review or repair. Wall
  repair boards explicitly preserve that slide posture in identity mode.
  Action prompt/cache version advances to v6.

## Controlled live component checks

Four Muse Image calls used the same published Solmar Lighthouse identity and
combat kit, with the existing movement/combat prompts. The old board produced
**0/12 extractable cells**; the corrected board produced **12/12**, with no
relaxation of extraction gates. These are two six-cell sheets per variant, not
an estimate of long-run acceptance probability. Semantic review still follows
extraction in the full pipeline.

The corrected twelve-pose board was then reviewed twice with the same model,
low reasoning effort, scoring contract and 7,000-token ceiling:

| Review output | Request duration | Output tokens | Result |
| --- | ---: | ---: | --- |
| Original prose | 43.227s | 3,564 | Accepted; all 12 reviewed |
| Compact | 22.176s | 2,012 | Accepted; all 12 reviewed |

This single paired observation is 48.7% shorter with 43.5% fewer output tokens;
it is not a latency distribution or a guarantee of identical model judgments.
The requests ran concurrently to reduce differences in provider conditions.

## Verification

- Full suite at `8f6327c`: 2,198 passed, 90 skipped by existing environment gates.
- Added photo-before-cover dependency test at `47bb039`: passed separately.
- Durable tests hold a run candidate pending while action requests advance and
  verify all eight run-and-gun actions are requested exactly once across resumes.
- Identity-only action tests cover all eleven armed-climber poses, wall-slide
  dependencies and a fresh cache/workspace resume without new image requests.
- Compact schema tests retain all scoring/selection fields and verify missing
  scores, omitted candidates and unknown candidate IDs still fail acceptance.
- Adventure seed tests require green padding and all six reference cells to
  round-trip through the unchanged extractor.
- Root/site typechecks, lint and preview deployment build pass. The final wall
  follow-up also passes root typecheck and changed-file lint.

## Live full-generation audit

Preview `dpl_DK665pUn1modfzYYCkuZw7AV9b43` runs `47bb039`:
<https://sparkade-1gapkbin9-danny-hines-projects.vercel.app>.
Three fresh no-photo jobs run concurrently under the existing test owner:
run-and-gun, armed climber and adventure. Run-and-gun and adventure reuse their
previous prompts. Timings cover cloud submission to publication, excluding
Portal download and installation. No starter-art or partial-play mode is used.

| Style | Published game | Cloud → published | Previous sample | Calls (images) |
| --- | --- | ---: | ---: | ---: |
| run-and-gun | [Danny Merge Conflict](https://sparkade.dev/p/bzvc3td) | 4:21 (261.431s) | 7:31 | 53 (42) |
| adventure | [Maya Sunlit Beacon](https://sparkade.dev/p/rwjy5bm) | 6:52 (412.485s) | 10:25 | 29 (18) |
| armed climber | [Danny: Wallpatch Tower](https://sparkade.dev/p/589zp59) | 9:16 (555.535s) | No equivalent baseline | 73 (54) |

Run-and-gun was 42.0% faster than the earlier same-prompt/style sample; Adventure
was 34.1% faster. Fresh generations vary in level repairs, designs and artwork,
so these observations do not isolate each change's contribution. All three
finished on game attempt 1; no provider request required a transport retry. All 90 published assets matched their manifests'
hashes/dimensions, and all three bundles passed the Portal compatibility validator.

The platformer's action generation and run/jump generation started together at
10:04:14–15 UTC. All eight required action images were requested once. Final
movement selection finished afterward; actions no longer waited for it.
Adventure generated both sheets once, with zero isolated extraction-recovery
calls. Its set review requested two alternatives each for upIdle and sideIdle.
This is materially fewer image calls than the prior run's 37 versus 18 now.

The climber exposed remaining latency: level repairs ran from 10:02:20 UTC
through regeneration and art startup at 10:04:27 (about 127 seconds). The captured
mixed tower route reproduces an unreachable exit; generic entity normalization
then changes the compiled encounter and triggers provenance errors. This needs
a separate compiler/traversal investigation, not a relaxed validation gate.
Three upward poses (shootUp, runShootUp2, wallShootUp) needed a second image.

These full-generation measurements **precede** the final wall-attack scheduling
and repair-reference follow-up in `eb13d78`. That follow-up passed 19 action and
durable tests, including all six archetypes, early wall completion during an
unrelated suspended repair, and no duplicate wall images after a fresh resume.
It has not received another fresh full-game timing measurement. No production
promotion or local Portal installation was performed.

Browser smoke checks loaded the run-and-gun controls/story/level introduction
and reached Adventure gameplay with the generated character and objects, with
no browser errors. These checks are not complete playthroughs.

## First playable versus final art

Platformer, fighter and adventure enforce complete required art sets at runtime;
platformer action-specific starter sprites are not present in the built-in
platformer pack. Exposing a validated spec early would not make these games
playable. Early play therefore needs a separate, explicit starter-art product
path with complete mechanic-compatible art and a session-stable final-art
upgrade. This patch retains the existing fully custom completion contract.
