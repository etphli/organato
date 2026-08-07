# Organato product specification

## 1. Product definition

Organato is a single-owner academic organization web app. It removes the repeated work of checking Canvas/Reshet, noticing upcoming assignments, and manually copying them into a separate table or calendar.

It is not a replacement learning management system. Canvas remains the authoritative source for school-issued assignment details and submission links. Organato is the personal planning layer placed on top of it.

## 2. Problem statement

The owner receives assignments and checkpoints in Canvas but does not consistently transfer them into a planning system. That creates several failure points:

- Upcoming work can remain unnoticed.
- Deadlines exist in several places rather than one trusted view.
- The difference between an assignment and a checkpoint is contextual and cannot be inferred reliably.
- Manually maintained Notion-style tables become stale.
- Calendar entry and reminder creation are repetitive.
- A list of tasks does not always make urgency or workload obvious.

Organato solves these problems by importing first, asking for human classification second, and deriving all views, calendar events, and reminders from one underlying item.

## 3. Goals

### Primary goals

- Import only upcoming Canvas assignments automatically.
- Make unclassified work impossible to overlook on Home.
- Provide fast human classification as Assignment, Checkpoint, or Both.
- Show all active work in clean, editable, Notion-like tables.
- Allow every user-facing field to be manually overridden.
- Synchronize assignments, checkpoints, and todos to a dedicated Google Calendar.
- Send one useful HTML email at 6:00 AM Australia/Sydney time when something is due within seven days.
- Preserve an accessible archive instead of permanently deleting work.
- Remain private, free, open-source, and installable as a PWA.

### Secondary goals

- Make daily planning fast enough to become habitual.
- Support search, saved filters, keyboard shortcuts, a command palette, notes, linked attachments, statistics, backup/export, undo history, and theme choices.
- Make synchronization state understandable without forcing the owner to inspect logs.
- Keep all integration boundaries replaceable if a provider changes its free offering.

## 4. Non-goals

The initial product will not:

- Submit work to Canvas.
- Modify Canvas assignments or courses.
- Import announcements, discussions, standalone calendar events, past assignments, or unrelated quizzes.
- Import unrelated Google Calendar events.
- Support collaboration or shared editing between accounts.
- Work fully offline.
- Provide native iOS, Android, or macOS applications.
- Upload and host large files. Attachments are links in the first complete version.
- Replace Canvas as the source for assignment instructions.
- Use automatic AI classification.

## 5. User model

Each verified Google identity owns one private workspace. Account identity,
workspace data, settings, sessions, integrations, sync jobs, reminders, and
backups are isolated by that identity.

The workspace's connected Google identity is its **integration owner**. Its
authorization is used to:

- Create and maintain the dedicated Organato calendar.
- Send the HTML digest.
- Receive the digest by default.

Signing in through another Google account creates or opens that account's
separate workspace and never transfers data or integration ownership.

## 6. Terminology

| Term                | Meaning                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| Work item           | The single underlying record for an assignment, checkpoint, or item classified as both |
| Assignment          | A major or conventional piece of assessed school work                                  |
| Checkpoint          | A milestone, draft, preparation step, or smaller assessed event                        |
| Both                | One Canvas item that legitimately belongs in both Assignment and Checkpoint views      |
| Todo                | A manually created task that does not come from Canvas                                 |
| Unclassified        | An imported Canvas item awaiting the owner's classification                            |
| Subject             | The owner-facing name for a Canvas course                                              |
| Source value        | The latest value received from Canvas                                                  |
| Override            | A user-edited value that takes precedence over its Canvas source value                 |
| Active              | Visible in ordinary product views                                                      |
| Archived            | Hidden from ordinary views and accessible through Settings                             |
| Integration owner   | Google account whose Calendar and Gmail authorization powers automation                |
| Calendar-suppressed | An active Organato item that the owner chose not to keep in Google Calendar            |

## 7. Classification model

Classification is intentionally human-controlled because names are not reliable enough to distinguish assignments from checkpoints.

Each newly imported Canvas item is created immediately with `Unclassified` status. It appears in a persistent classification panel on Home. Importing is never blocked by an unanswered prompt.

The classification choices are:

- Assignment
- Checkpoint
- Both
- Decide later
- Archive

`Both` is a deliberate third choice because some Canvas items genuinely function as both. It is one underlying record:

- It appears in both tables.
- Editing it in either table updates the same item.
- It appears once in the calendar.
- It produces one reminder stream.
- Completing or archiving it applies everywhere.

No keyword learning or automatic classification is performed.

## 8. Work item requirements

Every assignment or checkpoint supports:

- Display name
- Due date
- Optional due time
- Days remaining, computed rather than manually stored
- Subject
- Optional priority
- Status
- Classification
- Notes
- Linked attachments
- Canvas source link when imported
- Calendar inclusion state
- Reminder inclusion state
- Created, updated, completed, submitted, and archived timestamps
- Source-versus-override indicators
- Change history

The table's default visible columns are:

1. Name
2. Due
3. Days remaining
4. Subject
5. Priority

Status is always available and should be visible by default unless the owner hides it through column settings.

### Statuses

- Not started
- In progress
- Submitted
- Completed
- Overdue
- Archived

`Overdue` is normally computed when an active item has passed its effective deadline and is not Submitted or Completed. The UI may display it as a derived state while preserving the prior working status internally.

`Archived` is not shown in standard status menus unless the archive action is invoked. Archived items are accessible only through Settings → Data → Archive.

### Priority

- Blank
- Low
- Medium
- High
- Urgent

Blank is the default. Organato never invents a priority.

## 9. Manual override policy

The owner can edit every planning field regardless of source.

For Canvas-imported records, Organato retains both:

- The latest source value from Canvas.
- The effective value shown by Organato.

When the owner edits a sourced field, the field receives a durable override. Later Canvas changes do not replace it. If Canvas then differs, the row shows a quiet `Source changed` indicator. The detail panel allows:

- Keep my value.
- Use the Canvas value.
- Compare the two values.
- Remove my override and follow Canvas again.

Canvas identifiers and the source link cannot be manually repointed. A manual item can be duplicated from an imported item if a separate record is required.

## 10. Todo requirements

Todos are entered manually and support:

- Task
- Due date
- Optional due time
- Days remaining
- Subject
- Priority
- Status
- Notes
- Linked attachments
- Recurrence
- Calendar inclusion
- Reminder inclusion
- History

Recommended recurrence options:

- Does not repeat
- Daily
- Weekdays
- Weekly
- Every two weeks
- Monthly
- Custom interval

Completing a recurring todo completes the current occurrence and generates the next occurrence. Editing can apply to one occurrence or the whole series.

Todos use the statuses Not started, In progress, Completed, Overdue, and Archived. `Submitted` is not meaningful for todos.

## 11. Subject requirements

Canvas course names are imported as subjects. Settings allows the owner to:

- Rename the display name without changing the Canvas course.
- Assign a colour.
- Set a short label.
- Hide an inactive course from creation menus.
- Merge only the visual display of two course sections under one subject.
- Restore the original Canvas course name.

Each source record retains its Canvas course ID, even when the displayed subject is renamed.

## 12. Search, filters, and views

Global search covers work items, todos, subjects, and notes. It does not index secret values or full attachment contents.

Filters include:

- Type
- Subject
- Priority
- Status
- Due range
- Source
- Has notes
- Has attachments
- Calendar state
- Classification state

Users can save a named view, choose its columns, set its sort order, and optionally make it the default for a page.

Default useful views:

- Due soon
- Overdue
- High and urgent
- Unscheduled
- Submitted
- Completed this week

## 13. Reminder requirements

The reminder system uses Australia/Sydney time and is daylight-saving aware.

At 6:00 AM, Organato sends one consolidated HTML email only if at least one incomplete, non-submitted item is due within the next seven calendar days.

The email contains:

- A strong section for items due today or overdue.
- Highlighted reminder sections for items exactly one, two, three, or seven calendar days away.
- A compact summary of all other items due in the seven-day window.
- Assignment, checkpoint, both, and todo labels.
- Subject and priority.
- Effective due date and time.
- Direct Organato link.
- Direct Canvas link where available.
- A footer showing last successful Canvas and Calendar synchronization.

There is never one email per item. All qualifying items are combined.

When an hourly Canvas import discovers new work already less than seven days away, it sends at most one immediate HTML alert for that entire sync batch, then the normal morning digest continues. An idempotency record prevents repeats.

Submitted and Completed items stop appearing in reminders immediately. Archived and calendar-suppressed items are excluded from reminder emails only when their reminder toggle is also off; suppressing a calendar event alone does not suppress safety reminders.

## 14. Calendar requirements

Organato has an internal calendar containing all active assignments, checkpoints, both-type work items, and todos with due dates.

The Google integration creates or adopts a dedicated calendar named `Organato`.

Only Organato-created events are synchronized. Unrelated Google Calendar events are not read into Organato, displayed, changed, or deleted.

Google is authoritative for direct edits to Organato-owned events:

- A Google title edit becomes the Organato display name override.
- A Google date/time edit becomes the Organato due-date override.
- A Google description edit updates the editable calendar note area, not protected Canvas metadata.
- Deleting the Google event marks the item calendar-suppressed rather than archiving the underlying work.
- Re-enabling calendar sync for the item creates a new event.

This is therefore **scoped two-way synchronization for Organato-owned events**, even though the rest of Google Calendar is strictly outside the app's scope.

## 15. PWA and device requirements

- Installable from supported desktop and mobile browsers.
- Desktop-first layout from approximately 1024 pixels upward.
- Functional tablet and phone navigation.
- Online connection required for fresh data and all mutations.
- The service worker may cache the application shell for fast loading, but the product must not claim offline data support.
- If the network is unavailable, show a clear read-only connection state and do not imply that unsaved changes succeeded.

## 16. Accessibility requirements

- Full keyboard access to navigation, tables, dialogs, calendar controls, and settings.
- Visible focus state that fits the minimal theme.
- Colour is never the only signal for subject, priority, status, or sync health.
- Minimum WCAG AA contrast.
- Reduced-motion support.
- Semantic headings and landmarks.
- Screen-reader labels for icon-only controls.
- Table view has an accessible linear alternative on narrow screens.
- Dates are rendered in readable local formats and exposed with full date/time labels.

## 17. Product-level success metrics

Metrics are stored locally in Organato and are optional. No third-party analytics are required.

- Percentage of Canvas items classified within 24 hours.
- Number of upcoming Canvas items imported successfully.
- Count of overdue active items.
- Count of items completed before their due date.
- Canvas, Calendar, and email automation success rate.
- Time since the last successful Canvas sync.
- Daily and weekly workload by subject.

The most meaningful success criterion is behavioural: the owner can trust Organato enough that manual copying into Notion is no longer necessary.
