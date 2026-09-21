# Set up Sparkade on Meta Portal — office operator guide

Use a **Mac**, the Portal's power supply, a **USB data cable**, and a Wi-Fi network
the Portal can join. You also need access to [Sparkade kiosk administration](https://sparkade.dev/admin/kiosks).
No source checkout, Homebrew, Android Studio, Node, Java, model API key, or signing
key is required. Complete the Portal's initial setup first. The installer can then
configure the office network over USB; no office SSID/password belongs in this repo.

## 1. Start the installer

Open **Terminal** on the Mac and paste:

```sh
curl -fL --proto '=https' --proto-redir '=https' \
  https://github.com/danny-hines/sparkade/releases/download/portal-v0.4.5/install-portal.sh \
  -o /tmp/install-sparkade-portal.sh && bash /tmp/install-sparkade-portal.sh
```

This versioned command downloads the complete script before running it. The
installer reuses ADB if present or downloads Google's official Mac Platform Tools
into your user folder. It downloads and verifies the signed Sparkade app. No
administrator password is requested. Do not run it with `sudo`.

## 2. Connect one Portal

1. Power on the Portal. Complete its normal setup and join Wi-Fi.
2. On the Portal, open **Settings → Debug** and enable **ADB**. Menu names can vary
   with firmware; if Debug is absent, ask the device administrator to enable developer access.
3. Connect it to the Mac with a USB **data** cable.
4. Accept **Allow USB debugging** on the Portal and allow this computer.
5. Follow Terminal's prompts. Check the model and serial before confirming install.

If several devices are attached, the installer makes you select one. Wireless ADB
devices are ignored by default. An unauthorized/offline device is explained instead
of silently selecting a different one. A non-Portal Android device is rejected.

The installer keeps existing Sparkade data, grants camera/microphone permissions,
makes Sparkade the default Home app, and opens a setup screen on the Portal. If it
finds an enabled retired Wondry app, it asks to disable it while retaining its data.
It does not remove Portal system apps or root the device.

### Choose Wi-Fi during setup

Terminal offers **keep the current network**, **enter a network**, or **open Portal
Wi-Fi settings**. On Android 9, enter the exact SSID, select WPA2/shared password or
open network, and enter/repeat the password with typing hidden. Hidden SSIDs are
supported. For additional Portals in the same installer run, you can reuse the
network details held in memory. Exiting the installer discards that copy.

The password travels through the authorized USB connection using stdin. It is not
a command argument, shell-history entry, setup record, checked-in configuration,
or Sparkade cloud field. Android saves the credentials in its normal Wi-Fi settings
so the kiosk reconnects after power-on. Do not supply passwords in command flags,
environment variables, chat, or issue reports. Setup disables shell tracing before
reading credentials.

Changing networks requires USB; the installer will not change Wi-Fi through a
wireless ADB connection. `--skip-wifi` preserves the current connection without a
prompt; non-interactive setup also leaves Wi-Fi alone. Enterprise authentication,
certificates, other Android versions, or firmware restrictions use Portal settings.
Automatic configuration targets WPA2-Personal and open networks, not WPA3-only.

Wi-Fi association is checked first; production registration separately proves
internet access. If the guest network requires accepting terms or signing in on a
web page, complete that on the Portal. A saved Wi-Fi password cannot bypass that
step or prevent the guest session from expiring.

## 3. Register it in production

The Portal creates its own identity and requests a short-lived registration code.
The code appears on its screen and in Terminal; the installer opens
[kiosk administration](https://sparkade.dev/admin/kiosks) on the Mac.

1. Sign in with an account allowed to manage kiosks.
2. Enter the code.
3. Give it a unique location/name, such as **NYC Portal 01**. Label the physical
   Portal with the same name.
4. Choose whether new games should be **listed** or **unlisted** in the public feed.
5. Wait for **Production registration confirmed** in Terminal and the registered
   name on the Portal. Sparkade then opens automatically.

The installer never needs your admin password. Credentials and model keys are not
copied from the Mac or another kiosk. Expired pairing codes refresh on the Portal.
A rerun retains an existing registration; it does not create a duplicate kiosk.
Revoked registrations require an administrator's attention and are not silently replaced.

The Portal itself needs working internet access; the Mac does not proxy its traffic.
For office Wi-Fi restrictions or captive portals, use the setup screen's **Wi-Fi
settings** button, complete access, return to setup, and tap **Retry connection**.

## 4. Unplug and check

Disconnect the Mac, then attach the controller. Allow Sparkade's USB access prompt
if shown and follow the mapping screen. A previously mapped controller retains its
mapping. The tested Kiwitata controller is supported; a Zero Delay encoder still
needs qualification for its exact board/report format.

Before putting the kiosk out for use:

- Play a starter game and check directions, buttons, Start, and leaving a game.
- Check the camera preview and a real spoken prompt.
- Generate one intended game and verify it downloads and plays. Production
  generation uses the service's normal billing and the visibility you selected.
- Power the Portal off and on. Confirm Sparkade opens with the Mac disconnected.
- Briefly disconnect Wi-Fi and confirm an installed game still plays. Reconnect
  Wi-Fi for game creation.

The installer can then set up the next Portal. Unplug the completed device first.
The 10-inch Portal and new controller types need their own hardware acceptance;
successful APK installation alone does not qualify every model.

## Troubleshooting and recovery

### Floating bug icon

Some Portals show Meta's **Bugnub** reporting shortcut over every app. In Portal's
debug settings, turn **Bugnub** off under **Feedback**. This uses Portal's own
saved toggle; it does not disable ADB or any system package. Turn it back on in
the same screen if needed.

On the tested Portal+, an operator can open that screen from the Mac with the
following command (replace `PORTAL_SERIAL` with the target from `adb devices`):

```sh
adb -s PORTAL_SERIAL shell am start \
  -a com.facebook.aloha.system.settings.PROD_DEBUG_TAB \
  -p com.facebook.alohaapps.settings
```

After switching Bugnub off, return Home to Sparkade. The installer does not
automatically change this setting.

| Symptom                                   | What to do                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Nothing appears in Terminal's device list | Enable ADB, try a different data cable/USB port, and check the Portal screen. Charging-only cables are a common cause.  |
| `unauthorized`                            | Unlock the Portal and accept its USB debugging prompt. Reconnect if needed.                                             |
| `offline` or disconnected                 | Reconnect USB, then rerun. The existing registration is kept.                                                           |
| Download failed                           | Check the Mac's internet access and the release URL. Ask IT if GitHub or Google's Android downloads are blocked.        |
| App checksum mismatch                     | Do not install that file. Rerun to download a verified copy.                                                            |
| Signature mismatch or version downgrade   | Ask the maintainer for the correct signed release. **Do not uninstall Sparkade or clear app data** to work around this. |
| No pairing code / network error           | Connect the Portal to Wi-Fi using the setup screen, then retry. Its connection is separate from the Mac's.              |
| Code expired                              | Use the replacement code shown on the Portal/Terminal.                                                                  |
| Can't access kiosk admin                  | Ask a Sparkade administrator to claim the code; installing the app does not grant admin access.                         |
| Setup says registration is not confirmed  | Finish registration on the Portal setup screen or rerun the command. Do not count this device as complete yet.          |

Setup records and the previous Home launcher are saved per **hardware serial** at:

```text
~/Library/Application Support/Sparkade/Portal Setup/devices/
```

These records include app version/checksum, model, Android/WebView information, and
registration completion time. They contain no device secret, admin credentials,
photos, audio, Wi-Fi credentials, or persisted pairing codes. Keep the recovery records.

To restore the original launcher using the same Mac:

```sh
bash /tmp/install-sparkade-portal.sh --restore-home
```

Sparkade and its data remain installed. Retired Wondry stays disabled. If this Mac
didn't perform the original setup, obtain the recovery record from the original
operator. Android Back → Other launchers also provides temporary access to Portal
settings. Clearing app data or uninstalling Sparkade removes its local identity
and games and requires a new registration.
Recovery also restores the saved high-contrast text and app-verifier settings.
It keeps Android's saved Wi-Fi networks.

## Updating

The Portal app includes its own copy of the Sparkade interface, game engine, and
built-in games. Website deployments and pushes to `main` do not replace that copy.
These changes reach Portals through a new signed APK approved on their update
channel. Version **0.4.5** includes **Spark Token Rally**, the replacement built-in
racer, along with kiosk display titles and the library's high-score dialogs.

**Dedicated kiosk option:** setup asks whether to enable on-device app updates.
This disables Meta's additional OS-wide app-install verifier, which otherwise
rejects Sparkade's app-initiated installation on the tested Portal+. Android's
cryptographic signature checks and Sparkade's signing/checksum checks remain.
The change affects all app installations on the device. Answer No to retain the
verifier and use Mac-driven updates; non-interactive setup retains it unless
`--enable-device-updates` is explicitly supplied. The original value is saved once
per hardware serial and restored by `--restore-home`.

**Portal+ pilot result:** with that verifier disabled, the device downloaded and
installed v0.4.3 from v0.4.2, then v0.4.4 from v0.4.3 over Wi-Fi, returning to
Sparkade automatically. Registration and camera/microphone grants were retained;
the isolated v0.4.4 upgrade also retained Sparkade as default Home. Stable rollout is not yet
promoted. A real office-network join using the new Wi-Fi helper still needs testing.

The experimental **Android Back → Sparkade updates** screen downloads and verifies
signed releases over Wi-Fi. It only opens from Press Start or a menu, and preserves
registration and games. Setup enables high-contrast Android text on Android 9 so
system confirmation buttons are readable, and launcher recovery restores the
previous display setting. Installation still requires confirmation on the Portal.

Run the installer for a published release from a menu or the attract screen because
updating restarts Sparkade. Offices always use the same maintainer-signed APK and
never build or sign their own copy. Do not uninstall or clear data when updating.

For maintainers: [build, signing, release, and channel promotion](../apps/portal/README.md).
