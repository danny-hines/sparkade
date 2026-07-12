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

# --- 1. verify hardware & OS -------------------------------------------------
log "Checking hardware and OS"
if [ "$FORCE" -ne 1 ]; then
  grep -qi 'raspberry pi' /proc/device-tree/model 2>/dev/null \
    || fail "This doesn't look like a Raspberry Pi. Re-run with --force for other Debian ARM boxes."
fi
. /etc/os-release
case "${VERSION_CODENAME:-}" in
  bookworm) ;;
  *) [ "$FORCE" -eq 1 ] || fail "Raspberry Pi OS Bookworm required (found: ${VERSION_CODENAME:-unknown})." ;;
esac
ARCH="$(dpkg --print-architecture)"
if [ "$ARCH" != "arm64" ] && [ "$FORCE" -ne 1 ]; then
  fail "64-bit OS required — this image is '$ARCH'. Flash Raspberry Pi OS Lite (64-bit) and retry."
fi

SUDO=sudo
[ "$(id -u)" = "0" ] && SUDO=""

# --- 2. apt packages ----------------------------------------------------------
log "Installing packages (git, X, openbox, chromium, alsa, ffmpeg)"
$SUDO apt-get update -qq
# chromium vs chromium-browser package-name split:
CHROMIUM_PKG=chromium
apt-cache show chromium >/dev/null 2>&1 || CHROMIUM_PKG=chromium-browser
$SUDO apt-get install -y --no-install-recommends \
  git curl ca-certificates xserver-xorg xinit openbox unclutter \
  "$CHROMIUM_PKG" alsa-utils ffmpeg
# NetworkManager ships with Bookworm — verify, don't install.
systemctl is-active --quiet NetworkManager \
  || echo "WARNING: NetworkManager is not active; WiFi settings in the UI won't work until it is."

# --- 3. Node 20 (NodeSource arm64) ---------------------------------------------
if ! command -v node >/dev/null 2>&1 || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 20 ]; then
  log "Installing Node.js 20 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
  $SUDO apt-get install -y nodejs
else
  log "Node $(node --version) already present"
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
sudo -u "$RUN_USER" npm ci --no-audit --no-fund
log "Building"
sudo -u "$RUN_USER" npm run build

# --- 6. env file (0600) ------------------------------------------------------------
log "Setting up /etc/sparkade/env"
$SUDO mkdir -p /etc/sparkade
if [ ! -f /etc/sparkade/env ]; then
  $SUDO touch /etc/sparkade/env
  $SUDO chmod 0600 /etc/sparkade/env
  $SUDO chown "$RUN_USER":"$RUN_USER" /etc/sparkade/env
fi
if ! grep -q '^META_API_KEY=' /etc/sparkade/env 2>/dev/null; then
  if [ -t 0 ]; then
    printf 'Enter your Meta Model API key (blank to skip — demo mode still works): '
    read -r API_KEY || API_KEY=""
    if [ -n "$API_KEY" ]; then
      echo "META_API_KEY=$API_KEY" | $SUDO tee -a /etc/sparkade/env >/dev/null
      echo "key saved."
    fi
  else
    echo "No TTY — set the key later with: sparkade config set-key META_API_KEY <key>"
  fi
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
install -m 0755 "$INSTALL_DIR/install/kiosk/launch.sh" "$RUN_HOME/.sparkade-kiosk-launch.sh"
install -m 0644 "$INSTALL_DIR/install/kiosk/xinitrc" "$RUN_HOME/.xinitrc"
mkdir -p "$RUN_HOME/.config/openbox"
install -m 0755 "$INSTALL_DIR/install/kiosk/openbox-autostart" "$RUN_HOME/.config/openbox/autostart"
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

if [ -t 0 ]; then
  printf 'Reboot now? [y/N] '
  read -r REBOOT || REBOOT=n
  case "$REBOOT" in y|Y) $SUDO reboot ;; esac
fi
