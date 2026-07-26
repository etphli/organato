# Organato delivery and quality plan

## 1. Delivery philosophy

Organato becomes useful as soon as Canvas import, classification, editable work tables, and Home are trustworthy. Calendar and reminder automation should follow only after the internal item model is stable, because both are projections of that model.

Each phase ends with a working, testable product. Later phases add capability without rewriting the central data model.

## 2. Phase 0 — feasibility and setup

### Objectives

- Confirm exact Canvas base URL.
- Test personal token against the school installation.
- Verify active courses and upcoming-assignment endpoint behaviour.
- Confirm personalized due dates and submission states.
- Create Cloudflare Free account without a payment method.
- Create Google Cloud project without billing.
- Confirm Google OAuth Production/unverified personal-use flow for the chosen accounts.
- Confirm the school account is not administrator-blocked.
- Confirm Calendar scope and Gmail send scope.
- Benchmark a complete real Canvas normalization run against the Workers Free 10 ms CPU ceiling.

### Deliverables

- Redacted Canvas response fixtures.
- API mapping notes.
- Free-tier verification checklist with date.
- OAuth redirect URI list.
- Initial threat-model sign-off.
- Go/no-go decision for Cloudflare-hosted architecture.

### Exit criteria

- One real upcoming Canvas assignment can be read.
- One test event can be created and then edited in the dedicated Google calendar.
- One HTML test email can be sent through the intended Google account.
- No payment card or billing account is attached.
- The scheduled sync fits the free CPU limit, or the free local scheduler fallback is selected before feature implementation.

## 3. Phase 1 — foundation

### Scope

- Monorepo/tooling.
- Worker API.
- D1 schema and migrations.
- React shell and routing.
- Google basic sign-in.
- Exact email allow-list.
- Server sessions, CSRF, and security headers.
- Theme tokens and capsule sidebar.
- Local fake providers for development.

### Exit criteria

- Unauthorized Google account cannot access private routes.
- Authorized identities reach the same workspace.
- Desktop and phone navigation works.
- CI passes format, lint, types, tests, build, licence, and secret checks.

## 4. Phase 2 — core planning

### Scope

- Unified item/subject model.
- Manual assignments, checkpoints, Both items, and todos.
- Assignment and checkpoint tables.
- Todo table.
- Inline editing.
- Detail inspector.
- Status, priority, notes, linked attachments.
- Calendar internal month view.
- Archive and restore.
- History and undo.

### Exit criteria

- A Both item appears in both work tables but once in the internal calendar.
- Days remaining is correct across Sydney date boundaries.
- Archiving removes an item from all ordinary views.
- Restoring returns it without losing notes/history.
- Manual edits survive reload and conflicting version writes are detected.

## 5. Phase 3 — Canvas automation

### Scope

- Protected Canvas setup.
- Active course/subject import.
- Upcoming assignment import.
- Pagination and bounded concurrency.
- Source/override separation.
- Home classification inbox.
- Submission reconciliation.
- Two-sync disappearance archival.
- Hourly Cron and Sync now.
- Health/activity panel.

### Exit criteria

- A new real Canvas assignment appears after the next successful sync.
- It appears Unclassified on Home.
- Assignment, Checkpoint, Both, Later, and Archive actions behave correctly.
- A manual name/due override is not replaced by Canvas.
- Source changes are visible and reversible.
- One failed course does not discard successful course results.
- Duplicate Cron invocation creates no duplicate item.

## 6. Phase 4 — Google Calendar

### Scope

- Separate integration-owner authorization.
- Dedicated app-created Organato calendar.
- Create/update/delete projections.
- Incremental reconciliation.
- Google edits win for supported fields.
- Google deletion suppresses only the calendar event.
- Retry and health states.

### Exit criteria

- Every dated active item with calendar enabled has exactly one event.
- Both items still have exactly one event.
- Direct Google date/title edits return to Organato as overrides.
- Deleting an event in Google preserves the item.
- Unrelated Google events are never imported or mutated.
- Retry after a simulated failure creates no duplicate.

## 7. Phase 5 — email automation

### Scope

- Versioned HTML/plain-text template.
- 6:00 AM Sydney dispatcher.
- Seven-day conditional query.
- Reminder highlighting for 7, 3, 2, and 1 days.
- One consolidated message.
- Urgent short-notice import batch alert.
- Delivery idempotency/history.
- Test and retry controls.

### Exit criteria

- No message is sent when nothing qualifies.
- One message contains all qualifying assignments, checkpoints, Both items, and todos.
- Both item appears once.
- Submitted, Completed, and Archived items are absent.
- Exact reminder groups respect Sydney calendar dates and daylight saving.
- Re-running the same daily job sends no duplicate.
- HTML renders readably in Gmail desktop and phone clients.

## 8. Phase 6 — focus and personalization

### Scope

- Global search and filters.
- Saved views and column settings.
- Command palette.
- Keyboard shortcuts.
- Subject renaming/colours.
- Theme variants.
- Recurring todos.
- Workload statistics.
- Full settings catalogue.

### Exit criteria

- All important actions are keyboard accessible.
- Search finds items by name, subject, and notes.
- Saved views survive reload.
- Recurrence never creates duplicate next occurrences.
- Statistics match direct database counts.
- Themes pass contrast checks.

## 9. Phase 7 — backup, resilience, and PWA release

### Scope

- JSON/CSV exports.
- Import preview and restore.
- Session/security views.
- PWA manifest and asset caching.
- Install prompts.
- Responsive QA.
- Production runbook.
- Free-tier review.

### Exit criteria

- Full backup contains no secrets.
- Restore dry run reports exact counts and conflicts.
- Installed PWA launches correctly.
- Network loss is honestly shown; unsaved changes are not falsely acknowledged.
- Production has no billing account/card.
- Recovery instructions have been tested once.

## 10. Core user stories and acceptance criteria

### Import upcoming work

- **Given** Canvas has a newly published upcoming assignment
- **When** the hourly sync succeeds
- **Then** Organato creates one Unclassified item with its personalized due date, subject, and Canvas link.

- **Given** the same sync is processed twice
- **When** both runs complete
- **Then** only one Organato item exists.

### Classify from Home

- **Given** one or more Unclassified items exist
- **When** the owner opens Home
- **Then** the anchored classification panel is visible without blocking the rest of Home.

- **Given** an item functions as an assignment and checkpoint
- **When** the owner selects Both
- **Then** it appears in both tables but remains one record, event, and reminder stream.

### Respect overrides

- **Given** the owner changed an imported due date
- **When** Canvas later sends a different due date
- **Then** the Organato due date remains, and a source-change comparison is available.

### Archive Canvas removals

- **Given** an active Canvas item is absent from one otherwise successful sync
- **Then** Organato does not archive it yet.

- **Given** it is absent from the next successful full sync too
- **Then** it is archived with reason Removed from Canvas and accessible through Settings.

### Calendar conflict

- **Given** an Organato event exists in Google Calendar
- **When** the owner changes its date in Google
- **Then** Organato adopts that date as an override after reconciliation.

- **Given** the event is deleted in Google
- **Then** Organato preserves the item, suppresses its calendar projection, and continues email reminders unless separately disabled.

### Daily email

- **Given** at least one incomplete item is due in the next seven Sydney calendar days
- **When** the 6:00 AM dispatcher runs
- **Then** it sends exactly one combined HTML/plain-text email.

- **Given** no item qualifies
- **Then** it sends no email.

- **Given** the same dispatcher is invoked again for the same date and recipients
- **Then** it sends no second email.

### Completion

- **Given** an item is marked Completed or Submitted
- **Then** it disappears from future reminder selection immediately.

### Free-only constraint

- **Given** a provider limit is reached
- **Then** the operation fails safely and Organato asks the owner to wait or use a documented free fallback; it never upgrades or creates a charge.

## 11. Test strategy

### Unit tests

- Effective field resolution.
- Classification membership.
- Both-item deduplication.
- Status derivation.
- Sydney days-remaining calculation.
- Date-only 11:59 PM cutoff.
- Digest grouping/sorting.
- Recurrence generation.
- Archive/restoration rules.
- Idempotency-key generation.
- Scope and URL validation.

### Property/invariant tests

- Repeating an upsert does not increase item count.
- Repeating a calendar projection does not increase event count.
- Completed items never qualify for reminders.
- Archived items never appear in active queries.
- Source updates never alter an active override.
- One Canvas identity maps to at most one item.

### Integration contract tests

Use redacted fixtures for:

- Canvas pagination.
- Personalized assignment overrides.
- No-due assignment.
- Submission state.
- Course failure.
- Rate limiting.
- Google OAuth refresh.
- Calendar incremental sync.
- ETag conflict.
- Deleted event.
- Gmail send and retry.

### Component tests

- Classification panel.
- Editable table cells.
- Detail inspector.
- Date/time editor.
- Status and priority menus.
- Archive.
- Settings search.
- Email template snapshots.

### Browser tests

- Authorized and unauthorized sign-in.
- Home → classify → table → calendar flow.
- Manual override and source-change comparison.
- Todo recurrence.
- Keyboard-only navigation.
- Responsive desktop/tablet/phone.
- PWA update banner.
- Network and API failure states.

### Accessibility tests

- Automated axe checks on each route.
- Manual keyboard pass.
- Screen-reader smoke test.
- High zoom and large text.
- Reduced motion.
- Colour-blind-independent status signals.
- Email plain-text alternative.

### Security tests

- CSRF.
- Open redirect.
- OAuth state/nonce.
- Session fixation.
- Allow-list bypass.
- XSS in Canvas name, notes, and Google summary.
- Malicious backup.
- Canvas cross-host redirect.
- Secret leakage in build/log/export.
- Rate limit and duplicate Cron.

## 12. Timezone test matrix

Explicitly test:

- Sydney standard time.
- Sydney daylight-saving time.
- The spring-forward date.
- The fall-back date.
- Item due exactly at midnight.
- Date-only item.
- Item created at 5:59 AM and 6:01 AM.
- Due today after the digest.
- Seven-day boundary at 11:59 PM.
- Canvas timestamp with a non-Sydney offset.

## 13. Email rendering matrix

At minimum:

- Gmail web dark and light modes.
- Gmail mobile.
- Plain-text view.
- Images blocked, although the template should not depend on remote images.
- Very long assignment name.
- Missing subject.
- Blank priority.
- Many items in one digest.
- Both classification.
- Canvas and non-Canvas items.

## 14. Operational release checklist

- [x] Exact Canvas URL confirmed (`https://emanuel.instructure.com`).
- [ ] Allowed Google emails confirmed.
- [ ] Integration owner confirmed.
- [ ] Production origins and redirects exact.
- [ ] Google project is Production publishing status.
- [ ] No billing account or payment card.
- [ ] Cloudflare is on Workers Free.
- [ ] Secrets set through deployment secret store.
- [ ] D1 migrations applied.
- [ ] Owner data backup taken.
- [ ] Canvas, Calendar, and Gmail smoke tests pass.
- [ ] Cron schedules verified in Sydney time.
- [ ] Email idempotency verified.
- [ ] Privacy and free-only pages published.
- [ ] Licence report contains only allowed licences.
- [ ] Recovery runbook available privately.

## 15. Risks and mitigations

| Risk                                    | Impact                                               | Mitigation                                                               |
| --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| School Canvas API behaviour differs     | Import incomplete                                    | Phase 0 real-instance spike and fallback endpoint                        |
| School blocks Google scopes             | Calendar/email cannot connect through school account | Use personal Gmail as integration owner                                  |
| Google OAuth left in Testing            | Automation breaks every seven days                   | Production publishing state for personal-use deployment                  |
| Provider free terms change              | Hosting or API becomes unavailable                   | No card, internal caps, periodic review, portable export, local fallback |
| Manual override conflicts confuse owner | Stale date used                                      | Source comparison indicator and explicit reset                           |
| Calendar delete recreates event         | Frustrating sync loop                                | Persist calendar-suppressed state                                        |
| Hourly sync duplicates email/event      | Spam/duplicates                                      | Locks, unique keys, external IDs, version checks                         |
| Canvas omission archives valid item     | Hidden work                                          | Two successful absence confirmations                                     |
| Dense desktop UI fails on phone         | Mobile unusable                                      | Stacked list/detail sheets and bottom navigation                         |
| Feature breadth delays usable release   | No working core                                      | Phase releases with foundation/core/import first                         |

## 16. Definition of done

A feature is done when:

- Behaviour matches written acceptance criteria.
- Empty, loading, offline, and failure states exist.
- Keyboard and screen-reader use is possible.
- Unit/integration/browser coverage is proportionate to risk.
- No new paid, trial, card-gated, closed-source dependency is required.
- Security and privacy effects are documented.
- Settings and data export account for it.
- Logs and health state make failure diagnosable.
- Documentation is updated.

## 17. Future ideas that still fit the product

These are not part of the first complete release:

- Estimated effort and study-block planning.
- Optional focus timer linked to an item.
- “What should I do next?” deterministic ranking based on due date, priority, and effort.
- Read-only school timetable overlay.
- Assessment-weight field and workload forecast.
- Smart but fully local quick-entry parsing.
- Optional browser extension to save the current Canvas page.
- Yearly archive packs.
- Printable weekly plan.

Any future feature must pass the privacy, simplicity, and free-only tests.
