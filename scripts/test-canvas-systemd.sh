#!/usr/bin/env bash
set -euo pipefail

# This installs test services and firewall rules only on a disposable CI runner.
[[ "${CI:-}" == "true" && "$(id -u)" -eq 0 ]] || {
  echo "Run with sudo on a disposable Linux CI runner." >&2
  exit 1
}
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../apps/canvas-connector" && pwd)"
unit=organato-canvas-profile-boottest
state_dir=/var/lib/organato-canvas-profile-boottest
service_user=organato-boottest
units=("$unit-xvfb.service" "$unit-x11vnc.service" "$unit-connector.service")
[[ ! -e "$state_dir" && ! -e "/etc/$unit.env" ]] || exit 1
useradd --system --user-group --home-dir "$state_dir" --create-home "$service_user"
install -d /opt/organato-canvas-connector/scripts /opt/organato-canvas-connector/policies/managed \
  /etc/chromium/policies/managed /etc/chromium-browser/policies/managed
install -m 0755 "$source_dir/scripts/ensure-vnc-firewall.sh" /opt/organato-canvas-connector/scripts/
touch "$state_dir/device-credential.json" "/etc/$unit.env"
printf 'add :107 . %s\n' "$(mcookie)" | xauth -f "$state_dir/Xauthority" source -
chown -R "$service_user:$service_user" "$state_dir"
chmod 0700 "$state_dir"
bash "$source_dir/scripts/setup-profile.sh" boottest 8 --print | awk '
  BEGIN { split("xvfb x11vnc connector", components, " ") }
  /^\[Unit\]$/ { part++; file="/run/systemd/system/organato-canvas-profile-boottest-" components[part] ".service" }
  { print > file }
'
for service in "${units[@]}"; do
  install -d "/run/systemd/system/$service.d"
  printf '[Unit]\nStartLimitBurst=2\n[Service]\nRestartSec=100ms\n' > "/run/systemd/system/$service.d/test.conf"
done
cat >> "/run/systemd/system/$unit-xvfb.service.d/test.conf" <<EOF
ExecStartPre=/usr/bin/test -e $state_dir/start-allowed
EOF
cat >> "/run/systemd/system/$unit-connector.service.d/test.conf" <<'EOF'
ExecStart=
ExecStart=/usr/bin/sleep infinity
EOF
cleanup() {
  systemctl stop "${units[@]}" || true
  systemctl disable --runtime "${units[@]}" || true
  for service in "${units[@]}"; do
    rm -f "/run/systemd/system/$service"
    rm -rf "/run/systemd/system/$service.d"
  done
  systemctl daemon-reload
}
trap cleanup EXIT
systemctl daemon-reload
systemd-analyze verify "${units[@]}"
systemctl enable --runtime "${units[@]}"
for service in "${units[@]}"; do systemctl is-enabled --quiet "$service"; done

wait_for() {
  for ((attempt=0; attempt<150; attempt++)); do
    if "$@"; then return 0; fi
    sleep 0.1
  done
  systemctl --no-pager --full status "${units[@]}" || true
  journalctl --no-pager -n 60 -u "$unit-xvfb" -u "$unit-x11vnc" -u "$unit-connector"
  echo "Timed out: $*" >&2
  return 1
}
restarted_often() {
  [[ "$(systemctl show "$unit-xvfb" -p NRestarts --value)" -ge 8 &&
     "$(systemctl show "$unit-x11vnc" -p NRestarts --value)" -ge 8 ]]
}
all_active() {
  for service in "${units[@]}"; do
    systemctl is-active --quiet "$service" || return 1
  done
}
new_pid() {
  local pid
  pid="$(systemctl show "$1" -p MainPID --value)"
  [[ "$pid" -ne 0 && "$pid" -ne "$2" ]]
}
vnc_ready() {
  python3 - <<'PY'
import socket
try:
    with socket.create_connection(("127.0.0.1", 5908), timeout=0.2) as connection:
        assert connection.recv(12).startswith(b"RFB ")
except (OSError, AssertionError):
    raise SystemExit(1)
PY
}

# Pull in the whole display stack through the connector, as happens at boot.
rm "$state_dir/device-credential.json"
systemctl start "$unit-connector"
[[ "$(systemctl show "$unit-connector" -p ActiveState --value)" == "inactive" ]]
touch "$state_dir/device-credential.json"
systemctl start "$unit-connector"
wait_for restarted_often
systemctl is-active --quiet "$unit-connector"
connector_pid="$(systemctl show "$unit-connector" -p MainPID --value)"
touch "$state_dir/start-allowed"
wait_for all_active
wait_for vnc_ready
iptables -C OUTPUT -p tcp -d 127.0.0.0/8 --dport 5908 -m owner --uid-owner "$service_user" -j ACCEPT
iptables -C OUTPUT -p tcp -d 127.0.0.0/8 --dport 5908 -j REJECT
if runuser -u nobody -- python3 -c 'import socket; socket.create_connection(("127.0.0.1", 5908), timeout=1)' 2>/dev/null; then
  echo "An unrelated local user could access the VNC port." >&2
  exit 1
fi

# A display crash must recover without stopping the connector's polling.
display_pid="$(systemctl show "$unit-xvfb" -p MainPID --value)"
systemctl kill --signal=SIGKILL "$unit-xvfb"
wait_for new_pid "$unit-xvfb" "$display_pid"
wait_for vnc_ready
[[ "$(systemctl show "$unit-connector" -p MainPID --value)" == "$connector_pid" ]]

# Recreate lost firewall rules before a fresh VNC listener starts.
systemctl stop "$unit-x11vnc"
for owner in "$service_user" root; do
  iptables -D OUTPUT -p tcp -d 127.0.0.0/8 --dport 5908 -m owner --uid-owner "$owner" -j ACCEPT
done
iptables -D OUTPUT -p tcp -d 127.0.0.0/8 --dport 5908 -j REJECT
systemctl start "$unit-x11vnc"
wait_for vnc_ready
iptables -C OUTPUT -p tcp -d 127.0.0.0/8 --dport 5908 -j REJECT

systemctl kill --signal=SIGKILL "$unit-connector"
wait_for new_pid "$unit-connector" "$connector_pid"
# A clean exit, including device revocation, must stay stopped.
systemctl kill --signal=SIGTERM "$unit-connector"
sleep 0.5
[[ "$(systemctl show "$unit-connector" -p ActiveState --value)" == "inactive" ]]
echo "PASS: boot enablement, unpaired skip, prolonged display failure, crash recovery, VNC isolation/restoration, and clean connector exit."
