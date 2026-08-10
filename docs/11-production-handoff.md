# Organato production handoff

## Live resources

| Resource             | Production value                               |
| -------------------- | ---------------------------------------------- |
| App                  | `https://organato.vercel.app`                  |
| GitHub               | `https://github.com/etphli/organato` (private) |
| Vercel project       | `ethans-project/organato`                      |
| Worker               | `https://organato.etphli.workers.dev`          |
| Cloudflare account   | `9a11949235ee2de5a154b31a725c464b`             |
| D1 database          | `organato-production`                          |
| D1 database ID       | `a653bf6d-e7d4-4429-af3a-fc30bd839af4`         |
| Google Cloud project | `organato-etphli`                              |

The production origin is exactly `https://organato.vercel.app`. Vercel's
same-origin `/api/*` rewrite terminates at the Cloudflare Worker.

## Completed

- Created and pushed the private GitHub repository.
- Connected GitHub to Vercel for automatic deployments.
- Deployed the production PWA to Vercel with demo mode disabled.
- Created the Oceania D1 database and applied `0001_initial.sql` and
  `0002_reminder_retry.sql`.
- Registered the `etphli.workers.dev` account subdomain.
- Deployed the Worker with D1, production origin, owner allow-list, and
  observability attached.
- Generated and uploaded the session, AES-GCM, and scheduler secrets without
  committing or printing them.
- Created the Google Cloud project and enabled the Google Calendar and Gmail
  APIs.
- Created and installed the production Google OAuth web client with the exact
  Vercel origin and both callback URLs.
- Published the external OAuth configuration for this private personal app.
- Installed and loaded the hourly Canvas and 6:00 AM Sydney digest LaunchAgents.
  Their token is stored locally in `~/.config/organato/scheduler.env` with mode
  `0600`.
- Configured the Google sign-in allow-list wildcard so any verified Google
  account can create a private personal workspace. Workspace records,
  assignments, settings, sessions, integrations, sync jobs, reminders, backups,
  and diagnostics are tenant-scoped by the verified account.
- Verified authenticated session reads and authenticated item create, read, and
  archive requests against production, then removed the smoke-test item and
  revoked its temporary sessions.
- Added account-scoped session revocation, recent-auth protection for sensitive
  actions, stable multi-tab CSRF tokens, and tenant-scoped security events.
- Added full-workspace export and validated merge restore, searchable archive
  recovery, permanent item/workspace deletion, and scheduled retention cleanup.
- Hardened Canvas pagination/retries/redirects and missing-item handling; added
  idempotent Google Calendar reconciliation and durable Gmail delivery retries
  with a ten-message daily ceiling.
- Added an automatic first-run setup walkthrough that verifies Reshet, connects
  Calendar and Gmail, lets the owner choose a separate approved reminder
  address, and requires a successful test message before completion.
- Fixed Google token and API redirect handling for the Cloudflare runtime, and
  added sanitized Reshet connection diagnostics without storing failed tokens.
- Rebound the Canvas adapter's runtime `fetch` call to Cloudflare's global
  context, fixing the production-only illegal-invocation failure that prevented
  Reshet validation before any request reached Canvas.

No billing account or paid plan was enabled.

## Personal workspace activation

### 1. Sign in

Open `https://organato.vercel.app` and continue with any verified Google
identity. The first consent screen asks only for name, profile picture, and
email address. Organato validates the verified email and permanently binds its
Google subject identifier before creating a session. Each identity receives a
separate workspace and cannot read or mutate another identity's data or
integration credentials.

### 2. Activate provider connections inside Organato

After Google sign-in succeeds, Organato opens the guided setup automatically:

1. Create a personal access token in Reshet and paste it into the walkthrough.
   Emanuel School is pinned as the installation. Organato validates the token,
   stores it encrypted, and runs the first import.
2. Connect a personal Google account for the private Organato Calendar and
   Gmail sending. Review the requested Calendar and Gmail-send scopes.
3. Choose any approved owner address as the reminder recipient. This can be the
   school address even when school policy blocks that address from Google
   sign-in.
4. Send a real test message. The walkthrough completes only after Gmail accepts
   it.
5. Review the imported items on Home before enabling normal daily use.

Canvas tokens are created by the signed-in Canvas user and cannot be generated
by this repository.

## Operations

- Local app: `pnpm dev:web`
- Full gate: `pnpm check`
- D1 migrations:
  `pnpm dlx wrangler@4.114.0 d1 migrations apply organato-production --remote --config wrangler.jsonc`
- Worker deploy: `pnpm dlx wrangler@4.114.0 deploy`
- Vercel deploy: `pnpm dlx vercel@57.0.0 deploy --prod`
- Hourly scheduler log: `~/.config/organato/hourly.log`
- Hourly error log: `~/.config/organato/hourly.error.log`
- Digest scheduler log: `~/.config/organato/digest.log`
- Digest error log: `~/.config/organato/digest.error.log`

The scheduler safely skips hourly Canvas work until Canvas is connected. Keep
this Mac awake and signed in when a local scheduled run is due.
