# Organato settings catalogue

Settings is both configuration and the home of infrequent administrative surfaces. The ordinary navigation remains intentionally small.

## 1. Settings navigation

Recommended sections:

1. Account & access
2. Appearance
3. Home
4. Assignments & checkpoints
5. Todo
6. Calendar
7. Canvas / Reshet
8. Email & reminders
9. Subjects
10. Search & shortcuts
11. Accessibility
12. Data & archive
13. Security
14. Advanced
15. About

Settings search should locate options by label and synonyms.

## 2. Account & access

### Profile

- Display name: default from Google, locally overrideable.
- Preferred sign-in identity.
- Workspace timezone: default `Australia/Sydney`.
- Date format: default `D MMM YYYY`.
- Time format: default 12-hour, optional 24-hour.
- First day of week: default Monday.

### Allowed Google accounts

- List normalized emails and last sign-in.
- Add another owner email.
- Disable an identity.
- Remove an unused identity.
- Mark the integration owner.
- Require recent Google reauthentication for changes.

Guardrails:

- At least one owner remains.
- Changing the integration owner requires a fresh Google Calendar/Gmail connection.
- An added email has no access until Google verifies it during sign-in.

### Active sessions

- Device/browser description.
- Approximate last activity.
- Created date.
- Current session marker.
- Revoke one.
- Revoke all other sessions.

## 3. Appearance

- Theme: Obsidian Dark, Pure Black, Soft Dark, Light, System.
- Density: Comfortable, Compact.
- Sidebar: Expanded, Collapsed, Remember per device.
- Sidebar position: Left only in version one.
- Content width: Fluid, Focused.
- Table row height.
- Font size: 90–120%.
- Interface font: System default.
- Monospace countdown numerals: On by default.
- Reduce visual colour: Off by default.
- Show subject colour as: Dot, Edge, Text accent.
- Corner style: Subtle, Rounded.
- Animation: System, Reduced, On.

## 4. Home

- Show classification inbox: always on when non-empty.
- Auto-expand classification inbox: on.
- Classification batch size: one item at a time.
- Home panel order via drag.
- Show mini calendar: on.
- Mini calendar starts on: current month.
- Show quick todo: on.
- Upcoming assignment count: default 6.
- Upcoming checkpoint count: default 6.
- Include Both items in both panels: on.
- Show workload strip: on.
- Workload horizon: default 7 days.
- Show completed-today items: on.
- Show sync-health footer: on.
- Default Home greeting: off, preserving minimalism.

## 5. Assignments & checkpoints

- Default sort.
- Default saved view per page.
- Visible columns per view.
- Sticky Name column: on.
- Show source icons: on.
- Open Canvas links in new tab: on.
- Row click action: open inspector.
- Inline editing: on.
- Show Submitted in active tables: on.
- Show Completed until: end of day, 7 days, or immediately hide.
- Default: hide Completed after end of day.
- Auto-archive Completed after: Never by default.
- Auto-archive Submitted after: Never by default.
- Ask before bulk archive: on.
- New manual work default type: Assignment.
- Default calendar inclusion: on.
- Default reminders inclusion: on.
- Source-change indicator: on.

Classification remains manual; there is deliberately no keyword-learning setting.

## 6. Todo

- Quick-add default subject: None.
- Quick-add default due time: 11:59 PM when a date but no time is entered.
- New todos appear in calendar: on.
- New todos appear in reminders: on.
- Completion sound: off.
- Keep completed visible until: end of day.
- Recurrence generation: on completion.
- Default recurrence: none.
- Weekdays definition: Monday–Friday.
- Natural shorthand parsing: on.
- Require shorthand preview for ambiguity: on.
- Show notes preview: off.
- Show attachment indicator: on.

## 7. Calendar

### Organato calendar

- Default view: Month.
- Available views: Month, Week, Agenda.
- First day: Monday.
- Week numbers: off.
- Show weekends: on.
- Working/day visible hours: 6:00 AM–11:59 PM.
- Date-only items: all-day.
- Manual date default cutoff: 11:59 PM.
- Show Completed through end of day: on.
- Subject filter memory: per device.
- Drag to reschedule: on.
- Confirm drag for Canvas items: optional, off by default because undo exists.

### Google Calendar

- Connection identity.
- Calendar name: `Organato`.
- Stored Calendar ID display.
- Connection state.
- Last pull and push.
- Reconcile now.
- Open in Google Calendar.
- Disconnect.
- Rebuild missing events.
- Adopt Google edits: on and locked by the selected conflict policy.
- On Google event deletion: suppress event, keep item.
- Automatically retry transient failure: on.
- Default event reminders inside Google Calendar: none, avoiding duplicate notification systems.
- Event description contents toggles: subject, priority, Organato link, Canvas link.

Changing conflict policy away from `Google wins for Organato-owned event fields` is an advanced future option, not required initially.

## 8. Canvas / Reshet

- Canvas hostname.
- Connected Canvas user.
- Token status.
- Last validated.
- Last successful sync.
- Next expected sync.
- Sync every hour: on.
- Sync now.
- Import active courses only: on and locked.
- Import upcoming assignments only: on and locked.
- Import no-due upcoming items: on.
- Read submission status: on.
- Course list and detected assignment counts.
- Replace token.
- Disconnect.
- Recent sync history.
- Download sanitized diagnostic report.

### Source update behaviour

- User overrides win: on and locked by product decision.
- Notify when source differs: on.
- Canvas removal action: archive after confirmation sync.
- Missing confirmations required: default 2, advanced range 2–5.

Disconnecting Canvas does not delete imported items.

## 9. Email & reminders

### Connection

- Sending Google identity.
- Recipient list.
- Add allow-listed recipient.
- Send test email.
- Last successful send.
- Last failure.
- Reconnect Gmail.

### Schedule

- Daily digest: on.
- Time: 6:00 AM.
- Timezone: Australia/Sydney.
- Send only when something is due within seven days: on and locked by decision.
- Summary window: seven days.
- Highlight reminder days: 7, 3, 2, 1.
- Include overdue: on.
- Include due today: on.
- Immediate short-notice import alert: on.
- Maximum messages/day: 10 safety ceiling.

### Contents

- Combine all items into one email: on.
- Include assignments: on.
- Include checkpoints: on.
- Include todos: on.
- Both items appear once: on.
- Include priority: on.
- Include subject: on.
- Include Organato link: on.
- Include Canvas link: on.
- Include sync-health footer: on.
- Include completed/submitted: off and locked.
- Template: `Minimal dark`, with future versioned choices.
- Plain-text alternative: on and locked.
- Remote tracking: off and locked.

### Quiet controls

- Pause email without disconnecting.
- Pause until date.
- Disable reminders for one item from its inspector.
- Retry latest failed digest.
- View recent delivery history.

## 10. Subjects

For each subject:

- Canvas source name.
- Display name.
- Short name.
- Colour.
- Active/hidden state.
- Number of active items.
- Restore source name.

Global subject controls:

- Sort alphabetically or custom.
- Add manual subject.
- Reorder.
- Reset colours.
- Accessible colour check.
- Visual merge/group course sections.

Deleting a subject with items is disallowed. It can be hidden or its items reassigned.

## 11. Search & shortcuts

### Search

- Include notes: on.
- Include archive in global search: off.
- Fuzzy matching: on.
- Search result limit.
- Recent searches: local only, on.
- Clear search history.

### Command palette

- Show recent commands: on.
- Show keyboard hints: on.
- Reset command ordering.

### Keyboard shortcuts

- View all.
- Customize supported shortcuts.
- Detect conflicts.
- Reset defaults.
- Disable multi-key navigation sequences.

## 12. Accessibility

- Reduce motion.
- Increase contrast.
- Increase font size.
- Underline external links.
- Always show text with icons.
- Use patterns/labels in addition to subject colours.
- Focus-ring strength.
- Screen-reader announcements for sync and saves.
- Table keyboard mode.
- Prefer agenda calendar on narrow screens.
- Time format.
- Test colour contrast for subject palette.

System preferences are honoured by default.

## 13. Data & archive

### Archive

This is the only standard entry point to archived records.

- Search archive.
- Filter by type, subject, year, archive reason.
- Restore.
- Export selected.
- Permanently delete with typed confirmation.
- Show archived count and estimated storage.

### Export

- Export full JSON backup.
- Export assignments CSV.
- Export checkpoints CSV.
- Export todos CSV.
- Export archive CSV.
- Include history in full backup: on.
- Confirm that secrets are excluded.

### Import

- Select JSON backup.
- Validate and preview.
- Merge mode.
- Conflict summary.
- Create pre-import backup.

### Retention

- Sync history: 90 days.
- Email delivery history: 180 days.
- Detailed item history: one year.
- Auto-delete archive: Never.
- Clear old operational logs now.

### Reset

- Reset interface preferences.
- Remove all manual todos.
- Archive all active work.
- Delete all Organato data.

The last option requires recent reauthentication, typed workspace name, backup offer, and clear explanation that external Canvas and Google source data are not deleted.

## 14. Security

- Active sessions.
- Last sign-ins.
- Security events.
- Reauthenticate now.
- Revoke all sessions.
- Revoke Canvas token metadata from Organato.
- Revoke Google integration.
- Token encryption key version status.
- Copy privacy-policy URL.
- View requested Google scopes in plain language.
- View deployment origin and allowed redirect origins.
- Download sanitized security diagnostic.

No setting displays a full secret.

## 15. Advanced

Advanced settings are collapsed behind an explanation.

- Internal daily usage ceilings.
- Manual Calendar full rebuild.
- Force Canvas full rescan.
- Clear Calendar incremental sync token.
- Clear non-secret local device preferences.
- Show item IDs.
- Show integration run IDs.
- Enable verbose sanitized diagnostics temporarily.
- Date-only cutoff time.
- Canvas missing-confirmation threshold.
- Export schema version.
- PWA update channel.

There is no setting to enable billing or paid services.

## 16. About

- Organato version.
- Build date and commit.
- Database schema version.
- Open-source licence notices.
- Dependency licence report.
- Links to source repository if desired.
- Privacy policy.
- Free-only policy.
- Provider status links.
- Last free-tier review date.
- Check for PWA update.

## 17. Settings UX rules

- Save ordinary toggles immediately.
- Show undo after reversible changes.
- Use explicit Save for multi-field connection forms.
- Explain consequences before disconnecting an integration.
- Search results navigate to and highlight the exact setting.
- Settings labels use plain language, with technical detail beneath when necessary.
- Settings must never become a substitute for sensible defaults.
