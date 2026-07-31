# Ato product standards

**Status:** Proposed suite standard, grounded in the shipped Organato product  
**Applies to:** Organato, Emailato, Calandato, and Ato Centre  
**Last audited:** 2026-07-31  
**Owner:** Ethan Likht

## 1. Purpose and boundaries

This document defines the shared product character and quality bar for the Ato
family. It covers product philosophy, product identity, naming, voice, logo
usage, navigation, interaction behaviour, accessibility, notifications,
privacy, performance, quality, release practice, and documentation.

It intentionally does **not** define:

- exact colours, spacing, type scales, surface treatments, component styling,
  or other detailed visual-theme tokens; or
- cross-app schemas, APIs, identity exchange, event contracts, synchronization,
  conflict resolution, or Ato Centre's data-ingestion architecture.

Those belong in the separate suite theme and cross-app framework documents.
When documents overlap, data/security contracts outrank convenience, and the
theme document owns exact presentation values.

Normative language is deliberate:

- **Must** is a release requirement.
- **Should** is the default and needs a recorded reason to vary.
- **May** is optional.

## 2. Evidence and certainty

This standard separates established evidence from recommendations so that a
preference is not accidentally presented as a historical fact.

### 2.1 Audit result

- **Organato** is implemented and documented. Its repository contains a
  production PWA, Worker API, tests, runbooks, a decision register, security
  requirements, and a reusable code-native brand mark.
- **Emailato**, **Calandato**, and **Ato Centre** currently have no commits or
  tracked product files. At audit time, each contains only Finder metadata and
  an empty Git repository.
- The current Centre folder is named `ato centre`. The user-facing product name
  in this standard is **Ato Centre**; a folder or repository rename should be a
  separate deliberate change.

Consequently, sections labelled **Observed** are evidence from Organato.
Descriptions of the other three apps come from the owner's brief. All
suite-wide extensions are labelled **Recommended** until adopted.

### 2.2 Primary evidence

The strongest sources in Organato are:

- `README.md`: private single-owner purpose, calm/compact product direction,
  desktop-first PWA, free-only operation, notification restraint, portability.
- `docs/01-product-specification.md`: goals, terminology, search, device and
  accessibility requirements, success measures.
- `docs/02-experience-and-interface.md`: navigation, interaction hierarchy,
  keyboard behaviour, practical states, motion, and plain-language errors.
- `docs/06-security-and-privacy.md`: privacy classification, least privilege,
  narrow scopes, no tracking, secret handling, recovery.
- `docs/07-settings-catalogue.md`: sensible defaults, immediate/reversible
  settings, admin surfaces, accessibility controls.
- `docs/08-delivery-and-quality-plan.md`: risk-proportionate test strategy,
  release checklist, and definition of done.
- `docs/09-decision-register.md`: confirmed decisions versus interpretations,
  defaults, change control, and the final orbital mark decision.
- `docs/10-build-and-release-runbook.md` and
  `docs/11-production-handoff.md`: operational gates, deployment, recovery, and
  production handoff.
- `apps/web/src/components/BrandMark.tsx`, PWA icon SVGs, `AppShell.tsx`,
  `NetworkStatus.tsx`, and `Toast.tsx`: implemented identity, navigation,
  offline honesty, accessible status, and undo behaviour.

## 3. Established product DNA — observed

These rules are already explicit or implemented in Organato.

### 3.1 Product philosophy

1. **Quiet usefulness over spectacle.** The product should feel calm before it
   feels impressive. Decoration must not compete with the work.
2. **Trust before breadth.** The central workflow becomes useful only when its
   source, state, edits, and failure modes are dependable.
3. **One trusted place, not another stale copy.** Organato exists to remove
   repeated manual transfer and make the next action obvious.
4. **Human judgment stays visible.** Ambiguous choices are not silently guessed;
   the owner can decide without blocking safe import or capture.
5. **Private by default.** The app is for one owner, possibly using several
   allow-listed identities, not a public or collaborative service.
6. **Free means genuinely free.** Required operation uses no payment card,
   expiring trial, paid developer account, or closed-source application library.
7. **Owner control and portability.** Data can be exported, archived records are
   recoverable, integrations can be revoked, and service boundaries are
   replaceable.
8. **Desktop first, not desktop only.** Dense work is optimized for desktop;
   phone and tablet remain complete and usable rather than becoming screenshots
   of a desktop layout.

### 3.2 Detail and interaction level

Organato demonstrates a high-detail product standard:

- a primary workflow plus search, filters, saved views, shortcuts, command
  palette, notes, history, undo, backup, archive, health, and settings;
- explicit initial, empty, loading, pending, saved, offline, partial, conflict,
  success, and failure states;
- optimistic feedback only when truthfully backed by a pending/saved state;
- confirmation for destructive actions and undo for reversible ones;
- practical empty copy instead of decorative filler;
- human-readable integration health instead of unexplained codes;
- deterministic demo data and redacted fixtures for inspection without secrets;
- settings that expose real control without forcing the owner to configure
  sensible defaults first.

### 3.3 Voice and naming

The implemented voice is quiet, exact, short, and reassuring without being
playful or corporate. Examples include `Up to date`, `Action needed`,
`Nothing to classify`, and `Existing Organato items are unchanged`.

Errors consistently answer:

1. What did not happen?
2. Is existing data safe?
3. What can the owner do next?

Labels use the owner's vocabulary. For example, the interface uses **Reshet**
where that is the familiar school name and retains **Canvas** when technical
precision is needed. Raw provider language is translated rather than exposed.

### 3.4 Navigation and control hierarchy

Organato implements:

- a small set of top-level destinations;
- desktop sidebar navigation and phone bottom navigation;
- global search and a command palette;
- contextual `New` and `Sync now` actions;
- an inspector/detail surface that preserves list context;
- Settings as the home of infrequent administration, archive, security, and
  advanced diagnostics;
- visible current location, focus, sync state, and owner identity;
- a skip link, semantic navigation landmarks, and labelled icon controls.

### 3.5 Accessibility

The documented and implemented baseline includes keyboard access, visible
focus, semantic headings/landmarks, icon labels, minimum WCAG AA contrast,
reduced-motion support, screen-reader announcements, non-colour status signals,
readable full date/time labels, high zoom/large text testing, and a linear
alternative for dense tables or calendars on narrow screens.

### 3.6 Notifications and feedback

Organato avoids notification spam: qualifying work is consolidated into one
useful digest, short-notice imports into at most one batch alert, and duplicate
delivery is prevented. In-product feedback is compact, dismissible, announced
politely when enabled, and offers Undo when possible. Completion and submission
immediately stop irrelevant reminders.

### 3.7 Privacy, safety, and accountability

Organato uses exact allow-listing, server-enforced authorization, least-privilege
provider scopes, encrypted credentials, no third-party analytics, no advertising
or tracking pixels, no AI-training use, sanitized logs, secret-free exports,
recent authentication for sensitive operations, and explicit revoke/delete
paths. External content is untrusted and rendered safely. The product fails
closed for unauthorized access and fails safely when integrations break.

### 3.8 Quality and release discipline

The repository runs formatting, lint, type checks, unit/component/contract tests,
production build, licence checks, vulnerability audit, and secret scanning as a
single gate. The documented definition of done also requires accessibility,
failure states, security/privacy consideration, diagnostics, export/settings
coverage, and updated documentation. Provider and timezone behaviour are tested
at boundaries rather than assumed.

## 4. Suite standards — recommended

The following standards extend Organato's demonstrated DNA to the full Ato
family. They become observed standards after the owner adopts and each app
implements them.

### 4.1 Family product promise

Every Ato app must help the owner see, decide, and act with less mental overhead.
It must feel like a focused personal instrument, not a generic SaaS dashboard.

Every feature should pass five questions:

1. Does it remove repeated work or make important state clearer?
2. Can the owner understand what it did and undo or recover where appropriate?
3. Does it preserve privacy and request only the access it needs?
4. Does it fit the app's focused responsibility without duplicating another app?
5. Can it be operated and maintained without surprise cost?

If the answer is no, defer or redesign the feature.

### 4.2 App identity and responsibility

| Product        | Identity                    | Primary promise                                                            | Justified exception                                                                                                  |
| -------------- | --------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Organato**   | Academic workload organizer | Make school work, urgency, classification, and completion trustworthy      | School language such as Reshet/Canvas is appropriate; retain its current planning-first navigation                   |
| **Emailato**   | Personal email app          | Turn a high-volume inbox into calm, deliberate communication and follow-up | Conventional mail folders and message density may require more navigation and stronger bulk actions than other apps  |
| **Calandato**  | Formal calendar app         | Make time commitments precise, legible, and dependable                     | Date navigation, time-zone detail, recurrence, and invitation states may need more persistent controls               |
| **Ato Centre** | Suite command centre        | Give a concise cross-app overview, health, search, and launch point        | It may summarize every app, but should route deep work to the owning app instead of rebuilding all domain interfaces |

The apps must remain useful independently. Ato Centre should add orientation and
coordination, not become a mandatory bottleneck. No app should silently take
ownership of another app's domain action.

### 4.3 Naming system

- User-facing names must be **Organato**, **Emailato**, **Calandato**, and
  **Ato Centre** with this capitalization.
- Use the full name on sign-in, About, permissions, exports, privacy text, and
  destructive confirmations. Shortening is acceptable only where space is
  genuinely constrained.
- Use **Ato** for the family and shared experience, not as a vague replacement
  for a specific app name.
- Repository/package identifiers should be lowercase and separator-safe, for
  example `emailato`, `calandato`, and `ato-centre`. Renaming existing folders is
  not required by this document.
- Prefer concrete nouns and verbs. Good labels include `Archive message`,
  `Move event`, `Reconnect calendar`, and `Open in Emailato`. Avoid `Manage`,
  `Solution`, `Workspace`, or `Smart` when a more exact label exists.
- Preserve domain terminology users already know, then explain provider or
  technical terms beneath it where needed.
- Use Australian English consistently (`centre`, `colour`) except in code,
  provider-owned field names, or quoted external language.
- Store and display dates in the owner's configured locale; suite defaults are
  Australia/Sydney, Monday-first, and `D MMM YYYY` unless the domain requires a
  more precise timestamp.

### 4.4 Voice and copy

All apps should sound like the same calm, capable product family.

**Do:**

- lead with the outcome: `Message moved to Archive`;
- state safety explicitly when a failure could cause anxiety, for example:
  `Your draft is still saved`;
- provide one useful next step: `Reconnect Emailato in Settings`;
- distinguish pending from complete: `Saving…`, `Saved`, `Send failed`;
- use sentence case and short labels;
- use first or second person only when it clarifies ownership (`Your calendar`).

**Do not:**

- use unexplained codes, provider exceptions, or stack traces in ordinary UI;
- blame the user (`You entered an invalid token`);
- claim success before confirmation;
- use exclamation marks, gamification, forced greetings, or celebratory motion
  for routine work;
- use vague copy such as `Something went wrong` without impact and recovery;
- call ordinary deterministic features `AI`, `smart`, or `magic`.

### 4.5 Logo scheme and brand use

**Observed master:** Organato's final mark is a code-native incomplete orbital
`O` with one organizing point. It has accent and monochrome variants, a compact
mark, a mark-plus-word lockup, and standard/maskable/monochrome PWA icons. The
component hides a decorative mark from assistive technology and supports an
accessible title when the mark carries meaning.

**Recommended family scheme:**

1. The incomplete orbit and single organizing point are the invariant Ato family
   shape. Do not give every app an unrelated logo.
2. Differentiate products through the adjacent wordmark and one approved app
   accent applied to the organizing point. Exact accents belong to the suite
   theme document.
3. Organato keeps the existing master geometry. Emailato, Calandato, and Ato
   Centre should not alter the orbit path, point size, or point position merely
   to create novelty.
4. Ato Centre uses the core Ato mark with the **Ato Centre** lockup. It should not
   combine all app logos into an unreadable small icon.
5. Use mark-only at favicon, app-icon, compact-sidebar, and small-avatar sizes.
   Use mark plus exact app name wherever product identity or consent matters.
6. Provide full-colour/accent, one-colour, reversed, and maskable-safe variants
   from one canonical vector source. Raster exports are outputs, never masters.
7. Never stretch, rotate, add shadows/gradients, place content inside the orbit,
   recolour the orbit with status colour, or animate it continuously.
8. Do not use a logo alone as a button label unless there is an accessible name.
   Decorative marks must be hidden from assistive technology.
9. Status colours and notification badges are separate from the organizing point;
   the brand must not look broken merely because an integration needs attention.

### 4.6 Navigation and information architecture

All apps must share a recognizable hierarchy without forcing identical domain
navigation.

- Keep primary navigation to the smallest durable set of work destinations.
- Put account, connections, archive/trash, privacy, security, diagnostics, and
  other infrequent administration in Settings or a clearly secondary surface.
- Preserve location and context when opening a record; prefer inspector, split
  view, sheet, or back-stack behaviour over unnecessary page replacement.
- Provide global search. Provide a command palette when the app has enough
  destinations/actions to justify it.
- Keep creation contextual and unambiguous. A global create action must reveal
  its target app/type before saving.
- Show app/integration health quietly but persistently when it affects trust.
- Desktop may use a sidebar or split view. Phone should use a bounded bottom
  navigation or equivalent native-feeling pattern; overflow moves to `More` or
  Settings rather than shrinking labels to illegibility.
- Icons supplement labels. Primary actions and unfamiliar destinations must not
  rely on icon recognition alone.
- Ato Centre cards/sections should answer `What needs attention?`, `What is next?`,
  and `Is every app healthy?`, then deep-link to the owning app.

App-specific domain conventions take priority where users have strong learned
expectations: Emailato may use inbox/folder/thread structure; Calandato may keep
Today, previous/next period, view switcher, and timezone controls persistently
available.

### 4.7 Interaction and state standards

Every meaningful workflow must define:

- initial and first-run state;
- empty state;
- loading and refresh state;
- pending/local state;
- confirmed success;
- partial success where batch work can split;
- offline or unreachable-provider behaviour;
- authorization expired/action-needed state;
- conflict/concurrent-edit behaviour;
- destructive and recovery path.

Additional rules:

- Save simple toggles immediately; use explicit Save for multi-field,
  connection, or message-composition forms.
- Offer Undo for reversible actions. Require consequence text and confirmation
  for irreversible actions; use typed confirmation only for exceptional broad
  deletion or replacement.
- Never discard a draft, edit, imported record, or locally valid state merely
  because an external service failed.
- Disable unavailable mutations when offline and say why. Do not imply offline
  data support unless it has been intentionally designed and tested.
- Keep defaults useful. Settings should refine behaviour, not serve as a setup
  maze for routine use.
- Bulk actions must show scope before execution and result counts afterwards.
- Power-user shortcuts must have visible discoverability and must not override
  text-entry or assistive-technology conventions.
- Motion must communicate relationship or state, remain brief, and honour
  reduced motion.

### 4.8 Accessibility standard

WCAG 2.2 AA is the minimum target for new suite UI. Each app must provide:

- complete keyboard operation and logical focus order;
- a visible focus indicator and focus restoration after dialogs/sheets;
- semantic regions, headings, lists, tables, forms, and dialog labelling;
- accessible names for icon-only controls;
- status communicated by text/shape as well as colour;
- polite announcements for saves, sync, sends, and background changes, with a
  user preference where frequent announcements may become noisy;
- text resizing and 200% zoom without loss of core function;
- reduced motion and increased contrast support;
- readable date/time labels including timezone where ambiguity matters;
- accessible alternatives for dense visual structures such as calendars,
  timelines, charts, and tables;
- plain-text email alternatives and meaningful link text;
- no drag-only, hover-only, or gesture-only required action.

Automated checking is necessary but not sufficient. Release validation must
include keyboard and screen-reader smoke passes on the primary workflows.

### 4.9 Notification standard

Notifications are an interruption budget, not a growth channel.

- Default to fewer, consolidated, actionable notifications.
- Notify only for a meaningful state change, owner-chosen reminder, urgent
  failure, or required decision.
- Make channel, schedule, quiet time, urgency, and opt-out understandable.
- Deduplicate retries and repeated upstream events.
- One event should have one owning notification. Ato Centre must not repeat a
  notification already delivered by the domain app unless the owner explicitly
  enables a centre summary.
- Show source app, reason, relevant time, and one primary action.
- Do not include unnecessary private content on a lock screen or in an email
  subject.
- Marketing, streak, engagement, and `we miss you` notifications are prohibited.

App-specific defaults:

- **Organato:** retain consolidated deadline/reminder behaviour.
- **Emailato:** do not notify for every incoming message by default; allow
  owner-defined priority senders/rules and a digest.
- **Calandato:** time-sensitive event reminders may be immediate, but must be
  owner-configurable and timezone-safe.
- **Ato Centre:** default to cross-app attention summaries and health escalation,
  not duplicate domain traffic.

### 4.10 Privacy and security standard

Every app must:

- be private and single-owner by default unless the owner explicitly approves a
  different user model;
- deny protected access by default and enforce authorization server-side;
- request the narrowest provider permissions needed for the described feature;
- separate basic sign-in from optional integration consent where scopes differ;
- keep secrets out of source, client storage, URLs, logs, analytics, exports,
  screenshots, and support diagnostics;
- encrypt stored provider credentials with keys managed separately;
- treat imported content, email HTML, invitations, links, files, and backups as
  untrusted;
- provide plain-language scope disclosure, connection health, revoke, export,
  archive/trash, and permanent-delete paths;
- use no advertising, selling/sharing of personal data, third-party behavioural
  analytics, tracking pixels, or AI training on owner data;
- collect only operational telemetry needed to keep the private product healthy,
  and sanitize/retain it for a bounded period;
- fail closed on identity/permission uncertainty and fail safely on provider
  outages;
- document recovery for account lockout, credential exposure, corrupt import,
  provider revocation, and data loss.

The existing free-only constraint should apply across the suite: no required
payment card, expiring trial, paid plan, paid developer account, or closed-source
application dependency. Any requested exception requires an explicit owner
decision, cost ceiling, exit plan, and updated decision register; it must never
be enabled automatically.

### 4.11 Performance and resilience standard

Use Organato's current targets as the suite baseline:

- authenticated shell usable within 2 seconds on a typical school connection
  after first load;
- cached navigation response under 150 ms;
- routine edit acknowledgement under 500 ms in normal conditions;
- layout-preserving loading without repeated full-page flashes;
- purpose-built aggregates rather than many sequential client requests;
- search indexed/debounced and long lists virtualized or paginated;
- no route loads an entire archive, mailbox, or multi-year calendar by default;
- background work is idempotent, bounded, retryable, and observable;
- provider failures preserve existing data and expose a useful recovery action.

Each app must add a domain-scale test. Organato currently names at least 2,000
active-plus-archived items. Emailato should test a large mailbox/thread sample;
Calandato a multi-year recurring/event sample; Ato Centre a realistic combined
summary. Record the chosen scale and measured result in the app's quality plan.

### 4.12 Testing and release standard

Every repository should expose one documented full gate, preferably `check`,
that covers as applicable:

1. formatting and lint;
2. strict type checking;
3. domain/unit and invariant tests;
4. component tests;
5. integration contract tests using redacted fixtures;
6. authorization, validation, XSS/unsafe-content, and secret-leakage tests;
7. accessibility automation plus manual smoke checks;
8. primary browser/end-to-end workflows on desktop and phone;
9. production build and migration verification;
10. dependency licence check, vulnerability audit, and secret scan.

A feature is done only when:

- its written acceptance criteria pass;
- all material states from section 4.7 exist;
- keyboard and screen-reader use is possible;
- tests match its risk and failure cost;
- privacy, permission, notification, performance, and cost effects are recorded;
- settings, export/deletion, diagnostics, and recovery account for it where
  applicable;
- relevant docs and the decision register are current.

Before release, run smoke tests against real providers with dedicated preview or
owner-approved accounts, verify exact origins/redirects, confirm no production
secrets or personal fixtures are committed, test upgrade/rollback or recovery,
and take a secret-free backup where persistent data changes. Recheck unstable
provider limits and policies at release time rather than relying on old notes.

### 4.13 Documentation conventions

Each app should adopt the depth and separation already used by Organato. At
minimum maintain:

- `README`: purpose, boundaries, current state, setup, and documentation map;
- product specification: goals, non-goals, user model, terminology, core rules;
- experience document: navigation, screens, interactions, responsive and
  accessibility behaviour;
- data/behaviour and cross-app contract references;
- integration and automation document;
- security/privacy document;
- settings catalogue;
- delivery/quality plan with acceptance criteria and test matrix;
- decision register separating confirmed decisions, interpretations,
  recommendations, unresolved questions, and dated changes;
- build/release/recovery runbook;
- production handoff containing only non-secret operational facts.

Documentation rules:

- Lead with product intent, then exact behaviour and exceptions.
- Define domain terms once and use them consistently in UI, code, and docs.
- Use `Given / When / Then` for critical workflow acceptance criteria.
- Use ISO dates (`YYYY-MM-DD`) in records and change logs.
- Mark defaults, owner decisions, assumptions, recommendations, and unresolved
  questions separately.
- Record the source and review date for unstable limits, policies, scopes, or
  platform behaviour.
- Never paste secrets, live tokens, private message bodies, school data, or
  unredacted provider responses into documentation or fixtures.
- Include exact safe commands in runbooks and state expected results, rollback,
  and recovery.
- When a decision changes, update the decision register, affected specification,
  migrations/contracts if applicable, acceptance tests, and security/free-only
  review.
- Prefer one authoritative document per concern. Link instead of copying
  sections that can drift.

## 5. Decision checklist

Use this before approving a feature, redesign, integration, or release. A `No`
on a **must** item blocks release; `Not applicable` needs a short explanation.

### Product fit

- [ ] The owner problem and successful outcome are stated in one sentence.
- [ ] The feature belongs to this app; Ato Centre is not duplicating a domain app.
- [ ] It reduces repeated work, risk, or uncertainty rather than adding novelty.
- [ ] Non-goals and app-specific exceptions are recorded.
- [ ] The default is useful without extensive setup.

### Identity and language

- [ ] Product and Ato family names use approved spelling/capitalization.
- [ ] Copy is quiet, exact, and action-oriented.
- [ ] Errors explain failure, data safety, and next action.
- [ ] Brand mark usage follows the shared logo scheme and has accessible naming.
- [ ] Exact styling follows the separate suite theme standard.

### Workflow and state

- [ ] Initial, empty, loading, pending, success, partial, offline, conflict, and
      failure states are handled where applicable.
- [ ] Reversible actions have Undo; destructive scope and recovery are explicit.
- [ ] Bulk actions preview scope and report results.
- [ ] Keyboard, phone, and desktop workflows are complete.
- [ ] Search/navigation location and integration health remain understandable.

### Privacy, permissions, and notifications

- [ ] The minimum data and provider scopes are documented and user-facing.
- [ ] Secrets and private content cannot leak through clients, logs, exports,
      fixtures, notifications, or Ato Centre summaries.
- [ ] Revoke, export, deletion, and recovery paths are defined.
- [ ] Notifications are necessary, consolidated, deduplicated, and owner-controlled.
- [ ] No advertising, tracking, third-party behavioural analytics, or AI training
      use has been introduced.
- [ ] The feature remains truly free, or an explicit owner-approved exception is
      recorded with an exit plan.

### Accessibility and quality

- [ ] WCAG 2.2 AA, keyboard, screen-reader, zoom, contrast, and reduced-motion
      expectations are met.
- [ ] Visual information has a non-visual/non-colour equivalent.
- [ ] Performance is measured at a documented realistic domain scale.
- [ ] Unit/invariant, component, integration, security, accessibility, and browser
      tests are proportionate to risk.
- [ ] The full quality gate and production build pass.

### Release and stewardship

- [ ] Preview and production are isolated and exact origins/redirects are verified.
- [ ] Provider policy, free-tier, scope, and quota evidence is current.
- [ ] Migration, backup, rollback, and recovery have been rehearsed where needed.
- [ ] Documentation, decision register, acceptance criteria, and handoff are updated.
- [ ] The change leaves the owning app independently useful and Ato Centre honest
      about source, freshness, and action ownership.

## 6. Adoption notes

Organato should be treated as the compatibility baseline; do not retroactively
rename its established domain language or weaken its privacy, free-only,
accessibility, and quality commitments to manufacture consistency.

Emailato, Calandato, and Ato Centre should record this document as an adopted
suite dependency in their first decision register. Their initial product specs
should explicitly list any app-specific exception rather than silently diverging.
Once real implementations exist, re-audit all four apps and move genuinely shared
behaviour from **Recommended** to **Observed**.
