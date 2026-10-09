# AI planning preview

This PR adds three opt-in planning features in the agreed order: natural-language task entry, assignment breakdown, then a next-action recommendation. The AI proposes changes; the user reviews and saves them. It does not reclassify existing work, change teacher deadlines, submit assignments, send messages or schedule study sessions.

## Try the demo

From this branch, run:

```sh
pnpm install --frozen-lockfile
pnpm demo:ai
```

Open <http://127.0.0.1:5173>. The committed development profile enables a sample workspace without Google sign-in. Production builds do not enable demo mode. Sample deadlines are fixed fixture dates, so some appear overdue.

1. On Todo, use the slim bar between the title and **Show completed**. Enter `Finish my English draft next Thursday at 5pm, high priority` and press Enter or the arrow. Review the subject/date/time/priority, edit the title, then **Save todo**. **Discard** makes no changes. Dates and times use the workspace timezone.
2. On Assignments, click **New**, then **Describe it naturally**. Enter `English essay next Friday at 5pm` to preview an assignment. **Enter details** restores the usual manual form.
3. Press **⌘K**, type `English essay assignment tomorrow` and Enter. The preview detects **Assignments**. A personal action such as `Read chapter four tomorrow` detects **Todo**. The **Save to** selector lets you correct either destination before saving. Existing navigation commands still work.
4. Open an assignment. Below its checklist, **Break into steps** has **Suggest steps** and an optional **Add brief** control. Edit step titles, deselect one, then **Add selected steps**. Accepted steps appear in the checklist. Time estimates are approximate and shown during review.
5. On Home, **Next up** lets you choose 15, 25 or 60 minutes and **Find a next step**. **Open task** opens the recommended item. **Why this task?** explains the suggestion. Completed, submitted, archived and dependency-blocked items are excluded. A workspace change invalidates the displayed recommendation until you ask again.

The demo uses local deterministic examples, not a language model. Natural-language parsing supports today, tomorrow, the next occurrence of a weekday, ISO dates, explicit AM/PM or 24-hour times, existing subject names and priority words. Ambiguous times request clarification. The optional brief does not change demo checklist examples. Live AI can understand broader wording and tailor steps to the pasted brief; its quality and latency need a separate test with a key.

Demo changes use only `organato-demo-state-v1` browser storage. **Reset demo** restores sample data. The demo flows make no API or OpenRouter requests and do not touch real workspaces or integrations.

## Live connection, after approval

After the Worker rollout, open **Settings → Integrations → AI** in your signed-in workspace. Paste an [OpenRouter API key](https://openrouter.ai/settings/keys), enter a model ID ending in `:free`, enable suggestions, and save. Organato verifies the key through OpenRouter's [current-key endpoint](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key) before storing it.

The personal key is encrypted with the Worker's existing AES-GCM secret and bound to your workspace. It is never returned to the browser, stored in browser storage, or included in backups. Leave the key field blank to retain it when changing the model or enable switch. **Test connection** checks the saved key without requesting a model completion. **Remove personal connection** deletes the key and restores the installation defaults. Key changes require a recent Google sign-in.

Personal connections work without an installation-wide key. Accounts without personal configuration can still use the installation defaults: `OPENROUTER_API_KEY` as a Worker secret, `AI_ENABLED=true`, and optional `OPENROUTER_MODEL`. Live AI otherwise defaults off. Demo mode never saves provider keys. No schema migration is needed; account-scoped AI credentials use the existing integration connection table.

For local live testing, use private `.dev.vars` for the Worker and disable the frontend demo profile with `VITE_DEMO_MODE=false`. Serve the frontend and API from the same origin; the Vite demo command is frontend-only.

Every live suggestion requires a visible consent checkbox explaining what will leave Organato. Task creation sends the entered text, active subject names/IDs and workspace date/timezone. Breakdown sends only the owned assignment's title, deadline, existing checklist and explicitly pasted instructions. Recommendations send at most 15 candidate items' titles, deadlines, priorities, statuses, estimates and unfinished checklist steps. Notes, attachments, Canvas credentials, Google tokens and user identity are not sent. Free providers may retain prompts under their own policies; only send material you are comfortable sharing.

## Limits and failures

OpenRouter currently documents 20 free-model requests per minute and 50 per day for accounts with less than $10 in lifetime credit purchases. Purchasing at least $10 raises the daily tier to 1,000; that tier requires spending money. These limits are shared across free models under the account. Upstream providers can also throttle or be unavailable. Free availability is not permanent.

References, checked 9 October 2026:

- [OpenRouter rate limits](https://openrouter.ai/docs/api/reference/limits)
- [OpenRouter support explanation](https://openrouter.zendesk.com/hc/en-us/articles/39501163636379-OpenRouter-Rate-Limits-What-You-Need-to-Know)
- [Zero-price provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Free-tier sustainability](https://openrouter.ai/blog/announcements/updates-to-our-free-tier-sustaining-accessible-ai-for-everyone/)

Organato applies conservative request guards for personal and shared keys: 4 attempts/minute and 12/day per workspace, plus 16/minute and 40/day across the installation. Day buckets reset at UTC midnight. Attempts count even if the provider fails; cancellations may already have consumed a provider request. Use a dedicated key/account budget if other apps share the same OpenRouter account. These guards leave headroom but cannot guarantee provider availability or quota synchronization.

Each preview/suggestion button makes one model request. Editing, discarding and accepting a preview make no further model requests. Recommendations run only when requested. Output is capped at 1,600 tokens, provider calls time out after 25 seconds, and no automatic retry is performed. Routing caps prompt, completion and per-request pricing at zero, disables provider fallback, and never selects a paid model. If no eligible free endpoint remains, the request fails and manual planning remains available.

Input and model output are validated at their boundaries. Cross-workspace assignment IDs, invented subject/item IDs, invalid dates, oversized checklists and recommendations exceeding the available time are rejected. Checklist acceptance is an atomic D1 batch using stable step IDs, so retrying an uncertain response does not duplicate steps.

## Verification

Run `pnpm check` for formatting, lint, type checks, tests, the real Worker/D1/connector contract check, builds, license checks, dependency audit and secret scanning. The existing audit configuration ignores one known advisory; this change adds no runtime dependencies. The optional credentialed Canvas browser smoke remains skipped unless configured.

Added coverage checks demo preview/edit/save/discard, command-palette destination detection and correction, natural assignment creation in New, selected checklist acceptance without network traffic, date/time validation, dependency filtering, live routing and privacy boundaries with a simulated provider, invalid model output, rate limiting, request size limits and retry-safe checklist writes against real SQLite using the existing D1 test adapter.

Live OpenRouter inference remains unverified without a key. A passing test suite validates the integration contract and user flows, not the model's ability to interpret every school brief.
