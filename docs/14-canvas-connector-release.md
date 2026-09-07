# Canvas connector release

This change adds an optional Raspberry Pi browser connector to the existing Canvas cookie integration. The Pi keeps the school browser session and uploads normalized assignment data. Organato provides device pairing, an authenticated remote sign-in panel, account confirmation, sync status, and disconnect. The copied-cookie connection remains available until the owner confirms a browser connection.

## Release order

Run these commands from the connector branch after reviewing and approving the production release. The original local checkout has unrelated unfinished work and must not be reset or overwritten.

1. Run `pnpm install --frozen-lockfile` and `pnpm check`. The check includes the actual Workers/D1/Durable Object integration test. The web build generates the downloadable Pi archive and checksum.
2. Use the existing authenticated Cloudflare deployment account. Make a private D1 backup through the existing operator workflow. Keep the backup out of source control and public assets.
3. Inspect `pnpm dlx wrangler@4.114.0 d1 migrations list organato-production --remote`, then apply `pnpm dlx wrangler@4.114.0 d1 migrations apply organato-production --remote`. Migration 0004 adds connector pairing/device tables and an import retry marker. It does not delete assignments.
4. Deploy the Worker with `pnpm dlx wrangler@4.114.0 deploy`. The configuration creates the SQLite-backed CanvasConnector Durable Object and points interactive browser connections at `https://organato.etphli.workers.dev`.
5. Deploy this branch's web build to the existing Organato Vercel project using its established deployment workflow. Do not deploy the older dirty checkout. The updated content security policy permits the authenticated Worker WebSocket endpoint.
6. Check the live settings panel, pairing code, and download URLs before installing the Pi. Complete the actual school login from Organato on the paired Pi. Check the imported account and assignments, reboot the Pi, and observe a multi-day trial. These hardware and school-session checks cannot be replaced by local automated tests.

No new cloud administrator secret is needed. Pairing issues a random device credential stored only on the Pi, with a hash on the server. The temporary pairing code is single-use and expires after ten minutes. A viewing link is single-use and expires after one minute; an interactive sign-in session ends after ten minutes.

## Verification

`pnpm test:connector` starts an isolated Cloudflare runtime with real D1 and Durable Object storage. It uses fictional accounts and Canvas data. It covers authenticated pairing, account isolation, one-use viewer tickets, RFB data relay, confirmation, imports, duplicate delivery, partial course failure, preservation of user overrides, an injected database failure followed by retry, identity changes, disconnect/account-switch races, device revocation, local-erasure acknowledgement, and a stale request from a replaced device.

`CONNECTOR_STRESS=1 pnpm test:connector` also imports and updates 2,000 assignments, checks the SQL statement count, and exercises the import email path. Imports use an atomic batch and bounded JSON parameters; stale connection generations cannot commit data or restore connection health.

The service's `npm test` checks its own local state and browser boundary behavior. The actual school can still require login or MFA again. There is no attempt to defeat session expiration.

## Operation

Canvas connector accounts are skipped by the old cloud/local Canvas scheduler. The Pi polls for work and the server issues one hourly sync or a manual sync. Existing Google Calendar and email scheduling are unchanged. If those jobs currently depend on a Mac, this release does not move them to the Pi.

A disconnected Pi does not remove existing assignments. Repeated delivery of one import cannot count as two separate observations of a missing assignment. A browser account mismatch stops import. The server rejects requests from a revoked or replaced device. The UI distinguishes server revocation from confirmation that the Pi has erased its local browser data.

Keep the Pi's operating system and Chromium patched. Browser profiles and pending import data are sensitive. The installation directory is separate from the private state directory. Do not back up a live profile into shared cloud folders.

## Rollback

The added tables and column can remain in place. Revert the UI first if the new panel is faulty; keep the connector backend available to existing paired devices. Before removing the connector backend or binding, disconnect paired devices and confirm local cleanup where possible. A user who already confirmed a browser connection has discarded the former copied cookie and must sign in again or supply a new cookie if reverting to the old method. Imported assignments and manual edits remain in D1.

## Remaining external checks

Production deployment requires operator approval. Raspberry Pi installation, actual Emanuel authentication, MFA compatibility, restart persistence, and the real interval between required logins remain to be tested on the user's device. Local tests do not establish those outcomes.
