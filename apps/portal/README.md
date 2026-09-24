# Sparkade on Meta Portal

A small Android WebView host for the existing Sparkade kiosk. Gamepad mode is
the default. Touch controls can be enabled in the host's connection settings.
The app fits Sparkade's 1024×600 stage inside the available display, preserving
its aspect ratio in landscape and portrait. Gamepad mode uses the full display
without an outer gutter; only aspect-ratio letterboxing remains. Portal's floating
system controls can appear above the app. Touch mode retains spacing around its
controls. The Pi's default layout is unchanged.

The standalone kiosk packages the shell and six starter games in the APK, stores
settings/scores/downloads on the Portal, and uses Sparkade production for pairing,
Muse Voice, and game generation. Installed games work without a Mac or network.
The older Mac-backed bench mode remains available as a separate app.

## Install and register a standalone kiosk

**Office operators:** use the [guided Mac setup](../../docs/portal-setup.md).
It downloads ADB and a signed APK, walks through USB authorization, opens a
controller-free registration screen, and waits for production registration to be
confirmed. The Mac needs no development environment or signing key. One session
can provision multiple Portals, with a recovery record for each hardware serial.

The commands below are for **developers building from a source checkout**.

Enable ADB, connect by USB (or an already configured Wi-Fi ADB transport), and run:

```sh
npm run portal:doctor -- --serial YOUR_DEVICE_SERIAL
npm run portal:provision -- --serial YOUR_DEVICE_SERIAL
```

This builds/tests/lints a signed **release** APK, installs `dev.sparkade.kiosk`,
grants camera/microphone capture permissions, saves the previous Home activity,
and makes Sparkade the default Home. The bench app `dev.sparkade.portal` and its
data are retained. No ADB forwarding or Mac server is needed. Configure Wi-Fi
through Android settings, accessible via Android Back → Other launchers.

On the Portal, map the controller if needed, then open **Settings → Cloud**.
Enter its short-lived code at [Kiosk administration](https://sparkade.dev/admin/kiosks),
give the device a unique name, and choose its new-game visibility. The Portal
shows the registered name automatically. Each installation creates its own
random credential; the credential is encrypted using Android Keystore and never
exposed to the web UI. Model API keys stay on Sparkade's backend.

The first standalone build creates a private signing key and properties file in
`~/.config/sparkade/portal/` (outside the repository, restricted permissions).
**Back up this directory securely.** Future builds must use the same key to update
installed kiosks without losing their data/registration. Alternatively set
`SPARKADE_PORTAL_SIGNING` to an existing Gradle properties file containing
`storeFile`, `storePassword`, `keyAlias`, and `keyPassword`. Never commit it.

Run the same provisioning command for signed updates. Do this from the attract
screen or menus, since installing restarts the app. Uninstalling/clearing data
removes the device identity and requires pairing again. To restore the saved Home:

```sh
npm run portal:boot-off -- --serial YOUR_DEVICE_SERIAL
```

Validate controller input, camera preview, voice transcription, a generated-game
download, reboot, and offline play on each physical device before placement.
Wi-Fi app updates are available through Android Back → Sparkade updates. See the update process below.

For development only, `portal:provision -- --serial SERIAL --debug` installs a
debuggable build of the same kiosk app, signed with the same private release key.
Follow it with a normal provisioning run to disable WebView debugging. Build only:
`npm run portal:build -- --standalone`. Generated web/assets are under `app/build`;
they are never checked in or seeded from a developer's personal data directory.

## Run the Mac-backed bench experiment

Requirements: Java 17, Android SDK platform 36 and build tools 35, platform-tools
(`adb`), and the repository's installed npm dependencies. Gradle is pinned via
the included wrapper. Set `ANDROID_HOME` if your SDK is outside the usual macOS
location; `JAVA_HOME` must select a compatible JDK.

1. On Portal: **Settings → Debug → ADB Enabled**. Connect a USB data cable and
   allow the computer on the Portal's authorization prompt.
2. In one terminal at the repository root:

   ```sh
   npm run portal:doctor
   npm run portal:demo
   ```

3. In another terminal:

   ```sh
   npm run portal:install
   # Multiple Android devices connected:
   npm run portal:install -- --serial YOUR_DEVICE_SERIAL
   ```

`portal:install` tests, builds, and lints the APK, installs it, forwards device port 8099
to Mac port 8099, and launches Sparkade. `portal:build` only tests/builds/lints. The APK
is at `app/build/outputs/apk/debug/app-debug.apk` relative to this directory.

The demo uses `scratch/portal-data`, the mock provider, and no cloud publishing.
It binds to Mac loopback at `http://127.0.0.1:8099`, independently of the normal
development server on 8080. Restart `portal:demo` after web source changes; it
rebuilds the production web bundle. Reinstall only after Android source changes.
The experiment and ordinary kiosk builds share `packages/web/dist`.

### Test real voice transcription

The default demo returns canned transcripts; a moving microphone meter confirms
capture but does not mean real speech recognition is enabled. To test recognition
with the configured `stages.stt` provider and its API key:

```sh
npm run portal:demo -- --serial PORTAL_IP:5555 --live-voice
```

This sends recordings to the configured transcription service (currently Muse
Voice) and uses its normal API billing. Game generation stays mock and cloud
publishing stays disabled. Ordinary demo/E2E runs remain entirely mock unless
`--live-voice` is explicitly supplied. Restarting the server keeps saved controller
mappings; the shell may return to the attract screen when it detects the restart.

The tested Portal+ firmware has no registered Android `RecognitionService`, no
`RECOGNIZE_SPEECH` activity, and no configured voice recognition/interaction service.
`portal:doctor` reports standard recognition services so this can be checked again
on other devices. The installed Portal AI service exposes camera controls; no
callable built-in transcription interface was found. This does not prove that
Meta's internal software never supported local recognition. Offline Sparkade
transcription would currently require shipping our own engine/model and measuring
accuracy and latency on the hardware; see the production roadmap.

## Controls and connection settings

- Pair a Bluetooth gamepad in Portal settings, or attach a compatible USB
  gamepad through a data/host-capable USB-C adapter. USB controller support on
  this Portal remains subject to hardware testing. A normal hub does not let the
  Portal act as a USB host for a controller and a USB peripheral for Mac ADB at
  the same time; use Wi-Fi ADB/server forwarding for USB controller experiments.
- Press a button to expose the controller to the web Gamepad API. First-boot
  setup starts automatically when a controller is detected without a saved map.
  To replace an existing map, hold exactly one button for five seconds on
  **Press Start** or a shell menu. A progress hint appears after two seconds.
- Hold **Start** for about two seconds in a game to return to the library.
- **Android Back** opens the host's device settings, including a touch-controls
  toggle, WebView information, and Other launchers. Bench mode also has a server
  URL field. From the Mac:

  ```sh
  adb -s YOUR_DEVICE_SERIAL shell input keyevent KEYCODE_BACK
  ```

- The touch panel provides all twelve logical arcade buttons and works in the
  library, wizard, gameplay, and pause screens. The shell is still designed for
  directional navigation: tapping arbitrary library rows is not implemented.
- Keyboard-mode encoders retain Sparkade's keyboard mapping. ADB-injected Android
  key events can have an empty `KeyboardEvent.code`; they are not a substitute
  for testing a physical keyboard or controller.

Bench default URL: `http://127.0.0.1:8099/`. The host adds
`?kiosk=adaptive&touch=0` (or `touch=1`) automatically. You can preview those
parameters directly in a desktop browser. A network server must use HTTPS with
a certificate the device trusts. Arbitrary LAN HTTP is disabled; browser camera
and microphone APIs also require a secure context. USB loopback satisfies this.
The URL should point to the kiosk server, not the separate public website.

In bench mode, controller mappings/settings belong to the server, not each WebView.
Use a separate server/data directory for each simultaneously tested kiosk to
avoid changing another kiosk's mapping.

### Free the USB port for a controller

For bench testing, ADB can carry the same loopback server connection over Wi-Fi.
The Mac and Portal must share a trusted network. With the Portal connected by USB:

```sh
adb -s USB_SERIAL shell ip -4 addr show wlan0
adb -s USB_SERIAL tcpip 5555
# Replace PORTAL_IP with the wlan0 address from the first command.
adb connect PORTAL_IP:5555
adb -s PORTAL_IP:5555 reverse tcp:8099 tcp:8099
```

Restart the demo with `npm run portal:demo -- --serial PORTAL_IP:5555` so its
forwarding watcher selects the Wi-Fi transport. Once `adb -s PORTAL_IP:5555
get-state` reports `device`, unplug the Mac and attach the USB controller. The
app URL remains `http://127.0.0.1:8099/`; no LAN HTTP exception is needed.

This still depends on the Mac server. If Wi-Fi ADB disconnects, run `adb connect`
again; after a reboot it may need the initial USB setup again. To return ADB to
USB-only mode, reconnect the cable and run `adb -s PORTAL_IP:5555 usb`.

To distinguish USB enumeration from Android controller support:

```sh
adb -s PORTAL_IP:5555 shell dumpsys input
adb -s PORTAL_IP:5555 shell getevent -pl
```

A device appearing on the USB bus does not guarantee an Android input device or
WebView Gamepad API entry. Inspect each layer before changing control mappings.

### Direct USB controller fallback

The tested Kiwitata SNES pad identifies as `0079:0011` (`USB Gamepad`). The Portal+
successfully enumerates it in USB host mode, but this firmware has no `usbhid`
driver or corresponding Android input device. Consequently,
`navigator.getGamepads()` stays empty even when the controller sends reports.

The Android host has a direct USB reader scoped to supported vendor/product pairs
and their exact tested HID report descriptors. Allow Sparkade's USB access prompt.
For the Kiwitata it decodes ten raw buttons and the D-pad axes, then passes bounded controller state
one way to the shared input broker. The normal mapping wizard configures these
inputs; the source stays separate from keyboard/touch input. No root or OS driver
installation is required. Controllers already handled by Android use that path.

From **v0.4.6**, the fallback also supports the tested **DragonRise Zero Delay
encoder `0079:0006`** (`Generic USB Joystick`). This Portal+ enumerates the encoder
but does not expose it to Android's input system. Its descriptor provides twelve
buttons, X/Y directions, and a hat; unused axes/vendor bits are ignored. Captures
from the connected arcade pad include all four joystick directions and eight wired
buttons (USB button numbers 1, 2, and 7–12). Unwired-axis noise is discarded before
sending state to the WebView. The shared bridge accepts both supported button counts,
so buttons 11/12 can initiate the five-second remapping hold as well.

This qualifies the captured USB identity/descriptor, not every board sold as “Zero
Delay.” Do not treat a controller's USB power LED alone as evidence of usable input.

The reader releases input when detached, backgrounded, or stopped, and while the
native connection panel is open. Open **Android Back → Retry USB controller** to
retry a denied permission or reader error. The panel also shows controller status.
USB permission may need granting again after reconnect. Other controllers with
different report formats require their own verified support; matching a vendor
ID alone is insufficient. Bluetooth support still needs physical validation.

For diagnostics, `adb -s PORTAL_IP:5555 logcat -s SparkadeUsb:D` shows connection
status and a limited number of changed HID reports in debug builds. A native
fallback controller is visible to Sparkade's broker, not the browser's
`navigator.getGamepads()` list.

## Android behavior

- Android 9 minimum / Android 10 target, per Meta's Portal guidance; no GMS
  dependency. AndroidX WebKit supplies the origin-scoped WebMessage bridge.
  Compilation uses the newer SDK.
- Hardware acceleration and DOM storage enabled; screen stays awake while the
  app is visible. Rotation resizes the stage without restarting the activity.
- Navigation stays on the configured origin. Camera/microphone requests are
  restricted to that origin and the corresponding Android runtime permissions.
  File access, mixed content, and arbitrary JavaScript-to-native bridges are disabled.
  Native USB input uses a one-way event, restricted to the configured origin;
  it does not expose a JavaScript-callable native interface.
- A failed page load or renderer crash shows Retry and Connection settings,
  and retries every five seconds while the app is visible. Opening connection
  settings pauses the retries so you can edit the address.
- Debug builds expose the WebView inspector and log web console output using
  the `SparkadeWeb` tag. Standalone provisioning defaults to a signed release
  with WebView debugging disabled.
- The app can be selected as Android's default Home activity for boot startup
  (see below). No device-owner enrollment, OS changes, automatic WebView updates,
  or locked-task mode are installed by this prototype.
- Camera preview/photo capture and microphone recording work on the tested
  Portal+ (see findings below). Native file uploads and native camera fallbacks
  are not implemented.

The demo server automatically restores USB forwarding after reconnect or reboot
for the single device selected when it starts. With multiple devices, use
`npm run portal:demo -- --serial SERIAL` (or `ANDROID_SERIAL`). If no device is
connected when starting, specify its serial explicitly to enable reconnection.
Manual recovery is `adb -s SERIAL reverse tcp:8099 tcp:8099`.

To remove the experiment, restore the previous launcher first if boot mode is on:

```sh
npm run portal:boot-off -- --serial YOUR_DEVICE_SERIAL
adb -s YOUR_DEVICE_SERIAL uninstall dev.sparkade.portal
adb -s YOUR_DEVICE_SERIAL reverse --remove tcp:8099
```

## Boot directly into Sparkade

Standalone `portal:provision` already enables this and needs no Mac server.
For the bench app only:

```sh
npm run portal:boot -- --serial YOUR_DEVICE_SERIAL
```

This builds/installs Sparkade and uses Android's supported
`cmd package set-home-activity` command to make it the default Home app. Android
starts the Home activity during boot and returns to it when Home is pressed.
No root access or removal of Portal system apps is needed. The previous Home
component is saved per device in `scratch/portal-devices/SERIAL.json` **before**
installation, because adding a new Home app can reset Android's implicit choice.
Keep that file for rollback. Normal `portal:install` preserves a resolved Home
choice; it does not opt another device into Sparkade boot mode.

The native connection panel's **Other launchers** button can open Portal's
original launcher or Android settings temporarily. Sparkade remains the default.
To restore the previous default permanently:

```sh
npm run portal:boot-off -- --serial YOUR_DEVICE_SERIAL
```

On the tested Portal+, Wondry's `BOOT_COMPLETED` receiver explicitly opened its
activity, competing with Sparkade even after changing the default Home. At the
operator's request, the entire `ai.wondry.portal` package has been force-stopped
and disabled for user 0. It remains installed with its data intact. The saved
rollback Home was changed to the original Meta Portal launcher during bench
testing; standalone provisioning subsequently saved the bench app as its previous
Home. Inspect the per-device backup before rollback. `portal:boot-off` does not
reactivate retired Wondry. This is a
device-specific retirement, not an automatic action in the installer. Other
devices need their own startup-app inspection. No system components are disabled.

If the local backup is lost, inspect available launchers, then explicitly choose
the desired component:

```sh
adb -s SERIAL shell cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME
adb -s SERIAL shell cmd package set-home-activity --user 0 PACKAGE/ACTIVITY
```

**The bench app still needs its server after boot.** For a bench USB setup,
leave the Mac awake with `portal:demo` running and the device authorized for ADB.
The server restores the USB tunnel and the app retries until it connects. If
the Mac is off, the Portal opens Sparkade's connection/retry screen. Untethered
boot is provided by the standalone kiosk installed with `portal:provision`.

## Debugging

```sh
adb -s YOUR_DEVICE_SERIAL logcat -s SparkadeWeb:D AndroidRuntime:E chromium:E
adb -s YOUR_DEVICE_SERIAL exec-out screencap -p > portal.png
adb -s YOUR_DEVICE_SERIAL shell pidof dev.sparkade.portal
adb -s YOUR_DEVICE_SERIAL forward tcp:9223 localabstract:webview_devtools_remote_PID
```

Inspect the forwarded WebView using Chrome's device inspector or a CDP client on
port 9223. On the tested Portal, CDP screenshots omitted the hardware-rendered
game canvas; **ADB screencap** captured the actual screen correctly. Remove the
debug forward when finished: `adb -s SERIAL forward --remove tcp:9223`.

## Initial hardware findings (2026-09-19)

| Item                            | Connected Portal+                                                          |
| ------------------------------- | -------------------------------------------------------------------------- |
| Device codename                 | `aloha`                                                                    |
| Android                         | 9 / API 28                                                                 |
| Display                         | 1920×1080, 160dpi                                                          |
| WebView viewport                | 1920×1016 after reserving the top overlay                                  |
| WebView                         | Meta package `com.facebook.portal.webview`, Chromium 131.0.6778.39         |
| Browser capabilities            | Secure loopback context, Gamepad API, mediaDevices, ResizeObserver present |
| Storage available at inspection | Approximately 14 GB                                                        |

Verified on this Portal+:

- Installation, attract/library, golden shooter intro/gameplay/pause using remote
  keyboard input. Short frame-timing samples were approximately 60 fps; this is
  not a sustained performance test.
- Default-Home startup after an actual ADB reboot, with automatic USB forwarding
  recovery. The native retry screen also recovered without a tap after stopping
  and restarting the Mac server. Physical power removal/restoration still needs
  a separate check.
- Live camera preview at 640×480 / 30 fps, countdown, and photo preview. A request
  for 1280×720 still returned 640×480; do not infer output from capabilities alone.
- Microphone capture at 48 kHz mono and the existing voice recording flow through
  a local mock transcription response. `MODIFY_AUDIO_SETTINGS` is required in
  addition to `RECORD_AUDIO` for Chromium to open the microphone on this device.

Separately, a synthetic spoken WebM sent through the bench server's actual
`/api/transcribe` route with `--live-voice` returned the expected sentence from
Muse Voice. This verifies the live server/provider path, not recognition accuracy
for speech recorded by the Portal. The standalone production checks below also
use a known synthetic recording; real player dictation and a newly generated
production game remain acceptance checks.

Kiwitata USB enumeration, direct button reports, all D-pad directions, full
12-control mapping/save, and physical library navigation were verified on hardware.
Decoder tests use those captured reports; browser tests
cover native input navigation, gameplay entry, remapping, and disconnect release.
Sustained physical gameplay/reconnect qualification is still in progress. The 10-inch
second-generation Portal has not been connected or verified. Inspect its OS,
WebView, density, input devices, media permissions, and real layout separately.

## Standalone runtime

Keep the game runtime and most UI shared with the Pi. Use native Android code
for lifecycle, media permissions, hardware integration, and kiosk management.
The standalone adapter supplies the operations previously owned by the Node server.

The packaged shell runs at `https://appassets.androidplatform.net/`, resolved
entirely from APK assets and app-private files. A main-frame-only, origin-scoped
WebMessage interface handles device storage and a fixed allowlist of Sparkade
cloud operations. It cannot issue arbitrary authenticated URL requests. Native
HTTPS calls reject redirects; downloaded assets are size-limited and SHA-256
checked before the game is marked ready. Interrupted downloads retry without
creating another generation job. Local settings and library metadata are saved
atomically; clearing web browsing storage does not erase the native identity.

On this Portal+, the standalone kiosk was registered in production as **Meta SEA
Portal+ 1**, with listed-by-default visibility selected in kiosk admin. A signed
release update and fresh process launch retained registration and all twelve
controller mappings. Starter gameplay ran with the Mac bench server stopped and
ADB reverse forwarding removed. Camera and microphone capture worked from the
packaged origin. A known spoken WebM uploaded through the native authenticated
production bridge returned the correct Muse Voice transcript. The live estimate
endpoint also succeeded. Automated checks cover download commit/retry, persistence,
bundle validation, controller input, and packaged-game playback.

This release still needs a complete new production game/photo/voice acceptance
run, physical power-cycle/offline qualification, and testing on the 10-inch Portal.
Unattended installation and additional live camera/microphone game controls remain future work.

The [production Portal roadmap](../../docs/roadmaps/portal-kiosks.md) describes the
repeatable install/register/validate process using the existing pairing API,
device-local identity/storage, packaged offline games, signed updates, and
camera/microphone input experiments. The separately installed bench wrapper still
requires its configured server; the standalone kiosk does not.

Compare both Portal models on gameplay frame pacing, controller latency and
reconnect, camera/mic access, rotation, network loss/recovery, sleep/wake, reboot,
and a sustained gameplay run before choosing kiosk management or native UI work.

## Prepare an office release (maintainers)

First assess all affected clients using the [release guide](../../docs/releases.md).
Shared shell, engine, and built-in game changes can require a Portal APK even when
the change does not touch Android source.

Office setup always installs the same fleet-signed APK. Keep the original private
key in secure backup; `release-certificate.sha256` contains only its public
certificate fingerprint. The packager checks the APK signature against that
fingerprint and rejects debug builds. It does not upload the key. Do not replace
the fingerprint to work around a missing/wrong signing key.

1. Bump Android `versionCode` / `versionName` and the `RELEASE` in
   `scripts/install-portal.sh`. Update the versioned URL in the office guide.
2. Commit the intended release source, then run `npm run portal:release` with
   the original signing key available. This tests the installer, builds/tests/lints
   Android, verifies the signature, and packages the release in
   `scratch/portal-releases/portal-vVERSION/`. Check `release.json` for the source
   commit, APK hash, version, and public signing certificate.
3. Test the installer against a Portal, including existing-registration updates
   and recovery. A local artifact can be selected with `--apk PATH --sha256 HASH`;
   `--serial SERIAL` makes the hardware target explicit. `--non-interactive` exits
   **2** when installation succeeded but registration still needs an operator.
4. Publish `install-portal.sh`, `sparkade-portal.apk`,
   `sparkade-portal.apk.sha256`, `portal-setup.md`, and `release.json` together in
   a GitHub release named `portal-vVERSION`, targeting that source commit.
   Keep published release assets/tags immutable; corrections need a new version.
5. Run the published installer with `--prepare-only` to check the remote download,
   then send operators the exact versioned command from the guide.

The setup Activity and read-only status receiver require Android's privileged
`DUMP` permission, which the authorized ADB shell holds. The receiver only returns
bounded public status fields and the temporary pairing code. It never reads
credentials into the Mac and does no network work in the broadcast callback.
Registration runs on the setup Activity's worker, preserving the same native
identity across retries, setup, gameplay, and signed updates. A revoked identity
requires admin action. Production enrollment is not accessible to arbitrary apps
through an unprotected exported component.

References: [Portal development](https://developers.meta.com/horizon/documentation/android-apps/portal-development/),
[device setup](https://developers.meta.com/horizon/documentation/android-apps/portal-setup/),
[app requirements](https://developers.meta.com/horizon/documentation/android-apps/portal-create-app/),
[design requirements](https://developers.meta.com/horizon/documentation/android-apps/portal-design-requirements/).

## Wi-Fi updates and fleet version reports

**Verifier qualification:** with `package_verifier_enable=1`, the tested Portal+
rejects app-initiated installation with `-22` (`INSTALL_FAILED_VERIFICATION_FAILURE`)
after user confirmation. Its required verifier is `com.facebook.appverifier`;
the pre-existing `verifier_verify_adb_installs=0` allows Mac-driven ADB installation.
With authorization, `package_verifier_enable=0` was tested on the dedicated pilot:
v0.4.2 downloaded, verified, and installed v0.4.3 after Android confirmation, followed
by an isolated upgrade to v0.4.4. Both returned automatically to Press Start.
Android records `dev.sparkade.kiosk` as the installer, rather than ADB; version code
advanced from 8 to 9 to 10. Production registration and camera/microphone grants
were retained. The isolated v0.4.4 upgrade retained Sparkade as default Home without
an ADB repair; a fresh HOME launch also passed. Those upgrades used the pilot channel;
stable was not promoted. Installer v0.4.3 and later offer this OS-wide change explicitly, save the previous value,
and restore it during launcher recovery. This does not remove Android's APK signing
checks or Sparkade's pinned certificate/checksum checks. This qualifies one
operator-confirmed update path on Portal+, not unattended installs or other Portal models.

From v0.4.2, **Android Back → Sparkade updates** checks a release channel and
stages the signed APK over Wi-Fi. Open it from Press Start, the library, or Settings;
gameplay, generation, recording, and stale/unresponsive shell state block entry.
The background check runs at most every six hours while Sparkade is open. It never
installs automatically or opens a prompt during a game. **Install update** rechecks
the channel approval, asks Android to install, and returns to Sparkade after replacement.
The Android 9 Portal theme renders the stock installer text invisibly by default.
Provisioning enables Android's high-contrast text setting to make its labels and
buttons readable, saves its previous value, and restores it with launcher recovery.
This affects Android native text, including maintenance dialogs, and does not
change the web game's rendering. Rerun the new Mac installer once on older builds
if the Android confirmation appears blank. No additional secure-settings permission
is granted to Sparkade. A manual check retries a failed/interrupted download. No Mac/server/ADB is needed.
The existing Mac installer remains the recovery path if the app cannot run.

New devices use **stable**. Enable **Use pilot releases on this test kiosk** in the
native update screen for test devices. Channels point to immutable versioned APKs;
publishing an APK alone does not promote it. Maintainers validate a published release:

```sh
npm run portal:promote -- --release portal-v0.4.9 --channel pilot
npm run portal:promote -- --release portal-v0.4.9 --channel pilot --publish
# After hardware acceptance, approve the identical binary for ordinary kiosks:
npm run portal:promote -- --release portal-v0.4.9 --channel stable --publish
# Withdraw approval without uninstalling or altering devices:
npm run portal:promote -- --channel stable --disable --publish
```

Only `portal-channel-stable` / `portal-channel-pilot` release metadata is mutable.
Shared shell, engine, and built-in game changes require this Portal release process
as well as the website/Pi rollout. `portal-assets.mts` packages the repository's
current goldens and their asset manifests inside the APK; a `main` push alone does
not update an installed Portal. Release v0.4.5 includes Spark Token Rally, kiosk
display titles, and library high-score dialogs from `main` through `4afeac5`.
Release v0.4.8 packages `main` through `b6666e6`, including camera preview recovery,
specific camera errors, corrected generation retry instructions, and shared
platformer validation. It also includes the controller and racing touch changes
from v0.4.6/v0.4.7. Cloud generation improvements have their own website deployment;
an APK update does not replace existing games' generated artwork.
Release v0.4.9 removes file upload from the New Game photo and camera-error
screens, updates controller navigation to the remaining two choices, and replaces
the racing type's old gameplay screenshot with illustrated pixel art. Pi kiosks
receive these shared shell changes through their source updater; Portal kiosks
require this APK. Website/cloud deployment is not required for these UI changes.

The app only downloads from pinned GitHub release hosts, bounds download size/time,
checks SHA-256 and the installed app's signing certificate, and rejects debug builds,
wrong package names, incompatible Android requirements, and non-increasing versions.
It stages before installation and leaves device registration/storage untouched.
Rollback means releasing the previous good code with a **higher versionCode**;
keep storage migrations compatible. Never replace a published APK or signing key.

Registration requests include bounded app version/model/channel/update state headers.
The corresponding site change stores them against the authenticated kiosk and shows
them in **Admin → Kiosks**, alongside last-contact time. This is backward compatible
with older clients and servers; the admin display requires deploying the site change.
It is version/status reporting, not remote control or per-device approval scheduling.

### Office Wi-Fi configuration

The Mac installer can configure an Android 9 Portal over authorized USB, without
embedding office network details. It prompts for SSID, WPA2-Personal/open security,
hidden-network status, and a hidden/repeated password. Credentials remain only in
the installer process and Android's saved network configuration, and can be reused
for subsequent Portals during that one run. No credential flag/env-file is supported.

`WifiSetupProvider` is protected by `android.permission.DUMP`, including an explicit
check in `call()` (provider call methods do not enforce URI read/write permission
automatically). It accepts at most 512 bytes over an in-memory pipe, with a ten-second
input deadline, strict UTF-8/SSID/PSK validation, and a request nonce. There is no
WebView bridge to it. It uses `WifiManager` only on API 28, reports association within
45 seconds, and attempts to return to the prior network on a failed new connection.
It never deletes existing networks; Android may retain a submitted network after
failure. Production registration separately verifies internet access. Status contains
no SSID or password, and errors do not reflect or log submitted values. No location
permission or network scanning is added.

Changing an existing network's password may require Portal settings if Android
rejects modification of a network saved by another app. Enterprise/certificate and
captive-portal sign-in use Portal settings; wireless ADB cannot run network-changing
setup. The terminal choices and credential transport have fixture coverage, but a
real office-network join still needs hardware qualification.

### Device-owner investigation (Portal+, Android 9)

The tested firmware exposes `device_admin`, `managed_users`, and `dpm`, with no existing
owner, one Android user, and four accounts. A temporary `testOnly` admin probe's ADB
enrollment stalled waiting for the account authenticator; it was removed and the
original empty admin state verified. Android 9's production enrollment path rejects
non-test apps when accounts exist. No accounts or setup flags were removed/changed,
no reset was performed, and the kiosk remains unmanaged. A clean-device enrollment
experiment needs separate hardware qualification. Do not provision release apps as
`testOnly` or depend on unattended APK installs in the office setup process.
