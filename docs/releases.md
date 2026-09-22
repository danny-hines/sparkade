# Releasing changes to Sparkade clients

Sparkade has three delivery paths. Shared source does not mean shared deployment:
a change can be live on the website while an installed kiosk still runs older code.
Assess each target before calling a production change complete.

## Where code runs

| Target                       | What it runs                                                                                               | How it receives changes                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website and cloud generation | `apps/site` plus imported shared packages and traced runtime files                                         | Build/deploy the site; verify the intended commit reached production.                                                                             |
| Pi kiosk                     | Local Node server, built web shell/engine, repository starter games and assets                             | The operator runs **Settings → System info → Check for updates** or `sparkade update`; this fetches source, builds, and restarts the service.     |
| Standalone Portal            | Signed Android APK containing the native host, web shell/engine, starter games/art, and bootstrap defaults | Build/publish a new versioned APK and promote its update channel, then install on the device. A website deployment does not replace APK contents. |

The Portal bench app connected to a Mac development server is a separate workflow.
Seeing a change there does not establish that the standalone production APK has it.

## Decide which targets need a release

These are starting points. Check imports, build inputs, runtime file reads, and API
consumers before deciding; dependencies and generated assets can cross package boundaries.

| Changed behavior or files                                                                                  | Website/cloud                                                                                             | Pi                                                                                                | Standalone Portal                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gameplay/rendering/input in `packages/engine`, `packages/archetypes`, or runtime code in `packages/shared` | Deploy if consumed by the web player or cloud validation.                                                 | Update local build.                                                                               | New APK when included in its runtime.                                                                                                                                           |
| Kiosk screens, styles, controls, or assets in `packages/web`                                               | Deploy for site consumers, such as exported photo/creation helpers or shared fonts.                       | Update local build.                                                                               | New APK.                                                                                                                                                                        |
| Built-in specs/art in `packages/generation/golden`                                                         | Check traced files and consumers; redeploy if used. Existing published games are separate stored content. | Update/restart so starter games are re-seeded.                                                    | New APK containing the changed spec **and** its art.                                                                                                                            |
| Generation prompts, providers, or pipeline code in `packages/generation` / `packages/server`               | Deploy when imported by cloud generation.                                                                 | Update kiosks using the changed local code.                                                       | No APK solely for compatible cloud-side generation changes; release one if the client contract, validation, packaged defaults, or playback runtime also changes.                |
| `apps/site` UI, admin, or compatible server API behavior                                                   | Deploy the site.                                                                                          | No local update unless client behavior must change.                                               | No APK unless client behavior must change.                                                                                                                                      |
| Native Android code/resources, `scripts/portal-assets.mts`, or Android dependencies                        | Usually none; trace any shared changes.                                                                   | Usually none.                                                                                     | New APK.                                                                                                                                                                        |
| Pi service, CLI, launcher, or OS provisioning                                                              | Usually none.                                                                                             | Update/re-provision as needed; check whether the updater actually applies the changed OS setting. | None unless shared behavior is involved.                                                                                                                                        |
| Portal Mac installer or release tooling                                                                    | None.                                                                                                     | None.                                                                                             | Follow the versioned installer/release process; determine whether existing devices need configuration or an APK update. Do not replace assets on an existing versioned release. |
| Documentation, tests, or isolated development tooling                                                      | No runtime release unless build/runtime behavior also changes.                                            | Same.                                                                                             | Same; do not bump the APK just for documentation.                                                                                                                               |

For example, replacing Ember Cup with Spark Token Rally changed a shared golden spec
and artwork. The Pi could receive it through its source updater. Portal needed a
new APK even though the racing change did not edit Android code. That gap was closed
by `portal-v0.4.5`; adding a tag to the old APK would not have updated the game inside it.

## Check what is actually available

Use live repository/release/device state, not a version remembered from a prior task.

- Compare the intended source revision with the website deployment's commit, the
  Pi's installed commit and selected update target, and the Portal release's
  `release.json` → `sourceCommit` plus `versionCode`.
- For Portal, inspect the selected channel's `release.json` as well as the immutable
  versioned release. GitHub's generic “latest release” is not the Portal update source.
- Check the installed device version independently. A successful build, upload,
  channel promotion, or download is not proof of installation or gameplay acceptance.
- Batch compatible source changes into a release when appropriate; not every commit
  needs its own APK. Ensure the chosen release includes all intended changes.

## Deliver and verify each affected target

### Website and cloud

Run checks for the affected consumers, deploy through the project's configured
workflow, and verify the production deployment's commit and changed behavior.
Cloud APIs must keep working with older installed kiosks during rollout. If a change
requires new client capabilities, plan the compatible server/client order before
enabling it. New generation behavior does not automatically regenerate saved games
or replace their published assets.

### Pi

The [update checker](../packages/server/src/system/update.ts) and
[CLI](../packages/cli/src/index.ts) use `git describe --tags --abbrev=0
--exclude=portal-* origin/main`, falling back to `origin/main` when no eligible tag
exists. Check this selection before claiming a push is available: an eligible older
tag can keep a kiosk on older source. Portal version/channel tags must remain excluded
from **both** paths. Account for other platforms' tag namespaces if adding one.

Updating requires an operator/device action; a source push alone does not rebuild a
running Pi. Verify the installed commit, service restart, and the changed game or UI.
The updater refreshes the kiosk launcher, but a new launcher may need a reboot; OS
dependencies such as Node upgrades may require rerunning the installer. Preserve
device data and registration.

### Portal

Follow [the maintainer release procedure](../apps/portal/README.md#prepare-an-office-release-maintainers)
and [channel promotion procedure](../apps/portal/README.md#wi-fi-updates-and-fleet-version-reports).
The essential steps are:

1. Select a clean, committed source revision containing the intended shared changes.
   Increase Android `versionCode` and `versionName`, update the Mac installer's release
   pin and office guide, and commit those edits. Build with the existing fleet
   signing key using `npm run portal:release`.
2. Verify `release.json` has the intended source commit, `sourceDirty: false`, new
   version, APK checksum, and expected signing certificate. For a starter-game change,
   inspect the packaged `portal-games` spec and every required artwork file, then
   exercise the packaged shell/game. Preserve registration and stored user games.
3. Publish all five prepared release assets together under a new `portal-vX.Y.Z` tag.
   Versioned APKs, tags, and assets stay immutable; corrections use a new version.
   Never generate a replacement signing key to update existing kiosks.
4. Promote the intended channel with `npm run portal:promote -- --release
portal-vX.Y.Z --channel pilot --publish`. Publication and promotion are distinct.
   Pilot availability does not imply stable availability; promote the same validated
   binary to stable when the rollout calls for it and hardware acceptance is complete.
5. On a target device, use **Android Back → Sparkade updates** from Press Start,
   the library, or Settings. Check the correct channel, install, and confirm Android's
   prompt. Verify the installed version, retained registration/controller settings,
   and changed behavior. The [Mac installer](portal-setup.md) is also an update/recovery path.

Keep signing credentials and device secrets outside Git. Rollback requires packaging
the previous good code with a **higher** version code; Android rejects a downgrade.

## Record the handoff

For a production change, include a short release-impact note in the final response or
PR. For each affected target, give its status and any remaining step. For example:

| Target        | Status                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------- |
| Website/cloud | Deployed commit `<sha>`; changed behavior verified.                                       |
| Pi            | Update required; selected source target contains `<sha>`; device installation pending.    |
| Portal        | `portal-vX.Y.Z` published and promoted to pilot; download verified; installation pending. |

Say “not required” for unaffected targets when that distinction matters. Continue any
release work already in the user's requested scope; if a rollout is deferred, state
exactly what remains instead of describing all clients as updated. A new kiosk type
must document its build inputs, update mechanism, and verification here.
