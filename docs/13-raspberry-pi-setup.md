# Raspberry Pi Canvas connector setup

This guide installs the standalone Organato browser connector on a Raspberry
Pi. It uses a real persistent Chromium profile and a virtual display, so the
school's normal Canvas/Reshet sign-in page works without a Canvas API key. The
Pi makes only outbound HTTPS connections to Organato; port 5900 stays bound to
loopback.

The supported device is Raspberry Pi OS 64-bit (`arm64`/`aarch64`) with a
network connection and a local terminal. The installer checks this before it
changes the device. It installs the Debian packages Chromium, Xvfb, and
x11vnc, installs Node.js 22 from the official nodejs.org archive when a
supported Node.js 22–24 runtime is not already present, and creates the locked
`organato-canvas` service user.

## 1. Download the release

Download the release archive directly on the Pi. Git is not required.

```sh
mkdir -p "$HOME/organato-downloads"
cd "$HOME/organato-downloads"
curl --fail --location \
  https://organato.vercel.app/downloads/organato-canvas-connector.tar.gz \
  --output organato-canvas-connector.tar.gz
curl --fail --location \
  https://organato.vercel.app/downloads/organato-canvas-connector.tar.gz.sha256 \
  --output organato-canvas-connector.tar.gz.sha256
sha256sum --check organato-canvas-connector.tar.gz.sha256
tar --extract --gzip --file organato-canvas-connector.tar.gz
cd "$HOME/organato-downloads/organato-canvas-connector"
```

## 2. Install the connector and display services

Run the installer as root:

```sh
sudo ./scripts/install-systemd.sh
```

The installer stops an existing connector before replacing its executable
files, installs dependencies with the committed `npm ci` lockfile, installs
three package-contained systemd units, and starts Xvfb plus loopback x11vnc.
The connector itself stays stopped until pairing is complete. The installed
paths are:

| Purpose                         | Path                                 |
| ------------------------------- | ------------------------------------ |
| Connector package               | `/opt/organato-canvas-connector`     |
| Non-secret settings             | `/etc/organato-canvas-connector.env` |
| Owned state and browser profile | `/var/lib/organato-canvas-connector` |
| Service user/group              | `organato-canvas`                    |
| Virtual display                 | `:99`                                |

The service user has no login shell. Chromium is launched with its normal
sandbox; the service does not use `--no-sandbox`.

## 3. Configure the API and browser origins

Run:

```sh
sudo ./scripts/setup-device.sh
```

Enter the Organato API origin when prompted, or accept
`https://organato.etphli.workers.dev`. Leave the additional SSO/resource list
blank for the verified Emanuel defaults. The connector allows the Canvas
origin plus these exact HTTPS origins:

- `https://emanuelschool-login.cloudworkengine.net`
- `https://emanuel.files.cloudworkengine.net.au`
- `https://theme.files.cloudworkengine.net.au`
- `https://fonts.googleapis.com`
- `https://fonts.gstatic.com`
- `https://ssl.gstatic.com`

Every configured origin must be HTTPS, have no credentials, query, fragment,
or non-standard port, and resolve to public addresses. The browser rejects
`file:` URLs, private addresses, unlisted origins, Canvas API writes, and
non-authenticated Canvas writes. It permits only the Canvas login/logout
redirect paths and form submissions on the verified SSO origins, so the school
sign-in flow can complete. The importer itself uses GET requests only.

If a verified school SSO page later needs another resource host, add only that
exact HTTPS origin as a comma-separated value when rerunning
`setup-device.sh`. Verify the host belongs to the school or its named identity
provider first. Do not add a wildcard, a parent domain, or a blanket
`cloudfront.net` entry. A changed setting takes effect after the connector is
started again.

## 4. Pair the Pi with Organato

1. Open `https://organato.vercel.app` and sign in.
2. Open Settings → Canvas / Reshet and create a pairing code.
3. On the Pi, run the pairing command printed by `setup-device.sh`, or run:

   ```sh
   sudo -u organato-canvas env \
     ORGANATO_API_BASE=https://organato.etphli.workers.dev \
     ORGANATO_STATE_DIR=/var/lib/organato-canvas-connector \
     /usr/local/bin/node /opt/organato-canvas-connector/bin/pair.mjs
   ```

4. Enter the short-lived code and a device name such as `Organato Pi`.

The code expires after ten minutes and is single-use. Pairing writes the
Bearer credential to
`/var/lib/organato-canvas-connector/device-credential.json` with mode `0600`.
The token is never printed or written to the journal.

## 5. Start and use the service

```sh
sudo systemctl enable --now organato-canvas-connector.service
sudo systemctl status organato-canvas-connector.service
```

In Organato, select **Sign in to Canvas**. The connector polls the Worker
roughly every 15 seconds. The login request opens `/login` in the persistent
Chromium profile. Organato's sign-in view reaches the Pi through an
authenticated outbound WebSocket. Loopback x11vnc accepts the RFB stream, and
the connector carries that stream over the authenticated WebSocket. No inbound
router port or VNC password needs configuration.

The command flow is:

1. `login` → the Pi opens Chromium and reports `login_ready`.
2. Sign in through the Organato view using the school's normal SSO page.
3. Select **I have signed in**.
4. `verify` → the Pi reports the Canvas identity.
5. Select **Confirm this account**.
6. `sync` → the Pi reads the current user, active courses, and upcoming
   assignments, then reports the normalized result.

Transient network failures leave a bounded result in
`pending-result.json`. The next poll retries the same command ID and removes
the file only after the Worker acknowledges it. A stale command is safely
discarded. If the Worker rejects a malformed or oversized result with 400 or
413, the connector replaces it once with the small `read_failed` result and
resumes polling; a repeated permanent rejection is dropped. Network, 429, and
5xx failures retain the pending result for another attempt.

Useful diagnostics contain event names only:

```sh
journalctl -u organato-canvas-connector.service -f
systemctl status organato-canvas-xvfb.service organato-canvas-x11vnc.service
```

The connector does not log Canvas credentials, typed keys, screenshots, or
browser URLs containing authentication query parameters.

Chromium's managed policy for this connector is bind-mounted into its private
systemd service namespace. The installer leaves any existing system-wide
Chromium policy files untouched; the connector policy disables developer tools,
downloads, password saving, autofill, and browser sync.

## 6. Disconnect and erase local state

Use Disconnect in Organato before giving away or retiring the Pi. When the
Worker returns HTTP 410, the connector stops the viewer and browser, removes
only its credential, pending result, and Chromium profile inside the owned
state directory, and then acknowledges erasure with the old in-memory Bearer
token. It clears that token immediately and stops; it never restores access
after revocation. If the acknowledgement cannot reach the Worker, Organato
shows erasure pending and the local connector remains stopped.

## 7. Upgrade an installed connector

Run the following commands on the Pi. The backup contains the device
credential and the Canvas browser session. Keep it private.

```sh
set -eu
mkdir -p "$HOME/organato-downloads"
backup="$HOME/organato-downloads/organato-canvas-state-$(date +%Y%m%d-%H%M%S).tar.gz"

sudo systemctl stop \
  organato-canvas-connector.service \
  organato-canvas-x11vnc.service \
  organato-canvas-xvfb.service
sudo tar --create --gzip \
  --file "$backup" \
  --directory /var/lib \
  organato-canvas-connector
sudo chown "$(id -u):$(id -g)" "$backup"
chmod 600 "$backup"

upgrade_dir="$(mktemp -d "$HOME/organato-downloads/upgrade.XXXXXX")"
cd "$upgrade_dir"
curl --fail --location \
  https://organato.vercel.app/downloads/organato-canvas-connector.tar.gz \
  --output organato-canvas-connector.tar.gz
curl --fail --location \
  https://organato.vercel.app/downloads/organato-canvas-connector.tar.gz.sha256 \
  --output organato-canvas-connector.tar.gz.sha256
sha256sum --check organato-canvas-connector.tar.gz.sha256
tar --extract --gzip --file organato-canvas-connector.tar.gz
cd organato-canvas-connector

sudo ./scripts/install-systemd.sh
sudo systemctl start organato-canvas-connector.service
sudo systemctl --no-pager --full status \
  organato-canvas-xvfb.service \
  organato-canvas-x11vnc.service \
  organato-canvas-connector.service
```

The checksum command must report `OK`. The final command must show all three
services as `active (running)`. Open Organato, select **Refresh status**, and
run a Canvas sync to test the upgrade.

The installer replaces only the connector program in
`/opt/organato-canvas-connector`. It keeps the settings in
`/etc/organato-canvas-connector.env` and the pairing state and browser profile
in `/var/lib/organato-canvas-connector`. You do not need to pair or sign in
again. Run `setup-device.sh` again only when the API origin or the school SSO
allowlist must change.

After the connector has completed a sync, delete the temporary files. The
backup contains a live browser session, so do not leave it in the downloads
directory.

```sh
rm -rf -- "$upgrade_dir"
rm -- "$backup"
```

## 8. Troubleshooting

### Repair the Xvfb lock-file restart loop

If the journal reports `Could not create lock file in /tmp/.tX99-lock`,
older service units make `/tmp` read-only. Each Xvfb crash also stops the
browser connector, even when its WebSocket connected successfully.
The current release allows Xvfb and Chromium to write temporary files while
keeping `ProtectSystem=strict`. The services share the X11 socket in `/tmp`.

Upgrade using section 7, or apply this repair directly on the Pi:

```sh
sudo mkdir -p /etc/systemd/system/organato-canvas-xvfb.service.d \
  /etc/systemd/system/organato-canvas-connector.service.d
printf '[Service]\nReadWritePaths=/tmp\n' | sudo tee \
  /etc/systemd/system/organato-canvas-xvfb.service.d/temporary-files.conf \
  /etc/systemd/system/organato-canvas-connector.service.d/temporary-files.conf >/dev/null
sudo systemctl stop organato-canvas-connector.service organato-canvas-x11vnc.service organato-canvas-xvfb.service
sudo systemctl daemon-reload
sudo systemctl start organato-canvas-xvfb.service organato-canvas-x11vnc.service organato-canvas-connector.service
sleep 30
sudo systemctl show organato-canvas-xvfb.service organato-canvas-x11vnc.service organato-canvas-connector.service -p Id -p ActiveState -p SubState -p NRestarts
```

All three services must remain `active` and `running`, with restart counts
that stop increasing. Then close the old sign-in session in Organato and
select **Sign in to Canvas** again. This repair preserves pairing and the
browser profile. If a service still fails, capture its latest journal output
before changing permissions or deleting X11 lock files.

### Connected viewer stays blank

Older Organato builds gave the viewer a minimum height but no definite height.
The noVNC display uses `height: 100%`, which resolved to zero and scaled the
remote screen to 0 × 0 even after a successful connection. The web fix gives
the viewer a definite responsive height. Reload Organato after deployment;
this fix does not require a Pi upgrade.

Organato records display handshake, timeout, disconnect, and display dimensions
in its existing diagnostic store. The server also records socket connections,
the first data packet in each direction, close codes, and command results.
These events contain no screen contents, keystrokes, cookies, or view tickets.
An operator with access to the production Cloudflare account can inspect them:

```sh
pnpm dlx wrangler@4.114.0 d1 execute organato-production --remote --command "SELECT category, summary, created_at FROM security_event WHERE category IN ('canvas_connector', 'client_canvas_viewer') ORDER BY created_at DESC LIMIT 30"
```

### Viewer reconnects every minute

If all three services are stable and x11vnc logs a successful handshake followed
by a disconnect after exactly 60 seconds, an older Worker response used the
connection ticket expiry as the viewer expiry. The corrected Worker keeps the
viewer open for the remaining ten-minute sign-in session. Its single-use
connection ticket still expires after one minute.

This fix is deployed on Organato's server; no Pi upgrade is needed. After the
server update, close the old sign-in session, reload Organato, and start a new
Canvas sign-in. Successful VNC handshakes confirm the display connection, but
you must still check that the Canvas page appears and completes sign-in.

| Symptom                             | Check                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Installer says arm64 is required    | Install Raspberry Pi OS 64-bit, not a 32-bit image.                                                               |
| Connector says `not_paired`         | Create a fresh code in Organato and run the pairing command as `organato-canvas`.                                 |
| Sign-in page is blank or incomplete | Check Xvfb/x11vnc status, then add a school-verified exact resource origin through `setup-device.sh`.             |
| The Pi is offline in Organato       | Check the connector journal and outbound HTTPS connectivity; do not expose port 5900.                             |
| Canvas identity is rejected         | Sign in to the same Emanuel Canvas account that was confirmed previously, then reconnect if the account changed.  |
| A result remains pending            | Leave the service running for the next poll; network, 429, and 5xx failures retain the same command ID for retry. |

The automated package tests cover persistence, pending uploads, revocation,
allowlist/SSRF checks, bounded pagination, Worker-compatible normalization,
and the request route policy. They do not perform a school login or claim a
Raspberry Pi hardware test. An optional public login smoke can be run on a
device with Chromium and Xvfb using `ORGANATO_CANVAS_SMOKE=1`; it enters no
credentials.
