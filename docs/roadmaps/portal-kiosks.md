# Portal kiosks: installation, registration, and media input

Status: standalone production-connected pilot, 2026-09-20. The Android kiosk now
packages the shared UI/engine and six starter games, owns its settings and encrypted
identity, and calls the existing production pairing/generation APIs directly.
The separate bench wrapper still supports a Mac server. Fleet updating, broader
hardware qualification, and the additional camera/microphone game controls remain
future work.

The [guided Mac office installer](../portal-setup.md) now downloads ADB and the
fleet-signed release, handles one explicitly selected Portal at a time, preserves
recovery information, and waits for registration. Its native setup screen shows
the production code without requiring a controller. The maintainer release
packager verifies signing identity; operators never build or sign an APK.

See [the Portal experiment guide](../../apps/portal/README.md) for working commands
and device findings. Keep gamepad input as the initial control scheme; camera and
microphone controls are additional capabilities.

## Target operator experience

1. Connect a Portal over USB, authorize ADB, and run a provisioning command with
   an explicit device serial. Inspect its model, Android/WebView versions, screen,
   free space, existing Home app, and competing startup apps. Save a recovery record.
2. Install a versioned release APK signed with Sparkade's stable release key.
   Configure Wi-Fi through Android/Portal settings and pair a controller. USB is
   needed for initial installation and recovery, not normal operation.
3. Sparkade's first-run setup checks controller mapping, display orientation,
   camera preview/photo capture, and microphone recording. Request permissions
   here and offer clear retry/skip paths before the public game flow.
4. Create a unique credential on that Portal and show a short registration code
   (and an operator URL/QR). An authorized operator claims it in Sparkade's
   existing kiosk administration UI, names the device, and selects feed visibility.
5. Persist the registration, download the initial game library, and select Sparkade
   as the default Home app. Reboot and disconnect the provisioning computer.
6. Verify offline launch and play, then reconnect Wi-Fi and verify generation and
   publishing under this kiosk's identity. Record the installed version and test
   results before placing the device in service.

`portal:provision` builds/tests/lints a signed standalone APK, installs it, grants
media permissions, and sets it as default Home. The separate `portal:boot` command
still covers the bench prototype. Default Home has been
verified after an ADB reboot with the bench app and after a fresh process launch
with the standalone release on Portal+; power removal/restoration, sleep/wake,
and the 10-inch second-generation model still need separate qualification.

## Reuse the existing registration protocol

Sparkade already has the necessary server-side enrollment primitives:

- [KioskRegistration](../../packages/server/src/cloud/kiosk-registration.ts)
  generates a random per-install credential, submits its identifier and SHA-256
  token hash to `POST /api/kiosk/pairings`, and polls
  `GET /api/kiosk/registration` with the credential. Pairings can expire and
  registered credentials can be revoked.
- [Kiosk administration and persistence](../../apps/site/lib/kiosks.ts) manage
  claims, names, ownership, visibility, credential hashes, and last-seen data.
- [Generation sessions](../../apps/site/app/api/generation/session/route.ts)
  exchange kiosk authentication for a five-minute generation session. Model
  provider credentials remain on the server.

The Android adapter implements this client protocol against `https://sparkade.dev`.
It keeps the long-lived kiosk credential in app-private storage encrypted with a
key protected by Android Keystore and retains it across signed APK updates. Uninstalling
or clearing app data requires enrollment again. Do not bake credentials into an
APK, reuse the Pi identity, or copy the Mac's `cloud-registration.json` to devices.

In bench mode the Node data directory owns the credential, library, settings, and
controller mappings. Standalone `dev.sparkade.kiosk` owns those on the device;
multiple Portals no longer need shared server state. The first Portal+ was paired
in production as **Meta SEA Portal+ 1** with listed-by-default visibility chosen
in admin. Neither the Pi credential nor the Mac credential was copied.

## Runtime split

| Layer                       | Responsibility                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Shared web shell and engine | Library, creation UI, Canvas2D games, WebAudio, gamepad mapping, adaptive display, optional touch controls                               |
| Android host                | Boot/Home behavior, lifecycle, permissions, Wi-Fi/settings entry points, protected device identity, local files/database, signed updates |
| Platform adapter            | Typed library/settings/score operations and cloud requests currently implemented through the Pi's Node API                               |
| Sparkade cloud              | Enrollment, short-lived generation sessions, model calls, generated assets, publishing, revocation                                       |

The release APK bundles the shell and starter games. Native app-private files hold
atomic JSON settings/library/score metadata and downloaded bundles. Assets load
from the secure local WebView origin `https://appassets.androidplatform.net/`;
camera/mic capture works there without a remote page or development USB tunnel.
Downloads enforce per-file limits and SHA-256 hashes before committing a bundle.

The native WebMessage interface checks the exact packaged origin and main frame.
Authentication stays native, cloud operations are allowlisted, and authenticated
redirects/alternate hosts are rejected. Android Wi-Fi settings remain available
through the operator panel; Linux network/update operations are not exposed.

Saved games and the shell load locally on network loss. Accepted cloud jobs survive
app restarts and resume downloads rather than regenerating. Unsaved creation drafts
still live in the current web session; persisting those across restarts is future work.

## Controller compatibility

The Portal+ advertises USB host support and enumerates the Kiwitata SNES pad
(`0079:0011`), but its firmware exposes neither a `usbhid` driver nor an Android
input device for that pad. A direct USB fallback is now implemented in the host,
scoped to the tested ID and exact report descriptor. Physical button/D-pad reports
were captured, all twelve logical controls were mapped and saved, and the
controller navigated the shared library UI.

This establishes a workable path for this controller; it does not qualify every
USB HID device. Add controller profiles only after verifying their descriptors
and reports. Provisioning should distinguish USB enumeration, normal Android input,
and a supported native fallback, then guide the operator through mapping. Verify
detach/reconnect, permission prompts, background release, and sustained gameplay
on each supported combination. Bluetooth remains a separate hardware test.

## Camera and microphone

The Portal+ WebView supports ordinary browser media APIs through Android runtime
permissions. The prototype restricts grants to the configured Sparkade origin and
only the requested camera/microphone resources. Audio capture also requires
`MODIFY_AUDIO_SETTINGS` in the Android manifest: without it, this device returned
`NotReadableError` and Chromium logged that it could not select an audio device.

### Creation inputs

Reuse the existing photo and voice screens first. Live camera preview, countdown,
and photo preview work on Portal+. The observed stream was 640×480 at 30 fps;
even a 1280×720 request returned 640×480 in this WebView. Inspect actual track
settings rather than assuming the advertised sensor resolution is available.
Microphone capture reports 48 kHz, mono, with echo cancellation, noise suppression,
and automatic gain control enabled by default.

The existing recording screen completed capture and received a local mock
transcription response. A separate short WebAudio probe observed nonzero input
and stopped its tracks afterward. The bench server now supports `--live-voice`
to use the configured STT provider while leaving game generation mock. A synthetic
spoken WebM passed through `/api/transcribe` and Muse Voice returned the expected
sentence. The standalone Portal then sent the same synthetic recording through its
native upload bridge and authenticated production `/v1/transcribe` endpoint; Muse
Voice returned the expected sentence. Its authenticated estimate endpoint also
returned the live models/prices. Both camera and mic capture were checked on the
packaged secure origin. Real player dictation and a new complete production game
still need an operator acceptance run.

### Transcription choice and local alternatives

Use the existing Muse Voice model API for Portal transcription, matching the Pi
kiosk. Both current configurations select `meta` / `muse-voice-transcribe-1.0`.
Production Portal work should reuse the authenticated kiosk/backend path and keep
the provider key on the server. Local transcription is an optional future
experiment, not a prerequisite for deploying independent Portal kiosks.

On the tested Portal+ firmware, Android service discovery finds no
`android.speech.RecognitionService`, `RECOGNIZE_SPEECH` resolves to no activity,
both secure voice-service settings are null, and `dumpsys voiceinteraction`
reports no active implementation. The installed `com.facebook.portal.aiservice`
advertises camera services, with no discovered speech interface. These checks
establish that the standard Android recognition path is unavailable here; they
do not establish whether Meta has private recognition code elsewhere in the
firmware. Recheck each hardware/firmware combination during provisioning.

Android's explicit on-device recognizer API requires API 31; this Portal+ runs
API 28. The older recognizer API still needs an installed recognition service.
See the [Android SpeechRecognizer reference](https://developer.android.com/reference/android/speech/SpeechRecognizer).

If offline transcription becomes a requirement, evaluate bundling a recognizer
behind a native adapter. [Vosk](https://alphacephei.com/vosk/) supports offline Android recognition
and small language models, making it a candidate for a hardware benchmark, not
a selected production dependency. Measure open-ended game descriptions separately
from a restricted game-command vocabulary: accuracy, end-of-speech latency,
memory, CPU contention with games, and noisy-room performance all matter. Keep
the transcription source explicit; local failure should offer retry/typing, with
cloud fallback controlled by kiosk configuration. No offline engine is bundled
in the prototype yet.

The initial camera permission prompt outlasted the web helper's eight-second
timeout. Complete permission setup during provisioning and preserve bounded,
actionable retries. Keep keyboard entry and photo/voice skip paths available.
Native capture is a fallback if the WebView's resolution, orientation, or codecs
prove insufficient; it is not required for the initial capture path.

### Live game controls

Build these as optional input adapters that produce bounded actions or axes for
the shared input layer. Games should declare the capabilities they need and
retain a controller alternative.

| Experiment                        | First implementation                                                            | Qualification                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Move left/right with body motion  | Sample reduced camera frames locally and detect motion in calibrated regions    | Lighting, multiple bystanders, mirror/orientation behavior, false triggers, frame budget |
| Clap/jump or sound-powered action | WebAudio analyser with a calibrated noise floor, threshold, and cooldown        | Arcade noise, speaker feedback, distance, AGC effects, false triggers                    |
| Pose or hand gestures             | Benchmark a small local vision model and convert recognized gestures to actions | Sustained frame pacing, thermal behavior, latency, reliability across players            |
| Spoken commands                   | Explicit push-to-talk with a small command vocabulary                           | Recognition latency, noisy rooms, network loss, cancellation, accidental activation      |

Start with motion regions and audio level; they can run locally without uploading
camera frames or continuous audio. For sound measurement, test whether disabling
AGC/noise suppression is supported and improves consistent thresholds. Do not
assume access to individual microphones, beamforming, Portal smart tracking, or
privileged camera APIs merely because normal capture works.

Media sessions must have visible start/stop state and stop on cancel, leaving the
screen, app backgrounding, or permission revocation. Test this explicitly: the
prototype pauses WebView timers on backgrounding, which alone does not establish
that an active media track stops. Keep capture off in attract mode. Review photos
and recognized words before generation, limit recording duration, and keep raw
media out of fleet diagnostics.

## Release and fleet operations

- Produce signed release APKs with stable application ID/versioning and WebView
  debugging disabled: implemented by `portal:provision`. The first signed update
  retained registration and controller mappings on Portal+. Preserve a known-good
  version and qualify rollback and retention of downloaded games separately.
- Operator-assisted Wi-Fi updates are implemented. The tested Portal+'s required
  Meta verifier blocks installation when enabled. With its OS-wide disable setting
  authorized, the dedicated pilot successfully self-updated from v0.4.2 to v0.4.3
  and returned to Press Start. Provisioning offers an explicit option and
  backs up/restores the original value. Stable is not promoted. The implementation includes stable/pilot
  channel promotion, private staging, signature/hash/version checks, and native
  Android confirmation. Basic version/model/channel/status reporting is implemented
  on the device and in the site code; the site change must be deployed for the admin
  display. Determine whether unattended
  installation and stronger kiosk restrictions are supported on each Portal
  model before promising remote management; the experiment uses neither root nor
  device-owner enrollment.
- Guided USB provisioning can prompt locally for Wi-Fi SSID/password, retain them
  only for the current batch, and submit them to Android without CLI arguments,
  files, or cloud transmission. Android 9 WPA2/open configuration is implemented;
  a real guest-network join still needs testing. Captive portals and enterprise
  authentication use Portal settings.
- Extend kiosk health reporting with model, OS/WebView/APK version, storage,
  controller/media capability summaries, and actionable startup failures. Do not
  upload captured media or credentials as diagnostics.
- On retirement, revoke the credential, remove local private data, restore the
  intended Home app, and remove Sparkade if appropriate.

## Implementation order and acceptance gates

The untethered runtime, per-device enrollment, and signed provisioning are
implemented. The list below tracks qualification as well as future work; it does
not imply each capability is still unbuilt. On the first Portal+, a fresh release
launch retained its production registration and controller mappings with no Mac
server or reverse tunnel. Packaged gameplay, capture, authenticated estimates,
and known-sample production transcription passed. Real player dictation and a
complete newly generated production game remain the next acceptance checks.

1. **Hardware qualification:** both Portal models; physical USB/Bluetooth gamepad
   mapping/reconnect; camera/recording; rotation; sustained game performance;
   sleep/wake; reboot and actual power restoration.
2. **Untethered slice:** packaged shell and starter game, device-local settings
   and storage, Wi-Fi operation, offline cold start with no Mac connected.
3. **Per-device enrollment:** existing pairing API through the Android adapter;
   claim, expired code, revoke/re-enroll, and update-persistence checks. Verify two
   Portals have distinct identities and do not share controller settings.
4. **Cloud workflow:** real photo/voice generation, asset caching, publishing under
   the correct device identity, interrupted request recovery, and offline replay.
5. **Provisioning/release:** reproducible signed build, guided install/acceptance
   record, update/rollback and recovery instructions.
6. **New inputs:** one camera-motion and one clap/sound prototype, followed by
   pose/voice work only after measured hardware results justify it.

Reference: [Meta Portal development](https://developers.meta.com/horizon/documentation/android-apps/portal-development/),
[WebView permission requests](https://developer.android.com/reference/android/webkit/PermissionRequest),
[Android audio settings permission](https://developer.android.com/reference/android/Manifest.permission#MODIFY_AUDIO_SETTINGS).
