# Organato build and release runbook

## Current implementation

The repository contains:

- `apps/web`: React/Vite responsive PWA with Home, Assignments, Checkpoints, Calendar, Todo, Settings, command palette, search, detail inspector, archive, export, validated restore, themes, and phone/tablet adaptations.
- `apps/worker`: Hono API, Google OIDC, exact allow-list and subject binding, opaque server sessions, CSRF/origin checks, D1 persistence, protected integration setup, scheduled handlers, and security headers.
- `packages/domain`: provider-independent item, date, status, recurrence, reminder, and backup rules.
- `packages/integrations`: real and fake Canvas, Google Calendar, and Gmail adapters.
- `packages/email`: versioned, escaped HTML/plain-text digest renderer.
- `migrations`: immutable D1 migrations for external identities, active-due
  items, archives, Calendar work, durable reminder retries, and history indexes.
- `scripts`: licence/secret gates, CPU benchmark, and free local `launchd` scheduler fallback.

## Local setup

1. Install Node 22+ and pnpm.
2. Run `pnpm install`.
3. Copy `.env.example` to `.env.local` only for local values. Never commit it.
4. Run `pnpm dev:web` for the redacted interactive UI.
5. Run `pnpm dev:worker` after creating `.dev.vars` and a local D1 database.

The committed Vite development profile enables redacted demo data only for `vite dev`. Production builds and the Worker default to `DEMO_MODE=false`; never override either production value to `true`.

## Required production values

- Pinned Canvas HTTPS origin (`https://emanuel.instructure.com` for this deployment).
- Initial normalized Google owner email allow-list.
- Google integration-owner email.
- Digest recipients chosen from allowed owner identities.
- Google OAuth client ID and secret.
- Random 32-byte session secret.
- Random base64url 32-byte AES-GCM key.
- Random local-scheduler bearer token.
- Production D1 database ID.

Set secrets with `wrangler secret put`; do not place them in `wrangler.jsonc`.

## Google configuration

1. Create a Google Cloud project without attaching a billing account.
2. Configure exact production and preview redirect URIs:
   - `<origin>/api/auth/google/callback`
   - `<origin>/api/integrations/google/callback`
3. Configure the public homepage and `/privacy.html`.
4. Basic sign-in requests `openid email profile`.
5. Integration consent separately requests:
   - `https://www.googleapis.com/auth/calendar.app.created`
   - `https://www.googleapis.com/auth/gmail.send`
6. Use External/In Production for dependable background refresh tokens. Keep the application private through Organato's exact allow-list and accept the unverified personal-use warning only for the owner or a few personally known users.
7. Do not request Calendar-wide, Drive, Contacts, inbox-reading, or full-mail scopes.

Google currently documents `calendar.app.created` as the scope that can create secondary calendars and manage events on those app-created calendars. Google also documents that Testing-state authorizations, including offline refresh tokens, expire after seven days, while its personal-use exception covers a sole user or a few personally known users.

Official references:

- https://developers.google.com/workspace/calendar/api/auth
- https://support.google.com/cloud/answer/15549945
- https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- https://developers.google.com/workspace/gmail/api/reference/quota

## Canvas setup

1. Open Settings → Canvas / Reshet.
2. Enter a personal access token. The Emanuel School origin is configured and
   enforced server-side.
3. Organato validates the token against the current-user endpoint before encrypting it.
4. Confirm the detected user and school.
5. Organato runs the first sync; compare the redacted diagnostics with the school's actual upcoming/personalized-date behavior.

Organato pins the exact origin, rejects alternate ports and credential-bearing
cross-origin redirects, follows pagination with loop detection, uses bounded
course concurrency, and never calls a Canvas mutation endpoint.

## Scheduler decision

Cloudflare Workers Free currently permits only 10 ms of CPU per HTTP or Cron invocation, despite a 15-minute Cron wall-time. The committed Wrangler configuration therefore has no Cron triggers and uses the safe local scheduler by default.

Run:

```bash
pnpm scheduler:benchmark
```

This synthetic benchmark is deliberately conservative but cannot approve Cloudflare Cron on behalf of the owner's real Canvas installation. To consider Cloudflare Cron, repeat the benchmark through `workerd` with a redacted capture representing all real courses, pagination, assignments, D1 writes, Calendar changes, and email selection. Require repeated results below 7 ms to retain headroom, then add the documented hourly and Sydney-dispatch trigger schedules.

If it does not pass, keep the hosted PWA/API/D1 and install the free local scheduler:

```bash
export ORGANATO_API_URL="https://<worker>.workers.dev"
export ORGANATO_SCHEDULER_TOKEN="<locally generated token>"
pnpm scheduler:install
```

Review the generated plists, ensure the Mac timezone is Australia/Sydney, and load them with `launchctl bootstrap`. The token is stored in a mode-0600 local environment file, not in the plist or repository.

Current official references:

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/

As of 25 July 2026, the official pages list 100,000 Worker requests/day, 10 ms Free CPU, five Cron triggers, 5 million D1 rows read/day, 100,000 rows written/day, 5 GB D1 storage, and free/unlimited static asset requests. Recheck immediately before every production release.

## Quality and security gates

Run:

```bash
pnpm check
```

This covers formatting, lint, TypeScript, unit/component/contract tests,
production build, dependency licence allow-listing, production dependency
auditing, and secret scanning. `GHSA-qwww-vcr4-c8h2` is explicitly ignored
because the official advisory says it applies only to unstable React Server
Component APIs; Organato is a client-rendered Vite SPA and imports none of those
APIs. Remove the ignore when React Router publishes a compatible 7.x fix or
Organato moves to React Router 8. Before release, also perform:

- Authorized/unauthorized Google sign-in.
- Canvas real-instance mapping and cross-host redirect test.
- Calendar create/edit/delete/retry/idempotency flow.
- Gmail desktop/mobile/plain-text rendering.
- Sydney standard time, daylight-saving boundaries, 5:59/6:01 AM, midnight, and seven-day boundary.
- Keyboard-only and screen-reader smoke tests.
- Desktop, tablet, and phone browser pass.
- D1 migration on a production-like copy.
- Secret-free backup, merge-preview, required pre-restore download, typed confirmation, and restore apply.
- Duplicate scheduled/manual job invocation.

## Deployment

1. Create separate preview and production D1 databases.
2. Replace the placeholder production D1 ID in `wrangler.jsonc`.
3. Apply every pending migration with
   `pnpm dlx wrangler@4.114.0 d1 migrations apply organato-production --remote --config wrangler.jsonc`.
4. Set non-secret vars and all Worker secrets.
5. Build with `pnpm build`.
6. Run `pnpm check`.
7. Review `pnpm dlx wrangler@4.114.0 deploy --dry-run`.
8. Confirm the Cloudflare account remains on Workers Free and has no payment method.
9. Deploy with Wrangler and complete owner-only smoke tests.
10. Download the first secret-free JSON backup.

Never edit or re-run an already-applied migration. Add a sequential migration,
inspect the pending list, apply it to a local D1 database first, and only then
apply it to production.

## Recovery

- Canvas token: revoke in Canvas, disconnect, replace, review sanitized sync runs.
- Google authorization: revoke in Google Account permissions, revoke Organato sessions, reconnect, reconcile the dedicated calendar.
- Database compromise: revoke provider credentials, rotate session/encryption keys, revoke sessions, restore a known-good secret-free export.
- Backup restore: Settings validates the complete schema, previews counts, requires `RESTORE ORGANATO`, downloads the current workspace first, then performs an idempotent merge. Keep the downloaded pre-restore file until the merged workspace has been checked.
- Lockout: update the exact allow-list through deployment configuration; there is no public recovery flow.
- Quota exhaustion: wait for the free limit reset or use the documented local scheduler. Never enable billing or upgrade automatically.
