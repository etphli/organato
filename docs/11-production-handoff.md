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
- Created the Oceania D1 database and applied `0001_initial.sql`.
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
- Configured these exact permitted Google identities:
  `ethan.likht@gmail.com` and
  `likht.ethan@emanuelschool.nsw.edu.au`.
- Verified authenticated session reads and authenticated item create, read, and
  archive requests against production, then removed the smoke-test item and
  revoked its temporary sessions.

No billing account or paid plan was enabled.

## Owner-only activation

### 1. Sign in

Open `https://organato.vercel.app` and continue with either permitted Google
identity. The first consent screen asks only for name, profile picture, and
email address. Organato validates the verified email and permanently binds its
Google subject identifier before creating a session.

### 2. Activate provider connections inside Organato

After Google sign-in succeeds:

1. Open Settings → Canvas / Reshet.
2. Enter the school's exact HTTPS Canvas base URL and a personal access token.
3. Confirm the detected identity and run the first Canvas sync.
4. Open Settings → Google, connect the dedicated Organato Calendar and Gmail
   sender, review the requested Calendar and Gmail-send scopes, then send a test
   message.
5. Review the imported items before enabling normal daily use.

Canvas tokens are created by the signed-in Canvas user and cannot be generated
by this repository.

## Operations

- Local app: `pnpm dev:web`
- Full gate: `pnpm check`
- Worker deploy: `pnpm dlx wrangler@4.114.0 deploy`
- Vercel deploy: `pnpm dlx vercel@57.0.0 deploy --prod`
- Hourly scheduler log: `~/.config/organato/hourly.log`
- Hourly error log: `~/.config/organato/hourly.error.log`
- Digest scheduler log: `~/.config/organato/digest.log`
- Digest error log: `~/.config/organato/digest.error.log`

The scheduler safely skips hourly Canvas work until Canvas is connected. Keep
this Mac awake and signed in when a local scheduled run is due.
