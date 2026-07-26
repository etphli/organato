# Master build prompt — build Organato completely

You are the lead product engineer, frontend designer, backend engineer, integration engineer, security engineer, QA engineer, and release engineer for Organato.

Your task is to build the **entire Organato application in one continuous execution**. Do not stop after creating a plan, mockup, scaffold, database schema, or partial MVP. Continue until the complete application described in the project documentation is implemented, tested, documented, and ready to configure and deploy.

## First action: read the complete specification

Before writing code, read every line of these files:

1. `README.md`
2. `docs/01-product-specification.md`
3. `docs/02-experience-and-interface.md`
4. `docs/03-data-and-behaviour.md`
5. `docs/04-integrations-and-automation.md`
6. `docs/05-architecture-and-free-stack.md`
7. `docs/06-security-and-privacy.md`
8. `docs/07-settings-catalogue.md`
9. `docs/08-delivery-and-quality-plan.md`
10. `docs/09-decision-register.md`

Treat these documents as the authoritative product requirements. Build all specified pages, workflows, states, integrations, settings, safeguards, responsive layouts, and quality controls.

When documents overlap:

1. Follow confirmed decisions in `docs/09-decision-register.md`.
2. Follow security and free-only constraints.
3. Prefer the more detailed requirement.
4. Preserve the central product intention: a private, quiet, dependable school command centre.

Do not replace the specification with your own simplified interpretation.

## Non-negotiable outcome

Produce a complete, production-quality, desktop-first PWA that:

- Uses Google sign-in and an exact email allow-list.
- Has one private shared workspace for the owner’s permitted Google identities.
- Securely connects to Canvas/Reshet using a personal API token.
- Automatically checks Canvas hourly and provides `Sync now`.
- Imports upcoming Canvas assignments only.
- Displays new imports in the Home classification panel.
- Supports Assignment, Checkpoint, Both, Decide later, and Archive classification actions.
- Implements Home, Assignments, Checkpoints, Calendar, Todo, and Settings.
- Provides editable Notion-like data tables.
- Supports manual overrides that survive Canvas updates.
- Retains Canvas source values and exposes source-change comparisons.
- Implements every documented status, priority, subject, note, linked-attachment, recurrence, history, undo, archive, search, filter, saved-view, command-palette, keyboard-shortcut, theme, accessibility, statistics, export, backup, and restore requirement.
- Creates and manages a dedicated Google Calendar named `Organato`.
- Synchronizes assignments, checkpoints, Both items, and todos.
- Ignores unrelated Google Calendar content.
- Pulls supported edits back from Organato-created Google events, with Google winning the documented event-field conflicts.
- Treats deletion of a Google event as calendar suppression, not deletion of the Organato item.
- Sends one predetermined HTML/plain-text digest at 6:00 AM Australia/Sydney time when incomplete work is due within seven days.
- Highlights the seven-, three-, two-, and one-day reminder points.
- Combines all qualifying work into one email.
- Sends at most one immediate batch alert when Canvas discovers short-notice work.
- Stops reminders for Completed, Submitted, and Archived items.
- Is responsive and installable on desktop, tablet, and phone.
- Does not claim full offline support.

## Free-only rule

Everything required to build and operate Organato must be:

- Free without an expiring trial.
- Usable without a credit card.
- Usable without a paid developer account.
- Open source when it is an application library.

Never:

- Add a paid dependency.
- Require a commercial component licence.
- Use premium FullCalendar modules.
- Attach or require a billing account.
- silently introduce a free trial.
- Suggest upgrading as the solution to a quota or platform limit.

Use the free architecture recommended in the documentation where it passes real validation. Recheck current official provider documentation before relying on unstable limits or OAuth behaviour.

Cloudflare Workers Free currently has a strict scheduled-invocation CPU constraint. Benchmark the real implementation. If the scheduled workload cannot reliably fit, implement the documented free local Node/`launchd` scheduler fallback rather than requiring payment. Keep provider boundaries portable.

## Engineering approach

Work autonomously. Make reasonable implementation decisions consistent with the documentation and record them in the decision register.

Do not ask the user to choose minor technical details. Do not stop to report that a later phase remains. Internally sequence the work into manageable phases, but continue through every phase in this run.

Only stop for user input if progress is genuinely impossible without an unavailable secret or an externally controlled decision. Missing secrets must not block local completion:

- Use typed environment-variable placeholders.
- Create `.env.example` without real values.
- Implement fake providers and redacted fixtures.
- Complete the real adapter code.
- Provide a protected setup flow.
- Test integration behaviour through mocks and contract fixtures.

Never invent, expose, print, or commit real credentials.

Preserve any unrelated existing user work. Use the existing repository rather than creating a separate project elsewhere.

## Required architecture

Unless a documented feasibility check proves a component unsuitable, use:

- TypeScript throughout.
- React and Vite for the PWA.
- Cloudflare Worker for authenticated API routes and scheduled handlers.
- Cloudflare D1 with committed SQL migrations.
- Hono or an equivalently small open-source Worker framework.
- Google OpenID Connect for authentication.
- `https://www.googleapis.com/auth/calendar.app.created` for the dedicated app-created calendar.
- `https://www.googleapis.com/auth/gmail.send` for sending without inbox access.
- Canvas REST API through a read-only application adapter.
- Open-source testing, validation, table, date, icon, and accessibility libraries described in the architecture document.

Keep business rules independent from Cloudflare bindings so the free local fallback can reuse them.

## Interface quality

The visual result must be polished, not a generic dashboard.

Follow `docs/02-experience-and-interface.md` precisely:

- Near-black Obsidian-like visual language.
- Floating grey capsule sidebar with heavily rounded corners.
- Minimal decoration and excellent information hierarchy.
- Compact, precise tables.
- Calm semantic colour usage.
- Complete hover, focus, selected, loading, empty, offline, pending, success, conflict, and failure states.
- Desktop-first layout with deliberate tablet and phone adaptations.
- Accessible keyboard navigation and visible focus.
- Reduced-motion and high-contrast support.

Do not use placeholder UI, inconsistent icons, excessive gradients, glassmorphism, oversized headings, or generic card grids.

Use deterministic sample data in development so every screen and state can be inspected without real credentials.

## Data correctness

Implement the documented unified item model and its invariants:

- One Canvas assignment maps to one Organato item.
- Both-classified work is never duplicated internally.
- Both items appear in both relevant tables but only once in Calendar and email.
- Source values and user overrides are separate.
- Days remaining uses Sydney calendar dates.
- Date-only deadlines appear as all-day events and use 11:59 PM Sydney internally.
- Overdue is derived without destroying the working status.
- Archives are excluded from ordinary queries.
- Canvas disappearance requires two successful full-sync confirmations.
- External writes and scheduled jobs are idempotent.
- Recurrence cannot generate duplicate occurrences.
- Every important mutation produces sanitized history.
- Optimistic concurrency prevents lost updates.

Enforce invariants in domain logic, database constraints, and tests where appropriate.

## Security requirements

Implement every applicable control in `docs/06-security-and-privacy.md`, including:

- Server-side Google token validation.
- Exact email allow-list and Google subject binding.
- Secure opaque sessions.
- Secure, HttpOnly, SameSite cookies.
- CSRF and origin protection.
- OAuth state, nonce, and PKCE where applicable.
- Recent reauthentication for sensitive settings.
- Server-side AES-GCM encryption for Canvas and Google refresh tokens.
- Deployment-managed encryption keys and client secrets.
- No tokens in the frontend, URLs, logs, exports, or Git.
- Narrow Google scopes.
- Canvas host pinning and cross-host redirect refusal.
- Parameterized database access.
- Runtime input validation.
- Strict security headers and CSP.
- Safe Markdown rendering.
- Escaping of Canvas, Google, email, and user-provided values.
- Rate limits and body-size limits.
- Session and integration revocation.
- Sanitized security events.
- Secret-free backups.

The application must fail closed for unauthorized access and fail safely for integration errors.

## Integration implementation

Build real provider adapters and deterministic fake adapters behind the same interfaces.

### Canvas

- Validate the configured HTTPS installation.
- Validate the personal token through a harmless endpoint.
- Fetch active courses and upcoming assignments.
- Follow pagination correctly.
- Bound concurrency.
- Import personalized due dates and submission state when available.
- Preserve Canvas IDs and HTML links.
- Make no Canvas mutation requests.
- Handle partial course errors, rate limits, invalid tokens, malformed responses, and temporary outages.

### Google Calendar

- Use separate integration authorization from basic sign-in.
- Create a dedicated Organato secondary calendar.
- Store its exact ID.
- Project each eligible item exactly once.
- Use event IDs, ETags, item versions, and private extended properties.
- Reconcile only the Organato calendar.
- Use incremental sync tokens where supported.
- Pull supported user edits into Organato overrides.
- Persist calendar suppression after Google deletion.
- Handle expired sync tokens, revoked authorization, conflicts, retries, and partial failure.

### Gmail

- Send from the integration owner through `gmail.send`.
- Produce HTML and plain-text MIME alternatives.
- Use inline email CSS.
- Load no external tracking assets.
- Escape all content.
- Implement the exact grouping and sorting rules.
- Use Sydney-local dates and daylight-saving-safe scheduling.
- Use delivery locks and unique idempotency keys.
- Expose test, retry, pause, health, and history controls.

## Complete settings

Implement the full settings information architecture in `docs/07-settings-catalogue.md`. Do not reduce Settings to a few integration buttons.

Settings must include:

- Account and allowed identities.
- Appearance.
- Home configuration.
- Assignment/checkpoint behaviour.
- Todo behaviour.
- Internal and Google Calendar configuration.
- Canvas configuration and sync history.
- Email schedule, contents, recipients, test, retry, and delivery history.
- Subjects.
- Search and keyboard shortcuts.
- Accessibility.
- Data, archive, export, import, retention, and reset.
- Sessions and security.
- Advanced diagnostics and safe repair operations.
- Version, licences, privacy, and last free-tier review.

Archive must be accessible through Settings and not added as a normal sidebar destination.

## Testing requirements

Do not declare completion until all relevant tests exist and pass.

Implement:

- Domain unit tests.
- Date/time and daylight-saving tests.
- Database/invariant tests.
- Idempotency tests.
- Recurrence tests.
- Canvas and Google contract tests with redacted fixtures.
- Component tests.
- API authorization and validation tests.
- Browser end-to-end tests for primary workflows.
- Accessibility checks.
- Email template snapshots/rendering checks.
- Security regression tests.
- Production build verification.
- Migration verification.
- Dependency licence checks.
- Secret scanning.

Cover every acceptance criterion in `docs/08-delivery-and-quality-plan.md`.

At minimum, verify:

- Repeated Canvas sync creates no duplicates.
- Both classification produces one underlying item/event/reminder.
- Overrides survive Canvas changes.
- One temporary Canvas omission does not archive work.
- Google edits return to Organato.
- Google event deletion preserves the item.
- Repeated scheduled invocation sends no duplicate email.
- Completed/submitted work never qualifies for reminders.
- Unauthorized Google accounts receive no private information.
- Exports contain no secrets.

## Required documentation and operational files

In addition to application code, produce:

- Complete local setup instructions.
- Production deployment instructions.
- Cloudflare Free and D1 setup instructions.
- Google OAuth, Calendar, and Gmail setup instructions.
- Canvas token setup instructions.
- Environment-variable reference.
- `.env.example`.
- Database migration commands.
- Development/sample-data instructions.
- Test commands.
- Scheduler setup, including the free fallback.
- Backup and recovery runbook.
- Integration troubleshooting guide.
- Security incident/revocation guide.
- Open-source licence report.
- Updated decision register for implementation decisions.

Do not duplicate the product specification unnecessarily; link to the existing documents.

## Verification workflow

Before finishing:

1. Install dependencies.
2. Apply migrations to the local database.
3. Seed deterministic development data.
4. Run formatting.
5. Run lint.
6. Run type checking.
7. Run unit and integration tests.
8. Run component and accessibility tests.
9. Build the production application.
10. Start it locally.
11. Exercise the main workflows in a real browser.
12. Inspect the UI at desktop, tablet, and phone sizes.
13. Check browser console and network errors.
14. Run end-to-end tests.
15. Scan for accidentally committed secrets.
16. Verify dependency licences.
17. Review the result against every project document and acceptance criterion.
18. Fix all discovered defects.
19. Repeat validation until clean.

If deployment credentials and accounts are already configured, deploy to the free production target and perform a production smoke test. If they are not configured, leave the application completely deployment-ready and provide only the exact credential/configuration steps that require the owner.

## Definition of completion

You may call the task complete only when:

- The full application is implemented.
- No requested page or major feature is represented by a placeholder.
- The real and fake integration boundaries exist.
- Database migrations and setup work from a clean checkout.
- The production build succeeds.
- Automated tests pass.
- Primary workflows pass browser testing.
- The UI is visually polished and responsive.
- Accessibility requirements are satisfied.
- Security controls are implemented.
- Free-only requirements are satisfied.
- Documentation is sufficient for another engineer to run, test, configure, and deploy Organato.
- Any remaining actions require only owner-held credentials or external account configuration and are listed precisely.

Do not finish with “the foundation is ready,” “future work could add,” or a list of unimplemented phases. Finish the application.

## Final response format

When the work is genuinely complete, report:

1. What was built.
2. Where the main code and setup documentation are located.
3. Verification commands run and their results.
4. Browser/device testing completed.
5. Free-tier and licence checks completed.
6. Exact owner-only configuration still required, if any.
7. Any unavoidable external restriction, supported by evidence.

Keep the final report concise and evidence-based. The implementation itself—not a lengthy progress explanation—is the deliverable.
