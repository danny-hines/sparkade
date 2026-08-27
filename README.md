# Sparkade

A self-hosted arcade cabinet that **generates its own SNES-era games** from an optional photo of
the player (their likeness becomes the hero) and a voice prompt. Runs on a dev PC and on its
production target: a Raspberry Pi 3B+ inside a 3D-printed mini cabinet with a 1024×600 display,
USB webcam + mic, and arcade controls on a Zero Delay USB encoder.

Five hand-crafted **golden games** ship preinstalled, so the cabinet is playable out of the box
with no API key. Everything except the AI API calls works fully offline.

---

## Dev quickstart

```bash
npm install
npm run demo      # ← start here: full end-to-end flow with the MOCK provider
                  #    (no API key, no network; serves http://127.0.0.1:8080)
```

Other commands:

```bash
npm run dev       # Vite dev server (http://127.0.0.1:5173, HMR) + tsx-watch API server
npm run verify    # typecheck + eslint + unit tests + full build — must pass cleanly
npm run test:e2e  # Playwright at 1024×600 against demo mode (dev/CI only, never on the Pi)
npm run build     # web shell → packages/web/dist · server/cli → single Node bundles
npm run analyze:repairs # aggregate repair + incident patterns from the local data directory
npm run incidents -- list # review the local generation incident catalog
```

Keyboard controls (default map): **arrows** = d-pad, **X**=A, **Z**=B, **A**=X, **S**=Y,
**Q**=L, **W**=R, **Enter**=START, **Right-Shift**=SELECT. In dev mode the photo step offers a
file-upload fallback and the voice step offers canned transcripts.

**Asset review (dev only):** `http://localhost:5173/?dev=assets` (during `npm run dev`;
`http://127.0.0.1:8080/dev/assets` redirects there) is a tabbed gallery of the entire built-in
sprite library — heroes/ships, enemies, 12 bosses (four per archetype), NPCs, projectiles/pickups,
and 11 themed tile families — plus the bitmap font, all 11 procedural backdrops with live parallax,
the ~two-dozen curated palette moods (each with an in-use scene), and the ambient weather overlays
(each animated over a sample backdrop). Switch between the preview palette and any installed game's
palette, zoom, toggle animation, see 3×3 seamless-tiling previews for every tile family, overlay
hero head-slots, and reroll backdrop/weather seeds. Rendered by the real engine code, so what you
review is what ships (`scripts/check-art.mts` and `scripts/check-palettes.mts` validate the data;
this page is for taste).

To hit the real models, copy `.env.example` to `.env`, set `META_API_KEY`, and use `npm run dev`.
The same key is used for Muse Spark 1.2 Contributor and Muse Image 1.0.

## Pi install (production)

Flash **Raspberry Pi OS Lite (Bookworm, 64-bit)**, boot, then:

```bash
curl -fsSL https://raw.githubusercontent.com/danny-hines/sparkade/main/install/install.sh | bash
```

The installer is idempotent. It **prompts you to pick a text AI provider (Meta / Anthropic /
OpenAI-compatible / skip-for-demo) and enter its API key plus the Meta key required by Muse Image**
(the prompt works even through
`curl | bash`), installs X/openbox/chromium/Node 24, temporarily raises swap to 1024 MB for the
build, clones to `/opt/sparkade`, builds, installs the `sparkade` systemd service and CLI, wires
the chosen provider into `config.json`, configures console-autologin → `startx` → openbox →
Chromium kiosk (with a relaunch loop that waits for the server, so a crash or slow boot never
strands the cabinet), and scopes a sudoers rule to the exact `nmcli` invocations the WiFi settings
screen uses. Set `SPARKADE_REPO=owner/repo` to install a fork; `--force` allows other Debian ARM
boxes. Muse Image always runs through Meta, and only Meta can transcribe voice, so a non-Meta text
provider still needs `META_API_KEY` for generated art (and voice). Without it, the five preinstalled
games and mock demo remain playable, but new real-model games cannot publish.

After reboot the cabinet boots straight to the attract screen. Useful commands:

```bash
sparkade status | logs -f | doctor | restart
sparkade debug                                      # secure SSH tunnel instructions for Chromium DevTools
sparkade lan on | off | status                      # temporarily expose the web kiosk to the local network
sparkade config set-key META_API_KEY <key>            # stored in /etc/sparkade/env (0600)
sparkade config set-provider anthropic [model]        # repoint generation (meta|anthropic|compat)
sparkade provider test                                # one tiny paid call per provider
sparkade update                               # pull latest → install (only if deps changed) → build → restart
sparkade backup [file] / backup restore <file>
```

No SSH needed to update: **Settings → System info → Check for updates** runs the same `sparkade update` flow from the cabinet (detached so it survives the service restart), then the kiosk hard-reloads itself.

## Architecture

```
                       ┌────────────────────────────────────────────────┐
                       │  Chromium kiosk (1024×600, no mouse/keyboard)  │
                       │  ┌──────────────────────────────────────────┐  │
   d-pad + A/B ──────▶ │  │ packages/web  — Preact shell             │  │
   (gamepad or         │  │  attract · library · wizard · settings   │  │
    keyboard encoder)  │  │  remap wizard · on-screen keyboard       │  │
                       │  ├──────────────────────────────────────────┤  │
                       │  │ packages/engine — Canvas2D+WebAudio      │  │
                       │  │  substrate: loop·renderer·input·chiptune │  │
                       │  │  synth·SFX·sprite lib·HUD·pause·initials │  │
                       │  ├──────────────────────────────────────────┤  │
                       │  │ packages/archetypes — platformer ·       │  │
                       │  │  shooter · adventure · hshooter · fighter│  │
                       │  │  (schema + lint + hand-written gameplay) │  │
                       │  └──────────────────────────────────────────┘  │
                       └───────────────┬────────────────────────────────┘
                              /api (127.0.0.1:8080, same-origin enforced)
                       ┌───────────────┴────────────────────────────────┐
                       │ packages/server — Fastify                      │
                       │  durable pipeline: design → levels|entities|   │
                       │  music (parallel) → validate → repair →        │
                       │  assets → ATOMIC publish                       │
                       │  text: meta · openai-compat · anthropic · mock │
                       │  images: Muse Image · postprocess: sharp       │
                       │  wifi: nmcli                                   │
                       │  node:sqlite (WAL): games·jobs·scores·         │
                       │  usage ledger  ·  specs live on disk           │
                       └────────────────────────────────────────────────┘
```

**The three-layer game architecture** (the load-bearing decision): the LLM never writes code.

1. **Engine substrate** (hand-written): loop, renderer, input, audio synthesis, physics, pools,
   HUD, pause, scoring, leaderboards — plus game-feel (coyote time, jump buffering, hit-stop,
   screen shake) baked in so every generated game inherits it.
2. **Archetype templates** (hand-written): the platformer, vertical shooter, adventure,
   horizontal shooter and fighter gameplay systems, each with a strict JSON Schema, semantic
   linter, duration estimator and content floors.
3. **Generated game spec** (model-authored, pure data): story, palette, sprites, levels,
   boss, backdrop, weather, music score, SFX params, scoring — validated, auto-repaired (RFC 6902
   patches at temperature 0), and bounded. The model composes each game's look from a broad built-in
   library (multiple hero/ship bodies, enemies, per-archetype bosses, 11 themed tile families),
   picks a parallax backdrop scene and an optional ambient weather overlay (rain, snow, embers,
   fog, fireflies, …), or draws its own pure-data sprites. The 16-color palette
   recolors everything, so it is checked for legibility (dark outline, hero popping off the
   background, readable text, distinct hazard, …); a palette that fails snaps to the nearest of
   ~two dozen curated "moods" the model also gets as a cookbook. String fields are scanned;
   markup/URLs/code/paths are rejected.

A "game" is `engine + archetype(spec)`. Specs are validated by the same JSON Schemas that are
embedded verbatim in the prompt templates (`packages/shared/src/schemas/`).

**Generated art:** after the spec passes validation, Muse Image 1.0 authors landscape key art and
four consistent story scenes (intro, boss, victory, defeat). Photo games additionally require
neutral and story-aware defeat-expression portraits plus generated 12/16px player-head sprites;
there is no quantized-photo fallback or UI toggle. Fighter photo games also attempt one complete
11-pose player set. The runtime activates that
set only if every pose passes green-screen, crop, size, and transparency checks—otherwise it keeps
the procedural fighter for the whole match. Successful binaries carry model/prompt/hash provenance
in `assets/manifest.json` and are reused across job retries.

**Durability:** jobs persist to SQLite before work starts; all output goes to
`staging/<jobId>/` and is atomically renamed into `games/<gameId>/` only after every gate
passes. Yank the plug mid-generation and the boot reconciliation marks the job failed-retryable —
no half-written game is ever visible as playable, and existing games/scores can't corrupt (WAL).

## Privacy

- The player's photo is kept only while a job is retryable and deleted the moment a game publishes.
  Photos and audio never appear in logs.
- An accepted photo is sent to Meta's Model API (Muse Image) to create the hero. Sparkade also
  sends it to the configured design-stage provider only when `likeness.describeInStory` is enabled
  (it ships **off**) so the story can reference visible traits; there is no production face-taxonomy
  analysis step. Recorded ideas go to the configured transcription provider. The story setting does
  not disable Muse Image personalization.
- The default text model uses the Muse Spark 1.2 Contributor tier. Inputs and responses sent through
  this tier may be used by Meta for model training; choose another configured model/provider if that
  is unsuitable for your use case.
- API keys live in an env file (0600), never in config.json, the API, or the browser.
- The server binds 127.0.0.1 by default and rejects cross-origin mutations.

## Data layout

```
~/.sparkade (Pi)  ·  ./data (dev)
├── config.json        # text/image models, pricing, presets, volumes, key mappings
├── sparkade.db        # games index, jobs, scores, settings, immutable cost ledger
├── checkpoints/       # versioned raw model stages; retained across retries and successful publish
├── incidents/         # structured failures/recoveries + editable lifecycle notes (gitignored)
├── staging/<jobId>/   # in-flight generation (atomically renamed on success)
└── games/<gameId>/    # game.json · meta.json · assets/ (manifest, key/story art, player sprites)
```

### Generation incident workflow

Every terminal pipeline failure is recorded under `incidents/<timestamp>--<jobId>--attempt-N/`.
Sparkade also records a `recovered` incident when a game publishes only after a substantive model
repair, level regeneration, compile retry, collision redraft, content fallback, or fighter-art
fallback. Routine deterministic normalization remains in aggregate repair telemetry without
creating a noisy incident for every harmless cleanup.

Each incident has an `incident.json` machine-readable snapshot and a `notes.md` file with lifecycle
frontmatter. Prompts, photos, audio, and credentials are never copied into incidents; the record
links to the durable SQLite repair rows and raw checkpoints instead. A successful retry updates the
prior incident's retry outcome but does not automatically resolve it.

```bash
npm run incidents -- list
npm run incidents -- list --status open
npm run incidents -- set <id> candidate-fixed --fixed-by <commit> --note "Added a fallback"
npm run incidents -- set <id> resolved --verified-by <job-or-test>
npm run incidents -- set <id> obsolete --superseded-by <incident-or-change>
npm run incidents -- backfill # import currently recoverable historical evidence
npm run analyze:repairs       # include status/fingerprint/retry aggregates
```

Lifecycle states are `open`, `candidate-fixed`, `resolved`, `obsolete`, and `accepted`. Keep an
incident `candidate-fixed` until a regression test or fresh generation is recorded in
`verifiedBy`; a one-off successful retry is evidence of nondeterminism, not proof of a fix.

## Pointing at a different model / provider

Per-stage config in `config.json` (`sparkade config edit`, or `sparkade config set
stages.music.model <id>`): stages are `design · levels · entities · music · repair · stt`, each
with `{provider, model}`. Providers: `meta` (Meta Model API, default `muse-spark-1.2-contributor`),
`compat` (any OpenAI-compatible server — set `baseUrl`), `anthropic`, `mock`. Capability flags
(`structuredOutput`, `audioIn`, `imageIn`) control what the pipeline sends. Add pricing rows under
`pricing` or the UI shows "cost unavailable" (never $0.00). Muse Image is configured separately at
`imageGeneration` and defaults to `muse-image-1.0` at $0.01 per returned image. Meta wire formats
live in `packages/server/src/providers/meta.ts` (text/audio) and
`packages/server/src/providers/meta-image.ts` (generation/edits), both with configurable base URLs.

## Adding another archetype

1. `packages/shared/src/schemas/<id>.schema.json` — full game schema (copy the shared `$defs`
   block verbatim; a unit test enforces parity) + types in `shared/src/types.ts`.
2. `packages/archetypes/src/<id>/{lint.ts, game.ts, index.ts}` implementing the `Archetype`
   interface (schema, lint, estimateDurationS, create, controlHelp, contentFloors); register it in
   `archetypes/src/index.ts`.
3. `packages/generation/prompts/levels-<id>.md` + a golden game `golden/golden-<id>.json` that
   passes `npx tsx scripts/check-golden.mts <id>` with zero repairs.
4. Add the archetype to the design prompt's menu (`prompts/design.md`).

Deferred archetypes (documented, not built): see [docs/EXTENDING.md](docs/EXTENDING.md), including
the canonical **racing** control map (B accelerate, Y brake, A item/boost, L/R hop/drift).

## On-device smoke checklist (hardware-only — cannot be tested in CI)

- [ ] Fresh flash → one curl command → reboot → **attract screen appears** with no keyboard/mouse
      ever attached, even if Chromium starts before the server is ready.
- [ ] First boot with an unmapped encoder walks through **raw-input mapping** before any menu
      needs mapped buttons ("DragonRise Inc. Generic USB Joystick" and keyboard-mode clones both).
- [ ] **Camera + mic capture**: photo step shows a mirrored preview with oval guide and countdown;
      voice step meters and transcribes. If the wrong input is used, pick the USB camera/mic in
      **Settings → Camera & Mic** (live preview + mic level meter); the choice persists in config.
- [ ] A **real remote generation** completes in under 5 minutes with honest stage progress and a
      cost ticker; the final cost matches the meta.json breakdown.
- [ ] A ready game **launches offline** (WiFi off) with music, SFX, story cards, boss, checkpoints.
- [ ] **15-minute frame-rate soak** on each golden game holds ~60 fps (SELECT+START debug overlay);
      particle budget degrades before stutter.
- [ ] **Leaderboard persists across reboot** (enter initials, pull the plug, verify).
- [ ] **WiFi switch and recovery** via Settings → WiFi (on-screen keyboard, wrong-password vs
      timeout errors distinguished) — mutates NetworkManager, so hardware-only.
- [ ] **Power-loss safety**: yank power mid-generation; on reboot the job shows failed-retryable,
      library intact.
- [ ] `sparkade update` completes and the kiosk **hard-reloads itself** via the version poll.
- [ ] Audio autoplays at the attract screen without any input (kiosk flag).

## Hardening later (deliberately out of MVP scope)

Manual `sparkade update` on the login user is fine for a hobbyist cabinet. A hardened install
would add: a dedicated service user, checksummed release archives with atomic-symlink updates and
rollback, CI-built artifacts, and a read-only root. Also out of scope: racing, multiplayer,
accounts, localization, touch, analytics.

## License notes

Code: MIT. The vendored [Press Start 2P](packages/web/public/fonts/press-start-2p/) font is
SIL OFL 1.1 (license file alongside). Sprite art, golden games and prompts are original.
