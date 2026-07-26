# Organato decision register

This document separates confirmed product decisions from design interpretations and setup values still required.

## 1. Confirmed decisions

| Area                    | Decision                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Product                 | Organato is exclusively for the owner's use                                                                                       |
| Cost                    | Every required component must be free                                                                                             |
| Account requirements    | No credit card, no expiring trial, no paid developer account                                                                      |
| Libraries               | Open-source libraries only                                                                                                        |
| Form factor             | Free hosted, installable PWA                                                                                                      |
| Device priority         | Desktop first; phone/tablet supported                                                                                             |
| Offline                 | Not included                                                                                                                      |
| Authentication          | Google sign-in only                                                                                                               |
| Identities              | More than one Google email may be allowed, but there is one actual owner/workspace                                                |
| Canvas token            | Owner can generate a personal Canvas API token                                                                                    |
| Canvas scope            | Import just upcoming assignments                                                                                                  |
| Canvas schedule         | Check hourly and provide Sync now                                                                                                 |
| Classification          | Ask on Home; no learned or keyword-based auto-classification                                                                      |
| Source conflicts        | User overrides beat later Canvas values                                                                                           |
| Canvas deletion         | Archive, do not delete                                                                                                            |
| Archive location        | Accessible through Settings only                                                                                                  |
| Work statuses           | Not started, In progress, Submitted, Completed, Overdue, Archived                                                                 |
| Priority                | Blank, Low, Medium, High, Urgent                                                                                                  |
| Subjects                | Import course name; allow rename and colour                                                                                       |
| Todo fields             | Task, due date/time, days remaining, subject, priority, status, notes, recurrence                                                 |
| Calendar contents       | Assignments, checkpoints, and todos all synchronize                                                                               |
| Google calendar         | Create a separate calendar named Organato                                                                                         |
| Unrelated Google events | Do not import or alter them                                                                                                       |
| Google edits            | Google should win for edits to Organato-created events                                                                            |
| Reminder days           | Seven, three, two, and one day before                                                                                             |
| Reminder time           | 6:00 AM Sydney time                                                                                                               |
| Short-notice import     | Send an immediate alert, then continue remaining reminders                                                                        |
| Completed/submitted     | Stop reminders                                                                                                                    |
| Daily summary           | Send only when something is due within seven days                                                                                 |
| Email shape             | Predetermined HTML template; everything consolidated into one email                                                               |
| Missing due time        | Use a default unless an explicit time exists                                                                                      |
| Focus features          | Include search/filters, themes, shortcuts, command palette, drag priority, notes/attachments, statistics, export/backup, and undo |

## 2. Design interpretations made from those decisions

These choices resolve ambiguities without changing the vision.

### Assignment, checkpoint, or both

The owner noted that some checkpoints are also assignments. Classification therefore has three positive choices: Assignment, Checkpoint, and Both.

A Both item is one record. It appears in both tables but has one calendar event and one reminder stream.

### “Popup” on Home

The classification request is an anchored attention panel on Home, automatically expanded when new items exist. It is not a blocking modal. `Decide later` keeps the item safely visible.

### Calendar direction

The integration is:

- One-way for the universe of calendar content: Organato never imports unrelated events.
- Two-way for the narrow set of events Organato created: supported Google edits return to Organato.

### Google event deletion

Deleting an Organato-created event in Google suppresses that item's calendar projection. It does not delete/archive the Organato item or turn off email safety reminders.

### Email consolidation

At 6:00 AM, one daily email includes all incomplete items due in the next seven days. Days seven, three, two, and one are visually highlighted, while days four through six remain in the requested summary. This avoids separate reminder emails.

An hourly sync can send one additional immediate batch email only for newly discovered short-notice work.

### Missing time

A manual deadline with a date but no time is:

- Shown as an all-day calendar event.
- Treated internally as due at 11:59 PM Sydney time for ordering, overdue status, and reminders.

Exact Canvas timestamps are honoured as supplied.

### Attachments

The complete first release supports labelled attachment links rather than uploaded files. This keeps the feature cross-device while avoiding a paid/card-gated storage dependency.

### Drag-to-reorder priorities

Priority itself is a defined enum, so dragging is used to reorder rows or workload focus within a view. Dropping into a priority group can also change priority with undo.

### Multiple Google identities

All allow-listed accounts enter one workspace. One account is separately designated the integration owner for Calendar/Gmail automation.

## 3. Recommended defaults

| Setting                 | Default                                            |
| ----------------------- | -------------------------------------------------- |
| Timezone                | Australia/Sydney                                   |
| First day of week       | Monday                                             |
| Theme                   | Obsidian Dark                                      |
| Sidebar                 | Expanded desktop, bottom navigation phone          |
| Table density           | Compact                                            |
| Canvas sync             | Hourly                                             |
| Calendar sync           | On for all new dated items                         |
| Email reminders         | On                                                 |
| Daily digest            | 6:00 AM when work is due within seven days         |
| Date-only cutoff        | 11:59 PM                                           |
| New todo priority       | Blank                                              |
| New work status         | Not started                                        |
| Canvas source conflict  | Owner override                                     |
| Calendar event conflict | Google edit                                        |
| Canvas disappearance    | Archive after two successful absence confirmations |
| Completed visibility    | Until end of day                                   |
| Auto-archive            | Never                                              |
| Archive retention       | Indefinite                                         |
| Analytics               | Private derived statistics only                    |
| External tracking       | None                                               |

## 4. Setup values still needed before implementation

These do not block product design:

1. Which Google account is the Calendar/Gmail integration owner.
2. Which email addresses receive the digest.
3. Whether the school Google Workspace account permits the requested scopes.

The Canvas/Reshet origin is confirmed as
`https://emanuel.instructure.com`. The final Organato mark is the code-native
incomplete orbital O with one organizing point.

Secrets such as the Canvas token must be entered during protected setup and must not be written in this file.

## 5. Technical validations still required

1. Confirm the school's Canvas `upcoming` behaviour.
2. Confirm whether unscheduled upcoming assignments are returned and how the school uses them.
3. Confirm personalized due-date override fields.
4. Confirm reliable submission-state data.
5. Regression-test `calendar.app.created`, the narrow Google scope designed for app-created secondary calendars.
6. Confirm the unverified personal-use OAuth flow with every intended account.
7. Confirm Cloudflare account creation and production deployment require no payment method.
8. Recheck all provider free limits immediately before production deployment.
9. Benchmark scheduled Canvas processing against Cloudflare's Free-plan CPU limit and use the free fallback if it does not fit.

## 6. Change control

When a decision changes:

1. Add a dated entry below.
2. Update the affected specification.
3. Identify migration or synchronization consequences.
4. Update acceptance tests.
5. Re-run the free-only and security review if the stack or integration scope changes.

## 7. Change log

| Date       | Decision                                   | Reason                                                                                                          |
| ---------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 2026-07-25 | Initial product decisions recorded         | Project discovery                                                                                               |
| 2026-07-25 | Added Both classification                  | Some checkpoints are also assignments                                                                           |
| 2026-07-25 | Scoped two-way Google event reconciliation | Google edits should win without importing unrelated calendar content                                            |
| 2026-07-25 | Link attachments in first complete release | Preserve cross-device support under free-only constraint                                                        |
| 2026-07-25 | Use the free local scheduler by default    | The conservative 480-assignment benchmark measured about 19 ms, above the Workers Free 10 ms Cron CPU allowance |
| 2026-07-26 | Restore backups through confirmed merge    | Preserve current data, require a pre-restore download, and keep retries idempotent                              |
| 2026-07-26 | Pin Emanuel School Canvas server-side      | Remove technical URL entry from ordinary setup and enforce the confirmed origin                                 |
| 2026-07-26 | Adopt the orbital Organato mark            | Create one distinctive, scalable identity across app shell, authentication, favicon, and PWA                    |
