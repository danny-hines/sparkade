#!/usr/bin/env bash
# Sparkade one-shot installer for Raspberry Pi OS Lite (Bookworm, 64-bit).
#   curl -fsSL https://raw.githubusercontent.com/danny-hines/sparkade/main/install/install.sh | bash
# Idempotent: safe to re-run. Override the repo with SPARKADE_REPO=owner/repo.
# --force allows other Debian ARM boxes.
set -euo pipefail

REPO_SLUG="${SPARKADE_REPO:-danny-hines/sparkade}"
INSTALL_DIR=/opt/sparkade
RUN_USER="${SUDO_USER:-$(whoami)}"
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
DATA_DIR="$RUN_HOME/.sparkade"
FORCE=0
for arg in "$@"; do [ "$arg" = "--force" ] && FORCE=1; done

log()  { printf '\n\033[1;36m» %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }

# Prompt on the controlling terminal even when the script is piped: `curl | bash`
# makes stdin the pipe (so `[ -t 0 ]` is false and `read` would eat script text),
# but /dev/tty is still the real terminal. Empty result when truly headless.
have_tty() { [ -r /dev/tty ] && [ -w /dev/tty ]; }
ask() { # ask "<prompt>" <varname> [default]
  local __ans=""
  if have_tty; then
    printf '%s' "$1" > /dev/tty
    IFS= read -r __ans < /dev/tty || __ans=""
  fi
  [ -z "$__ans" ] && __ans="${3:-}"
  printf -v "$2" '%s' "$__ans"
}

# --- 1. verify hardware & OS -------------------------------------------------
log "Checking hardware and OS"
if [ "$FORCE" -ne 1 ]; then
  grep -qi 'raspberry pi' /proc/device-tree/model 2>/dev/null \
    || fail "This doesn't look like a Raspberry Pi. Re-run with --force for other Debian ARM boxes."
fi
. /etc/os-release
case "${VERSION_CODENAME:-}" in
  bookworm|trixie) ;;
  *) [ "$FORCE" -eq 1 ] || fail "Raspberry Pi OS Bookworm or Trixie required (found: ${VERSION_CODENAME:-unknown}). Re-run with --force to try anyway." ;;
esac
ARCH="$(dpkg --print-architecture)"
if [ "$ARCH" != "arm64" ] && [ "$FORCE" -ne 1 ]; then
  fail "64-bit OS required — this image is '$ARCH'. Flash Raspberry Pi OS Lite (64-bit) and retry."
fi

SUDO=sudo
[ "$(id -u)" = "0" ] && SUDO=""

# --- 2. apt packages ----------------------------------------------------------
log "Installing packages (git, X, openbox, chromium, pipewire, ffmpeg)"
$SUDO apt-get update -qq
# chromium vs chromium-browser package-name split:
CHROMIUM_PKG=chromium
apt-cache show chromium >/dev/null 2>&1 || CHROMIUM_PKG=chromium-browser
# x11-xserver-utils provides `xset` (used to disable screen blanking); without
# it the kiosk's blanking-disable silently no-ops and the display sleeps.
# pipewire + pipewire-pulse + wireplumber: Chromium enumerates the MIC only via a
# PulseAudio-compatible server (never raw ALSA), so without these the Camera & Mic
# picker shows no microphone even though `arecord` sees it. dbus-user-session gives
# the autologin session a user D-Bus bus so those user services actually start on a
# minimal (no-desktop) image.
$SUDO apt-get install -y --no-install-recommends \
  git curl ca-certificates xserver-xorg xinit openbox unclutter x11-xserver-utils \
  pipewire pipewire-pulse wireplumber pipewire-alsa dbus-user-session \
  "$CHROMIUM_PKG" alsa-utils ffmpeg
# NetworkManager ships with Bookworm — verify, don't install.
systemctl is-active --quiet NetworkManager \
  || echo "WARNING: NetworkManager is not active; WiFi settings in the UI won't work until it is."

# --- 3. Node with built-in node:sqlite (NodeSource 24 LTS, distro fallback) ---
# We use Node's built-in node:sqlite instead of a compiled better-sqlite3 — so
# there's no native build step. It must be available WITHOUT a flag, which means
# Node >= 22.13 / 24. Feature-detect rather than parse versions.
node_ok() { command -v node >/dev/null 2>&1 && node -e 'require("node:sqlite")' >/dev/null 2>&1; }
if ! node_ok; then
  log "Installing Node.js 24 (built-in node:sqlite)"
  if ! { curl -fsSL https://deb.nodesource.com/setup_24.x | $SUDO bash - && $SUDO apt-get install -y nodejs; }; then
    log "NodeSource unavailable for this release — falling back to the distro nodejs package"
    $SUDO apt-get install -y nodejs npm || true
  fi
  node_ok || fail "Could not install a Node with built-in node:sqlite (need >= 24). Install it manually (e.g. 'sudo apt-get install nodejs npm') and re-run."
else
  log "Node $(node --version) already present (node:sqlite available)"
fi

# --- 4. temporarily raise swap for the build (Vite on 1 GB RAM) ----------------
SWAP_RESTORE=""
if [ -f /etc/dphys-swapfile ]; then
  CURRENT_SWAP="$(grep -oP '^CONF_SWAPSIZE=\K[0-9]+' /etc/dphys-swapfile || echo 100)"
  if [ "$CURRENT_SWAP" -lt 1024 ]; then
    log "Raising swap to 1024 MB for the build (will restore to ${CURRENT_SWAP} MB)"
    SWAP_RESTORE="$CURRENT_SWAP"
    $SUDO sed -i "s/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=1024/" /etc/dphys-swapfile
    $SUDO systemctl restart dphys-swapfile || { $SUDO dphys-swapfile setup && $SUDO dphys-swapfile swapon; }
  fi
fi
restore_swap() {
  if [ -n "$SWAP_RESTORE" ]; then
    log "Restoring swap to ${SWAP_RESTORE} MB"
    $SUDO sed -i "s/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=${SWAP_RESTORE}/" /etc/dphys-swapfile
    $SUDO systemctl restart dphys-swapfile || true
  fi
}
trap restore_swap EXIT

# --- 5. clone / pull + build -----------------------------------------------------
log "Fetching Sparkade into $INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  $SUDO git -C "$INSTALL_DIR" fetch --tags --force
  $SUDO git -C "$INSTALL_DIR" pull --ff-only || true
else
  $SUDO git clone "https://github.com/${REPO_SLUG}.git" "$INSTALL_DIR"
fi
$SUDO chown -R "$RUN_USER":"$RUN_USER" "$INSTALL_DIR"

log "npm ci (this takes a while on a Pi 3)"
cd "$INSTALL_DIR"
# Skip the Playwright browser download — it's a dev-only e2e dep (~hundreds of MB)
# that the cabinet never runs, and downloading it on the Pi's network is the
# slowest part of the install.
sudo -u "$RUN_USER" env PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
log "Building"
sudo -u "$RUN_USER" npm run build

# --- 6. env file (0600) + provider / API key ---------------------------------------
log "Provider & API key"
$SUDO mkdir -p /etc/sparkade
[ -f /etc/sparkade/env ] || $SUDO touch /etc/sparkade/env
$SUDO chmod 0600 /etc/sparkade/env
$SUDO chown "$RUN_USER":"$RUN_USER" /etc/sparkade/env

env_set() { # env_set VAR VALUE — idempotent upsert into /etc/sparkade/env (0600)
  $SUDO sed -i "/^$1=/d" /etc/sparkade/env 2>/dev/null || true
  printf '%s=%s\n' "$1" "$2" | $SUDO tee -a /etc/sparkade/env >/dev/null
}

# The provider is applied to config.json AFTER the server first boots (step 9b),
# since the config doesn't exist yet. "meta"/"skip" ⇒ no repointing needed.
APPLY_PROVIDER=meta APPLY_MODEL="" APPLY_BASEURL=""

if have_tty; then
  cat > /dev/tty <<'MENU'

Which AI service should generate games?
  1) Meta Model API      (recommended — voice prompts, photo likeness, structured output)
  2) Anthropic (Claude)  (text + photo; voice transcription still needs a Meta key)
  3) OpenAI-compatible   (your own server — you supply the base URL + model)
  4) Skip for now        (demo mode: the 3 preinstalled games; add a key later)
MENU
  ask "Choice [1]: " CHOICE 1
  case "$CHOICE" in
    2) APPLY_PROVIDER=anthropic ;;
    3) APPLY_PROVIDER=compat ;;
    4) APPLY_PROVIDER=skip ;;
    *) APPLY_PROVIDER=meta ;;
  esac

  case "$APPLY_PROVIDER" in
    meta)
      ask "Meta Model API key (blank to skip — demo still works): " K
      [ -n "$K" ] && { env_set META_API_KEY "$K"; echo "key saved." > /dev/tty; }
      ;;
    anthropic)
      ask "Anthropic API key: " K
      [ -n "$K" ] && env_set ANTHROPIC_API_KEY "$K"
      ask "Model [claude-haiku-4-5-20251001]: " APPLY_MODEL claude-haiku-4-5-20251001
      ask "Add a Meta key too, for VOICE prompts? (blank = presets only): " MK
      [ -n "$MK" ] && env_set META_API_KEY "$MK"
      ;;
    compat)
      ask "Base URL (e.g. http://192.168.1.50:8000/v1): " APPLY_BASEURL
      ask "API key (blank if the server needs none): " K
      [ -n "$K" ] && env_set COMPAT_API_KEY "$K"
      ask "Model name your server serves: " APPLY_MODEL
      ask "Add a Meta key too, for VOICE prompts? (blank = presets only): " MK
      [ -n "$MK" ] && env_set META_API_KEY "$MK"
      ;;
    skip)
      echo "Demo mode. Add a key later:  sparkade config set-key META_API_KEY <key>" > /dev/tty
      ;;
  esac
else
  log "Non-interactive install — no terminal to prompt on"
  echo "Configure after boot:"
  echo "  sparkade config set-key META_API_KEY <key>"
  echo "  sparkade config set-provider meta|anthropic|compat [model] [baseUrl]"
fi

# --- 7. systemd service ---------------------------------------------------------------
log "Installing systemd service"
$SUDO sed "s|@USER@|$RUN_USER|g; s|@DATA@|$DATA_DIR|g" "$INSTALL_DIR/install/sparkade.service" \
  | $SUDO tee /etc/systemd/system/sparkade.service >/dev/null
$SUDO systemctl daemon-reload
$SUDO systemctl enable sparkade
$SUDO systemctl restart sparkade

# --- 8. kiosk boot ---------------------------------------------------------------------
log "Configuring kiosk boot (console autologin → startx → openbox → chromium)"
$SUDO raspi-config nonint do_boot_behaviour B2 || echo "raspi-config unavailable — enable console autologin manually"
# USB camera/mic device access: Chromium runs as the kiosk user, which must be in
# the `video` group to open /dev/video* and `audio` for the sound devices.
$SUDO usermod -aG video,audio "$RUN_USER" 2>/dev/null || echo "could not add $RUN_USER to video/audio groups"
install -m 0755 "$INSTALL_DIR/install/kiosk/launch.sh" "$RUN_HOME/.sparkade-kiosk-launch.sh"
install -m 0644 "$INSTALL_DIR/install/kiosk/xinitrc" "$RUN_HOME/.xinitrc"
mkdir -p "$RUN_HOME/.config/openbox"
install -m 0755 "$INSTALL_DIR/install/kiosk/openbox-autostart" "$RUN_HOME/.config/openbox/autostart"
# Disable display blanking/DPMS at the X-server level (race-free; no xset needed).
$SUDO mkdir -p /etc/X11/xorg.conf.d
$SUDO install -m 0644 "$INSTALL_DIR/install/kiosk/xorg-blanking.conf" /etc/X11/xorg.conf.d/10-sparkade-blanking.conf
$SUDO chown -R "$RUN_USER":"$RUN_USER" "$RUN_HOME/.xinitrc" "$RUN_HOME/.config/openbox" "$RUN_HOME/.sparkade-kiosk-launch.sh"
if ! grep -q 'sparkade kiosk autostart' "$RUN_HOME/.bash_profile" 2>/dev/null; then
  cat >> "$RUN_HOME/.bash_profile" <<'EOF'
# sparkade kiosk autostart
if [ -z "${DISPLAY:-}" ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec startx -- -nocursor
fi
EOF
  $SUDO chown "$RUN_USER":"$RUN_USER" "$RUN_HOME/.bash_profile"
fi

# --- 9. sudoers: exactly the nmcli invocations the WiFi endpoints run + service ctl ----
log "Installing scoped sudoers rule"
$SUDO tee /etc/sudoers.d/sparkade >/dev/null <<EOF
# Sparkade: WiFi management (PSK travels on stdin, never argv) + service control
$RUN_USER ALL=(root) NOPASSWD: /usr/bin/nmcli -t -f SSID\,SIGNAL\,SECURITY\,IN-USE dev wifi list --rescan yes
$RUN_USER ALL=(root) NOPASSWD: /usr/bin/nmcli -t -f ACTIVE\,SSID dev wifi
$RUN_USER ALL=(root) NOPASSWD: /usr/bin/nmcli -t -f IP4.ADDRESS dev show
$RUN_USER ALL=(root) NOPASSWD: /usr/bin/nmcli --ask dev wifi connect *
$RUN_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart sparkade, /usr/bin/systemctl stop sparkade, /usr/bin/systemctl start sparkade
$RUN_USER ALL=(root) NOPASSWD: /usr/bin/raspi-config nonint do_boot_behaviour *
EOF
$SUDO chmod 0440 /etc/sudoers.d/sparkade

# --- 9b. point generation at the chosen provider (config.json exists after boot) --------
if [ "$APPLY_PROVIDER" != "meta" ] && [ "$APPLY_PROVIDER" != "skip" ]; then
  log "Pointing generation at '$APPLY_PROVIDER'"
  for _ in $(seq 1 30); do [ -f "$DATA_DIR/config.json" ] && break; sleep 0.5; done
  if [ -f "$DATA_DIR/config.json" ]; then
    sudo -u "$RUN_USER" env SPARKADE_DATA="$DATA_DIR" \
      node "$INSTALL_DIR/packages/cli/dist/index.js" \
      config set-provider "$APPLY_PROVIDER" "$APPLY_MODEL" "$APPLY_BASEURL" \
      || echo "  couldn't apply — set it later: sparkade config set-provider $APPLY_PROVIDER $APPLY_MODEL $APPLY_BASEURL"
    $SUDO systemctl restart sparkade || true
  else
    echo "  config.json not ready yet — set it later: sparkade config set-provider $APPLY_PROVIDER $APPLY_MODEL $APPLY_BASEURL"
  fi
fi

# --- 10. CLI symlink + first-boot data ---------------------------------------------------
log "Linking the sparkade CLI"
$SUDO ln -sf "$INSTALL_DIR/packages/cli/dist/index.js" /usr/local/bin/sparkade
$SUDO chmod +x "$INSTALL_DIR/packages/cli/dist/index.js"

log "Seeding data dir (golden games appear on first server boot)"
sudo -u "$RUN_USER" mkdir -p "$DATA_DIR"
sleep 2
if curl -fsS --max-time 5 http://127.0.0.1:8080/api/system/info >/dev/null 2>&1; then
  echo "server is up ✓"
else
  echo "server not answering yet — check: sparkade logs"
fi

cat <<EOF

════════════════════════════════════════════════════════════
  Sparkade installed ✓

  service   systemctl status sparkade   ·   sparkade status
  logs      sparkade logs -f
  doctor    sparkade doctor
  api key   sparkade config set-key META_API_KEY <key>
  recover   sparkade restart · sparkade update

  Reboot to enter kiosk mode (attract screen on the 7" display).
════════════════════════════════════════════════════════════
EOF

if have_tty; then
  ask "Reboot now to enter kiosk mode? [y/N] " REBOOT n
  case "$REBOOT" in y|Y) $SUDO reboot ;; esac
fi
