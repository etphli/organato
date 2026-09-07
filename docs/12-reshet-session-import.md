# Reshet session import — Canvas without an API key

Organato connects to Emanuel School's Reshet (Canvas) using the **browser
session cookie of an already signed-in tab**. It never creates or uses a
personal access token, because Emanuel School blocks students from generating
API keys. This document explains the whole mechanism: what to paste, why it is
safe, and what happens when the session eventually expires.

## 1. Why a session cookie

| Approach                                       | Requires school permission                          | Used by Organato |
| ---------------------------------------------- | --------------------------------------------------- | ---------------- |
| Personal API token (`Authorization: Bearer …`) | Yes — blocked for students at Emanuel               | No               |
| Browser session cookie (`Cookie: …`)           | No — it is how every Canvas page load already works | **Yes**          |

When you open Reshet in a browser, every request the page makes is
authenticated by your session cookie. Organato replays exactly those read-only
requests against the same pinned origin. From Canvas's point of view it is
indistinguishable from you browsing your own courses.

## 2. Copying the cookie (60 seconds)

1. Sign in to Reshet at `emanuel.instructure.com` in your normal browser.
2. Press `F12` to open developer tools and switch to the **Network** tab.
3. Refresh the page, then click the very first request in the list.
4. Under **Request Headers**, find the line starting with `cookie:` and copy
   its entire value (right-click → Copy value).
5. Paste it into Organato's setup wizard or Settings → Reshet.

The value normally looks like `_csrf_token=…; canvas_session=…`. Organato
tolerates harmless extras: a leading `cookie:` label, wrapping quotes, and
surrounding whitespace are stripped automatically before the value is stored.

## 3. What Organato does with it

1. **Validates before storing.** The Worker calls `GET /api/v1/users/self` and
   probes one real course/assignment read. Only if both succeed is the cookie
   accepted; nothing is stored on failure.
2. **Encrypts at rest.** The cookie becomes an AES-GCM envelope bound to the
   Canvas origin via additional authenticated data, keyed by a deployment
   secret that does not live in the database.
3. **Sends it only to Reshet.** Every outbound request targets the pinned
   `https://emanuel.instructure.com` origin. Cross-origin redirects are refused
   before any credential-bearing request follows them.
4. **Reads only.** The integration contains no Canvas mutation calls: current
   user, active courses, upcoming assignments, submission state — nothing else.
5. **Never shows it again.** Not in responses, logs, exports, diagnostics, or
   browser storage. Settings exposes only the connected user's name and sync
   health.

## 4. Session lifetime and reconnection

Reshet expires sessions after days or weeks of inactivity, and any password
change or "log out everywhere" invalidates them immediately. When that happens:

- The next hourly sync records `canvas_session_rejected`, marks the connection
  **Action needed**, and stops Canvas automation. Imported items are preserved
  untouched.
- Settings shows a clear message. Click **Replace session**, repeat the 60-second
  copy above, and syncing resumes on the next hour (or via **Sync now**).

No data is lost across reconnections: items, notes, overrides, history, and
calendar links all survive because they are keyed to stable Canvas ids rather
than to the credential.

## 5. Security properties

- The cookie is a full-account credential, so it is treated with the same care
  as the Google refresh token: encrypted envelopes, AAD binding, secret-free
  metadata, and redacted security events (`canvas_connect_failed` records only
  an error category).
- The connect endpoint sits behind rate limiting and a recent-session
  re-authentication check, so a stolen Organato tab cannot silently swap the
  stored credential.
- Cookie values containing line breaks or control characters are rejected at
  the schema boundary — header injection has no surface here.
- If a cookie ever leaks, sign out of all Canvas sessions in Reshet
  (Account → Logout), which kills it server-side, then reconnect. See the
  recovery procedure in [Security and privacy](06-security-and-privacy.md).

## 6. Troubleshooting

| Symptom                                              | Meaning                                                       | Fix                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| "Canvas rejected the browser session" during connect | Cookie copied before signing in, or already expired           | Refresh Reshet, copy again                                                            |
| Sync fails with `canvas_session_rejected`            | Session expired since connecting                              | Replace session in Settings                                                           |
| "Emanuel Canvas denied the read-only API access…"    | Account cannot read the course catalogue even while signed in | Verify you can browse courses in a private window; otherwise contact the Canvas admin |
| "Canvas could not be reached"                        | Network or Cloudflare egress issue                            | Use **Check Reshet availability**, retry shortly                                      |
| Connect succeeds but zero items appear               | No published upcoming assignments yet                         | Normal — new work appears after the next hourly check                                 |

## 7. Companion desktop tooling

The standalone `reshet-api` repository provides command-line scripts built on
the same session-cookie idea (full file mirror, Markdown reports, calendar
feed). They are independent of Organato and useful for offline archives, but
the product itself needs nothing beyond the paste flow described here.
