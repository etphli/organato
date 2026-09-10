#!/usr/bin/env bash
# Restrict loopback TCP access to an x11vnc port so only the owning service
# user (the VNC relay process) and root can connect. Any other local user or
# process is rejected before the VNC handshake. This provides the UID-level
# isolation that loopback binding alone cannot enforce on a shared Pi.
set -euo pipefail

port="${1:-}"
owner="${2:-}"
[[ "$port" =~ ^[0-9]+$ && "$port" -ge 1 && "$port" -le 65535 ]] || {
  echo "Usage: sudo bash ensure-vnc-firewall.sh PORT SERVICE_USER" >&2
  exit 1
}
[[ -n "$owner" ]] || {
  echo "Usage: sudo bash ensure-vnc-firewall.sh PORT SERVICE_USER" >&2
  exit 1
}
[[ "$(id -u)" -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
command -v iptables >/dev/null 2>&1 || {
  echo "iptables is required to isolate the VNC port." >&2
  exit 1
}

# Allow the relay user and root; reject every other local UID. Rules are
# checked before insertion so re-running the installer is idempotent. The
# owner match applies to locally generated OUTPUT packets, which covers all
# loopback TCP clients.
for uid in "$owner" root; do
  if ! iptables -C OUTPUT -p tcp -d 127.0.0.0/8 --dport "$port" \
      -m owner --uid-owner "$uid" -j ACCEPT 2>/dev/null; then
    iptables -I OUTPUT 1 -p tcp -d 127.0.0.0/8 --dport "$port" \
      -m owner --uid-owner "$uid" -j ACCEPT
  fi
done
if ! iptables -C OUTPUT -p tcp -d 127.0.0.0/8 --dport "$port" -j REJECT \
    2>/dev/null; then
  iptables -A OUTPUT -p tcp -d 127.0.0.0/8 --dport "$port" -j REJECT
fi

if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save >/dev/null 2>&1 || true
elif command -v iptables-save >/dev/null 2>&1; then
  echo "Persist iptables rules with netfilter-persistent so VNC isolation survives reboot." >&2
fi
echo "Loopback port $port is restricted to $owner and root."
