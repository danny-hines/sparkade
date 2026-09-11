# Vercel generation verification

Vercel generation is deployed to `https://sparkade.dev`. Live generation, voice transcription,
publication and kiosk-client installation checks passed. The office kiosk is now running
the cloud client; its physical-device checks are recorded below.

## Verified

- Existing Vercel project: `sparkade`, `prj_ItjDoldj9C6ifg6g6opJpshiUcX6`.
- Separate private Blob store: `sparkade-generation`, `store_6XFjsEaXD239WmWI`, `iad1`.
- Native Sharp workflow probe on Vercel Node 24.19.0 / Sharp 0.35.4: generated a
  1536×1024 synthetic input, ran the existing key-art and reference normalization,
  produced 480×270 key art in 91 ms wall / 98.8 ms CPU, process RSS 156,790,784 bytes.
  This is a native-runtime compatibility check, not a worst-case processing benchmark.
- Mock horizontal-shooter and platformer generation across fresh temporary filesystems:
  complete validated bundles, durable response reuse and cost-ledger deduplication.
- Real Neon concurrency test: eight simultaneous claims for an owner limited to two slots
  yielded exactly two leases; all test leases released.
- Full repository verification passed: typechecking, lint, builds and 132 test files /
  1,243 tests. Final site changes also passed site typechecking and repository lint.
- Production API checks passed: anonymous requests and wrong-audience/preview-signed tokens
  are rejected; another owner cannot read a job/bundle, cancel it or retry it. Repeated
  identical submissions return the same job; changed inputs with the same key return 409.

## Live preview runs

- Horizontal shooter: `j-m-sN0CUfUsVQ`, game `g-j2jrir7ptx`, public ID `ztd2xqd`.
  First attempt identified missing prompt packaging and failed before any model spend;
  resumed after correcting deployment file tracing and resource-path resolution.
  Completed on attempt 2 with $0.1687952 recorded model cost. The actual kiosk client
  downloaded, hash-verified and atomically installed all 12 assets into a temporary local
  library. The public web player reached active gameplay with no browser page errors.
- Platformer: `j-_ht3YJzxIKfe`, game `g-a2jbcoahui`, public ID `tyttybq`.
  Deliberately canceled during attempt 1 and resumed as attempt 2 on a newer deployment.
  Completed successfully with $0.5106363 total recorded model cost across both attempts.
  The kiosk client downloaded, hash-verified and installed all 29 runtime assets.
  The public web player reached active platformer gameplay with no browser page errors.

## Production check

- Real generation: `j-TDSvgWswLhYR`, game `g-smnorkjpx6`, public ID `mt7s4yv`.
  **Tidebreak Repair Run** completed on attempt 1 with $0.1695121 recorded model cost.
  Using its normal fetch implementation against `https://sparkade.dev`, the actual kiosk
  client received progress, downloaded and hash-verified 12 assets, installed the game,
  and retained its installed/published state when the client was recreated and synced.
- Production uses separate signing and cron secrets from preview, with shared Neon and
  separate environment namespaces in the private generation Blob store.
- Deployment `dpl_AAu4ey9bGYaL5u5qo3ziKFgF4MUW` was promoted to `sparkade.dev` while the
  production test workflow continued on its original deployment. The actual kiosk client
  receives job progress through the public domain using its normal fetch implementation.
- Maintenance returned 401 without its secret and 200 with the production cron secret.
- Follow-up deployment `dpl_GuXHxDLqS8DPUisfMeRs9HZk9mfr` bundles FFmpeg for cloud voice
  conversion. A real synthetic WebM/Opus recording was converted inside Vercel and correctly
  transcribed by Meta, including a repeat against the live `sparkade.dev` domain.
  Site/root typechecking, lint and all 16 transcription tests passed.

## Office kiosk — September 11, 2026

- Connected to `danny@sparkade.local`, Raspberry Pi 3 Model B Plus Rev 1.4 / Node 24.18.0.
  Preserved the existing `Meta SEA` registration and all 16 installed games.
- Built on the Mac, checked the Pi's runtime dependencies, and installed the current source
  and compiled bundles into `/opt/sparkade`. The service uses
  `SPARKADE_GENERATION_MODE=cloud` from `/etc/sparkade/env`. Its live process environment was
  checked, and the deployed server SHA-256 is
  `db42c3d4a02b069ca6df9f1b290c2d9913f9c98cdcd1d6eabd10bfa5d5d7cf8a`.
- Backup: `/home/danny/.sparkade-backups/cloud-20260911-152851`, containing the prior
  installation, SQLite backup, full game library, environment, configuration and registration.
  The first activation encountered the protected environment directory and restored the
  prior service; the corrected activation used sudo to install the environment file.
- A real WebM voice recording submitted to the Pi's `/api/transcribe` returned the expected
  transcript through the cloud backend.
- Submitted two real H-scroll jobs concurrently through the Pi's `/api/games` endpoint:
  `j-bRGQi6oD1F6x` / `g-spk2uguc9g` / `nwwxp3y` (Moonlight Tug Rescue), and
  `j-EC2kK_6PBQM5` / `g-4gu1klxucn` / `yrgy848` (Seedwing Courier).
  Both showed live progress on the cabinet and remained on attempt 1 after a deliberate
  service restart. The shell reloaded and the cloud jobs reconnected without duplication.
  Both completed and installed automatically: Moonlight Tug Rescue at $0.169336294 and
  Seedwing Courier at $0.1693391 recorded model cost. Independently rehashed all 12 assets
  for each installed game on the Pi against its manifest; all matched. The library contains
  18 ready games, all original game directories remain, and the registration's credential,
  token and kiosk ID still match the backup.
  Launched Seedwing Courier from the cabinet's completed progress page and reached active
  gameplay with its downloaded artwork. No browser page errors were reported. Returned
  the cabinet to its normal attract/start screen after verification.
- Played the installed **Eric's Gauntlet Clash** while both jobs generated cloud images.
  A 10-second gameplay sample measured browser animation callbacks at 51.6 FPS,
  33.4 ms p95 frame interval, and 300.9 ms maximum. The Node service used 5.9% of one CPU
  core and 140,536 KiB RSS during a concurrent 10-second sample. This is a short observation,
  not a guarantee of sustained frame rate or a twenty-job load benchmark.
- The Pi reported 69.8–70.4°C and `throttled=0x80008`: the soft temperature limit is active
  and has occurred previously. This is a separate possible performance constraint; these
  checks do not establish the cause of the earlier black screen. Flag definitions:
  [Raspberry Pi documentation](https://www.raspberrypi.com/documentation/computers/os.html).
- The initial deployment used a working-tree snapshot before the migration was committed.
  The previous Pi Git revision is recorded in the backup. The kiosk checkout can be aligned
  with the published commit after verifying that its deployed source matches.

Physical photo capture, a prolonged network outage, and twenty simultaneous real-provider
generations have not been tested. Public website creation UI/credits remain separate future
work; the authenticated generation backend is available now.
