import {
  digestDeliveryKey,
  isDigestHour,
  localDateKey,
  type OrganatoItem,
} from "@organato/domain";
import { renderDigest } from "@organato/email";
import {
  CanvasConnectionError,
  CanvasRestProvider,
  GmailSendProvider,
  GoogleApiError,
  projectCalendarEvent,
  type CalendarEventRecord,
  type CanvasAssignment,
  type CanvasSyncResult,
} from "@organato/integrations";
import {
  canvasConnectionErrorCategory,
  parseCanvasConnectionMetadata,
} from "./canvas-connection";
import { getItem, getSettings, listItems, listSubjects, patchItem } from "./db";
import {
  GoogleConnectionError,
  loadGoogleConnection,
} from "./google-connection";
import { decryptSecret, sha256 } from "./security";
import type { Env } from "./types";

function jsonBatches(rows: readonly unknown[]): string[] {
  const batches: string[] = [];
  let parts: string[] = [];
  let bytes = 2;
  const encoder = new TextEncoder();
  for (const row of rows) {
    const part = JSON.stringify(row);
    const size = encoder.encode(part).length + 1;
    if (bytes + size > 1_000_000 && parts.length) {
      batches.push(`[${parts.join(",")}]`);
      parts = [];
      bytes = 2;
    }
    parts.push(part);
    bytes += size;
  }
  if (parts.length) batches.push(`[${parts.join(",")}]`);
  return batches;
}

function subjectColour(index: number): string {
  return ["#c084fc", "#3b9df8", "#7bd66a", "#f59e0b", "#a78bfa", "#55d6d6"][
    index % 6
  ]!;
}

export function isCanvasImportCandidate(
  assignment: CanvasAssignment,
  now = new Date(),
): boolean {
  if (!assignment.published || assignment.submitted) return false;
  if (!assignment.dueAt) return true;
  const due = Date.parse(assignment.dueAt);
  return Number.isFinite(due) && due >= now.getTime();
}

export function shouldAdvanceCanvasMissing(
  item: {
    canvasCourseId: string | null;
    sourceDueAt: string | null;
  },
  successfulCourseIds: ReadonlySet<string>,
  now = new Date(),
): boolean {
  if (!item.canvasCourseId || !successfulCourseIds.has(item.canvasCourseId)) {
    return false;
  }
  if (!item.sourceDueAt) return true;
  const sourceDue = Date.parse(item.sourceDueAt);
  return Number.isFinite(sourceDue) && sourceDue >= now.getTime();
}

function canvasPayload(assignment: CanvasAssignment): string {
  return JSON.stringify([
    assignment.name,
    assignment.dueAt,
    assignment.htmlUrl,
    assignment.updatedAt,
    assignment.published,
    assignment.submitted,
  ]);
}

export interface CanvasSyncOutcome {
  runId: string;
  createdIds: string[];
  result: "success" | "partial" | "skipped";
  courses: number;
  fetched: number;
  created: number;
  updated: number;
  archived: number;
  skipped: number;
}

async function acquireCanvasRun(
  env: Env,
  workspaceId: string,
  trigger: "scheduled" | "manual",
  now: Date,
  deliveryId?: string,
): Promise<{
  acquired: boolean;
  runId: string;
  finalKey: string;
}> {
  const runId = crypto.randomUUID();
  const finalKey = deliveryId
    ? `${workspaceId}:connector:${deliveryId}`
    : trigger === "scheduled"
      ? `${workspaceId}:canvas:${now.toISOString().slice(0, 13)}`
      : `${workspaceId}:manual:${runId}`;
  const activeKey = `${workspaceId}:canvas:active`;
  if (trigger === "scheduled" || deliveryId) {
    const existing = await env.DB.prepare(
      "SELECT id, result FROM sync_run WHERE scheduled_key = ?",
    )
      .bind(finalKey)
      .first<{ id: string; result: string }>();
    if (existing && existing.result !== "failed") {
      return { acquired: false, runId: existing?.id ?? runId, finalKey };
    }
    const released = existing
      ? await env.DB.prepare(
          `UPDATE sync_run SET scheduled_key = 'retry:' || id
       WHERE id = ? AND workspace_id = ? AND provider = 'canvas'
         AND scheduled_key = ? AND result = 'failed'`,
        )
          .bind(existing.id, workspaceId, finalKey)
          .run()
      : null;
    if (existing && released && !released.meta.changes) {
      return { acquired: false, runId: existing.id, finalKey };
    }
  }
  const staleBefore = new Date(now.getTime() - 10 * 60_000).toISOString();
  await env.DB.prepare(
    `UPDATE sync_run
     SET scheduled_key = 'abandoned:' || id, finished_at = ?,
         result = 'failed', error_category = 'stale_sync_lock'
     WHERE workspace_id = ? AND provider = 'canvas' AND scheduled_key = ?
       AND started_at < ?`,
  )
    .bind(now.toISOString(), workspaceId, activeKey, staleBefore)
    .run();
  const lock = await env.DB.prepare(
    `INSERT OR IGNORE INTO sync_run
      (id, workspace_id, provider, trigger_type, scheduled_key, started_at, result)
     VALUES (?, ?, 'canvas', ?, ?, ?, 'running')`,
  )
    .bind(runId, workspaceId, trigger, activeKey, now.toISOString())
    .run();
  if (lock.meta.changes) return { acquired: true, runId, finalKey };
  const active = await env.DB.prepare(
    `SELECT id FROM sync_run
     WHERE workspace_id = ? AND provider = 'canvas' AND scheduled_key = ?`,
  )
    .bind(workspaceId, activeKey)
    .first<{ id: string }>();
  return {
    acquired: false,
    runId: active?.id ?? runId,
    finalKey,
  };
}

export async function runCanvasSync(
  env: Env,
  workspaceId: string,
  trigger: "scheduled" | "manual",
  browserSource?: { result: CanvasSyncResult; deliveryId: string },
): Promise<CanvasSyncOutcome> {
  const connection = await env.DB.prepare(
    `SELECT encrypted_credential, metadata_json, account_label
     FROM integration_connection
     WHERE workspace_id = ? AND provider = 'canvas' AND status <> 'disconnected'`,
  )
    .bind(workspaceId)
    .first<{
      encrypted_credential: string | null;
      metadata_json: string;
      account_label: string;
    }>();
  if (!connection) throw new Error("Canvas is not connected.");
  const metadata = parseCanvasConnectionMetadata(
    connection.metadata_json,
    connection.account_label,
  );
  if (!metadata) throw new Error("Canvas connection metadata is invalid.");
  if (metadata.transport === "browser" && !browserSource) {
    throw new Error("Use the Canvas connector to synchronize this account.");
  }
  if (browserSource && metadata.transport !== "browser") {
    throw new Error("The Canvas browser connection has changed.");
  }
  if (!browserSource && !connection.encrypted_credential)
    throw new Error("Canvas credential is missing.");
  const credential = browserSource
    ? ""
    : await decryptSecret(
        connection.encrypted_credential ?? "",
        env.DATA_ENCRYPTION_KEY,
        metadata.credentialAad,
      );
  const started = new Date();
  const lock = await acquireCanvasRun(
    env,
    workspaceId,
    trigger,
    started,
    browserSource?.deliveryId,
  );
  const { runId, finalKey } = lock;
  if (!lock.acquired) {
    return {
      runId,
      createdIds: [],
      result: "skipped",
      courses: 0,
      fetched: 0,
      created: 0,
      updated: 0,
      archived: 0,
      skipped: 0,
    };
  }
  try {
    const provider = new CanvasRestProvider(metadata.baseUrl, credential);
    const result =
      browserSource?.result ??
      (await provider.fetchUpcomingAssignments(AbortSignal.timeout(45_000)));
    const now = new Date().toISOString();
    const createdIds: string[] = [];
    let updated = 0;
    let archived = 0;
    let skipped = result.skippedMalformedItems;
    const seenAssignmentIds = new Set(
      result.assignments
        .filter((assignment) => assignment.published)
        .map((assignment) => assignment.id),
    );
    const baseHash = `${workspaceId}:${await sha256(provider.baseUrl.origin)}`;

    const existingRows = await env.DB.prepare(
      `SELECT id, canvas_assignment_id, canvas_course_id, source_payload_hash,
              archived_at, manual_archive, missing_sync_count, canvas_missing_run_id,
              source_name, source_due_at, source_updated_at
       FROM item WHERE workspace_id = ? AND canvas_base_url_hash = ?`,
    )
      .bind(workspaceId, baseHash)
      .all<{
        id: string;
        canvas_assignment_id: string;
        canvas_course_id: string | null;
        source_payload_hash: string | null;
        archived_at: string | null;
        manual_archive: number;
        missing_sync_count: number;
        canvas_missing_run_id: string | null;
        source_name: string | null;
        source_due_at: string | null;
        source_updated_at: string | null;
      }>();
    const existingById = new Map(
      existingRows.results.map((item) => [item.canvas_assignment_id, item]),
    );
    const courses = result.courses.map((course, index) => ({
      id: `${workspaceId}:canvas-course-${course.id}`,
      courseId: `${workspaceId}:${course.id}`,
      name: course.name,
      colour: subjectColour(index),
    }));
    const inserts = [];
    const updates = [];
    const resets: string[] = [];
    const histories = [];
    for (const assignment of result.assignments) {
      const existing = existingById.get(assignment.id);
      const payloadHash = await sha256(canvasPayload(assignment));
      const source = {
        name: assignment.name,
        due: assignment.dueAt,
        updated: assignment.updatedAt,
        hash: payloadHash,
        url: assignment.htmlUrl,
      };
      if (!existing) {
        if (!isCanvasImportCandidate(assignment, started)) {
          skipped += 1;
          continue;
        }
        const id = crypto.randomUUID();
        inserts.push({
          id,
          assignmentId: assignment.id,
          courseId: `${workspaceId}:${assignment.courseId}`,
          ...source,
        });
        createdIds.push(id);
        histories.push({
          id: crypto.randomUUID(),
          itemId: id,
          action: "canvas_imported",
          summary: "Imported from Canvas",
          before: null,
          after: JSON.stringify({
            sourceName: assignment.name,
            sourceDueAt: assignment.dueAt,
            canvasCourseId: assignment.courseId,
          }),
        });
      } else {
        if (!assignment.published) {
          skipped += 1;
          continue;
        }
        const restore =
          Boolean(existing.archived_at) && !existing.manual_archive;
        if (existing.source_payload_hash === payloadHash && !restore) {
          if (existing.missing_sync_count) resets.push(existing.id);
          continue;
        }
        updates.push({
          id: existing.id,
          ...source,
          submitted: assignment.submitted ? 1 : 0,
          restore: restore ? 1 : 0,
        });
        histories.push({
          id: crypto.randomUUID(),
          itemId: existing.id,
          action: restore ? "canvas_restored" : "canvas_source_updated",
          summary: restore
            ? "Restored after returning to Canvas"
            : "Canvas source fields changed",
          before: JSON.stringify({
            sourceName: existing.source_name,
            sourceDueAt: existing.source_due_at,
            sourceUpdatedAt: existing.source_updated_at,
          }),
          after: JSON.stringify({
            sourceName: assignment.name,
            sourceDueAt: assignment.dueAt,
            sourceUpdatedAt: assignment.updatedAt,
          }),
        });
        updated += 1;
      }
    }
    const successfulCourseIds = new Set(result.successfulCourseIds);
    const missingRunId = browserSource?.deliveryId ?? runId;
    const omissions = [];
    for (const item of existingRows.results) {
      if (
        item.archived_at ||
        item.canvas_missing_run_id === missingRunId ||
        seenAssignmentIds.has(item.canvas_assignment_id)
      )
        continue;
      if (
        !shouldAdvanceCanvasMissing(
          {
            canvasCourseId: item.canvas_course_id?.startsWith(`${workspaceId}:`)
              ? item.canvas_course_id.slice(workspaceId.length + 1)
              : item.canvas_course_id,
            sourceDueAt: item.source_due_at,
          },
          successfulCourseIds,
          started,
        )
      ) {
        skipped += 1;
        continue;
      }
      const count = item.missing_sync_count + 1;
      omissions.push({ id: item.id, count, confirmed: count >= 2 ? 1 : 0 });
      if (count >= 2) {
        archived += 1;
        histories.push({
          id: crypto.randomUUID(),
          itemId: item.id,
          action: "canvas_removed",
          summary: "Archived after two confirmed Canvas omissions",
          before: null,
          after: null,
        });
      }
    }
    // The batch commits the whole snapshot atomically. Every write checks the same
    // connection generation, so a disconnect or account switch fences stale fetches.
    const guard = `EXISTS (SELECT 1 FROM integration_connection WHERE workspace_id = ?
      AND provider = 'canvas' AND status <> 'disconnected' AND metadata_json = ?
      AND encrypted_credential IS ?)`;
    const fence = [
      workspaceId,
      connection.metadata_json,
      connection.encrypted_credential,
    ];
    const statements = [
      ...jsonBatches(courses).map((json) =>
        env.DB.prepare(
          `INSERT INTO subject
        (id, workspace_id, canvas_course_id, source_name, display_name, colour, active, created_at, updated_at)
        SELECT value ->> '$.id', ?, value ->> '$.courseId', value ->> '$.name', value ->> '$.name', value ->> '$.colour', 1, ?, ?
        FROM json_each(?) WHERE ${guard}
        ON CONFLICT(canvas_course_id) DO UPDATE SET
          display_name = CASE WHEN subject.display_name = subject.source_name THEN excluded.source_name ELSE subject.display_name END,
          source_name = excluded.source_name, active = 1, updated_at = excluded.updated_at`,
        ).bind(workspaceId, now, now, json, ...fence),
      ),
      ...jsonBatches(inserts).map((json) =>
        env.DB.prepare(
          `INSERT INTO item
        (id, workspace_id, kind, classification, source_type, canvas_base_url_hash,
         canvas_assignment_id, canvas_course_id, canvas_html_url, source_name, source_due_at,
         source_updated_at, source_payload_hash, display_name, due_at, due_has_explicit_time,
         subject_id, working_status, calendar_enabled, reminders_enabled, calendar_sync_state, created_at, updated_at)
        SELECT value ->> '$.id', ?, 'work', 'unclassified', 'canvas', ?,
          value ->> '$.assignmentId', value ->> '$.courseId', value ->> '$.url', value ->> '$.name', value ->> '$.due',
          value ->> '$.updated', value ->> '$.hash', value ->> '$.name', value ->> '$.due', (value ->> '$.due') IS NOT NULL,
          (SELECT id FROM subject WHERE workspace_id = ? AND canvas_course_id = value ->> '$.courseId'),
          'not_started', 1, 1, 'pending', ?, ? FROM json_each(?) WHERE ${guard}`,
        ).bind(workspaceId, baseHash, workspaceId, now, now, json, ...fence),
      ),
      ...jsonBatches(updates).map((json) =>
        env.DB.prepare(
          `UPDATE item SET
        source_name = value ->> '$.name', source_due_at = value ->> '$.due', source_updated_at = value ->> '$.updated',
        source_payload_hash = value ->> '$.hash', canvas_html_url = value ->> '$.url',
        missing_sync_count = 0, source_missing_since = NULL,
        display_name = CASE WHEN NOT EXISTS (SELECT 1 FROM field_override WHERE item_id = item.id AND field_name = 'name') THEN value ->> '$.name' ELSE display_name END,
        due_at = CASE WHEN NOT EXISTS (SELECT 1 FROM field_override WHERE item_id = item.id AND field_name = 'due') THEN value ->> '$.due' ELSE due_at END,
        due_date_local = CASE WHEN NOT EXISTS (SELECT 1 FROM field_override WHERE item_id = item.id AND field_name = 'due') THEN NULL ELSE due_date_local END,
        due_has_explicit_time = CASE WHEN NOT EXISTS (SELECT 1 FROM field_override WHERE item_id = item.id AND field_name = 'due') THEN (value ->> '$.due') IS NOT NULL ELSE due_has_explicit_time END,
        working_status = CASE WHEN value ->> '$.submitted' = 1 AND working_status <> 'completed' THEN 'submitted' ELSE working_status END,
        submitted_at = CASE WHEN value ->> '$.submitted' = 1 THEN COALESCE(submitted_at, ?) ELSE submitted_at END,
        archived_at = CASE WHEN value ->> '$.restore' = 1 THEN NULL ELSE archived_at END,
        archive_reason = CASE WHEN value ->> '$.restore' = 1 THEN NULL ELSE archive_reason END,
        reminders_enabled = CASE WHEN value ->> '$.restore' = 1 AND archive_reason = 'Removed from Canvas' THEN 1 ELSE reminders_enabled END,
        calendar_sync_state = CASE WHEN calendar_enabled = 1 THEN 'pending' ELSE calendar_sync_state END,
        version = version + 1, updated_at = ?
        FROM json_each(?) WHERE item.id = value ->> '$.id' AND workspace_id = ? AND ${guard}`,
        ).bind(now, now, json, workspaceId, ...fence),
      ),
      ...jsonBatches(resets).map((json) =>
        env.DB.prepare(
          `UPDATE item SET missing_sync_count = 0, source_missing_since = NULL, updated_at = ?
        WHERE workspace_id = ? AND id IN (SELECT value FROM json_each(?)) AND ${guard}`,
        ).bind(now, workspaceId, json, ...fence),
      ),
      ...jsonBatches(omissions).map((json) =>
        env.DB.prepare(
          `UPDATE item SET missing_sync_count = value ->> '$.count', canvas_missing_run_id = ?,
        source_missing_since = COALESCE(source_missing_since, ?),
        archived_at = CASE WHEN value ->> '$.confirmed' = 1 THEN ? ELSE archived_at END,
        archive_reason = CASE WHEN value ->> '$.confirmed' = 1 THEN 'Removed from Canvas' ELSE archive_reason END,
        reminders_enabled = CASE WHEN value ->> '$.confirmed' = 1 THEN 0 ELSE reminders_enabled END,
        calendar_sync_state = CASE WHEN value ->> '$.confirmed' = 1 THEN 'pending' ELSE calendar_sync_state END,
        version = version + 1, updated_at = ? FROM json_each(?)
        WHERE item.id = value ->> '$.id' AND workspace_id = ? AND ${guard}`,
        ).bind(missingRunId, now, now, now, json, workspaceId, ...fence),
      ),
      ...jsonBatches(histories).map((json) =>
        env.DB.prepare(
          `INSERT INTO item_history
        (id, item_id, actor_type, actor_identity, action, summary, before_json, after_json, created_at)
        SELECT value ->> '$.id', value ->> '$.itemId', 'canvas', 'Canvas', value ->> '$.action',
          value ->> '$.summary', value ->> '$.before', value ->> '$.after', ? FROM json_each(?) WHERE ${guard}`,
        ).bind(now, json, ...fence),
      ),
      env.DB.prepare(
        `UPDATE sync_run SET finished_at = ?, fetched_count = ?, created_count = ?,
        updated_count = ?, archived_count = ?, skipped_count = ?, result = ?, scheduled_key = ?
        WHERE id = ? AND workspace_id = ? AND ${guard}`,
      ).bind(
        now,
        result.assignments.length,
        createdIds.length,
        updated,
        archived,
        skipped,
        result.partialFailures.length ? "partial" : "success",
        finalKey,
        runId,
        workspaceId,
        ...fence,
      ),
      env.DB.prepare(
        `UPDATE integration_connection SET status = ?, last_success_at = ?, last_attempt_at = ?,
        last_error_category = NULL, reconnect_needed = 0, updated_at = ?
        WHERE workspace_id = ? AND provider = 'canvas' AND ${guard}`,
      ).bind(
        result.partialFailures.length ? "partial" : "healthy",
        now,
        now,
        now,
        workspaceId,
        ...fence,
      ),
    ];
    const committed = await env.DB.batch(statements);
    if (!committed.at(-1)?.meta.changes)
      throw new Error("Canvas connection changed during sync. Try again.");
    return {
      runId,
      createdIds,
      result: result.partialFailures.length ? "partial" : "success",
      courses: result.courses.length,
      fetched: result.assignments.length,
      created: createdIds.length,
      updated,
      archived,
      skipped,
    };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const authenticationFailure =
      error instanceof CanvasConnectionError &&
      error.code === "session_rejected";
    const transientFailure =
      error instanceof CanvasConnectionError &&
      (error.code === "request_failed" || error.code === "rate_limited");
    const failureCategory = authenticationFailure
      ? "canvas_session_rejected"
      : transientFailure
        ? "canvas_temporarily_unavailable"
        : error instanceof CanvasConnectionError
          ? `canvas_${canvasConnectionErrorCategory(error)}`
          : "canvas_sync_failed";
    await Promise.all([
      env.DB.prepare(
        `UPDATE sync_run SET finished_at = ?, result = 'failed',
         error_category = ?, scheduled_key = ? WHERE id = ? AND workspace_id = ?`,
      )
        .bind(failedAt, failureCategory, finalKey, runId, workspaceId)
        .run(),
      env.DB.prepare(
        `UPDATE integration_connection SET status = ?,
         last_attempt_at = ?, last_error_category = ?, reconnect_needed = ?,
         updated_at = ? WHERE workspace_id = ? AND provider = 'canvas'
           AND status <> 'disconnected' AND metadata_json = ? AND encrypted_credential IS ?`,
      )
        .bind(
          authenticationFailure
            ? "action_needed"
            : transientFailure
              ? "delayed"
              : "action_needed",
          failedAt,
          failureCategory,
          authenticationFailure ? 1 : 0,
          failedAt,
          workspaceId,
          connection.metadata_json,
          connection.encrypted_credential,
        )
        .run(),
    ]).catch(() => undefined);
    throw error;
  }
}

const calendarNoteMarker = "— Your calendar note —";

export function extractCalendarNote(
  description: string | undefined,
): string | undefined {
  if (typeof description !== "string") return undefined;
  const markerIndex = description.indexOf(calendarNoteMarker);
  if (markerIndex < 0) return undefined;
  return description
    .slice(markerIndex + calendarNoteMarker.length)
    .replaceAll("\r", "")
    .trim()
    .slice(0, 20_000);
}

export function calendarPatchFromEvent(
  item: OrganatoItem,
  event: CalendarEventRecord,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const summary = event.summary?.trim().slice(0, 500);
  if (summary && summary !== item.displayName) patch.displayName = summary;
  const dateTime = event.start?.dateTime;
  const dateOnly = event.start?.date;
  if (dateTime) {
    const parsed = new Date(dateTime);
    if (Number.isFinite(parsed.getTime())) {
      const dueAt = parsed.toISOString();
      if (
        item.dueAt !== dueAt ||
        item.dueDateLocal !== null ||
        !item.dueHasExplicitTime
      ) {
        patch.dueAt = dueAt;
        patch.dueDateLocal = null;
        patch.dueHasExplicitTime = true;
      }
    }
  } else if (dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    if (
      item.dueDateLocal !== dateOnly ||
      item.dueAt !== null ||
      item.dueHasExplicitTime
    ) {
      patch.dueAt = null;
      patch.dueDateLocal = dateOnly;
      patch.dueHasExplicitTime = false;
    }
  }
  const calendarNote = extractCalendarNote(event.description);
  if (calendarNote !== undefined && calendarNote !== item.calendarNote) {
    patch.calendarNote = calendarNote;
  }
  return patch;
}

async function updateGoogleHealth(
  env: Env,
  workspaceId: string,
  input: {
    status: "healthy" | "partial" | "delayed" | "action_needed";
    errorCategory: string | null;
    success: boolean;
    reconnectNeeded?: boolean;
    syncToken?: string;
  },
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE integration_connection SET
       status = ?, last_attempt_at = ?,
       last_success_at = CASE WHEN ? = 1 THEN ? ELSE last_success_at END,
       last_error_category = ?, reconnect_needed = ?,
       metadata_json = CASE WHEN ? IS NOT NULL
         THEN json_set(metadata_json, '$.syncToken', ?)
         ELSE metadata_json END,
       updated_at = ?
     WHERE workspace_id = ? AND provider = 'google'`,
  )
    .bind(
      input.status,
      now,
      input.success ? 1 : 0,
      now,
      input.errorCategory,
      input.reconnectNeeded ? 1 : 0,
      input.syncToken ?? null,
      input.syncToken ?? null,
      now,
      workspaceId,
    )
    .run();
}

async function acquireCalendarRun(
  env: Env,
  workspaceId: string,
  now = new Date(),
): Promise<string | null> {
  const activeKey = `${workspaceId}:google-calendar:active`;
  const staleBefore = new Date(now.getTime() - 10 * 60_000).toISOString();
  await env.DB.prepare(
    `UPDATE sync_run
     SET scheduled_key = 'abandoned:' || id, finished_at = ?,
         result = 'failed', error_category = 'stale_google_calendar_lock'
     WHERE workspace_id = ? AND provider = 'google_calendar'
       AND scheduled_key = ? AND started_at < ?`,
  )
    .bind(now.toISOString(), workspaceId, activeKey, staleBefore)
    .run();
  const runId = crypto.randomUUID();
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO sync_run
      (id, workspace_id, provider, trigger_type, scheduled_key, started_at, result)
     VALUES (?, ?, 'google_calendar', 'reconcile', ?, ?, 'running')`,
  )
    .bind(runId, workspaceId, activeKey, now.toISOString())
    .run();
  return result.meta.changes ? runId : null;
}

async function finishCalendarRun(
  env: Env,
  runId: string,
  result: "success" | "partial" | "failed",
  errorCategory: string | null = null,
) {
  await env.DB.prepare(
    `UPDATE sync_run
     SET scheduled_key = 'completed:' || id, finished_at = ?,
         result = ?, error_category = ?
     WHERE id = ?`,
  )
    .bind(new Date().toISOString(), result, errorCategory, runId)
    .run();
}

export async function runCalendarReconciliation(
  env: Env,
  workspaceId: string,
): Promise<void> {
  const connection = await loadGoogleConnection(env, workspaceId);
  if (!connection?.metadata.calendarId) return;
  const runId = await acquireCalendarRun(env, workspaceId);
  if (!runId) return;
  const calendarId = connection.metadata.calendarId;
  const subjects = await listSubjects(env.DB, workspaceId);
  const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
  let nextSyncToken: string | undefined;
  let pullFailures = 0;
  let pushFailures = 0;

  try {
    let syncToken = connection.metadata.syncToken;
    let resetExpiredToken = false;
    for (;;) {
      let pageToken: string | undefined;
      let pageCount = 0;
      try {
        do {
          pageCount += 1;
          if (pageCount > 50) throw new GoogleApiError(508, false);
          const page = await connection.calendar.listChanges(
            calendarId,
            syncToken,
            pageToken,
          );
          for (const event of page.events) {
            try {
              const link = await env.DB.prepare(
                `SELECT item_id, google_etag, sync_state
                 FROM calendar_link WHERE workspace_id = ? AND google_event_id = ?`,
              )
                .bind(workspaceId, event.id)
                .first<{
                  item_id: string;
                  google_etag: string | null;
                  sync_state: string;
                }>();
              const itemId =
                link?.item_id ??
                event.extendedProperties?.private?.organatoItemId;
              if (!itemId) continue;
              const item = await getItem(env.DB, workspaceId, itemId);
              if (!item) continue;
              if (event.status === "cancelled") {
                if (!link || item.archivedAt) continue;
                const now = new Date().toISOString();
                await env.DB.batch([
                  env.DB.prepare(
                    `UPDATE item SET calendar_enabled = 0,
                       calendar_sync_state = 'suppressed',
                       version = version + 1, updated_at = ?
                     WHERE id = ? AND workspace_id = ?`,
                  ).bind(now, item.id, workspaceId),
                  env.DB.prepare(
                    `UPDATE calendar_link SET google_event_id = NULL,
                       google_etag = NULL, sync_state = 'suppressed',
                       suppressed_at = ?, last_synced_at = ?
                     WHERE item_id = ? AND workspace_id = ?`,
                  ).bind(now, now, item.id, workspaceId),
                  env.DB.prepare(
                    `INSERT INTO item_history
                      (id, item_id, actor_type, actor_identity, action,
                       summary, created_at)
                     VALUES (?, ?, 'google', ?, 'calendar_suppressed',
                             'Google Calendar event was deleted', ?)`,
                  ).bind(
                    crypto.randomUUID(),
                    item.id,
                    connection.metadata.email,
                    now,
                  ),
                ]);
                continue;
              }
              if (link?.google_etag && event.etag === link.google_etag) {
                continue;
              }
              const patch = calendarPatchFromEvent(item, event);
              const updatedItem = Object.keys(patch).length
                ? await patchItem(
                    env.DB,
                    workspaceId,
                    item.id,
                    item.version,
                    patch,
                    connection.metadata.email,
                    "google",
                  )
                : item;
              const now = new Date().toISOString();
              await env.DB.batch([
                env.DB.prepare(
                  `INSERT INTO calendar_link
                    (item_id, workspace_id, google_calendar_id, google_event_id, google_etag,
                     last_google_updated_at, last_pushed_item_version,
                     sync_state, last_synced_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', ?)
                   ON CONFLICT(item_id) DO UPDATE SET
                     google_event_id = excluded.google_event_id,
                     google_etag = excluded.google_etag,
                     last_google_updated_at = excluded.last_google_updated_at,
                     last_pushed_item_version = excluded.last_pushed_item_version,
                     sync_state = 'synced', suppressed_at = NULL,
                     last_synced_at = excluded.last_synced_at`,
                ).bind(
                  item.id,
                  workspaceId,
                  calendarId,
                  event.id,
                  event.etag ?? null,
                  event.updated ?? now,
                  updatedItem.version,
                  now,
                ),
                env.DB.prepare(
                  `UPDATE item SET calendar_sync_state = 'synced'
                   WHERE id = ? AND workspace_id = ?`,
                ).bind(item.id, workspaceId),
              ]);
            } catch {
              pullFailures += 1;
            }
          }
          pageToken = page.nextPageToken;
          nextSyncToken = page.nextSyncToken ?? nextSyncToken;
        } while (pageToken);
        break;
      } catch (error) {
        if (
          error instanceof GoogleApiError &&
          error.status === 410 &&
          syncToken &&
          !resetExpiredToken
        ) {
          resetExpiredToken = true;
          syncToken = undefined;
          nextSyncToken = undefined;
          await env.DB.prepare(
            `UPDATE integration_connection
             SET metadata_json = json_remove(metadata_json, '$.syncToken'),
                 updated_at = ? WHERE workspace_id = ? AND provider = 'google'`,
          )
            .bind(new Date().toISOString(), workspaceId)
            .run();
          continue;
        }
        throw error;
      }
    }

    const pendingRows = await env.DB.prepare(
      `SELECT id FROM item
       WHERE workspace_id = ?
         AND calendar_sync_state IN ('pending', 'error', 'conflict')
       ORDER BY updated_at LIMIT 1000`,
    )
      .bind(workspaceId)
      .all<{ id: string }>();
    for (const row of pendingRows.results) {
      const item = await getItem(env.DB, workspaceId, row.id);
      if (!item) continue;
      const link = await env.DB.prepare(
        `SELECT google_event_id, google_etag, sync_state, last_synced_at
         FROM calendar_link WHERE workspace_id = ? AND item_id = ?`,
      )
        .bind(workspaceId, item.id)
        .first<{
          google_event_id: string | null;
          google_etag: string | null;
          sync_state: string;
          last_synced_at: string | null;
        }>();
      const projection = projectCalendarEvent(
        item,
        item.subjectId ? subjectMap.get(item.subjectId) : undefined,
        env.APP_ORIGIN,
      );
      try {
        if (!projection) {
          if (link?.google_event_id) {
            await connection.calendar.deleteEvent(
              calendarId,
              link.google_event_id,
            );
          }
          const state = item.calendarEnabled ? "synced" : "suppressed";
          await env.DB.batch([
            env.DB.prepare(
              "DELETE FROM calendar_link WHERE workspace_id = ? AND item_id = ?",
            ).bind(workspaceId, item.id),
            env.DB.prepare(
              "UPDATE item SET calendar_sync_state = ? WHERE id = ? AND workspace_id = ?",
            ).bind(state, item.id, workspaceId),
          ]);
          continue;
        }
        let event: CalendarEventRecord;
        try {
          event = await connection.calendar.upsertEvent(
            calendarId,
            projection,
            link?.google_event_id ?? undefined,
            link?.google_etag ?? undefined,
          );
        } catch (error) {
          if (
            link?.google_event_id &&
            error instanceof GoogleApiError &&
            (error.status === 404 || error.status === 410)
          ) {
            event = await connection.calendar.upsertEvent(
              calendarId,
              projection,
            );
          } else {
            throw error;
          }
        }
        const now = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO calendar_link
              (item_id, workspace_id, google_calendar_id, google_event_id, google_etag,
               last_google_updated_at, last_pushed_item_version, sync_state,
               last_synced_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', ?)
             ON CONFLICT(item_id) DO UPDATE SET
               google_event_id = excluded.google_event_id,
               google_etag = excluded.google_etag,
               last_google_updated_at = excluded.last_google_updated_at,
               last_pushed_item_version = excluded.last_pushed_item_version,
               sync_state = 'synced', suppressed_at = NULL,
               last_synced_at = excluded.last_synced_at`,
          ).bind(
            item.id,
            workspaceId,
            calendarId,
            event.id,
            event.etag ?? null,
            event.updated ?? now,
            item.version,
            now,
          ),
          env.DB.prepare(
            "UPDATE item SET calendar_sync_state = 'synced' WHERE id = ? AND workspace_id = ?",
          ).bind(item.id, workspaceId),
        ]);
      } catch (error) {
        if (
          error instanceof GoogleApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          throw error;
        }
        pushFailures += 1;
        const conflict =
          error instanceof GoogleApiError && error.status === 412;
        const now = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE item SET calendar_sync_state = ? WHERE id = ? AND workspace_id = ?`,
          ).bind(conflict ? "conflict" : "error", item.id, workspaceId),
          ...(link
            ? [
                env.DB.prepare(
                  `UPDATE calendar_link SET sync_state = ?,
                     last_synced_at = ? WHERE item_id = ? AND workspace_id = ?`,
                ).bind(
                  conflict ? "conflict" : "error",
                  now,
                  item.id,
                  workspaceId,
                ),
              ]
            : []),
        ]);
      }
    }

    await updateGoogleHealth(env, workspaceId, {
      status: pullFailures || pushFailures ? "partial" : "healthy",
      errorCategory:
        pullFailures || pushFailures ? "calendar_partial_failure" : null,
      success: pullFailures === 0 && pushFailures === 0,
      ...(pullFailures === 0 && nextSyncToken
        ? { syncToken: nextSyncToken }
        : {}),
    });
    await finishCalendarRun(
      env,
      runId,
      pullFailures || pushFailures ? "partial" : "success",
      pullFailures || pushFailures ? "calendar_partial_failure" : null,
    );
  } catch (error) {
    const authorizationFailure =
      error instanceof GoogleApiError &&
      (error.status === 401 || error.status === 403);
    await updateGoogleHealth(env, workspaceId, {
      status: authorizationFailure ? "action_needed" : "delayed",
      errorCategory: authorizationFailure
        ? "google_authorization_failed"
        : "calendar_temporarily_unavailable",
      success: false,
      reconnectNeeded: authorizationFailure,
    }).catch(() => undefined);
    await finishCalendarRun(
      env,
      runId,
      "failed",
      authorizationFailure
        ? "google_authorization_failed"
        : "calendar_temporarily_unavailable",
    ).catch(() => undefined);
    throw error;
  }
}

export function nextDeliveryAttemptAt(attemptCount: number, now = new Date()) {
  const delayMinutes = Math.min(60, 5 * 2 ** Math.max(0, attemptCount - 1));
  return new Date(now.getTime() + delayMinutes * 60_000);
}

function syncHealthLabel(value: string | null | undefined, timezone: string) {
  if (!value) return "never";
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return "unknown";
  return instant.toLocaleString("en-AU", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function renderWorkspaceDigest(
  env: Env,
  workspaceId: string,
  items: OrganatoItem[],
  now: Date,
  timezone: string,
) {
  const [subjects, healthRows] = await Promise.all([
    listSubjects(env.DB, workspaceId),
    env.DB.prepare(
      `SELECT provider, last_success_at FROM integration_connection
       WHERE workspace_id = ? AND provider IN ('canvas', 'google')`,
    )
      .bind(workspaceId)
      .all<{ provider: string; last_success_at: string | null }>(),
  ]);
  const health = new Map(
    healthRows.results.map((row) => [row.provider, row.last_success_at]),
  );
  return renderDigest({
    items,
    subjects,
    now,
    appOrigin: env.APP_ORIGIN,
    lastCanvasSync: syncHealthLabel(health.get("canvas"), timezone),
    lastCalendarSync: syncHealthLabel(health.get("google"), timezone),
    timezone,
  });
}

async function sendDigestForItems(
  env: Env,
  workspaceId: string,
  items: OrganatoItem[],
  deliveryKey: string,
  deliveryType: "daily_digest" | "urgent_import",
  options: {
    now: Date;
    timezone: string;
    forceRetry?: boolean;
  },
): Promise<void> {
  const connection = await loadGoogleConnection(env, workspaceId);
  if (!connection) return;
  const rendered = await renderWorkspaceDigest(
    env,
    workspaceId,
    items,
    options.now,
    options.timezone,
  );
  const nowIso = options.now.toISOString();
  const localDate = localDateKey(options.now, options.timezone);
  const scopedDeliveryKey = `${workspaceId}:${deliveryKey}`;
  if (!rendered) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO reminder_delivery
       (delivery_key, workspace_id, delivery_type, local_date, item_snapshot_json, status,
        attempt_count, created_at, last_attempt_at)
       VALUES (?, ?, ?, ?, '[]', 'skipped_no_items', 0, ?, ?)`,
    )
      .bind(
        scopedDeliveryKey,
        workspaceId,
        deliveryType,
        localDate,
        nowIso,
        nowIso,
      )
      .run();
    return;
  }
  const dailyCount = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM reminder_delivery
     WHERE workspace_id = ? AND local_date = ? AND status = 'sent'`,
  )
    .bind(workspaceId, localDate)
    .first<{ count: number }>();
  if (Number(dailyCount?.count ?? 0) >= 10) {
    await env.DB.prepare(
      `INSERT INTO reminder_delivery
        (delivery_key, workspace_id, delivery_type, local_date, item_snapshot_json, status,
         attempt_count, created_at, last_attempt_at, last_error_category)
       VALUES (?, ?, ?, ?, ?, 'skipped_daily_limit', 0, ?, ?,
               'daily_delivery_limit')
       ON CONFLICT(delivery_key) DO UPDATE SET
         status = 'skipped_daily_limit',
         last_attempt_at = excluded.last_attempt_at,
         last_error_category = excluded.last_error_category`,
    )
      .bind(
        scopedDeliveryKey,
        workspaceId,
        deliveryType,
        localDate,
        JSON.stringify(rendered.itemIds),
        nowIso,
        nowIso,
      )
      .run();
    return;
  }
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO reminder_delivery
      (delivery_key, workspace_id, delivery_type, local_date, item_snapshot_json, status,
       attempt_count, created_at, last_attempt_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 1, ?, ?)`,
  )
    .bind(
      scopedDeliveryKey,
      workspaceId,
      deliveryType,
      localDate,
      JSON.stringify(rendered.itemIds),
      nowIso,
      nowIso,
    )
    .run();
  if (!inserted.meta.changes) {
    const staleBefore = new Date(
      options.now.getTime() - 10 * 60_000,
    ).toISOString();
    const claimed = await env.DB.prepare(
      `UPDATE reminder_delivery
       SET status = 'pending', attempt_count = attempt_count + 1,
           last_attempt_at = ?, next_attempt_at = NULL,
           last_error_category = NULL
       WHERE workspace_id = ? AND delivery_key = ? AND attempt_count < 3
         AND (
           (status = 'failed_transient' AND
             (? = 1 OR next_attempt_at IS NULL OR next_attempt_at <= ?))
           OR (status = 'pending' AND
               COALESCE(last_attempt_at, created_at) <= ?)
         )`,
    )
      .bind(
        nowIso,
        workspaceId,
        scopedDeliveryKey,
        options.forceRetry ? 1 : 0,
        nowIso,
        staleBefore,
      )
      .run();
    if (!claimed.meta.changes) return;
  }
  const recipients = connection.metadata.recipients?.length
    ? connection.metadata.recipients
    : [connection.metadata.email];
  const gmail = new GmailSendProvider(
    connection.tokenSource,
    connection.metadata.email,
  );
  try {
    const sent = await gmail.send({
      to: recipients,
      subject:
        deliveryType === "urgent_import"
          ? `New short-notice Canvas work: ${rendered.subject}`
          : rendered.subject,
      html: rendered.html,
      text: rendered.text,
      deliveryKey: scopedDeliveryKey,
    });
    await env.DB.prepare(
      `UPDATE reminder_delivery SET status = 'sent', gmail_message_id = ?,
         sent_at = ?, last_attempt_at = ?, next_attempt_at = NULL,
         last_error_category = NULL
       WHERE workspace_id = ? AND delivery_key = ?`,
    )
      .bind(sent.messageId, nowIso, nowIso, workspaceId, scopedDeliveryKey)
      .run();
  } catch (error) {
    const authorizationFailure =
      error instanceof GoogleApiError &&
      (error.status === 401 || error.status === 403);
    const delivery = await env.DB.prepare(
      `SELECT attempt_count FROM reminder_delivery WHERE workspace_id = ? AND delivery_key = ?`,
    )
      .bind(workspaceId, scopedDeliveryKey)
      .first<{ attempt_count: number }>();
    const attempts = Number(delivery?.attempt_count ?? 1);
    const retryAt =
      authorizationFailure || attempts >= 3
        ? null
        : nextDeliveryAttemptAt(attempts, options.now).toISOString();
    await Promise.all([
      env.DB.prepare(
        `UPDATE reminder_delivery
         SET status = ?, last_attempt_at = ?, next_attempt_at = ?,
             last_error_category = ?
         WHERE workspace_id = ? AND delivery_key = ?`,
      )
        .bind(
          authorizationFailure || attempts >= 3
            ? "failed_permanent"
            : "failed_transient",
          nowIso,
          retryAt,
          authorizationFailure
            ? "google_authorization_failed"
            : attempts >= 3
              ? "retry_limit_reached"
              : "gmail_temporarily_unavailable",
          workspaceId,
          scopedDeliveryKey,
        )
        .run(),
      env.DB.prepare(
        `UPDATE integration_connection
         SET status = ?, last_attempt_at = ?, last_error_category = ?,
             reconnect_needed = ?, updated_at = ?
         WHERE workspace_id = ? AND provider = 'google'`,
      )
        .bind(
          authorizationFailure ? "action_needed" : "delayed",
          nowIso,
          authorizationFailure
            ? "google_authorization_failed"
            : "gmail_temporarily_unavailable",
          authorizationFailure ? 1 : 0,
          nowIso,
          workspaceId,
        )
        .run(),
    ]);
    throw error;
  }
}

export async function sendTestEmail(
  env: Env,
  workspaceId: string,
  now = new Date(),
): Promise<{ messageId: string }> {
  const connection = await loadGoogleConnection(env, workspaceId);
  if (!connection) {
    throw new GoogleConnectionError(
      "not_connected",
      "Google is not connected.",
    );
  }
  const recipients = connection.metadata.recipients?.length
    ? connection.metadata.recipients
    : [connection.metadata.email];
  const [settings, items] = await Promise.all([
    getSettings(env.DB, workspaceId),
    listItems(env.DB, workspaceId, { limit: 1_000 }),
  ]);
  const rendered = await renderWorkspaceDigest(
    env,
    workspaceId,
    items,
    now,
    settings.timezone,
  );
  if (!rendered) {
    throw new DigestPreviewError(
      "There is no unfinished work due in the next seven days to preview.",
    );
  }
  const gmail = new GmailSendProvider(
    connection.tokenSource,
    connection.metadata.email,
  );
  const sent = await gmail.send({
    to: recipients,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    deliveryKey: `preview:${now.toISOString()}:${crypto.randomUUID()}`,
  });
  return sent;
}

export class DigestPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DigestPreviewError";
  }
}

export async function runDailyDigest(
  env: Env,
  workspaceId: string,
  now = new Date(),
): Promise<void> {
  const settings = await getSettings(env.DB, workspaceId);
  if (
    !settings.dailyDigestEnabled ||
    !isDigestHour(now, settings.timezone, settings.digestHour)
  ) {
    return;
  }
  await runCalendarReconciliation(env, workspaceId);
  const connection = await loadGoogleConnection(env, workspaceId);
  if (!connection) return;
  const recipients = connection.metadata.recipients?.length
    ? connection.metadata.recipients
    : [connection.metadata.email];
  const key = digestDeliveryKey(
    localDateKey(now, settings.timezone),
    recipients,
  );
  await sendDigestForItems(
    env,
    workspaceId,
    await listItems(env.DB, workspaceId, { limit: 1_000 }),
    key,
    "daily_digest",
    { now, timezone: settings.timezone },
  );
}

export async function sendUrgentImport(
  env: Env,
  workspaceId: string,
  runId: string,
  createdIds: string[],
): Promise<void> {
  if (!createdIds.length) return;
  const settings = await getSettings(env.DB, workspaceId);
  if (!settings.immediateImportAlert) return;
  const items = await listItems(env.DB, workspaceId, {
    ids: createdIds,
    limit: 2000,
  });
  await sendDigestForItems(
    env,
    workspaceId,
    items,
    `urgent-import:${runId}`,
    "urgent_import",
    { now: new Date(), timezone: settings.timezone },
  );
}

export async function retryLatestDelivery(
  env: Env,
  workspaceId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT delivery_key, delivery_type, item_snapshot_json
     FROM reminder_delivery
     WHERE workspace_id = ? AND status = 'failed_transient'
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(workspaceId)
    .first<{
      delivery_key: string;
      delivery_type: "daily_digest" | "urgent_import";
      item_snapshot_json: string;
    }>();
  if (!row) return false;
  if (
    row.delivery_type !== "daily_digest" &&
    row.delivery_type !== "urgent_import"
  ) {
    return false;
  }
  const ids = JSON.parse(row.item_snapshot_json) as unknown;
  if (!Array.isArray(ids) || !ids.every((value) => typeof value === "string")) {
    return false;
  }
  const items = (
    await Promise.all(ids.map((id) => getItem(env.DB, workspaceId, id)))
  ).filter((item): item is OrganatoItem => item !== null);
  const settings = await getSettings(env.DB, workspaceId);
  await sendDigestForItems(
    env,
    workspaceId,
    items,
    row.delivery_key.replace(`${workspaceId}:`, ""),
    row.delivery_type,
    {
      now: new Date(),
      timezone: settings.timezone,
      forceRetry: true,
    },
  );
  return true;
}

export async function runRetentionCleanup(
  env: Env,
  now = new Date(),
): Promise<void> {
  const isoBefore = (days: number) =>
    new Date(now.getTime() - days * 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sync_run WHERE started_at < ?").bind(
      isoBefore(90),
    ),
    env.DB.prepare("DELETE FROM reminder_delivery WHERE created_at < ?").bind(
      isoBefore(180),
    ),
    env.DB.prepare("DELETE FROM item_history WHERE created_at < ?").bind(
      isoBefore(365),
    ),
    env.DB.prepare("DELETE FROM security_event WHERE created_at < ?").bind(
      isoBefore(365),
    ),
    env.DB.prepare("DELETE FROM oauth_transaction WHERE expires_at < ?").bind(
      now.toISOString(),
    ),
    env.DB.prepare("DELETE FROM rate_limit WHERE window_start < ?").bind(
      isoBefore(2),
    ),
    env.DB.prepare(
      `DELETE FROM session
       WHERE absolute_expires_at < ?
          OR (revoked_at IS NOT NULL AND revoked_at < ?)`,
    ).bind(now.toISOString(), isoBefore(30)),
  ]);
}
