# Organato experience and interface

## 1. Design direction

Organato should feel calm before it feels impressive.

The visual reference is Obsidian's restraint: a near-black canvas, subtle grey structure, careful typography, compact information, almost no decorative colour, and interaction states that appear only when needed.

The interface must avoid:

- Large marketing-style headings.
- Gradient-heavy panels.
- Glassmorphism.
- Excessive cards inside cards.
- Bright status colours covering whole rows.
- Permanent labels for controls that are obvious from context.
- Animation that delays work.
- A “student portal” aesthetic.

The product personality is quiet, exact, and dependable.

## 2. Application shell

### Desktop

The page background is near-black. A floating grey navigation rail sits on the left with heavily rounded corners, giving it an elongated oval or capsule silhouette.

Recommended proportions:

- Viewport gutter: 16–24 px.
- Sidebar width: 220–248 px expanded.
- Sidebar collapsed width: 68–76 px.
- Sidebar top and bottom inset: 16–24 px.
- Main content maximum width: approximately 1500 px, fluid below that.
- Content padding: 24–40 px depending on viewport.

The sidebar contains:

1. Organato wordmark or compact mark.
2. Home.
3. Assignments.
4. Checkpoints.
5. Calendar.
6. Todo.
7. Flexible spacer.
8. Sync state.
9. User name/avatar and Settings.

The active page uses a slightly lighter surface and a slim neutral indicator. Subject colours do not colour the navigation.

### Tablet

The sidebar defaults to its collapsed icon rail. It can expand over content. Tables retain horizontal scrolling and sticky key columns.

### Phone

The rail becomes a five-item bottom navigation bar. Settings opens from the user/avatar control in the top bar. Table records become stacked list rows; tapping one opens the full detail sheet.

Phone support is complete but secondary. Dense editing remains most comfortable on desktop.

## 3. Global top bar

Every main page has a restrained top bar:

- Page title.
- Optional count or current date.
- Search trigger.
- `New` action where meaningful.
- `Sync now`.
- Command palette trigger.

Sync state language:

- `Up to date · 3 min ago`
- `Syncing Canvas…`
- `Calendar pending`
- `Action needed`
- `Offline`

A problem indicator opens a human-readable activity panel. It should never show raw error codes without an explanation.

## 4. Home

Home answers three questions:

1. What requires attention now?
2. What is coming next?
3. Is synchronization healthy?

### Desktop layout

The recommended layout uses a twelve-column grid:

- Classification inbox: full width when non-empty, otherwise absent.
- Mini calendar: five columns.
- Today/todo panel: seven columns.
- Upcoming assignments: six columns.
- Upcoming checkpoints: six columns.
- Workload strip and sync health: full width, visually quiet.

Cards have small radii compared with the capsule sidebar. The sidebar is the strongest rounded shape; content should not become a collection of bubbles.

### Classification inbox

This is the required Home-screen “popup.” It behaves as an anchored attention panel rather than a blocking modal.

When new Canvas items exist:

- A compact banner announces the count.
- The first item expands into a classification card.
- The card shows name, course, due date, Canvas link, and any source update warning.
- Actions are `Assignment`, `Checkpoint`, `Both`, `Later`, and overflow `Archive`.
- Keyboard shortcuts can select the visible choice.
- Classification immediately advances to the next item.
- Undo is offered after a choice.
- The panel can be collapsed but remains represented by a badge until empty.

On a return visit with outstanding items, the panel opens automatically. It never opens on top of unsaved work and never prevents navigation.

### Mini calendar

- Month header with previous, today, and next controls.
- Small date markers with count, not a pile of text.
- Selected date reveals its items below the grid.
- Subject colour appears as a dot or fine edge.
- Today is visibly distinct without using a bright solid circle.

### Today and todo panel

- Quick-add field at the top.
- Overdue tasks first.
- Then tasks due today.
- Then manually pinned tasks.
- Checkbox completion with undo.
- Inline priority and due-date controls.
- `View all todos` footer.

### Upcoming panels

Assignments and checkpoints each show the next five to eight active records. A `Both` item may appear in both panels but is visually tagged, and its calendar/reminder exists only once.

Each row contains:

- Name.
- Subject.
- Relative due label.
- Priority marker when set.
- Status control.

Canvas-backed names are links. A separate subtle external-link icon makes it clear that the destination leaves Organato.

### Workload strip

The strip summarizes the next seven days with stacked counts by subject and item type. It is not a gamification surface. It helps reveal unusually heavy days.

## 5. Assignments and Checkpoints pages

The two pages share one component and differ by saved filter and title.

### Header

- Clean page title.
- Active count.
- Search.
- Filter.
- Sort.
- View selector.
- Column chooser.
- New manual work item.

### Database table

Default columns:

| Column         | Behaviour                                                             |
| -------------- | --------------------------------------------------------------------- |
| Name           | Primary text; links to Canvas when sourced; opens detail on row click |
| Due            | Inline date/time editor                                               |
| Days remaining | Computed; not editable                                                |
| Subject        | Searchable select                                                     |
| Priority       | Optional select                                                       |
| Status         | Inline status select                                                  |

Optional columns:

- Type
- Source
- Notes preview
- Attachments
- Calendar state
- Last changed
- Created

Table behaviour:

- Sticky header.
- Sticky Name column on wide tables.
- Sort by clicking a header.
- Resize columns.
- Reorder columns.
- Multi-select rows.
- Bulk status, subject, priority, calendar, or archive action.
- Keyboard movement between cells.
- Enter edits the focused cell.
- Escape cancels an edit.
- Space opens a select or toggles selection.
- Row hover exposes small quick actions.
- Changes save immediately and provide undo.

Default sort:

1. Overdue.
2. Earliest due date.
3. Priority descending.
4. Name.

Items without dates appear last under `No due date`.

### Row signals

Signals are compact icons with accessible labels:

- Canvas source.
- Manual override.
- Canvas source changed.
- Calendar out of sync.
- Reminder disabled.
- Notes or attachments present.
- Item belongs to Both.

The table does not display internal IDs.

### Detail panel

Selecting a row opens a right-side inspector without losing table context.

Sections:

1. Editable name and status.
2. Due date/time, subject, priority, and classification.
3. Canvas source link and source metadata.
4. Notes.
5. Linked attachments.
6. Calendar and reminder toggles.
7. Source comparison, shown only when relevant.
8. Activity/history.
9. Archive action.

Manual override fields have an unobtrusive reset icon. Hover or focus explains `Following your value; Canvas currently says …`.

## 6. Todo

Todo uses the same table language to reduce learning cost.

Default columns:

- Completion checkbox/status.
- Task.
- Due.
- Days remaining.
- Subject.
- Priority.
- Recurrence.

Quick creation:

- Typing a task name and pressing Enter creates an unscheduled todo.
- Optional natural shorthand can be parsed only with deterministic, local rules—for example, `Essay outline tomorrow 4pm #English !high`.
- A preview must appear before ambiguous parsed values are accepted.

Recurring tasks display their recurrence rule and the next generated occurrence. Completing an occurrence must not alter previous history.

## 7. Calendar

### Views

- Month
- Week
- Agenda/list

Month is the default. The selected view and date persist per device.

### Event appearance

- Thin subject-colour edge or dot.
- Name.
- Due time when not all-day.
- Small type glyph.
- Priority only when High or Urgent.
- Completed items fade but remain visible until the end of the day; then the default calendar filter hides them.

`Both` items appear once with a combined type label.

### Interactions

- Click empty date/time to create a todo by default.
- Drag an event to reschedule; imported items receive a user due-date override.
- Resize a timed event to alter its planning block only if duration support is enabled later; due dates themselves remain a point in time.
- Click an event to open the same detail inspector used by tables.
- Filters for item type, subject, priority, and status.
- A clear indicator shows whether the displayed event is synchronized, pending, suppressed, or conflicted.

### Google Calendar relationship

The calendar header includes:

- `Google Calendar connected`.
- Last successful reconciliation time.
- Link to open the dedicated Organato calendar in Google.
- Problem indicator if authorization or writes fail.

Direct Google edits are displayed in Organato after reconciliation with a small `Edited in Google Calendar` history entry.

When both sides changed since the last push, the item is parked in
conflict instead of either side winning silently. The Inspector shows a
banner with **Keep Organato** / **Use Google**; the calendar marks the
event with a warning icon until resolved.

## 8. Search

`Cmd/Ctrl + K` opens the command palette. `/` focuses search when no field is active.

Search results are grouped:

- Actions.
- Assignments.
- Checkpoints.
- Todos.
- Subjects.
- Settings.

Result rows show enough context to distinguish similar names. Search supports simple filters such as `subject:english`, `priority:high`, `due:this-week`, and `status:overdue`.

## 9. Command palette

Commands include:

- Go to any page.
- Create todo.
- Create manual assignment/checkpoint.
- Sync now.
- Classify next item.
- Search archive.
- Toggle theme.
- Open keyboard shortcuts.
- Export backup.
- Open integration health.

Destructive commands require confirmation or are followed by a meaningful undo.

## 10. Notes and attachments

Notes use plain text or Markdown with a preview toggle. The editor should remain lightweight and should not become a full document system.

Version one attachments are secure links with:

- Label.
- URL.
- Optional type.
- Created date.

This satisfies cross-device attachment access without introducing a paid or card-gated file-hosting dependency. Future file uploads must pass the same free-only review before inclusion.

## 11. Statistics

Statistics are private and derived from existing records:

- Items due by day for the next two weeks.
- Active workload by subject.
- Completion by week.
- Completed on time versus after due date.
- Current overdue count.
- Average lead time between import and completion.
- Classification inbox age.

Charts must have adjacent textual summaries and accessible data tables. No analytics data leaves Organato.

## 12. Themes

Theme options:

- Obsidian Dark (default).
- Pure Black.
- Soft Dark.
- Light.
- System.

Theme changes alter surfaces and text, not semantic meaning. Subject colours are adjusted to maintain contrast.

Suggested default tokens:

| Token          | Suggested value          |
| -------------- | ------------------------ |
| App background | `#0B0B0C`                |
| Sidebar        | `#252527`                |
| Raised surface | `#171719`                |
| Hover surface  | `#202023`                |
| Primary text   | `#F2F2F3`                |
| Secondary text | `#A3A3AA`                |
| Muted text     | `#71717A`                |
| Border         | `rgba(255,255,255,0.08)` |
| Focus          | `#B7A7FF`                |
| Danger         | `#F87171`                |

These are starting points, not a licence to use low-contrast text.

## 13. Typography and icons

- Use a system sans-serif stack for speed and familiarity.
- Optional monospace numerals for countdowns and compact metadata.
- Recommended base size: 14–15 px on desktop.
- Use open-source Lucide icons or a similarly restrained icon family.
- Avoid mixing icon styles.

## 14. Motion

- 100–180 ms for small state transitions.
- No entrance animation for every row.
- Sidebar expansion and inspector opening may use subtle easing.
- Drag operations use direct movement with no decorative bounce.
- Honour `prefers-reduced-motion`.

## 15. Empty, loading, and error states

### Empty states

Use practical text:

- `Nothing to classify. Canvas is up to date.`
- `No assignments match this view.`
- `Nothing is due in the next seven days.`
- `No archived items.`

### Loading

Use layout-preserving skeletons only for the initial fetch. Subsequent mutations use local optimistic updates with a saved/pending indicator.

### Errors

Every error should answer:

1. What did not happen?
2. Is data safe?
3. What can the owner do?

Example: `Canvas could not be checked because its session expired. Your existing Organato items are unchanged. Reconnect Canvas in Settings.`

## 16. Keyboard shortcut defaults

| Shortcut       | Action                                |
| -------------- | ------------------------------------- |
| `Cmd/Ctrl + K` | Command palette                       |
| `/`            | Search                                |
| `G` then `H`   | Home                                  |
| `G` then `A`   | Assignments                           |
| `G` then `C`   | Checkpoints                           |
| `G` then `T`   | Todo                                  |
| `G` then `L`   | Calendar                              |
| `N` then `T`   | New todo                              |
| `N` then `W`   | New work item                         |
| `S` then `Y`   | Sync now                              |
| `?`            | Shortcut reference                    |
| `Esc`          | Close inspector/dialog or cancel edit |

Shortcuts are disabled while typing, can be customized, and always have clickable equivalents.
