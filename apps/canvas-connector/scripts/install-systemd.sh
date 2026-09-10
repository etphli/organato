#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

source_dir="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source_dir="$(cd "$source_dir" && pwd)"
install_dir="/opt/organato-canvas-connector"
state_dir="/var/lib/organato-canvas-connector"
env_file="/etc/organato-canvas-connector.env"
service_user="organato-canvas"
service_group="organato-canvas"
shopt -s nullglob
profile_units=(/etc/systemd/system/organato-canvas-profile-*-connector.service)

for required in package.json package-lock.json src bin policies systemd scripts/ensure-vnc-firewall.sh; do
  [[ -e "$source_dir/$required" ]] || {
    echo "Source directory is missing $required." >&2
    exit 1
  }
done

if [[ "$(uname -m)" != "aarch64" ]] || [[ "$(dpkg --print-architecture 2>/dev/null || true)" != "arm64" ]]; then
  echo "Raspberry Pi OS 64-bit (arm64/aarch64) is required." >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "A Debian-compatible Raspberry Pi OS installation is required." >&2
  exit 1
fi
# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "raspbian" && "${ID:-}" != "debian" && "${ID_LIKE:-}" != *debian* ]]; then
  echo "A Debian-compatible Raspberry Pi OS installation is required." >&2
  exit 1
fi
command -v apt-get >/dev/null 2>&1 || {
  echo "apt-get is required on Raspberry Pi OS." >&2
  exit 1
}

# Services keep running on the current release until the replacement is fully
# staged and validated below; the swap (with rollback) happens in one place.
export DEBIAN_FRONTEND=noninteractive
apt-get update
browser_package="chromium"
if ! apt-cache show "$browser_package" >/dev/null 2>&1; then
  browser_package="chromium-browser"
fi
apt-cache show "$browser_package" >/dev/null 2>&1 || {
  echo "The configured apt sources do not provide Chromium." >&2
  exit 1
}
apt-get install --no-install-recommends -y ca-certificates curl tar xz-utils "$browser_package" xvfb x11vnc xauth

node_is_supported() {
  local version major
  command -v node >/dev/null 2>&1 || return 1
  version="$(node --version 2>/dev/null || true)"
  [[ "$version" =~ ^v([0-9]+)\. ]] || return 1
  major="${BASH_REMATCH[1]}"
  [[ "$major" -ge 22 && "$major" -lt 25 ]]
}

if ! node_is_supported; then
  node_version="${ORGANATO_NODE_VERSION:-22.23.2}"
  [[ "$node_version" =~ ^22\.[0-9]+\.[0-9]+$ ]] || {
    echo "ORGANATO_NODE_VERSION must be a Node.js 22.x.y release." >&2
    exit 1
  }
  node_root="/usr/local/lib/nodejs/node-v${node_version}-linux-arm64"
  temporary="$(mktemp -d /tmp/organato-node.XXXXXX)"
  trap 'rm -rf "$temporary"' EXIT
  archive="node-v${node_version}-linux-arm64.tar.xz"
  node_url="https://nodejs.org/dist/v${node_version}"
  curl --fail --silent --show-error --location "$node_url/SHASUMS256.txt" \
    --output "$temporary/SHASUMS256.txt"
  curl --fail --silent --show-error --location "$node_url/$archive" \
    --output "$temporary/$archive"
  expected="$(awk -v target="$archive" '$2 == target { print $1; exit }' "$temporary/SHASUMS256.txt")"
  [[ "$expected" =~ ^[[:xdigit:]]{64}$ ]] || {
    echo "Node.js archive checksum was not published for $archive." >&2
    exit 1
  }
  printf '%s  %s\n' "$expected" "$temporary/$archive" | sha256sum --check --status - || {
    echo "Node.js archive checksum verification failed." >&2
    exit 1
  }
  install -d -m 0755 /usr/local/lib/nodejs
  rm -rf "$node_root"
  tar -xJf "$temporary/$archive" -C /usr/local/lib/nodejs
  for executable in node npm npx corepack; do
    if [[ -x "$node_root/bin/$executable" ]]; then
      ln -sfn "$node_root/bin/$executable" "/usr/local/bin/$executable"
    fi
  done
  trap - EXIT
  rm -rf "$temporary"
fi

node_is_supported || {
  echo "Node.js 22, 23, or 24 is required after installation; found $(node --version 2>/dev/null || echo missing)." >&2
  exit 1
}
command -v npm >/dev/null 2>&1 || {
  echo "npm was not installed with the supported Node.js runtime." >&2
  exit 1
}
node_path="$(command -v node)"
npm_path="$(command -v npm)"
npx_path="$(command -v npx 2>/dev/null || true)"
[[ "$node_path" == "/usr/local/bin/node" ]] || ln -sfn "$node_path" /usr/local/bin/node
[[ "$npm_path" == "/usr/local/bin/npm" ]] || ln -sfn "$npm_path" /usr/local/bin/npm
if [[ -n "$npx_path" && "$npx_path" != "/usr/local/bin/npx" ]]; then
  ln -sfn "$npx_path" /usr/local/bin/npx
fi

if ! getent group "$service_group" >/dev/null 2>&1; then
  groupadd --system "$service_group"
fi
if ! id "$service_user" >/dev/null 2>&1; then
  useradd --system --gid "$service_group" --home-dir "$state_dir" --create-home --shell /usr/sbin/nologin "$service_user"
fi
if [[ -L "$state_dir" ]]; then
  echo "$state_dir must not be a symbolic link." >&2
  exit 1
fi
install -d -o "$service_user" -g "$service_group" -m 0700 "$state_dir"

if [[ -L "$install_dir" || ( -e "$install_dir" && ! -d "$install_dir" ) ]]; then
  echo "$install_dir must be a directory, not a symbolic link or file." >&2
  exit 1
fi
if [[ -L "$env_file" ]]; then
  echo "$env_file must not be a symbolic link." >&2
  exit 1
fi
# Stage the replacement release in a separate directory and validate it
# before touching the running installation. Only the swap below stops
# services, and any failure there rolls back to the previous release.
staging_dir="$install_dir.new"
rollback_dir="$install_dir.prev"
rm -rf "$staging_dir"
install -d -m 0755 "$staging_dir"
install -m 0644 "$source_dir/package.json" "$staging_dir/package.json"
install -m 0644 "$source_dir/package-lock.json" "$staging_dir/package-lock.json"
install -d -m 0755 "$staging_dir/src" "$staging_dir/bin"
cp -a "$source_dir/src/." "$staging_dir/src/"
cp -a "$source_dir/bin/." "$staging_dir/bin/"
install -d -m 0755 "$staging_dir/scripts" "$staging_dir/systemd"
cp -a "$source_dir/scripts/." "$staging_dir/scripts/"
cp -a "$source_dir/systemd/." "$staging_dir/systemd/"
cp -a "$source_dir/policies" "$staging_dir/policies"
chmod 0755 "$staging_dir/bin/pair.mjs" "$staging_dir/src/index.mjs"
chown -R root:root "$staging_dir"

if [[ ! -f "$env_file" ]]; then
  install -m 0640 -o root -g "$service_group" /dev/null "$env_file"
  cat >"$env_file" <<'EOF'
# Non-secret connector settings. Leave the SSO list blank to use the verified
# Emanuel defaults; add exact comma-separated HTTPS origins when needed.
ORGANATO_API_BASE=https://organato.etphli.workers.dev
ORGANATO_STATE_DIR=/var/lib/organato-canvas-connector
DISPLAY=:99
CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
CANVAS_SSO_ALLOWLIST=
EOF
  chown root:"$service_group" "$env_file"
  chmod 0640 "$env_file"
fi

# systemd bind-mounts the package policy into the connector's private mount
# namespace. Keep the host policy directories empty and never replace files a
# system administrator may already have installed there.
for policy_destination in /etc/chromium/policies/managed /etc/chromium-browser/policies/managed; do
  if [[ -L "$policy_destination" || ( -e "$policy_destination" && ! -d "$policy_destination" ) ]]; then
    echo "$policy_destination must be a directory, not a symbolic link or file." >&2
    exit 1
  fi
  if [[ ! -e "$policy_destination" ]]; then
    install -d -m 0755 "$policy_destination"
  fi
done

npm ci --prefix "$staging_dir" --omit=dev --ignore-scripts --no-audit --no-fund

# Validate the staged release before it can replace the running one.
node --check "$staging_dir/src/index.mjs"
node --check "$staging_dir/src/service.mjs"
node --check "$staging_dir/src/canvas-browser.mjs"
node --check "$staging_dir/bin/pair.mjs"
[[ -d "$staging_dir/node_modules" ]] || {
  echo "Staged release is missing node_modules; refusing to swap." >&2
  rm -rf "$staging_dir"
  exit 1
}

rollback_needed=0
rollback() {
  if [[ "$rollback_needed" -eq 1 && -d "$rollback_dir" ]]; then
    echo "Install failed; rolling back to the previous release." >&2
    rm -rf "$install_dir"
    mv "$rollback_dir" "$install_dir"
    systemctl daemon-reload || true
    systemctl restart organato-canvas-xvfb.service organato-canvas-x11vnc.service >/dev/null 2>&1 || true
    systemctl restart organato-canvas-connector.service >/dev/null 2>&1 || true
  fi
}
trap rollback ERR

# Atomic swap: stop services, move the current release aside, move the staged
# release into place. The old connector never runs mixed old/new code.
if command -v systemctl >/dev/null 2>&1; then
  for profile_unit in "${profile_units[@]}"; do systemctl stop "$(basename "$profile_unit")"; done
  systemctl stop organato-canvas-connector.service organato-canvas-x11vnc.service organato-canvas-xvfb.service >/dev/null 2>&1 || true
fi
if [[ -e "$install_dir" ]]; then
  rm -rf "$rollback_dir"
  mv "$install_dir" "$rollback_dir"
fi
mv "$staging_dir" "$install_dir"
rollback_needed=1

install -m 0644 "$source_dir/systemd/organato-canvas-xvfb.service" /etc/systemd/system/organato-canvas-xvfb.service
install -m 0644 "$source_dir/systemd/organato-canvas-x11vnc.service" /etc/systemd/system/organato-canvas-x11vnc.service
install -m 0644 "$source_dir/systemd/organato-canvas-connector.service" /etc/systemd/system/organato-canvas-connector.service
auth_file="$state_dir/Xauthority"
if [[ ! -f "$auth_file" ]]; then
  auth_cookie="$(mcookie)"
  printf 'add :99 . %s\n' "$auth_cookie" | xauth -f "$auth_file" source -
  chown "$service_user:$service_group" "$auth_file"
  chmod 0600 "$auth_file"
fi
for profile_unit in "${profile_units[@]}"; do
  profile_name="$(basename "$profile_unit" -connector.service)"
  profile_slug="${profile_name#organato-canvas-profile-}"
  profile_display="$(sed -n 's/^DISPLAY=://p' "/etc/$profile_name.env")"
  [[ "$profile_display" =~ ^10[0-7]$ ]] || { echo "Invalid profile display for $profile_slug." >&2; exit 1; }
  bash "$install_dir/scripts/setup-profile.sh" "$profile_slug" "$((profile_display - 99))" --refresh
done
systemctl daemon-reload
systemctl enable organato-canvas-xvfb.service organato-canvas-x11vnc.service organato-canvas-connector.service
# UID-restrict the loopback VNC port before the bridge starts accepting
# connections. Failure here must not leave the display exposed, so abort.
bash "$source_dir/scripts/ensure-vnc-firewall.sh" 5900 "$service_user"
systemctl restart organato-canvas-xvfb.service organato-canvas-x11vnc.service

for profile_unit in "${profile_units[@]}"; do
  profile_name="$(basename "$profile_unit" -connector.service)"
  if systemctl is-enabled --quiet "$profile_name-connector.service"; then
    systemctl restart "$profile_name-xvfb.service" "$profile_name-x11vnc.service" "$profile_name-connector.service"
  fi
done

# The swap succeeded; the previous release is kept for manual rollback.
rollback_needed=0
trap - ERR

echo "Installed Chromium, Xvfb, x11vnc, Node.js, and the connector package."
echo "Configure $env_file, pair the device, then start organato-canvas-connector.service."
