#!/bin/bash
# Sparkade office installer. Compatible with the Bash 3.2 shipped by macOS.
# No development checkout, admin privileges, signing key, or model API key required.
set -euo pipefail
umask 077

RELEASE=portal-v0.4.1
REPOSITORY=danny-hines/sparkade
APP=dev.sparkade.kiosk
MAIN=dev.sparkade.kiosk/dev.sparkade.portal.MainActivity
SETUP=dev.sparkade.kiosk/dev.sparkade.portal.SetupActivity
STATUS=dev.sparkade.kiosk/dev.sparkade.portal.SetupStatusReceiver
ADMIN=https://sparkade.dev/admin/kiosks
WORK_DIR=${SPARKADE_PORTAL_SETUP_DIR:-"$HOME/Library/Application Support/Sparkade/Portal Setup"}
ADB=${SPARKADE_ADB:-}
REQUESTED_SERIAL=
SERIAL=
APK=
EXPECTED_SHA=
INTERACTIVE=1
RESTORE=0
DISABLE_WONDRY=0
PREPARE_ONLY=0
TEMP_DIR=

say() { printf '%s\n' "$*"; }
fail() { say "\nSetup stopped: $*" >&2; exit 1; }
cleanup() { if [ -n "$TEMP_DIR" ]; then rm -rf "$TEMP_DIR"; fi; }
trap cleanup EXIT
trap 'say "Setup interrupted. Run the same command to resume; existing registration is kept."; exit 130' INT TERM
usage() {
  cat <<'USAGE'
Sparkade Portal setup for macOS
Usage: bash install-portal.sh [options]
  --serial SERIAL         Select one specific device (USB by default)
  --release portal-vX.Y.Z  Install a specific published Portal release
  --restore-home          Restore this Mac's saved previous launcher; keep app/data
  --prepare-only          Download/verify prerequisites and APK without touching a device
  --adb /path/to/adb      Use a specific ADB executable
  --apk /path/to/app.apk --sha256 HEX
                          Test a locally prepared release instead of downloading
  --non-interactive       Require --serial; exit 2 if manual registration is still needed
  --disable-wondry       Disable the retired Wondry app if present, preserving its data
  --help                 Show this help
USAGE
}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --serial|--release|--adb|--apk|--sha256)
      [ "$#" -ge 2 ] || fail "$1 needs a value."
      case "$1" in
        --serial) REQUESTED_SERIAL=$2;; --release) RELEASE=$2;; --adb) ADB=$2;;
        --apk) APK=$2;; --sha256) EXPECTED_SHA=$2;;
      esac
      shift 2;;
    --non-interactive) INTERACTIVE=0; shift;;
    --restore-home) RESTORE=1; shift;;
    --disable-wondry) DISABLE_WONDRY=1; shift;;
    --prepare-only) PREPARE_ONLY=1; shift;;
    --help|-h) usage; exit 0;;
    *) usage; fail "Unknown option: $1";;
  esac
done
[[ "$RELEASE" =~ ^portal-v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Invalid release tag."
VERSION=${RELEASE#portal-v}
[ "$(uname -s)" = Darwin ] || fail "This installer supports Macs. Use a Mac with a USB data cable."
[ "$(id -u)" != 0 ] || fail "Run this as your normal user, without sudo."
if [ "$INTERACTIVE" = 0 ] && [ -z "$REQUESTED_SERIAL" ] && [ "$PREPARE_ONLY" = 0 ]; then
  fail "Non-interactive setup requires --serial so the intended device is explicit."
fi
if [ "$INTERACTIVE" = 1 ] && [ "$PREPARE_ONLY" = 0 ]; then
  # Read prompts from the terminal, not the downloaded script in curl | bash.
  if ! { exec 3<> /dev/tty; } 2>/dev/null; then
    fail "Open Terminal and run this command there. For automation use --non-interactive --serial SERIAL."
  fi
fi
ask() {
  [ "$INTERACTIVE" = 1 ] || return 1
  printf '%s ' "$1" >&3
  IFS= read -r REPLY <&3 || exit 130
}
confirm() {
  ask "$1 [y/N]" || return 1
  case "$REPLY" in y|Y|yes|YES) return 0;; *) return 1;; esac
}
download() {
  local url=$1 target=$2
  curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' \
    --connect-timeout 15 --max-time 600 --retry 2 --output "$target.part" "$url" || {
      rm -f "$target.part"
      fail "Download failed: $url. Check this Mac's internet connection and that the release has been published."
    }
  mv "$target.part" "$target"
}
for tool in curl unzip shasum awk sed; do
  command -v "$tool" >/dev/null || fail "macOS tool '$tool' is missing. Ask your IT team to restore it, then rerun setup."
done
mkdir -p "$WORK_DIR" "$WORK_DIR/devices"
TEMP_DIR=$(mktemp -d "$WORK_DIR/.setup.XXXXXX")
say "Sparkade Portal setup — $VERSION — production (sparkade.dev)"
say "This Mac is only needed for installation. Each Portal keeps its own registration and games."

if [ -z "$ADB" ]; then
  if command -v adb >/dev/null 2>&1; then ADB=$(command -v adb)
  elif [ -x "$HOME/Library/Android/sdk/platform-tools/adb" ]; then ADB="$HOME/Library/Android/sdk/platform-tools/adb"
  else ADB="$WORK_DIR/platform-tools/adb"
  fi
fi
if [ ! -x "$ADB" ]; then
  [ "$ADB" = "$WORK_DIR/platform-tools/adb" ] || fail "ADB is not executable: $ADB"
  say "Downloading Google's Android Platform Tools into $WORK_DIR. No administrator password is needed."
  say "Source and license: https://developer.android.com/tools/releases/platform-tools"
  download https://dl.google.com/android/repository/platform-tools-latest-darwin.zip "$TEMP_DIR/platform-tools.zip"
  unzip -q "$TEMP_DIR/platform-tools.zip" -d "$TEMP_DIR/tools" || fail "Could not unpack Android Platform Tools."
  [ -x "$TEMP_DIR/tools/platform-tools/adb" ] || fail "The Android tools download is incomplete."
  # The cache is only populated after extraction succeeds.
  if [ -e "$WORK_DIR/platform-tools" ]; then mv "$WORK_DIR/platform-tools" "$TEMP_DIR/old-tools"; fi
  mv "$TEMP_DIR/tools/platform-tools" "$WORK_DIR/platform-tools"
fi
"$ADB" version || fail "ADB could not run. Check macOS security/IT restrictions or pass --adb with a working copy."

if [ "$RESTORE" = 0 ]; then
  if [ -z "$APK" ]; then
    BASE_URL="https://github.com/$REPOSITORY/releases/download/$RELEASE"
    APK="$WORK_DIR/sparkade-$VERSION.apk"
    download "$BASE_URL/sparkade-portal.apk.sha256" "$TEMP_DIR/apk.sha256"
    EXPECTED_SHA=$(awk 'NR == 1 {print $1}' "$TEMP_DIR/apk.sha256")
    if [ ! -f "$APK" ] || [ "$(shasum -a 256 "$APK" | awk '{print $1}')" != "$EXPECTED_SHA" ]; then
      say "Downloading the signed Sparkade app…"
      download "$BASE_URL/sparkade-portal.apk" "$APK"
    fi
  fi
  [[ "$EXPECTED_SHA" =~ ^[a-f0-9]{64}$ ]] || fail "A valid SHA-256 checksum is required for the APK."
  [ -f "$APK" ] || fail "APK not found: $APK"
  [ "$(shasum -a 256 "$APK" | awk '{print $1}')" = "$EXPECTED_SHA" ] || fail "APK checksum mismatch. Do not install it; rerun setup to download a verified copy."
  say "App download verified."
fi
[ "$PREPARE_ONLY" = 0 ] || { say "Ready. Run without --prepare-only when the Portal is connected."; exit 0; }
"$ADB" start-server >/dev/null

device() { "$ADB" -s "$SERIAL" "$@"; }
remote() { device shell "$@" | tr -d '\r'; }
home_activity() {
  remote cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME | tail -n 1
}
valid_component() { [[ "$1" =~ ^[A-Za-z0-9_.]+/[A-Za-z0-9_.$]+$ ]] && [[ "$1" != *ResolverActivity* ]]; }
select_device() {
  local inventory line state serial index
  local candidates=()
  while :; do
    inventory=$("$ADB" devices -l)
    say "$inventory"
    candidates=()
    while IFS= read -r line; do
      serial=$(printf '%s\n' "$line" | awk '{print $1}')
      state=$(printf '%s\n' "$line" | awk '{print $2}')
      [ "$state" = device ] || continue
      if [ -n "$REQUESTED_SERIAL" ]; then
        [ "$serial" = "$REQUESTED_SERIAL" ] && candidates+=("$serial")
      elif [[ "$serial" != *:* && "$serial" != emulator-* ]]; then candidates+=("$serial")
      fi
    done <<< "$inventory"
    if [ "${#candidates[@]}" = 1 ]; then SERIAL=${candidates[0]}; return; fi
    if [ "$INTERACTIVE" = 0 ]; then fail "Selected Portal is unavailable or unauthorized. Enable ADB and accept the USB debugging prompt on its screen."; fi
    if [ "${#candidates[@]}" -gt 1 ]; then
      say "More than one USB device is connected. Select the Portal to set up:"
      index=1
      for serial in "${candidates[@]}"; do say "  $index) $serial"; index=$((index + 1)); done
      ask "Device number (or unplug the others and press Enter):"
      if [[ "$REPLY" =~ ^[0-9]+$ ]] && [ "${#REPLY}" -lt 4 ]; then
        index=$((10#$REPLY))
        if [ "$index" -ge 1 ] && [ "$index" -le "${#candidates[@]}" ]; then SERIAL=${candidates[$((index - 1))]}; return; fi
      fi
    else
      say "No authorized USB Portal found."
      say "On the Portal: finish its normal first-run setup, connect Wi-Fi, then enable ADB under Settings → Debug."
      say "Connect a USB DATA cable (a charging-only cable will not work). Accept 'Allow USB debugging' on the Portal; allow this computer."
      say "If it says unauthorized, unlock the Portal and accept its prompt. If offline, reconnect the cable. Try another cable/port if no device appears."
      say "Wi-Fi ADB devices are ignored unless selected explicitly with --serial."
      ask "Press Enter to check again, or type q to quit."
      [ "$REPLY" != q ] || exit 0
    fi
  done
}
status_field() { printf '%s\n' "$1" | sed -n "s/.*;$2=\([^;]*\);.*/\1/p"; }
setup_status() {
  local result
  result=$(device shell am broadcast --user 0 -a dev.sparkade.kiosk.SETUP_STATUS -n "$STATUS" 2>&1) || return 1
  [[ "$result" == *SPARKADE_SETUP_V1* ]] || return 1
  printf '%s\n' "$result"
}

while :; do
  say "Connect one powered-on Portal to this Mac with a USB data cable."
  select_device
  MODEL=$(remote getprop ro.product.model)
  SDK=$(remote getprop ro.build.version.sdk)
  HARDWARE_SERIAL=$(remote getprop ro.serialno)
  [[ "$MODEL" == *Portal* ]] || fail "Selected device '$MODEL' is not identified as a Meta Portal. Nothing was installed."
  [[ "$SDK" =~ ^[0-9]+$ ]] && [ "$SDK" -ge 28 ] || fail "Sparkade requires Android 9 / API 28 or later."
  [[ "$HARDWARE_SERIAL" =~ ^[A-Za-z0-9_-]{4,80}$ ]] || fail "Cannot read a stable hardware serial. Reconnect USB and retry."
  DEVICE_DIR="$WORK_DIR/devices/$HARDWARE_SERIAL"
  mkdir -p "$DEVICE_DIR"
  say "Selected $MODEL · serial $HARDWARE_SERIAL · Android API $SDK"
  if [ "$RESTORE" = 1 ]; then
    [ -f "$DEVICE_DIR/previous-home.txt" ] || fail "No launcher backup for this Portal on this Mac. Ask the original installer operator for its setup record."
    PREVIOUS_HOME=$(cat "$DEVICE_DIR/previous-home.txt")
    valid_component "$PREVIOUS_HOME" || fail "Invalid saved launcher."
    remote cmd package set-home-activity --user 0 "$PREVIOUS_HOME"
    [ "$(home_activity)" = "$PREVIOUS_HOME" ] || fail "Android did not restore the saved launcher."
    remote am start -a android.intent.action.MAIN -c android.intent.category.HOME
    say "Previous launcher restored. Sparkade registration and games are retained; retired Wondry remains disabled."
    exit 0
  fi
  if [ "$INTERACTIVE" = 1 ]; then confirm "Install/update Sparkade on this Portal and make it open at power-on?" || exit 0; fi
  FREE_KB=$(remote df -k /data | awk 'END {print $4}')
  [[ "$FREE_KB" =~ ^[0-9]+$ ]] || fail "Could not check Portal storage. Reconnect and retry."
  [ "$FREE_KB" -ge 262144 ] || fail "Less than 256 MB is free on this Portal. Free space in Portal settings, then rerun."
  PREVIOUS_HOME=$(home_activity)
  if [ ! -f "$DEVICE_DIR/previous-home.txt" ] && [[ "$PREVIOUS_HOME" != "$APP/"* ]]; then
    if ! valid_component "$PREVIOUS_HOME" || [[ "$PREVIOUS_HOME" == ai.wondry.portal/* ]]; then
      # An unselected or retired launcher must not become the recovery destination.
      OPTIONS=$(remote cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME |
        awk '/^[A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+$/ && !/^dev.sparkade\./ && !/^ai.wondry.portal\// {print}' | sort -u)
      [ "$(printf '%s\n' "$OPTIONS" | awk 'NF {n++} END {print n+0}')" = 1 ] || fail "Choose the original Portal launcher as default Home in Portal settings, then rerun so setup can save a safe recovery target."
      PREVIOUS_HOME=$OPTIONS
    fi
    printf '%s\n' "$PREVIOUS_HOME" > "$DEVICE_DIR/previous-home.txt"
  fi
  {
    printf 'model=%s\nhardware_serial=%s\nandroid_api=%s\nrelease=%s\napk_sha256=%s\n' "$MODEL" "$HARDWARE_SERIAL" "$SDK" "$RELEASE" "$EXPECTED_SHA"
    printf 'checked_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    remote dumpsys webviewupdate
  } > "$DEVICE_DIR/device-info.txt"
  say "Installing the verified app. Existing Sparkade data and registration are kept."
  if ! device install -r "$APK" > "$TEMP_DIR/install.log" 2>&1; then
    cat "$TEMP_DIR/install.log"
    fail "Android rejected the update. For a signature mismatch or newer installed version, obtain the correct signed release; do NOT uninstall or clear data. For disconnects/storage errors, fix the reported issue and rerun."
  fi
  INSTALLED=$(remote dumpsys package "$APP")
  [[ "$INSTALLED" == *"versionName=$VERSION"* ]] || fail "Installed version did not match $VERSION."
  if printf '%s\n' "$INSTALLED" | awk '/flags=\[/ && /DEBUGGABLE/ {found=1} END {exit !found}'; then
    fail "This is a debug APK. Obtain a signed release before office deployment."
  fi
  remote pm grant "$APP" android.permission.CAMERA
  remote pm grant "$APP" android.permission.RECORD_AUDIO
  # Permit Sparkade's signed self-updates; Android still confirms each installation.
  remote appops set "$APP" REQUEST_INSTALL_PACKAGES allow
  if remote pm list packages -e ai.wondry.portal | awk '/^package:ai.wondry.portal$/ {found=1} END {exit !found}'; then
    if [ "$DISABLE_WONDRY" = 1 ] || confirm "Retired Wondry is installed and may take over at boot. Disable it while keeping its data?"; then
      remote am force-stop ai.wondry.portal
      remote pm disable-user --user 0 ai.wondry.portal
      say "Wondry disabled; data retained."
    else fail "Wondry can compete at boot. Resolve that startup conflict, then rerun (or use --disable-wondry)."
    fi
  fi
  remote cmd package set-home-activity --user 0 "$MAIN"
  [ "$(home_activity)" = "$MAIN" ] || fail "Android did not make Sparkade the default Home."
  # Stop the retired bench wrapper if installed; never touch unrelated applications.
  remote am force-stop dev.sparkade.portal >/dev/null 2>&1 || true
  remote am start -S -n "$SETUP"
  say "Requesting this Portal's production registration status…"
  LAST_CODE=
  REGISTERED=0
  CHECKS=0
  while [ "$CHECKS" -lt 240 ]; do
    CHECKS=$((CHECKS + 1))
    RESULT=$(setup_status) || RESULT=
    STATE=$(status_field "$RESULT" state)
    CODE=$(status_field "$RESULT" code)
    if [ "$STATE" = registered ]; then REGISTERED=1; break; fi
    if [ "$STATE" = pairing ] && [[ "$CODE" =~ ^[A-Z0-9]{4}-[A-Z0-9]{4}$ ]]; then
      if [ "$CODE" != "$LAST_CODE" ]; then
        say ""
        say "Registration code for $HARDWARE_SERIAL: $CODE"
        say "Open $ADMIN, sign in, enter this code, name the kiosk (for example 'NYC Portal 01'), and choose game visibility."
        say "This is a short-lived pairing code, not a model API key. Leave the Portal connected until setup confirms registration."
        if [ -z "$LAST_CODE" ] && [ "$INTERACTIVE" = 1 ]; then open "$ADMIN" || true; fi
        LAST_CODE=$CODE
      fi
      [ "$INTERACTIVE" = 1 ] || break
    elif [ "$STATE" = revoked ]; then
      fail "This registration was revoked. Contact the kiosk administrator; setup will not silently replace its identity."
    elif [ "$STATE" = unsupported ]; then
      fail "This Portal's WebView needs updating before Sparkade can run. Update Portal software, then rerun."
    elif [ "$STATE" = error ] || { [ -z "$STATE" ] && [ "$CHECKS" -ge 12 ]; }; then
      say "Check the setup screen on the Portal. Connect its Wi-Fi using the on-screen button, then tap Retry connection."
      [ "$INTERACTIVE" = 1 ] || break
      ask "Press Enter after fixing the connection, or q to finish registration later."
      [ "$REPLY" != q ] || break
      if [ -z "$STATE" ]; then remote am start -n "$SETUP"; fi
    fi
    sleep 5
  done
  if [ "$REGISTERED" != 1 ]; then
    printf 'registration=pending\n' > "$DEVICE_DIR/result.txt"
    say "Sparkade is installed, but production registration is NOT confirmed. Finish on the Portal's setup screen or rerun this installer."
    exit 2
  fi
  printf 'registration=registered\nconfirmed_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DEVICE_DIR/result.txt"
  say "Production registration confirmed for $HARDWARE_SERIAL."
  remote am start -n "$MAIN"
  say "Disconnect the Mac and connect the controller. Allow USB access and follow the controller-mapping screen."
  say "Before placement: test a starter game, camera, and voice; power the Portal off/on and confirm Sparkade returns without this Mac."
  say "Setup record and launcher recovery: $DEVICE_DIR"
  say "To restore its previous launcher later: run this installer with --restore-home."
  [ "$INTERACTIVE" = 1 ] && [ -z "$REQUESTED_SERIAL" ] || break
  confirm "Set up another Portal? Unplug this one first." || break
done
say "Setup complete."
