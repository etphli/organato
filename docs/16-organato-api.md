# Organato API v1

Organato's API lets your scripts and integrations read and manage your own assignments, checkpoints, todos, subjects, checklists, dependency links, and attachment links. Changes appear in the same workspace as changes made in the app.

This file contains the integration reference, examples, and deployment instructions. The API does not change work in Canvas. Edits to imported Canvas work become Organato overrides, using the same rules as the app.

## Contents

- [Create and manage keys](#create-and-manage-keys)
- [Authentication and request format](#authentication-and-request-format)
- [List every assignment or todo](#list-every-assignment-or-todo)
- [Read an item](#read-an-item)
- [Create assignments and todos](#create-assignments-and-todos)
- [Edit work and deadlines](#edit-work-and-deadlines)
- [Classify, archive, and restore](#classify-archive-and-restore)
- [Checklists, dependencies, and attachment links](#checklists-dependencies-and-attachment-links)
- [Subjects](#subjects)
- [Client examples](#client-examples)
- [Errors, limits, and retries](#errors-limits-and-retries)
- [Implementation and deployment](#implementation-and-deployment)

## Create and manage keys

1. Sign in to Organato and open **Settings > API keys** at `/settings/api`.
2. Enter a name identifying the integration, such as `My study planner`.
3. Select **Read only** or **Read and write**. Read-only keys can list and read items and subjects. Read-and-write keys can use every endpoint in this guide.
4. Choose an expiry of 30 days, 90 days, one year, or never.
5. Click **Create API key**. If prompted, confirm your Google sign-in and return to the page to create the key.
6. Copy the key and store it in your integration's secret store or environment. Click **I've saved this key** to hide it.

The full key appears only in the creation response. Refreshing or leaving the page loses that copy. If you lose it, revoke the key and create another. Organato stores a SHA-256 hash, a short display prefix, and metadata. It cannot recover the full key.

There is no limit on the number of keys you can hold. Creation is throttled to 20 keys per minute per workspace. Each key has its own name, permissions, expiry, last-used time, and revocation state. Names need not be unique. Expired and revoked keys remain listed so you can identify old integrations.

Click **Revoke**, then **Confirm revoke** to disable a key. Revocation rejects subsequent requests; a request already in progress may finish. Revocation remains available with a valid browser session even when that session needs a fresh Google sign-in to create keys.

To rotate a key, create a replacement, update and test your integration, then revoke the old key. Revoking one key does not affect another key. Signing out does not revoke API keys. Deleting all workspace data removes every API key, and signing in again does not restore those keys.

Key management uses browser sessions and CSRF protection, not bearer keys:

| Method | Browser endpoint    | Body                                       | Response                                           |
| ------ | ------------------- | ------------------------------------------ | -------------------------------------------------- |
| GET    | `/api/keys`         | None                                       | `{ "keys": [ApiKeySummary] }`                      |
| POST   | `/api/keys`         | `name`, `permission`, optional `expiresAt` | `201 { "key": ApiKeySummary, "token": "org_..." }` |
| DELETE | `/api/keys/{keyId}` | `{}`                                       | `{ "ok": true }`                                   |

For POST, `name` is a trimmed string of 1 to 100 characters, `permission` is `read` or `read_write`, and `expiresAt` is a future UTC ISO timestamp or `null`. Omitting expiry means no expiry. Key creation requires a Google authentication stamp no older than ten minutes. The API returns `403` with `code: "reauthentication_required"` when confirmation is needed. DELETE is idempotent for an existing owned key; another workspace's key ID returns `404`.

`ApiKeySummary` contains `id`, `name`, `prefix`, `permission`, `createdAt`, `expiresAt`, `lastUsedAt`, and `revokedAt`. Nullable dates use `null`. Lists never return tokens or token hashes. Successful authentication records usage before endpoint processing, so last-used time can also reflect a request that later fails validation.

## Authentication and request format

The production base URL is:

```text
https://organato.vercel.app/api/v1
```

The direct Worker URL also supports the API:

```text
https://organato.etphli.workers.dev/api/v1
```

Self-hosted deployments use their own app or Worker origin followed by `/api/v1`. The examples assume the migration and Worker release described below have been deployed.

Every request requires the header:

```http
Authorization: Bearer org_YOUR_KEY
```

POST, PATCH, and DELETE also require `Content-Type: application/json`. Send `{}` for a DELETE without fields. Responses use JSON. Cookies and CSRF tokens are unnecessary for `/api/v1`, and a signed-in browser session alone cannot authenticate these endpoints. Keys do not authenticate the app's other `/api` routes.

Use HTTPS outside local development. Keep keys in server-side environment variables. Do not put keys in URLs, public source code, browser bundles, analytics, or logs. Any holder of a key can exercise its selected permissions. Third-party browser CORS access is not enabled; call Organato from your backend, local script, or automation service. These practices follow the [OWASP REST security guidance](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html).

All reads and writes derive the workspace from the stored key. Requests cannot select another workspace. Disabled or removed account identities cannot use their keys. A key never grants account management, key management, provider credentials, backup import/export, file downloads/uploads, integration controls, or permanent deletion.

## List every assignment or todo

```http
GET /items?kind=work&limit=100
```

| Query            | Default | Meaning                                                         |
| ---------------- | ------- | --------------------------------------------------------------- |
| `limit`          | `100`   | Integer from 1 to 200, the maximum number of items in this page |
| `cursor`         | Omitted | The preceding response's `nextCursor`; pass it unchanged        |
| `archived`       | `false` | `false` returns active items; `true` returns archived items     |
| `kind`           | Omitted | `work` or `todo`; omitted returns both                          |
| `classification` | Omitted | `unclassified`, `assignment`, `checkpoint`, or `both`           |

Use `kind=work` without a classification filter to read all work shown on the Assignments screen, including legacy checkpoints and unclassified imports.

`classification=assignment` includes work classified as `both`. So does `classification=checkpoint`. `classification=both` returns only `both`. Todos are always `unclassified`, so list todos with `kind=todo`. Unknown list parameters and invalid values return `400`.

```json
{
  "items": [
    {
      "id": "item-uuid",
      "version": 3,
      "kind": "work",
      "classification": "assignment",
      "displayName": "English essay",
      "priority": "high",
      "workingStatus": "in_progress",
      "dueAt": null,
      "dueDateLocal": "2026-12-10",
      "dueHasExplicitTime": false
    }
  ],
  "nextCursor": "item-uuid"
}
```

The example abbreviates the item. The actual response contains the item fields described below. Items sort by ID ascending, not by due date. Repeat the request with `cursor=nextCursor` and the same filters until `nextCursor` is `null`. An empty result has `items: []` and `nextCursor: null`. There is no total-item cap; pagination can read more than 2,000 items.

Active and archived lists are separate. To read all records, paginate once with `archived=false` and once with `archived=true`. Pagination does not hold a database snapshot. Concurrent creates, edits, or archives can change which records match between pages. If you need a consistent copy during active editing, repeat the scan and reconcile by item ID and version.

```sh
export ORGANATO_BASE_URL='https://organato.vercel.app/api/v1'
# Set ORGANATO_API_KEY through your shell's secret handling or environment manager.
curl --fail-with-body "$ORGANATO_BASE_URL/items?kind=work&limit=100" \
  -H "Authorization: Bearer $ORGANATO_API_KEY"
```

## Read an item

```http
GET /items/{itemId}
```

Returns `{ "item": OrganatoItem }`, including archived items. Unknown or foreign item IDs return `404`.

The item model uses these groups of fields:

| Fields                                                                | Meaning                                                                      |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `id`, `version`                                                       | Item identifier and integer used for optimistic concurrency                  |
| `kind`, `classification`                                              | `work` or `todo`; `unclassified`, `assignment`, `checkpoint`, or `both`      |
| `displayName`, `subjectId`, `priority`, `workingStatus`               | Editable work details; subject can be `null`                                 |
| `dueAt`, `dueDateLocal`, `dueHasExplicitTime`                         | Timed, all-day, or absent deadline                                           |
| `notesMarkdown`, `calendarNote`                                       | Private notes and the note used in the calendar projection                   |
| `calendarEnabled`, `remindersEnabled`, `calendarSyncState`            | Calendar/reminder preferences and sync state                                 |
| `pinned`, `sortRank`, `estimatedMinutes`                              | Organization and estimated effort                                            |
| `completedAt`, `submittedAt`                                          | Status timestamps maintained by Organato                                     |
| `recurrenceRule`, `recurrenceSeriesId`                                | Todo recurrence configuration                                                |
| `sourceType`, `canvasAssignmentId`, `canvasCourseId`, `canvasHtmlUrl` | Manual or Canvas source identity                                             |
| `sourceName`, `sourceDueAt`, `sourceUpdatedAt`, `sourcePayloadHash`   | Imported source metadata                                                     |
| `sourceMissingSince`, `missingSyncCount`                              | Import tracking                                                              |
| `archivedAt`, `archiveReason`                                         | Archive state                                                                |
| `createdAt`, `updatedAt`                                              | UTC timestamps                                                               |
| `overrides`                                                           | Local override records for imported fields                                   |
| `attachments`                                                         | Linked attachment metadata; stored-file URLs are metadata only               |
| `history`                                                             | Change history, newest first; list pages include up to 20 entries per item   |
| `subtasks`                                                            | Checklist entries with ID, title, completion, rank, and timestamps           |
| `links`                                                               | `blockedBy` and `blocking`, each containing `{ "itemId", "linkId" }` entries |

Single-item reads return the full available history. Read-only keys can read private notes and history. Give such keys only to integrations you trust with your workspace data.

## Create assignments and todos

```http
POST /items
```

Minimum assignment body:

```json
{
  "kind": "work",
  "classification": "assignment",
  "displayName": "English essay"
}
```

Todo with a deadline and priority:

```json
{
  "kind": "todo",
  "displayName": "Revise algebra",
  "dueDateLocal": "2026-12-10",
  "priority": "high",
  "notesMarkdown": "Complete the practice paper.",
  "estimatedMinutes": 45
}
```

Returns `201 { "item": OrganatoItem }`. New work has `sourceType: "manual"`, `workingStatus: "not_started"`, and version `1`. Creating an item does not post it to Canvas.

| Create field                          | Requirement or default                                           |
| ------------------------------------- | ---------------------------------------------------------------- |
| `kind`                                | Required: `work` or `todo`                                       |
| `displayName`                         | Required: 1 to 500 characters                                    |
| `classification`                      | Defaults to `assignment`; todos always become `unclassified`     |
| `dueAt`                               | UTC ISO timestamp or `null`; defaults to `null`                  |
| `dueDateLocal`                        | Real `YYYY-MM-DD` calendar date or `null`; defaults to `null`    |
| `dueHasExplicitTime`                  | Defaults to `false`; set `true` with `dueAt`                     |
| `subjectId`                           | ID of a subject in your workspace, or `null`                     |
| `priority`                            | `low`, `medium`, `high`, `urgent`, or `null`; defaults to `null` |
| `calendarEnabled`, `remindersEnabled` | Both default to `true`                                           |
| `notesMarkdown`                       | Up to 100,000 characters; defaults to empty text                 |
| `calendarNote`                        | Up to 20,000 characters; defaults to empty text                  |
| `estimatedMinutes`                    | Integer from 1 to 10,000 or `null`; defaults to `null`           |
| `recurrenceRule`                      | Todo-only recurrence object or `null`; defaults to `null`        |

The API uses these explicit defaults rather than applying the app's quick-create preferences or subject defaults. Supply your preferred values. New items always start as `not_started`; use PATCH to change their status or pin them after creation.

### Deadlines

Use one deadline representation:

```json
{ "dueAt": "2026-12-10T04:00:00Z", "dueHasExplicitTime": true }
```

```json
{ "dueDateLocal": "2026-12-10", "dueHasExplicitTime": false }
```

```json
{ "dueAt": null, "dueDateLocal": null, "dueHasExplicitTime": false }
```

`dueAt` identifies an instant and requires an explicit time. `dueDateLocal` is an all-day date interpreted in your workspace timezone. Do not convert an all-day date to UTC midnight. Invalid calendar dates, such as February 30, are rejected. Do not send conflicting timed and all-day deadlines.

### Recurring todos

```json
{
  "kind": "todo",
  "displayName": "Weekly revision",
  "dueDateLocal": "2026-12-10",
  "recurrenceRule": {
    "frequency": "weekly",
    "interval": 1,
    "seriesId": "my-weekly-revision"
  }
}
```

Supported frequencies are `daily`, `weekdays`, `weekly`, `biweekly`, `monthly`, and `custom`. `interval` is a positive integer up to 365. `seriesId` is 1 to 200 characters. Reuse a stable series ID to identify related occurrences. The frequency and interval follow the same scheduling rules as the app. A recurring todo needs a deadline. Work items cannot recur.

When a todo moves from an incomplete status to `completed`, Organato creates the next occurrence if the workspace's `recurrenceOnCompletion` setting is enabled. The PATCH response contains that item in `nextOccurrence`, or `null` if none was created. Completing an already completed todo does not create another occurrence.

## Edit work and deadlines

```http
PATCH /items/{itemId}
```

Read the current item, then submit its `version` with the fields you want to change:

```json
{
  "version": 3,
  "displayName": "English essay, final draft",
  "priority": "urgent",
  "workingStatus": "in_progress",
  "dueDateLocal": "2026-12-12",
  "notesMarkdown": "Add two supporting quotes.",
  "estimatedMinutes": 90,
  "pinned": true
}
```

Returns `{ "item": OrganatoItem, "nextOccurrence": OrganatoItem | null }`. A successful edit increments `version`. An empty patch containing only the version leaves the item unchanged.

Editable fields are `displayName`, `dueAt`, `dueDateLocal`, `dueHasExplicitTime`, `subjectId`, `priority`, `workingStatus`, `notesMarkdown`, `calendarEnabled`, `remindersEnabled`, `calendarNote`, `pinned`, `estimatedMinutes`, `sortRank`, `recurrenceRule`, and `recurrenceSeriesId`. `version` is a required positive integer. Field lengths and ranges match creation. `sortRank` is a number. `recurrenceSeriesId` is at most 200 characters or `null`; Organato derives it from `recurrenceRule.seriesId` when a rule exists.

PATCH preserves omitted fields. Use `null` to clear nullable fields and an empty string to clear notes. To remove recurrence, send `recurrenceRule: null`. To remove a deadline, clear both date fields and set `dueHasExplicitTime: false`. Switching to an all-day date clears the timed value; switching to an explicit timed deadline clears the all-day date.

Statuses are `not_started`, `in_progress`, `submitted`, and `completed`. Todos reject `submitted`. Status edits maintain `completedAt` and `submittedAt`. `overdue` is a derived display state, and `archived` is an archive state. Neither is a writable status.

`kind`, source identifiers, timestamps, archive fields, and `classification` are not PATCH fields. Use the dedicated classification and archive endpoints below. Existing browser mutation schemas discard unknown object fields, so use only the documented fields and check the returned item.

A stale version returns `409`. Fetch the item again, review the competing change, and submit the intended edit using the new version. Do not blindly overwrite another writer's changes. Checklist, dependency, and attachment mutations do not increment the parent item's version and do not take `version`.

Edits use Organato's normal history and source-override rules. History-bearing operations identify the account and API key ID. Calendar-affecting edits enter the normal pending calendar reconciliation process. An API success means Organato saved the work, not that Google Calendar or an email delivery has already completed. The API does not trigger a separate immediate provider sync.

## Classify, archive, and restore

| Method | Endpoint               | Body                                         | Response                   |
| ------ | ---------------------- | -------------------------------------------- | -------------------------- |
| POST   | `/items/{id}/classify` | `{ "version": 3, "classification": "both" }` | `{ "item": OrganatoItem }` |
| POST   | `/items/{id}/archive`  | `{ "version": 4 }`                           | `{ "item": OrganatoItem }` |
| POST   | `/items/{id}/restore`  | `{ "version": 5 }`                           | `{ "item": OrganatoItem }` |

Classification values are `unclassified`, `assignment`, `checkpoint`, and `both`. Classify applies to active work. Archive is reversible and removes the item from the active list. Restore brings an archived item back to that list. These operations increment the version. A mismatched version or inapplicable archive state returns `409`.

The public API does not expose permanent deletion. Use archive when your integration no longer needs an item in the active list.

## Checklists, dependencies, and attachment links

These endpoints require a read-and-write key and return the current parent item. POST returns `201`; PATCH and DELETE return `200`. IDs for entries are available in `item.subtasks`, `item.links`, and `item.attachments`.

| Method | Endpoint                                 | Body                                                                                |
| ------ | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| POST   | `/items/{id}/subtasks`                   | `{ "title": "Draft outline" }`                                                      |
| PATCH  | `/items/{id}/subtasks/{subtaskId}`       | `{ "title": "Revise outline", "completed": true }`                                  |
| DELETE | `/items/{id}/subtasks/{subtaskId}`       | `{}`                                                                                |
| POST   | `/items/{id}/links`                      | `{ "toItemId": "another-item-id" }`                                                 |
| DELETE | `/items/{id}/links/{linkId}`             | `{}`                                                                                |
| POST   | `/items/{id}/attachments`                | `{ "label": "Brief", "url": "https://example.com/brief.pdf", "linkType": "brief" }` |
| DELETE | `/items/{id}/attachments/{attachmentId}` | `{}`                                                                                |

Checklist titles trim whitespace and require 1 to 500 characters. PATCH requires a title, completion value, or both. New entries append to the checklist and start incomplete.

A dependency posted on item A with `toItemId: B` makes A a prerequisite of B. A lists B under `blocking`; B lists A under `blockedBy`. Both items must be in your workspace. Self-links return `400`; duplicate links and dependency cycles return `409`.

Attachment links require an HTTPS URL and a label of 1 to 200 characters. `linkType` is `reference`, `brief`, `rubric`, `working_document`, or `other`, defaulting to `other`. This creates a reference to an external resource; it does not upload a file. The API does not expose stored-file upload or download routes. Deleting attachment metadata uses the app's existing cleanup behavior for stored attachments.

DELETE operations do not take versions. Deleting an already missing checklist entry, dependency, or attachment can succeed as a no-op. Read the returned item to confirm the resulting state. Checklist and attachment operations reject an unknown parent; dependency deletion can return `item: null` for an unknown parent.

## Subjects

```http
GET /subjects
```

Returns `{ "subjects": [Subject] }` for your workspace, including inactive subjects. A subject contains `id`, `canvasCourseId`, `sourceName`, `displayName`, `shortName`, `colour`, and `active`.

```http
POST /subjects
```

```json
{
  "displayName": "Mathematics",
  "shortName": "Maths",
  "colour": "#3b9df8"
}
```

Returns `201 { "subjects": [Subject] }`, the updated list. `displayName` requires 1 to 200 characters. `shortName` is at most 12 characters or `null`, defaulting to `null`. `colour` is a six-digit hexadecimal color, defaulting to `#a78bfa`. New subjects are active.

```http
PATCH /subjects/{subjectId}
```

Accepts optional `displayName`, `shortName`, `colour`, and `active`. Returns `{ "subjects": [Subject] }`. Supplying a foreign or unknown subject ID with a non-empty patch returns `404`. Subject updates do not take an item version. Use `active: false` to hide a subject without deleting its items.

## Client examples

### Node.js, using built-in fetch

Node.js 22 or later can run this as `organato-client.mjs`. Set `ORGANATO_API_KEY` in the environment before running it. The script lists all active assignments and creates a todo.

```js
const base =
  process.env.ORGANATO_BASE_URL ?? "https://organato.vercel.app/api/v1";
const key = process.env.ORGANATO_API_KEY;
if (!key) throw new Error("Set ORGANATO_API_KEY.");

async function organato(path, { method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(
      `Organato ${response.status}: ${JSON.stringify(result.error ?? result)}`,
    );
  }
  return result;
}

const assignments = [];
let cursor = null;
do {
  const query = new URLSearchParams({
    classification: "assignment",
    limit: "100",
  });
  if (cursor !== null) query.set("cursor", cursor);
  const page = await organato(`/items?${query}`);
  assignments.push(...page.items);
  cursor = page.nextCursor;
} while (cursor !== null);
console.log(`Read ${assignments.length} assignments.`);

const { item } = await organato("/items", {
  method: "POST",
  body: {
    kind: "todo",
    displayName: "Review this week's assignments",
    priority: "medium",
  },
});
console.log(`Created todo ${item.id}.`);

const updated = await organato(`/items/${encodeURIComponent(item.id)}`, {
  method: "PATCH",
  body: { version: item.version, workingStatus: "in_progress" },
});
console.log(updated.item.workingStatus);
```

For read-only integrations, omit the create and edit calls. A `409` needs application-specific conflict handling. A `429` needs a delay using `Retry-After`. This minimal client deliberately does not automatically repeat writes.

### Python, using the standard library

```python
import json
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

BASE = os.environ.get("ORGANATO_BASE_URL", "https://organato.vercel.app/api/v1")
KEY = os.environ["ORGANATO_API_KEY"]


def organato(path, method="GET", body=None):
	data = None if body is None else json.dumps(body).encode("utf-8")
	headers = {"Authorization": f"Bearer {KEY}"}
	if data is not None:
		headers["Content-Type"] = "application/json"
	request = Request(BASE + path, data=data, headers=headers, method=method)
	try:
		with urlopen(request, timeout=30) as response:
			return json.load(response)
	except HTTPError as error:
		# Do not log the request headers or bearer key.
		raise RuntimeError(f"Organato {error.code}: {error.read().decode()}") from error


todos = []
cursor = None
while True:
	query = {"kind": "todo", "limit": 100}
	if cursor is not None:
		query["cursor"] = cursor
	page = organato("/items?" + urlencode(query))
	todos.extend(page["items"])
	cursor = page["nextCursor"]
	if cursor is None:
		break

print(f"Read {len(todos)} todos.")
```

### cURL, changing a deadline

Replace the item ID and version with values from GET `/items/{id}`:

```sh
curl --fail-with-body "$ORGANATO_BASE_URL/items/ITEM_ID" \
  -X PATCH \
  -H "Authorization: Bearer $ORGANATO_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"version":3,"dueDateLocal":"2026-12-12","dueHasExplicitTime":false,"priority":"urgent"}'
```

## Errors, limits, and retries

| Status | Meaning and client action                                                                      |
| ------ | ---------------------------------------------------------------------------------------------- |
| `200`  | Read or mutation succeeded                                                                     |
| `201`  | Record created                                                                                 |
| `400`  | Invalid JSON, fields, date, recurrence, or list query; fix the input                           |
| `401`  | Missing, invalid, expired, or revoked key, or unavailable account identity; supply a valid key |
| `403`  | Read-only key attempted a write; choose a read-and-write key                                   |
| `404`  | Item/subject is unavailable or the endpoint is not published                                   |
| `409`  | Stale item version, wrong archive state, duplicate dependency, or cycle; inspect current state |
| `413`  | Request body exceeds 256 KiB                                                                   |
| `415`  | Write is missing `Content-Type: application/json`                                              |
| `429`  | Request rate exceeded; wait at least `Retry-After` seconds                                     |
| `500`  | Unexpected server failure; inspect the current resource before retrying a write                |

Most errors return `{ "error": "message" }`. List validation also returns `details`. Shared mutation-schema errors return `{ "success": false, "error": { "name": "ZodError", "issues": [...] } }`. Clients must use the HTTP status to decide success and tolerate either error shape. Unknown endpoints return JSON rather than the app's HTML shell. Responses carry private/no-store cache headers.

The public API permits 120 authenticated requests per minute **per workspace**, shared by all keys. Creating extra keys does not increase this allowance. Rate windows align to UTC minute boundaries. A `429` includes `Retry-After: 60`, a conservative wait that crosses the boundary. A page can contain at most 200 items. Write bodies are limited to 256 KiB even if individual field character limits would allow a larger payload.

GET requests can be repeated. POST creation has no idempotency-key support. If a network timeout leaves the result unknown, check the workspace before repeating creation, or you can create duplicates. For PATCH, the item's version protects against reapplying a completed edit, but you must read the latest state before deciding what to retry. Subtask, dependency, and attachment edits use the existing app semantics and do not have version conflict protection.

## Implementation and deployment

### Code ownership

- `migrations/0012_api_keys.sql` creates the key table and workspace pagination index.
- `packages/domain/src/types.ts` defines safe key metadata and permissions shared by the Worker and Settings UI.
- `apps/worker/src/api-keys.ts` manages keys behind the existing browser session, CSRF, and recent-authentication checks.
- `apps/worker/src/public-api.ts` authenticates bearer keys, checks permissions, applies workspace rate/body limits, paginates items, and registers an explicit list of shared mutation/read handlers.
- `apps/worker/src/api.ts` remains the owner of item mutation rules. Its workspace deletion path also deletes API keys.
- `apps/worker/src/index.ts` mounts `/api/v1` before the browser session middleware. `/api/keys` stays behind that middleware.
- `apps/web/src/components/settings/ApiKeysSection.tsx` provides key creation, one-time display, copying, expiry selection, and confirmed revocation.
- `apps/worker/test/api-keys.test.ts` runs the production request pipeline against an in-memory SQLite database with every migration applied.

Keys contain 32 cryptographically random bytes, encoded as base64url with an `org_` prefix. Only SHA-256 hashes are stored. Lookup joins the creator's enabled identity and original workspace. Revocation and expiry are checked on every request. The API actor does not have browser session credentials or a recent-authentication timestamp.

Public methods and paths are explicit. Adding an internal route does not publish it. To expose another existing item capability, review its authorization and side effects, add its method/path to `publishedRoutes`, add an API integration test, and update this file. The route handlers retain their existing validators and mutation semantics. Routing follows [Hono's registration-order rules](https://hono.dev/docs/api/routing).

### Local verification

The repository requires Node.js 22 to 24 and pnpm 11.9.0.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The focused Worker test command is:

```sh
pnpm --filter @organato/worker exec vitest run test/api-keys.test.ts
```

Apply migrations to the local D1 database before starting the local Worker:

```sh
pnpm dlx wrangler@4.114.0 d1 migrations apply organato-production --local
pnpm dev:worker
```

Local demo mode can bypass browser authentication for the app, but **never** bypasses bearer authentication on `/api/v1`. A locally created key still needs a matching enabled identity and workspace in the local database. For a real sign-in flow, configure the development OAuth credentials and origins described in the repository's release runbook.

### Production rollout

These commands change production. Run them only after release approval.

1. Back up the production D1 database using the existing release process.
2. Apply the additive migration before deploying code that reads `api_key`:

   ```sh
   pnpm dlx wrangler@4.114.0 d1 migrations apply organato-production --remote
   ```

3. Build and deploy the Worker through the existing release process, then deploy the web bundle. Keep the `/api/*` Vercel rewrite and Worker's `run_worker_first` API routing in place. `/api/v1` needs no new domain or third-party service.
4. Sign in and create a temporary read-only key in Settings. Confirm GET `/items` returns only that account's work. Confirm a POST with it returns `403`.
5. Create a temporary read-and-write key. Create a todo, edit its priority and deadline using its version, confirm it in the app, then archive it.
6. Revoke both temporary keys and confirm subsequent calls return `401`.

The production configuration keeps `CANVAS_IMPORT_UPCOMING_ONLY=true` to preserve the live Worker's existing upcoming-only Canvas import behavior. This limits new Canvas imports, not API access to records already in Organato. Other deployments can omit the flag to import all published work.

The feature needs no new environment secrets or paid infrastructure. An older Worker can run with the new additive table present. For a code rollback, retain the table and its hashes so keys remain revocable after restoring this release. Do not include plaintext keys or token hashes in diagnostic exports. Existing workspace backups omit keys; restoring a work backup does not create or recover API credentials.

Production OAuth, D1 deployment, and provider synchronization require the release environment. Local tests cannot prove a production rollout has occurred.
