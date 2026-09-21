# Repository instructions

## Release impact

For production behavior changes, read [the release guide](docs/releases.md) before
finishing the task. Assess **website/cloud**, **Pi kiosks**, and **standalone Portal
kiosks** separately. Trace the changed code and assets into their consumers; the
directory being edited is only a starting point.

- Shared gameplay, shell/input, built-in games/art, and packaged defaults can require
  a Portal APK release even when no file under `apps/portal` changed.
- A push to `main` or successful website deployment does not update installed kiosk
  binaries. A published Portal APK is not offered by the updater until its channel
  is promoted. Availability is not evidence that a device installed it.
- Preserve compatibility with installed clients when changing cloud APIs, game
  bundles, or storage. Include the Portal native adapter when tracing kiosk API use.
- Complete release work included in the user's request and existing authorization.
  If an affected target is deferred or outside scope, identify the pending release
  or installation step explicitly; do not describe the change as live everywhere.
- In the final response or PR, briefly state the affected targets and actual rollout
  status, with the source revision/release/channel when relevant. Distinguish code
  committed, website deployed, kiosk update available, and device update verified.

Documentation and test-only changes do not require kiosk releases. Follow the
guide's immutable APK/signing rules and keep Portal tags out of Pi update selection.
