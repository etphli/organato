#!/usr/bin/env bash
set -euo pipefail

profile="${1:-}"
slot="${2:-}"
[[ "$profile" =~ ^[a-z][a-z0-9]{0,11}$ && "$slot" =~ ^[1-8]$ ]] || {
  echo "Usage: sudo bash setup-profile.sh NAME SLOT (lowercase name, slot 1-8)" >&2
  exit 1
}
install_dir=/opt/organato-canvas-connector
service_user="organato-$profile"
state_dir="/var/lib/organato-canvas-profile-$profile"
env_file="/etc/organato-canvas-profile-$profile.env"
unit="organato-canvas-profile-$profile"
display=$((99 + slot))
port=$((5900 + slot))
template_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../systemd" && pwd)"
render_unit() {
  local component="$1"
  sed \
    -e "s/organato-canvas-$component.service/$unit-$component.service/g" \
    -e "s/organato-canvas-xvfb.service/$unit-xvfb.service/g" \
    -e "s/organato-canvas-x11vnc.service/$unit-x11vnc.service/g" \
    -e "s|User=organato-canvas|User=$service_user|g" \
    -e "s|Group=organato-canvas|Group=$service_user|g" \
    -e "s|/var/lib/organato-canvas-connector|$state_dir|g" \
    -e "s|/etc/organato-canvas-connector.env|$env_file|g" \
    -e "s/:99/:$display/g" \
    -e "s/-rfbport 5900/-rfbport $port/g" \
    "$template_dir/organato-canvas-$component.service"
}
if [[ "${3:-}" == "--print" ]]; then
  for component in xvfb x11vnc connector; do render_unit "$component"; done
  exit 0
fi
[[ "$(id -u)" -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
if [[ "${3:-}" == "--refresh" ]]; then
  [[ -f "$env_file" && -d "$state_dir" ]] || { echo "Profile missing." >&2; exit 1; }
  for component in xvfb x11vnc connector; do
    render_unit "$component" > "/etc/systemd/system/$unit-$component.service"
  done
  exit 0
fi
[[ -f "$install_dir/systemd/organato-canvas-connector.service" ]] || {
  echo "Upgrade the base connector first." >&2; exit 1;
}
if [[ -e "$env_file" || -e "$state_dir" ]] || id "$service_user" >/dev/null 2>&1; then
  echo "This profile already exists. Choose a new name; existing profiles are preserved." >&2
  exit 1
fi
for existing in /etc/organato-canvas-profile-*.env; do
  [[ -f "$existing" ]] || continue
  if grep -qx "DISPLAY=:$display" "$existing"; then
    echo "Slot $slot is already assigned. Choose another slot." >&2; exit 1
  fi
done
[[ ! -e "/tmp/.X$display-lock" ]] || { echo "Display $display is already in use." >&2; exit 1; }
if ss -ltnH "sport = :$port" | grep -q .; then
  echo "Port $port is already in use." >&2; exit 1
fi
chromium_path="$(command -v chromium || command -v chromium-browser)"
useradd --system --user-group --home-dir "$state_dir" --create-home --shell /usr/sbin/nologin "$service_user"
chmod 0700 "$state_dir"
auth_cookie="$(mcookie)"
printf 'add :%s . %s\n' "$display" "$auth_cookie" | xauth -f "$state_dir/Xauthority" source -
chown "$service_user:$service_user" "$state_dir/Xauthority"
chmod 0600 "$state_dir/Xauthority"
cat > "$env_file" <<ENV
ORGANATO_API_BASE=https://organato.etphli.workers.dev
ORGANATO_STATE_DIR=$state_dir
DISPLAY=:$display
ORGANATO_VNC_PORT=$port
CHROMIUM_EXECUTABLE_PATH=$chromium_path
CANVAS_SSO_ALLOWLIST=
ENV
chown root:"$service_user" "$env_file"
chmod 0640 "$env_file"
for component in xvfb x11vnc connector; do
  render_unit "$component" > "/etc/systemd/system/$unit-$component.service"
done
systemctl daemon-reload
echo "In your friend's Organato account, open Canvas settings and create a pairing code."
if sudo -u "$service_user" env ORGANATO_STATE_DIR="$state_dir" /usr/local/bin/node "$install_dir/bin/pair.mjs"; then
  systemctl enable --now "$unit-xvfb.service" "$unit-x11vnc.service" "$unit-connector.service"
  echo "Profile $profile is running. Your friend can sign in from their own Organato account."
else
  echo "Profile created, but pairing did not complete. Retry with:"
  echo "sudo -u $service_user env ORGANATO_STATE_DIR=$state_dir /usr/local/bin/node $install_dir/bin/pair.mjs"
  echo "Then: sudo systemctl enable --now $unit-xvfb $unit-x11vnc $unit-connector"
  exit 1
fi
