#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this setup script with sudo." >&2
  exit 1
fi

env_file="/etc/organato-canvas-connector.env"
state_dir="/var/lib/organato-canvas-connector"
install_dir="/opt/organato-canvas-connector"
service_user="organato-canvas"
service_group="organato-canvas"
[[ -f "$env_file" ]] || {
  echo "Run install-systemd.sh first." >&2
  exit 1
}

for binary in /usr/local/bin/node /usr/local/bin/npm Xvfb x11vnc; do
  command -v "$binary" >/dev/null 2>&1 || {
    echo "Missing required command: $binary" >&2
    exit 1
  }
done
if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
  echo "Missing required command: chromium." >&2
  exit 1
fi
chromium_path="$(command -v chromium || command -v chromium-browser)"

node_major="$(/usr/local/bin/node --version | sed -E 's/^v([0-9]+).*$/\1/')"
if [[ "$node_major" -lt 22 || "$node_major" -ge 25 ]]; then
  echo "Node.js 22, 23, or 24 is required; found $(/usr/local/bin/node --version)." >&2
  exit 1
fi

read -r -p "Organato API base [https://organato.etphli.workers.dev]: " api_base
api_base="${api_base:-https://organato.etphli.workers.dev}"
read -r -p "Additional exact HTTPS SSO/resource origins, comma-separated (blank for Emanuel defaults): " sso_allowlist
if [[ "$api_base" == *$'\n'* || "$api_base" == *$'\r'* || "$sso_allowlist" == *$'\n'* || "$sso_allowlist" == *$'\r'* ]]; then
  echo "Settings cannot contain line breaks." >&2
  exit 1
fi

if ! ORGANATO_API_BASE="$api_base" CANVAS_SSO_ALLOWLIST="$sso_allowlist" /usr/local/bin/node --input-type=module -e '
  import { parseSsoAllowlist, validateApiBase } from "/opt/organato-canvas-connector/src/protocol.mjs";
  validateApiBase(process.env.ORGANATO_API_BASE);
  parseSsoAllowlist(process.env.CANVAS_SSO_ALLOWLIST ?? "");
' >/dev/null 2>&1; then
  echo "The API base or SSO allowlist is malformed. Use exact public HTTPS origins." >&2
  exit 1
fi

systemctl stop organato-canvas-connector.service >/dev/null 2>&1 || true
temporary="$(mktemp /etc/organato-canvas-connector.env.XXXXXX)"
trap 'rm -f "$temporary"' EXIT
cat >"$temporary" <<EOF
# Non-secret connector settings. Leave the SSO list blank to use the verified
# Emanuel defaults; add exact comma-separated HTTPS origins when needed.
ORGANATO_API_BASE=$api_base
ORGANATO_STATE_DIR=$state_dir
DISPLAY=:99
CHROMIUM_EXECUTABLE_PATH=$chromium_path
CANVAS_SSO_ALLOWLIST=$sso_allowlist
EOF
chown root:"$service_group" "$temporary"
chmod 0640 "$temporary"
mv -f "$temporary" "$env_file"
trap - EXIT
install -d -o "$service_user" -g "$service_group" -m 0700 "$state_dir"

echo "Saved non-secret settings and stopped the connector. Emanuel's verified SSO/resource origins are included by default."
echo "In Organato, create a Canvas pairing code, then run:"
echo "  sudo -u $service_user env ORGANATO_API_BASE=\"$api_base\" ORGANATO_STATE_DIR=\"$state_dir\" /usr/local/bin/node $install_dir/bin/pair.mjs"
echo "After pairing, start the service with:"
echo "  sudo systemctl enable --now organato-canvas-connector.service"
