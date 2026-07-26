import {
  digestDeliveryKey,
  isDigestHour,
  localDateKey,
  type OrganatoItem,
} from "@organato/domain";
import { renderDigest } from "@organato/email";
import {
  CanvasRestProvider,
  GmailSendProvider,
  projectCalendarEvent,
} from "@organato/integrations";
import { parseCanvasConnectionMetadata } from "./canvas-connection";
import { getItem, getSettings, listItems, listSubjects, patchItem } from "./db";
import { loadGoogleConnection } from "./google-connection";
import { decryptSecret, sha256 } from "./security";
import type { Env } from "./types";

function subjectColour(index: number): string {
  return ["#c084fc", "#3b9df8", "#7bd66a", "#f59e0b", "#a78bfa", "#55d6d6"][
    index % 6
  ]!;
}

export interface CanvasSyncOutcome {
  runId: string;
  createdIds: string[];
  result: "success" | "partial" | "skipped";
  courses: number;
  fetched: number;
  created: number;
  updated: number;
}

export async function runCanvasSync(
  env: Env,
  trigger: "scheduled" | "manual",
): Promise<CanvasSyncOutcome> {
  const connection = await env.DB.prepare(
    `SELECT encrypted_credential, metadata_json, account_label
     FROM integration_connection
     WHERE provider = 'canvas' AND status <> 'disconnected'`,
  ).first<{
    encrypted_credential: string;
    metadata_json: string;
    account_label: string;
  }>();
  if (!connection) throw new Error("Canvas is not connected.");
  const metadata = parseCanvasConnectionMetadata(
    connection.metadata_json,
    connection.account_label,
  );
  if (!metadata) throw new Error("Canvas connection metadata is invalid.");
  const token = await decryptSecret(
    connection.encrypted_credential,
    env.DATA_ENCRYPTION_KEY,
    metadata.credentialAad,
  );
  const runId = crypto.randomUUID();
  const scheduledKey =
    trigger === "scheduled"
      ? `canvas:${new Date().toISOString().slice(0, 13)}`
      : `manual:${runId}`;
  const lock = await env.DB.prepare(
    `INSERT OR IGNORE INTO sync_run
      (id, provider, trigger_type, scheduled_key, started_at, result)
     VALUES (?, 'canvas', ?, ?, ?, 'running')`,
  )
    .bind(runId, trigger, scheduledKey, new Date().toISOString())
    .run();
  if (!lock.meta.changes) {
    return {
      runId,
      createdIds: [],
      result: "skipped",
      courses: 0,
      fetched: 0,
      created: 0,
      updated: 0,
    };
  }
  try {
    const provider = new CanvasRestProvider(metadata.baseUrl, token);
    const result = await provider.fetchUpcomingAssignments(
      AbortSignal.timeout(45_000),
    );
    const now = new Date().toISOString();
    const createdIds: string[] = [];
    let updated = 0;
    const seenAssignmentIds = new Set(
      result.assignments.map((assignment) => assignment.id),
    );
    const baseHash = await sha256(provider.baseUrl.origin);

    for (const [index, course] of result.courses.entries()) {
      await env.DB.prepare(
        `INSERT INTO subject
        (id, canvas_course_id, source_name, display_name, colour, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(canvas_course_id) DO UPDATE SET
         source_name = excluded.source_name,
         active = 1,
         updated_at = excluded.updated_at`,
      )
        .bind(
          `canvas-course-${course.id}`,
          course.id,
          course.name,
          course.name,
          subjectColour(index),
          now,
          now,
        )
        .run();
    }

    for (const assignment of result.assignments) {
      const existing = await env.DB.prepare(
        "SELECT id, working_status FROM item WHERE canvas_base_url_hash = ? AND canvas_assignment_id = ?",
      )
        .bind(baseHash, assignment.id)
        .first<{ id: string; working_status: string }>();
      const payloadHash = await sha256(
        JSON.stringify([
          assignment.name,
          assignment.dueAt,
          assignment.htmlUrl,
          assignment.updatedAt,
          assignment.submitted,
        ]),
      );
      if (!existing) {
        const id = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO item
          (id, kind, classification, source_type, canvas_base_url_hash, canvas_assignment_id,
           canvas_course_id, canvas_html_url, source_name, source_due_at, source_updated_at,
           source_payload_hash, display_name, due_at, due_has_explicit_time, subject_id,
           working_status, submitted_at, calendar_enabled, reminders_enabled,
           calendar_sync_state, created_at, updated_at)
         VALUES (?, 'work', 'unclassified', 'canvas', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?,
                 ?, ?, 1, 1, 'pending', ?, ?)`,
        )
          .bind(
            id,
            baseHash,
            assignment.id,
            assignment.courseId,
            assignment.htmlUrl,
            assignment.name,
            assignment.dueAt,
            assignment.updatedAt,
            payloadHash,
            assignment.name,
            assignment.dueAt,
            `canvas-course-${assignment.courseId}`,
            assignment.submitted ? "submitted" : "not_started",
            assignment.submitted ? now : null,
            now,
            now,
          )
          .run();
        createdIds.push(id);
      } else {
        await env.DB.prepare(
          `UPDATE item SET
           source_name = ?, source_due_at = ?, source_updated_at = ?, source_payload_hash = ?,
           canvas_html_url = ?, missing_sync_count = 0, source_missing_since = NULL,
           display_name = CASE WHEN NOT EXISTS (
             SELECT 1 FROM field_override WHERE item_id = item.id AND field_name = 'name'
           ) THEN ? ELSE display_name END,
           due_at = CASE WHEN NOT EXISTS (
             SELECT 1 FROM field_override WHERE item_id = item.id AND field_name = 'due'
           ) THEN ? ELSE due_at END,
           working_status = CASE
             WHEN ? = 1 AND working_status <> 'completed' THEN 'submitted'
             ELSE working_status END,
           submitted_at = CASE WHEN ? = 1 THEN COALESCE(submitted_at, ?) ELSE submitted_at END,
           calendar_sync_state = 'pending',
           version = version + 1,
           updated_at = ?
         WHERE id = ?`,
        )
          .bind(
            assignment.name,
            assignment.dueAt,
            assignment.updatedAt,
            payloadHash,
            assignment.htmlUrl,
            assignment.name,
            assignment.dueAt,
            assignment.submitted ? 1 : 0,
            assignment.submitted ? 1 : 0,
            now,
            now,
            existing.id,
          )
          .run();
        updated += 1;
      }
    }

    const existingCanvas = await env.DB.prepare(
      `SELECT id, canvas_assignment_id, missing_sync_count, manual_archive
     FROM item WHERE source_type = 'canvas' AND canvas_base_url_hash = ?`,
    )
      .bind(baseHash)
      .all<{
        id: string;
        canvas_assignment_id: string;
        missing_sync_count: number;
        manual_archive: number;
      }>();
    for (const item of existingCanvas.results) {
      if (seenAssignmentIds.has(item.canvas_assignment_id)) continue;
      const count = item.missing_sync_count + 1;
      await env.DB.prepare(
        `UPDATE item SET missing_sync_count = ?, source_missing_since = COALESCE(source_missing_since, ?),
       archived_at = CASE WHEN ? >= 2 AND manual_archive = 0 THEN ? ELSE archived_at END,
       archive_reason = CASE WHEN ? >= 2 AND manual_archive = 0 THEN 'Removed from Canvas' ELSE archive_reason END,
       calendar_sync_state = CASE WHEN ? >= 2 THEN 'pending' ELSE calendar_sync_state END
       WHERE id = ?`,
      )
        .bind(count, now, count, now, count, count, item.id)
        .run();
    }
    await env.DB.prepare(
      `UPDATE sync_run SET finished_at = ?, fetched_count = ?, created_count = ?,
     updated_count = ?, result = ? WHERE id = ?`,
    )
      .bind(
        new Date().toISOString(),
        result.assignments.length,
        createdIds.length,
        updated,
        result.partialFailures.length ? "partial" : "success",
        runId,
      )
      .run();
    await env.DB.prepare(
      `UPDATE integration_connection SET status = ?, last_success_at = ?, last_attempt_at = ?,
     last_error_category = NULL, updated_at = ? WHERE provider = 'canvas'`,
    )
      .bind(
        result.partialFailures.length ? "partial" : "healthy",
        now,
        now,
        now,
      )
      .run();
    return {
      runId,
      createdIds,
      result: result.partialFailures.length ? "partial" : "success",
      courses: result.courses.length,
      fetched: result.assignments.length,
      created: createdIds.length,
      updated,
    };
  } catch (error) {
    const failedAt = new Date().toISOString();
    await Promise.all([
      env.DB.prepare(
        `UPDATE sync_run SET finished_at = ?, result = 'failed',
         error_category = 'canvas_sync_failed' WHERE id = ?`,
      )
        .bind(failedAt, runId)
        .run(),
      env.DB.prepare(
        `UPDATE integration_connection SET status = 'action_needed',
         last_attempt_at = ?, last_error_category = 'canvas_sync_failed',
         updated_at = ? WHERE provider = 'canvas'`,
      )
        .bind(failedAt, failedAt)
        .run(),
    ]).catch(() => undefined);
    throw error;
  }
}

export async function runCalendarReconciliation(env: Env): Promise<void> {
  const connection = await loadGoogleConnection(env);
  if (!connection?.metadata.calendarId) return;
  const subjects = await listSubjects(env.DB);
  const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  do {
    const page = await connection.calendar.listChanges(
      connection.metadata.calendarId,
      connection.metadata.syncToken,
      pageToken,
    );
    for (const event of page.events) {
      const link = await env.DB.prepare(
        "SELECT item_id FROM calendar_link WHERE google_event_id = ?",
      )
        .bind(event.id)
        .first<{ item_id: string }>();
      const itemId =
        link?.item_id ?? event.extendedProperties?.private?.organatoItemId;
      if (!itemId) continue;
      const item = await getItem(env.DB, itemId);
      if (!item) continue;
      if (event.status === "cancelled") {
        await env.DB.prepare(
          `UPDATE item SET calendar_enabled = 0, calendar_sync_state = 'suppressed',
           version = version + 1, updated_at = ? WHERE id = ?`,
        )
          .bind(new Date().toISOString(), item.id)
          .run();
        await env.DB.prepare(
          "UPDATE calendar_link SET sync_state = 'suppressed', suppressed_at = ? WHERE item_id = ?",
        )
          .bind(new Date().toISOString(), item.id)
          .run();
        continue;
      }
      const googleDue = event.start.dateTime
        ? new Date(event.start.dateTime).toISOString()
        : event.start.date
          ? new Date(`${event.start.date}T13:59:00.000Z`).toISOString()
          : item.dueAt;
      const patch: Record<string, unknown> = {};
      if (event.summary !== item.displayName) patch.displayName = event.summary;
      if (googleDue && googleDue !== item.dueAt) patch.dueAt = googleDue;
      if (Object.keys(patch).length) {
        await patchItem(
          env.DB,
          item.id,
          item.version,
          patch,
          connection.metadata.email,
          "google",
        );
      }
    }
    pageToken = page.nextPageToken;
    nextSyncToken = page.nextSyncToken ?? nextSyncToken;
  } while (pageToken);

  const pending = (await listItems(env.DB, { limit: 1_000 })).filter(
    (item) => item.calendarSyncState === "pending",
  );
  for (const item of pending) {
    const link = await env.DB.prepare(
      "SELECT google_event_id, google_etag FROM calendar_link WHERE item_id = ?",
    )
      .bind(item.id)
      .first<{ google_event_id: string | null; google_etag: string | null }>();
    const projection = projectCalendarEvent(
      item,
      item.subjectId ? subjectMap.get(item.subjectId) : undefined,
      env.APP_ORIGIN,
    );
    if (!projection) {
      if (link?.google_event_id) {
        await connection.calendar.deleteEvent(
          connection.metadata.calendarId,
          link.google_event_id,
        );
      }
      continue;
    }
    const event = await connection.calendar.upsertEvent(
      connection.metadata.calendarId,
      projection,
      link?.google_event_id ?? undefined,
      link?.google_etag ?? undefined,
    );
    await env.DB.prepare(
      `INSERT INTO calendar_link
        (item_id, google_calendar_id, google_event_id, google_etag,
         last_google_updated_at, last_pushed_item_version, sync_state, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, 'synced', ?)
       ON CONFLICT(item_id) DO UPDATE SET
         google_event_id = excluded.google_event_id,
         google_etag = excluded.google_etag,
         last_google_updated_at = excluded.last_google_updated_at,
         last_pushed_item_version = excluded.last_pushed_item_version,
         sync_state = 'synced',
         suppressed_at = NULL,
         last_synced_at = excluded.last_synced_at`,
    )
      .bind(
        item.id,
        connection.metadata.calendarId,
        event.id,
        event.etag,
        event.updated,
        item.version,
        new Date().toISOString(),
      )
      .run();
    await env.DB.prepare(
      "UPDATE item SET calendar_sync_state = 'synced' WHERE id = ?",
    )
      .bind(item.id)
      .run();
  }
  if (nextSyncToken) {
    await env.DB.prepare(
      `UPDATE integration_connection SET metadata_json = json_set(metadata_json, '$.syncToken', ?),
       last_success_at = ?, last_attempt_at = ?, status = 'healthy', updated_at = ?
       WHERE provider = 'google'`,
    )
      .bind(
        nextSyncToken,
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();
  }
}

async function sendDigestForItems(
  env: Env,
  items: OrganatoItem[],
  deliveryKey: string,
  deliveryType: "daily_digest" | "urgent_import",
): Promise<void> {
  const connection = await loadGoogleConnection(env);
  if (!connection) return;
  const subjects = await listSubjects(env.DB);
  const rendered = renderDigest({
    items,
    subjects,
    now: new Date(),
    appOrigin: env.APP_ORIGIN,
    lastCanvasSync: "recently",
    lastCalendarSync: "recently",
  });
  const localDate = localDateKey(new Date());
  if (!rendered) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO reminder_delivery
       (delivery_key, delivery_type, local_date, item_snapshot_json, status, created_at)
       VALUES (?, ?, ?, '[]', 'skipped_no_items', ?)`,
    )
      .bind(deliveryKey, deliveryType, localDate, new Date().toISOString())
      .run();
    return;
  }
  const lock = await env.DB.prepare(
    `INSERT OR IGNORE INTO reminder_delivery
      (delivery_key, delivery_type, local_date, item_snapshot_json, status, attempt_count, created_at)
     VALUES (?, ?, ?, ?, 'pending', 1, ?)`,
  )
    .bind(
      deliveryKey,
      deliveryType,
      localDate,
      JSON.stringify(rendered.itemIds),
      new Date().toISOString(),
    )
    .run();
  if (!lock.meta.changes) return;
  const recipients = connection.metadata.recipients?.length
    ? connection.metadata.recipients
    : [connection.metadata.email];
  const gmail = new GmailSendProvider(
    connection.tokenSource,
    connection.metadata.email,
  );
  const sent = await gmail.send({
    to: recipients,
    subject:
      deliveryType === "urgent_import"
        ? `New short-notice Canvas work · ${rendered.subject}`
        : rendered.subject,
    html: rendered.html,
    text: rendered.text,
    deliveryKey,
  });
  await env.DB.prepare(
    `UPDATE reminder_delivery SET status = 'sent', gmail_message_id = ?, sent_at = ?
     WHERE delivery_key = ?`,
  )
    .bind(sent.messageId, new Date().toISOString(), deliveryKey)
    .run();
}

export async function sendTestEmail(env: Env): Promise<{ messageId: string }> {
  const connection = await loadGoogleConnection(env);
  if (!connection) throw new Error("Google is not connected.");
  const recipients = connection.metadata.recipients?.length
    ? connection.metadata.recipients
    : [connection.metadata.email];
  const sentAt = new Date();
  const sentAtLabel = sentAt.toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const gmail = new GmailSendProvider(
    connection.tokenSource,
    connection.metadata.email,
  );
  const sent = await gmail.send({
    to: recipients,
    subject: "Organato · test delivery",
    html: `<!doctype html><html><body style="margin:0;background:#0b0b0c;color:#f2f2f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><div style="max-width:560px;margin:0 auto;padding:40px 20px"><h1 style="margin:0 0 12px;font-size:22px">Organato email is ready</h1><p style="margin:0;color:#a3a3aa;line-height:1.6">This private test was sent at ${sentAtLabel}. Future digests use the same Gmail connection and include no tracking pixels.</p></div></body></html>`,
    text: `ORGANATO EMAIL IS READY\n\nThis private test was sent at ${sentAtLabel}. Future digests use the same Gmail connection and include no tracking pixels.`,
    deliveryKey: `test:${sentAt.toISOString()}:${crypto.randomUUID()}`,
  });
  return sent;
}

export async function runDailyDigest(
  env: Env,
  now = new Date(),
): Promise<void> {
  const settings = await getSettings(env.DB);
  if (
    !settings.dailyDigestEnabled ||
    !isDigestHour(now, settings.timezone, settings.digestHour)
  ) {
    return;
  }
  await runCalendarReconciliation(env);
  const connection = await loadGoogleConnection(env);
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
    await listItems(env.DB, { limit: 1_000 }),
    key,
    "daily_digest",
  );
}

export async function sendUrgentImport(
  env: Env,
  runId: string,
  createdIds: string[],
): Promise<void> {
  if (!createdIds.length) return;
  const items = (
    await Promise.all(createdIds.map((id) => getItem(env.DB, id)))
  ).filter((item): item is OrganatoItem => item !== null);
  await sendDigestForItems(
    env,
    items,
    `urgent-import:${runId}`,
    "urgent_import",
  );
}
