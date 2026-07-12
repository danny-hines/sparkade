# Sparkade

A self-hosted arcade cabinet that **generates its own SNES-era games** from an optional photo of
the player (their likeness becomes the hero) and a voice prompt. Runs on a dev PC and on its
production target: a Raspberry Pi 3B+ inside a 3D-printed mini cabinet with a 1024×600 display,
USB webcam + mic, and arcade controls on a Zero Delay USB encoder.

Three hand-crafted **golden games** ship preinstalled, so the cabinet is playable out of the box
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

To hit a real model, copy `.env.example` to `.env`, set `META_API_KEY`, and use `npm run dev`.

## Pi install (production)

Flash **Raspberry Pi OS Lite (Bookworm, 64-bit)**, boot, then:

```bash
curl -fsSL https://raw.githubusercontent.com/danny-hines/sparkade/main/install/install.sh | bash
```

The installer is idempotent. It **prompts you to pick an AI provider (Meta / Anthropic /
OpenAI-compatible / skip-for-demo) and enter the API key** (the prompt works even through
`curl | bash`), installs X/openbox/chromium/Node 20, temporarily raises swap to 1024 MB for the
build, clones to `/opt/sparkade`, builds, installs the `sparkade` systemd service and CLI, wires
the chosen provider into `config.json`, configures console-autologin → `startx` → openbox →
Chromium kiosk (with a relaunch loop that waits for the server, so a crash or slow boot never
strands the cabinet), and scopes a sudoers rule to the exact `nmcli` invocations the WiFi settings
screen uses. Set `SPARKADE_REPO=owner/repo` to install a fork; `--force` allows other Debian ARM
boxes. Only Meta can transcribe voice, so a non-Meta text provider keeps the `stt` stage on Meta —
the installer offers to take a Meta key too, or you generate from the preset idea cards.

After reboot the cabinet boots straight to the attract screen. Useful commands:

```bash
sparkade status | logs -f | doctor | restart
sparkade config set-key META_API_KEY <key>            # stored in /etc/sparkade/env (0600)
sparkade config set-provider anthropic [model]        # repoint generation (meta|anthropic|compat)
sparkade provider test                                # one tiny paid call per provider
sparkade update                               # fetch latest tag → npm ci → build → restart
sparkade backup [file] / backup restore <file>
```

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
                       │  │ packages/archetypes — platformer /       │  │
                       │  │  shooter / adventure (schema+lint+game)  │  │
                       │  └──────────────────────────────────────────┘  │
                       └───────────────┬────────────────────────────────┘
                              /api (127.0.0.1:8080, same-origin enforced)
                       ┌───────────────┴────────────────────────────────┐
                       │ packages/server — Fastify                      │
                       │  durable pipeline: design → levels|entities|   │
                       │  music (parallel) → validate → repair →        │
                       │  assets → ATOMIC publish                       │
                       │  providers: meta · openai-compat · anthropic · │
                       │  mock  ·  likeness (sharp)  ·  wifi (nmcli)    │
                       │  better-sqlite3 (WAL): games·jobs·scores·      │
                       │  usage ledger  ·  specs live on disk           │
                       └────────────────────────────────────────────────┘
```

**The three-layer game architecture** (the load-bearing decision): the LLM never writes code.

1. **Engine substrate** (hand-written): loop, renderer, input, audio synthesis, physics, pools,
   HUD, pause, scoring, leaderboards — plus game-feel (coyote time, jump buffering, hit-stop,
   screen shake) baked in so every generated game inherits it.
2. **Archetype templates** (hand-written): the platformer/shooter/adventure gameplay systems,
   each with a strict JSON Schema, semantic linter, duration estimator and content floors.
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

**Durability:** jobs persist to SQLite before work starts; all output goes to
`staging/<jobId>/` and is atomically renamed into `games/<gameId>/` only after every gate
passes. Yank the plug mid-generation and the boot reconciliation marks the job failed-retryable —
no half-written game is ever visible as playable, and existing games/scores can't corrupt (WAL).

## Privacy

- The player's photo is processed locally (sharp): oval crop → downscale → palette quantize →
  outline. It is kept only while a job is retryable and deleted the moment a game publishes.
- Photos and audio never appear in logs. By default the photo never leaves the device; the single
  exception is `likeness.describeInStory` (ships **off**), which attaches it to the design call
  with a guard restricting the model to observable features only.
- API keys live in an env file (0600), never in config.json, the API, or the browser.
- The server binds 127.0.0.1 by default and rejects cross-origin mutations.

## Data layout

```
~/.sparkade (Pi)  ·  ./data (dev)
├── config.json        # providers, per-stage models, pricing, presets, volumes, key mappings
├── sparkade.db        # games index, jobs, scores, settings, immutable cost ledger
├── staging/<jobId>/   # in-flight generation (atomically renamed on success)
└── games/<gameId>/    # game.json · meta.json (cost breakdown, versions) · assets/ (likeness)
```

## Pointing at a different model / provider

Per-stage config in `config.json` (`sparkade config edit`, or `sparkade config set
stages.music.model <id>`): stages are `design · levels · entities · music · repair · stt`, each
with `{provider, model}`. Providers: `meta` (Meta Model API, default `muse-spark-1.1`),
`compat` (any OpenAI-compatible server — set `baseUrl`), `anthropic`, `mock`. Capability flags
(`structuredOutput`, `audioIn`, `imageIn`) control what the pipeline sends. Add pricing rows under
`pricing` or the UI shows "cost unavailable" (never $0.00). **Every wire-format detail of the Meta
Model API lives in `packages/server/src/providers/meta.ts`** with a configurable `baseUrl` — if
Meta changes shapes, fix that one file.

## Adding a fourth archetype

1. `packages/shared/src/schemas/<id>.schema.json` — full game schema (copy the shared `$defs`
   block verbatim; a unit test enforces parity) + types in `shared/src/types.ts`.
2. `packages/archetypes/src/<id>/{lint.ts, game.ts, index.ts}` implementing the `Archetype`
   interface (schema, lint, estimateDurationS, create, controlHelp, contentFloors); register it in
   `archetypes/src/index.ts`.
3. `packages/generation/prompts/levels-<id>.md` + a golden game `golden/golden-<id>.json` that
   passes `npx tsx scripts/check-golden.mts <id>` with zero repairs.
4. Add the archetype to the design prompt's menu (`prompts/design.md`).

Deferred archetypes (documented, not built): see [docs/EXTENDING.md](docs/EXTENDING.md) — includes
the canonical **fighter** (Y high punch, X high kick, B low punch, A low kick, L/R block) and
**racing** (B accelerate, Y brake, A item/boost, L/R hop/drift) control maps.

## On-device smoke checklist (hardware-only — cannot be tested in CI)

- [ ] Fresh flash → one curl command → reboot → **attract screen appears** with no keyboard/mouse
      ever attached, even if Chromium starts before the server is ready.
- [ ] First boot with an unmapped encoder walks through **raw-input mapping** before any menu
      needs mapped buttons ("DragonRise Inc. Generic USB Joystick" and keyboard-mode clones both).
- [ ] **Camera + mic capture**: photo step shows a mirrored preview with oval guide and countdown;
      voice step meters and transcribes.
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
rollback, CI-built artifacts, and a read-only root. Also out of scope: fighting/racing archetypes,
multiplayer, image-generation sprites, accounts, localization, touch, analytics.

## License notes

Code: MIT. The vendored [Press Start 2P](packages/web/public/fonts/press-start-2p/) font is
SIL OFL 1.1 (license file alongside). Sprite art, golden games and prompts are original.
