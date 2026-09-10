# Organato security and privacy

## 1. Security objective

Organato holds school schedule information plus credentials that can read Canvas assignments, create/edit a dedicated Google Calendar, and send email. Although it has one owner, it must be treated as an internet-facing application with valuable tokens.

The goal is to minimize both:

- The chance that an unauthorized person can enter the app.
- The damage possible if one component is compromised.

## 2. Data classification

| Class       | Examples                                                                         | Handling                                                                |
| ----------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Secret      | Canvas session cookie, Google refresh token, session signing key, encryption key | Encrypted or deployment secret store; never returned to browser or logs |
| Private     | Assignment names, due dates, subjects, notes, email addresses                    | Authenticated access only; minimal logging                              |
| Operational | Sync counts, error categories, schema version                                    | Authenticated/admin access; sanitized                                   |
| Public      | App name, sign-in page assets, privacy statement                                 | May be served without a session                                         |

## 3. Authentication

- Google-only sign-in.
- No password database.
- Validate Google ID tokens server-side using current signing keys.
- Validate issuer, audience, expiry, issued-at, nonce, and authorized party where applicable.
- Require verified email.
- Normalize email safely.
- Check both email allow-list and bound Google subject. Production sets
  `ALLOWED_GOOGLE_EMAILS: "*"` so any verified Google account is admitted,
  each into an isolated per-identity workspace; set explicit addresses to
  restrict sign-in to an exact allow-list.
- Do not use Google avatar URLs as authorization evidence.

The public sign-in response must not reveal whether a guessed email is allow-listed.

Implemented: only the allow-list rejection keeps its specific client wording
(needed for onboarding); every other sign-in failure returns one generic
message, with the precise reason kept in the server-side security event.
Both the redirect callback and the JSON exchange endpoint enforce origin
checks and per-IP rate limits.

## 4. Authorization

All application routes are denied by default.

Roles:

- `Owner`: normal and administrative access.
- No public, editor, viewer, or guest role in the initial product.

Each Google identity owns one isolated workspace; a person with two accounts has two workspaces that cannot read each other. Settings that alter identities, integration ownership, exports, imports, or permanent deletion require recent reauthentication. Uploads are bounded per workspace (20 × 10 MB per hour, 1 GB total) so one tenant cannot exhaust shared storage.

The Worker, not the client, enforces authorization on every request.

## 5. Session security

- Random opaque session ID.
- Session data stored server-side.
- Cookie is `Secure`, `HttpOnly`, `SameSite=Lax`, with a narrow path and no broad parent domain.
- Rotate session ID after login and reauthentication.
- Absolute lifetime default: 30 days.
- Idle lifetime default: 7 days.
- Allow owner to view and revoke active sessions.
- Revoke all sessions after an encryption-key or allow-list security incident.
- Do not put tokens or private assignment data in JWT browser payloads.

Implemented deltas (code over this text where they differ):

- Lifetimes are 180-day absolute / 30-day idle sliding.
- Each session stores `authenticated_at` (migration 0005), stamped at
  interactive login; step-up checks measure from it, so a fresh Google
  sign-in restores privileged actions without disturbing the session.
- Session revoke, diagnostics, calendar rebuild, and token-clear endpoints
  require recent authentication; a stolen-but-stale session cannot persist
  itself or scrape integration health.

## 6. CSRF and request protection

- Same-site cookie policy.
- CSRF token on every state-changing browser request.
- Verify `Origin`/`Referer` against the exact production origin.
- Google OAuth uses state, nonce, and PKCE where applicable.
- Reject unexpected content types.
- Set body-size limits per route.
- Rate-limit authentication, sync-now, test-email, import, and destructive operations.
- The rate limiter increments and reads in a single `INSERT … RETURNING`
  statement so concurrent requests cannot undercount.
- Restore refuses item-less backups over non-empty workspaces without an
  explicit empty-restore flag, commits small restores atomically in one D1
  batch, and logs the failing group for large restores.

## 7. Secret storage

### Deployment secrets

Store these in the Worker secret store:

- Session signing/authentication secret.
- Application-level data encryption key.
- Google OAuth client secret.

### Encrypted database secrets

Store the Canvas session cookie and Google refresh tokens as AES-GCM encrypted envelopes:

- Random nonce per encryption.
- Ciphertext.
- Key version.
- Provider/record-bound additional authenticated data.

The encryption key does not live in D1. Access tokens should be short-lived and held in memory; do not persist them unless strictly necessary.

Never store secrets in:

- Git.
- Frontend environment variables.
- Browser localStorage or IndexedDB.
- URLs.
- Analytics.
- Logs.
- Export files.

## 8. Token scopes and permissions

### Canvas

Organato authenticates with the signed-in user's browser session cookie and only GET endpoints. Organato's code should not contain Canvas mutation calls. Because a session cookie is a full-account credential, it is encrypted with provider-bound AAD, sent only to the pinned Canvas origin, never logged, and never returned to the browser.

### Google identity

Use only `openid`, `email`, and `profile`.

### Google Calendar

Request the narrowest scope capable of managing the app-created calendar. Do not request Drive, contacts, all mail, or unrelated profile data.

### Gmail

Request only `gmail.send`. Organato must not read the inbox.

Integration scopes are disclosed in plain language immediately before consent.

## 9. Network boundaries

- HTTPS only.
- HSTS in production.
- Redirect HTTP to HTTPS at the edge.
- Restrict Canvas base URL to a confirmed hostname.
- Do not follow credential-bearing redirects to another hostname.
- Restrict Google API requests to official endpoints.
- Validate all attachment links but do not fetch or preview them server-side.
- Use timeouts and response-size limits for external APIs.

These controls reduce token leakage and server-side request forgery risk.

## 10. Browser security headers

Recommended headers:

- Strict Content Security Policy with no `unsafe-eval`.
- `frame-ancestors 'none'`.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- Restrictive `Permissions-Policy`.
- HSTS.
- Cross-origin isolation headers only if compatible with Google sign-in flow.

The CSP should explicitly permit only required Google authentication endpoints and app assets. Inline email template CSS is server-generated and unrelated to the browser CSP.

## 11. XSS and content handling

Canvas names, course names, notes, imported URLs, Google edits, and backup files are untrusted input.

- Render ordinary text as text, never raw HTML.
- Sanitize Markdown through an allow-list before preview.
- Strip scripts, event handlers, embedded iframes, and unsafe protocols.
- Escape all email template values.
- Validate Canvas links against the configured Canvas hostname.
- Apply `rel="noopener noreferrer"` to external links.
- Never render copied Canvas assignment HTML in version one.

## 12. SQL and schema safety

- Parameterized SQL only.
- Runtime validation before database operations.
- Enum and foreign-key constraints.
- Transactional changes for item/history/sync state.
- Optimistic item version to prevent silent lost updates.
- Migrations tested on a production-like copy.
- Permanent deletion uses exact IDs, never broad unvalidated filters.

## 13. Privacy policy

The privacy statement should say plainly:

- Organato is a personal app.
- Which Google and Canvas data it accesses.
- Why each category is needed.
- Where data is stored.
- That data is not sold, shared, or used for advertising or AI training.
- That there are no third-party analytics.
- How to export and delete data.
- How to revoke Google and Canvas access.
- How to contact the owner/developer.

Google's OAuth configuration may require public homepage and privacy-policy URLs even for a private application. These pages must contain no private data.

## 14. Threat model

| Threat                                  | Main controls                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Stranger signs in                       | Google identity verification, allow-list (`*` admits any verified account into an isolated workspace), subject binding |
| Stolen session cookie                   | Secure HttpOnly cookie, session expiry, session revocation                                                             |
| CSRF changes data                       | SameSite, CSRF token, origin checks                                                                                    |
| XSS steals visible data                 | CSP, escaping, Markdown sanitation, no raw Canvas HTML                                                                 |
| Database leak exposes provider tokens   | Application-level encryption with separate key                                                                         |
| Malicious attachment URL attacks server | Store link only; no server-side fetch                                                                                  |
| Canvas redirects cookie to attacker     | Host pinning and cross-host redirect rejection                                                                         |
| Duplicate Cron run sends duplicate mail | Locks and unique delivery keys                                                                                         |
| Google deletion erases school item      | Event deletion only suppresses calendar projection                                                                     |
| Canvas outage archives everything       | Two successful absence confirmations                                                                                   |
| Compromised tenant account              | Session view/revoke, identity disable, recent-auth admin gate, per-workspace storage quotas                            |
| Backup leaks secrets                    | Secret-free export schema                                                                                              |
| Provider price change creates bill      | No payment method, free-plan lock, internal usage caps                                                                 |

## 15. Security events

Record:

- Successful and failed login category.
- Identity allow-list changes.
- New device/session.
- Integration connect, reconnect, and revoke.
- Export/import.
- Permanent deletion.
- Excessive rate-limit activity.
- Encryption key version changes.

Do not retain IP addresses longer than operationally necessary. A coarse security record is sufficient for a one-person app.

## 16. Recovery procedures

### Canvas session cookie exposed

1. Sign out of all Canvas sessions in Reshet (Account → Logout), which invalidates the leaked cookie.
2. Disconnect Canvas in Organato.
3. Reconnect with a fresh cookie value.
4. Review recent sync runs.
5. Existing items remain intact.

### Google authorization exposed

1. Revoke Organato from the Google Account permissions page.
2. Disconnect Google in Organato.
3. Revoke Organato sessions.
4. Reconnect and reconcile the dedicated calendar.

### Database compromise

1. Revoke provider credentials.
2. Rotate session and encryption keys.
3. Revoke all sessions.
4. Restore a known-good data export if necessary.
5. Review identity and security history.

### Owner locked out

Use a deployment-level recovery procedure to add one exact owner email. This is documented privately and cannot be initiated through a public “forgot account” flow.

## 17. Dependency security

- Commit lockfile.
- Automated vulnerability audit in CI where free.
- Review high/critical advisories manually.
- Avoid abandoned packages for auth, crypto, and HTML sanitation.
- Generate a dependency licence report.
- Depend on platform Web Crypto rather than custom cryptography.
- Remove unused packages promptly.

## 18. School-managed account caveat

A school Google Workspace administrator may prevent third-party OAuth clients from requesting Calendar or Gmail scopes. This is external policy, not an Organato bug. The recommended fallback is:

- Use the school account as an allow-listed sign-in identity if basic sign-in is permitted.
- Use a personal Gmail account as the integration owner for Calendar and email.

The Canvas session cookie remains independent of the Google identity.

## 19. Security acceptance checklist

- [ ] Unauthorized email receives no workspace information.
- [ ] Disabled identity cannot use an existing session.
- [ ] Token values cannot be found in browser storage, logs, exports, or Git.
- [ ] CSRF test cannot mutate data.
- [ ] Imported script-like text renders inertly.
- [ ] Cross-host Canvas redirect is refused.
- [ ] Duplicate job invocation produces no duplicate item, event, or email.
- [ ] Deleting a Google event does not delete an Organato item.
- [ ] Backup contains no credentials.
- [ ] Owner can revoke every session and integration.
- [ ] Production deployment has no billing account or payment method.
