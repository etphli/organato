# Organato integrations and automation

## 1. Integration principles

- Canvas is read-only.
- Organato imports before asking for classification.
- User overrides survive source updates.
- Google access uses the narrowest practical scopes.
- Unrelated Google Calendar content is outside Organato's boundary.
- Every scheduled job can run more than once without creating duplicates.
- A failed external operation never corrupts the internal item.
- Secrets stay server-side.
- Synchronization health is visible to the owner.

## 2. Canvas / Reshet connection

### Setup

> Two connection paths exist. The Raspberry Pi browser connector is the
> preferred path (see `docs/13-raspberry-pi-setup.md`); when a Pi is paired,
> direct cookie import is rejected with `409 Disconnect Pi first`. The cookie
> flow below applies only to workspaces without a paired Pi.

The Emanuel School installation is pinned server-side to
`https://emanuel.instructure.com`. The ordinary owner flow asks only for the
browser session cookie of an already signed-in Reshet tab — no personal API
token is created or required, which matters because Emanuel School blocks
student API token creation. A different installation is an advanced,
operator-configured deployment concern rather than a normal setting.

The setup flow:

1. Resolve and enforce the configured HTTPS installation origin.
2. Call a harmless identity endpoint to validate the session cookie.
3. Show the detected Canvas user and `Emanuel School`.
4. Encrypt the cookie server-side.
5. Run an initial upcoming-assignment sync.
6. Show the number of active courses and upcoming assignments found.

The cookie must never appear again in full. Settings shows only the connected
Canvas user, last validation time, and a Replace/Revoke control. When Reshet
expires the session (typically after days or weeks), sync marks the connection
`action needed` and the owner pastes a fresh cookie value — see
[Reshet session import](12-reshet-session-import.md).

### Read scope

Organato reads:

- The current Canvas user.
- Active course enrollments.
- Course identity/name.
- Upcoming assignments.
- The current user's submission state when available.

Organato does not write to Canvas.

### Candidate API flow

The final endpoint sequence must be verified against the school's Canvas installation during the integration spike. The expected approach is:

1. List active courses for the current user.
2. For each active course, list assignments with the `upcoming` bucket and personalized assignment-date overrides enabled.
3. Include submission information where the API permits.
4. Follow Canvas pagination `Link` headers until complete.
5. Normalize all records before touching the database.

The Canvas Assignments API documents an `upcoming` bucket and exposes assignment URLs and personalized date handling. The Planner API is a fallback if the school's assignment-bucket behaviour is incomplete. Official references:

- [Canvas Assignments API](https://developerdocs.instructure.com/services/canvas/resources/assignments)
- [Canvas Planner API](https://developerdocs.instructure.com/services/canvas/resources/planner)
- [Canvas pagination](https://developerdocs.instructure.com/services/canvas/basics/file.pagination)

### Definition of upcoming

An item qualifies for import when:

- It is an assignment returned for the current user.
- It belongs to an active/available course.
- It has not been conclusively completed or submitted, subject to Canvas data availability.
- Its effective personalized due date is now or in the future.

If Canvas returns an upcoming assignment without a due date, import it as unscheduled rather than dropping it. This protects against incomplete teacher setup while still honouring the request to import upcoming work only.

### Hourly schedule

There is no Cloudflare cron in `wrangler.jsonc` (`SCHEDULER_MODE: local`).
The hourly tick comes from the Mac `launchd` agents installed by
`scripts/install-launchd.mjs`, which call `POST /api/internal/schedule`.
If the Mac is asleep or off, hourly sync, digests, and cleanup do not run.
A lock prevents overlapping full syncs.

Recommended sequence:

1. Create `sync_run` with trigger `scheduled`.
2. Refresh/validate connection state.
3. Fetch all active courses with pagination.
4. Fetch upcoming assignments with bounded concurrency.
5. Normalize and deduplicate.
6. Upsert subjects.
7. Upsert assignments.
8. Record source changes without replacing overrides.
9. Reconcile submission status.
10. Evaluate confirmed disappearances.
11. Queue Google Calendar changes.
12. Evaluate whether this batch needs one urgent email.
13. Finish `sync_run` with counts and health.

`Sync now` invokes the same pipeline with trigger `manual`. Repeated clicks coalesce into the current or next run.

### Canvas field mapping

| Canvas value              | Organato value            |
| ------------------------- | ------------------------- |
| Assignment ID             | External uniqueness key   |
| Course ID                 | Subject source key        |
| Name                      | Source name               |
| Due timestamp             | Source due date/time      |
| HTML URL                  | External Canvas link      |
| Updated timestamp         | Change detection          |
| Submission workflow state | Suggested Submitted state |
| Published state           | Import/removal evidence   |

Descriptions may contain sensitive school content and are not required for the first version. Organato links to Canvas instead of copying full instructions.

### Update behaviour

For each source field:

- No override: update the effective view.
- Override exists: update only the source value and show `Source changed`.
- Exact match after an update: clear the difference indicator but retain the override until the owner chooses to follow Canvas again.

New assignments are Unclassified and appear on Home. Existing classifications are never re-asked because of an ordinary source update.

### Removal behaviour

Canvas omission needs two consecutive successful full-sync confirmations before automatic archival. This prevents an API outage from mass-archiving data.

If confirmed:

- Archive with reason `Removed from Canvas`.
- Remove or cancel its Organato-owned Google event.
- Stop reminders.
- Retain the item in Settings → Data → Archive.
- Preserve notes, history, and overrides.

### Canvas failures

| Failure                      | Behaviour                                                      |
| ---------------------------- | -------------------------------------------------------------- |
| Session expired or rejected  | Disable Canvas automation, preserve data, request reconnection |
| Canvas unavailable           | Keep existing data, retry next hour                            |
| One course fails             | Process other courses; mark run partial                        |
| Rate limited                 | Respect `Retry-After`, use exponential backoff                 |
| Malformed item               | Skip that item, sanitize log, expose count                     |
| Pagination loop              | Abort affected course safely                                   |
| Unexpected hostname redirect | Refuse redirect and flag security error                        |

## 3. Google authentication

### Sign-in

Use Google OpenID Connect scopes:

- `openid`
- `email`
- `profile`

The server validates issuer, audience, expiry, nonce, and signature. It then checks normalized email and stable Google subject against the allow-list.

Google authentication does not itself grant Calendar or Gmail access. Integration authorization is a separate, deliberate connection flow for the integration owner.

### Allow-list

- Begin with deployment-configured owner emails.
- Allow Settings to add another address only after reauthentication by the current owner.
- A newly added identity must successfully sign in before its Google subject is bound.
- Removing an identity revokes Organato sessions but does not attempt to delete the Google account.
- At least one enabled owner identity must remain.

## 4. Google Calendar connection

### Scope boundary

Request `https://www.googleapis.com/auth/calendar.app.created`. Google defines this scope as permission to create secondary calendars and see, create, change, and delete events on those app-created calendars. It precisely matches Organato's boundary and avoids access to unrelated calendars.

Never request access to unrelated primary-calendar data merely to render Organato's calendar.

Scope behaviour must still be regression-tested and rechecked against Google's official [Calendar authorization scopes](https://developers.google.com/workspace/calendar/api/auth) before implementation.

### Initial connection

1. Integration owner starts Connect Google Calendar.
2. Request offline access and explicit consent.
3. Validate granted scopes.
4. Search only for a previously stored Organato calendar ID.
5. If absent, create a secondary calendar named `Organato`.
6. Store its ID and encrypted refresh token.
7. Project all active dated items in bounded batches.
8. Display completion and failures.

Do not search all calendar names and adopt a calendar merely because it is called Organato; ownership is based on stored ID and app-created metadata.

### Event write policy

Create one Google event for every active, dated item with `calendar_enabled = true`.

Writes use:

- Stored Google event ID.
- Organato item version.
- Google ETag where supported.
- Extended private properties containing Organato item ID.

This prevents duplicate events after retries.

### Scoped reconciliation

At the end of Canvas sync and before the morning digest:

1. Pull changes only for the dedicated Organato calendar, ideally with incremental sync tokens.
2. Match events through event ID and Organato private property.
3. For events edited in Google, convert supported changes into owner overrides.
4. For events deleted in Google, mark the item calendar-suppressed.
5. Push Organato items whose item version is newer than the last projection.
6. Record a per-item result.
7. Persist the next incremental sync token only after successful processing.

### Conflict policy

When Google changed (etag differs) and the item also changed locally since
the last successful push (item version differs from the pushed version), the
pair is parked in `conflict` — neither side is overwritten. Resolution is
explicit, per item:

- **Keep Organato** (`POST /api/integrations/google/resolve-conflict`,
  strategy `mine`): re-queues the local version for push. A concurrent
  Google edit re-flags the conflict instead of being overwritten.
- **Use Google** (strategy `theirs`): aligns the pushed-version marker so
  the next pull adopts the Google event.

The Inspector shows a conflict banner with both actions; the calendar shows
a warning icon. Conflicts are never auto-pushed.

- Organato retains protected Canvas source metadata and source link.
- Notes are split into a generated protected section and an owner-editable calendar section.
- Status, priority, classification, and attachments remain Organato-owned.
- The history states which values came from Google and which resolution won.

### Google deletion policy

Deleting an Organato event in Google means `do not put this item on my Google Calendar`.

It does not:

- Delete or archive the item.
- Stop email reminders.
- Mark it Completed.

The item displays `Calendar off · deleted in Google`. Turning its calendar toggle back on creates a fresh event.

### Calendar write failure

The internal Organato calendar remains correct. The item receives pending/error state and retry backoff. Authentication errors pause all Calendar writes until reconnection; ordinary transient failures retry automatically.

## 5. Gmail connection and email delivery

### Sending model

Use the integration owner's Gmail authorization to send HTML email from that account to the configured recipient addresses. Default recipient is the integration owner; additional allow-listed addresses can be enabled explicitly.

Use the narrow `gmail.send` scope. Organato does not read the inbox, contacts, threads, or message history.

The Gmail API's standard use is available at no additional cost within documented thresholds, but Google announced evolving quota/billing rules in 2026. Organato therefore enforces a tiny internal send ceiling and operates without a billing account. Official references:

- [Gmail API usage limits](https://developers.google.com/workspace/gmail/api/reference/quota)
- [Google Workspace API quota model](https://developers.google.com/workspace/tools-safety)

### 6:00 AM daily job

Cron schedules use UTC, so the application must determine whether the current instant corresponds to 6:00 AM in `Australia/Sydney`. It must not hard-code UTC+10 because Sydney observes daylight saving.

Run the dispatcher frequently enough to cover the local time transition safely, or use two UTC schedules with a database idempotency key keyed to the Sydney local date.

Algorithm:

1. Acquire daily digest lock for the Sydney date.
2. Reconcile Google-owned event edits.
3. Select incomplete, non-submitted, non-archived, reminder-enabled items due from the start of today through the end of day seven.
4. If none exist, record `skipped_no_items` and send nothing.
5. Group and sort items.
6. Render plain-text and HTML MIME alternatives.
7. Send one message to all configured recipients.
8. Persist Gmail message ID and included snapshot.
9. Release lock.

### Grouping and order

1. Overdue.
2. Due today.
3. Due tomorrow.
4. Due in two days.
5. Due in three days.
6. Due in four to six days.
7. Due in seven days.

Within each group:

1. Urgent, High, Medium, Low, Blank.
2. Due time.

(Subject and name tiebreaks are intentionally absent: ordering within equal
priority and due time follows retrieval order.)

Days one, two, three, and seven receive explicit reminder styling. The remaining days appear because the owner requested a daily seven-day summary.

### Subject template

Examples (colon separator, as implemented):

- `Organato: 2 due today, 6 this week`
- `Organato: 1 overdue, 4 coming up`
- `Organato: 3 coming up this week`

### HTML template

The template is predetermined and versioned. It uses:

- Inline CSS for email-client compatibility.
- Dark design with a safe light fallback.
- Semantic table-based email layout where required.
- Text labels in addition to colour.
- Large tap targets.
- Escaped user and Canvas text.
- No remote tracking pixel.
- No third-party images.
- A plain-text MIME alternative.

### Immediate short-notice import

After an hourly Canvas sync:

1. Find items created by that sync with due dates inside seven calendar days.
2. Exclude submitted/completed/archived records.
3. Use delivery key `urgent-import:<sync-run-id>`.
4. Send at most one email for the entire batch.
5. Include all such new items and explain that they await classification if necessary.

Retries use the same key and cannot duplicate a confirmed send.

The 10-per-day send cap applies per delivery type, so urgent-import bursts
can never suppress the morning digest (and vice versa).

### Delivery failure

- Retry transient errors with capped exponential backoff (`next_attempt_at`,
  consumed automatically by the hourly retry sweep, up to 3 attempts).
- Never retry permanent authorization failure indefinitely.
- Display a Home/settings warning.
- Preserve the rendered message metadata so the owner can see what was missed.
- A manual `Send test` or `Retry latest` control is available.
- Never switch to a paid provider automatically.

## 6. Google OAuth publishing state

Calendar and Gmail permissions require more than basic sign-in. In Google's Testing state, authorizations for those scopes can expire after seven days. For reliable background automation, the intended private deployment should use an External project with publishing state set to Production while remaining unverified and restricted by Organato's own allow-list.

Google explicitly documents a personal-use exception where a sole user or a few personally known users may proceed through the unverified-app warning. An unverified-app user cap still applies, which is immaterial for this single-owner product. School-managed Google accounts may be blocked by their administrator; a personal Gmail account should be the integration owner if that occurs.

Official references:

- [Google personal-use verification exception](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification#exceptions-to-verification-requirements)
- [OAuth publishing status and seven-day testing expiry](https://support.google.com/cloud/answer/15549945)
- [Unverified app behaviour](https://support.google.com/cloud/answer/7454865)

No paid security assessment is planned or appropriate for this personal app. If Google later makes verification mandatory for this exact use, the free-only rule requires redesigning the automation rather than paying.

## 7. Automation schedule

| Automation              | Schedule                         | Idempotency unit               |
| ----------------------- | -------------------------------- | ------------------------------ |
| Canvas full sync        | Hourly (Mac launchd)             | Provider + scheduled hour      |
| Manual Canvas sync      | On demand                        | Requested run ID               |
| Calendar reconciliation | After sync and before digest     | Connection + sync token        |
| Calendar retry          | Hourly sweep of due retries      | Delivery/item key              |
| Daily digest            | 6:00 AM Sydney (Mac launchd)     | Local date + recipient set     |
| Evening preview         | 8 PM Sydney (Mac launchd)        | Local date + recipient set     |
| Weekly review           | Sunday 6 PM Sydney (Mac launchd) | Local date + recipient set     |
| Urgent import email     | After qualifying sync            | Canvas sync run ID             |
| Archive confirmation    | After two successful full syncs  | Canvas item ID + missing epoch |
| History cleanup         | Daily, inside the digest job     | Day                            |
| Health check            | None — use `/health` (D1-aware)  | n/a                            |

## 8. Integration health

Each integration exposes:

- Connected identity/host.
- Last successful operation.
- Last attempted operation.
- Current state.
- Human-readable last failure.
- Retry/reconnect control.
- Recent sanitized run history.

Overall states:

- Healthy.
- Delayed.
- Partial.
- Action needed.
- Disconnected.

Do not label Organato `Up to date` if Canvas has not succeeded within two expected hourly windows.
