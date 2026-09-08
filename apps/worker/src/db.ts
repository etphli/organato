import type {
  AttachmentLink,
  FieldOverride,
  HistoryEntry,
  OrganatoItem,
  Subject,
  WorkspaceSettings,
} from "@organato/domain";

type Row = Record<string, unknown>;

const defaultSettings: WorkspaceSettings = {
  timezone: "Australia/Sydney",
  dateFormat: "D MMM YYYY",
  timeFormat: "12h",
  firstDayOfWeek: 1,
  theme: "obsidian",
  density: "compact",
  sidebar: "expanded",
  fontScale: 1,
  reduceMotion: false,
  highContrast: false,
  underlineExternalLinks: false,
  calendarDefaultView: "month",
  upcomingAssignmentCount: 6,
  upcomingCheckpointCount: 6,
  completedVisibility: "end_of_day",
  dailyDigestEnabled: true,
  digestHour: 6,
  reminderWindowDays: 7,
  immediateImportAlert: true,
  naturalTodoParsing: true,
  autoExpandClassification: true,
  showMiniCalendar: true,
  showQuickTodo: true,
  includeBothInPanels: true,
  showWorkloadStrip: true,
  stickyNameColumn: true,
  inlineEditing: true,
  showSourceIcons: true,
  showSubmittedActive: false,
  confirmBulkArchive: true,
  todoCalendarDefault: true,
  todoRemindersDefault: true,
  recurrenceOnCompletion: true,
  showAttachmentIndicator: true,
  searchNotes: true,
  fuzzySearch: true,
  recentSearches: true,
  showKeyboardHints: true,
  multiKeyNavigation: true,
  alwaysShowIconText: false,
  screenReaderAnnouncements: true,
  dragCalendarReschedule: true,
  onboardingCompleted: false,
};

function boolean(value: unknown): boolean {
  return Number(value) === 1;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function unscopedCanvasCourseId(row: Row): string | null {
  const value = nullableString(row.canvas_course_id);
  const workspaceId = nullableString(row.workspace_id);
  if (!value || !workspaceId) return value;
  const prefix = `${workspaceId}:`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function mapSubject(row: Row): Subject {
  return {
    id: String(row.id),
    canvasCourseId: unscopedCanvasCourseId(row),
    sourceName: nullableString(row.source_name),
    displayName: String(row.display_name),
    shortName: nullableString(row.short_name),
    colour: String(row.colour),
    active: boolean(row.active),
  };
}

function mapItem(
  row: Row,
  overrides: FieldOverride[],
  attachments: AttachmentLink[],
  history: HistoryEntry[],
): OrganatoItem {
  return {
    id: String(row.id),
    version: Number(row.version),
    kind: row.kind as OrganatoItem["kind"],
    classification: row.classification as OrganatoItem["classification"],
    sourceType: row.source_type as OrganatoItem["sourceType"],
    canvasAssignmentId: nullableString(row.canvas_assignment_id),
    canvasCourseId: unscopedCanvasCourseId(row),
    canvasHtmlUrl: nullableString(row.canvas_html_url),
    sourceName: nullableString(row.source_name),
    sourceDueAt: nullableString(row.source_due_at),
    sourceUpdatedAt: nullableString(row.source_updated_at),
    sourcePayloadHash: nullableString(row.source_payload_hash),
    displayName: String(row.display_name),
    dueAt: nullableString(row.due_at),
    dueDateLocal: nullableString(row.due_date_local),
    dueHasExplicitTime: boolean(row.due_has_explicit_time),
    subjectId: nullableString(row.subject_id),
    priority: nullableString(row.priority) as OrganatoItem["priority"],
    workingStatus: row.working_status as OrganatoItem["workingStatus"],
    completedAt: nullableString(row.completed_at),
    submittedAt: nullableString(row.submitted_at),
    notesMarkdown: String(row.notes_markdown ?? ""),
    recurrenceRule: parseJson(row.recurrence_rule_json, null),
    recurrenceSeriesId: nullableString(row.recurrence_series_id),
    calendarEnabled: boolean(row.calendar_enabled),
    remindersEnabled: boolean(row.reminders_enabled),
    calendarSyncState:
      row.calendar_sync_state as OrganatoItem["calendarSyncState"],
    calendarNote: String(row.calendar_note ?? ""),
    pinned: boolean(row.pinned),
    sortRank: Number(row.sort_rank),
    archivedAt: nullableString(row.archived_at),
    archiveReason: nullableString(row.archive_reason),
    sourceMissingSince: nullableString(row.source_missing_since),
    missingSyncCount: Number(row.missing_sync_count),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    overrides,
    attachments,
    history,
  };
}

export async function listSubjects(
  db: D1Database,
  workspaceId: string,
): Promise<Subject[]> {
  const result = await db
    .prepare(
      "SELECT * FROM subject WHERE workspace_id = ? ORDER BY display_name",
    )
    .bind(workspaceId)
    .all<Row>();
  return result.results.map(mapSubject);
}

export async function listItems(
  db: D1Database,
  workspaceId: string,
  options: {
    archived?: boolean;
    ids?: readonly string[];
    limit?: number;
    all?: boolean;
    includeDetails?: boolean;
  } = {},
): Promise<OrganatoItem[]> {
  const archivedClause =
    (options.archived ? "archived_at IS NOT NULL" : "archived_at IS NULL") +
    (options.ids ? " AND id IN (SELECT value FROM json_each(?))" : "");
  const rawLimit = options.limit ?? 500;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.floor(rawLimit), 1), 2_000)
    : 500;
  const itemScope = options.all
    ? `SELECT id FROM item WHERE workspace_id = ? AND ${archivedClause}`
    : `SELECT id FROM item WHERE workspace_id = ? AND ${archivedClause}
       ORDER BY due_at IS NULL, due_at LIMIT ?`;
  const prepareScoped = (sql: string, workspaceBindings = 1) => {
    const statement = db.prepare(sql);
    const bindings = Array.from(
      { length: workspaceBindings },
      () => workspaceId,
    );
    const scopeBindings = options.ids
      ? [...bindings, JSON.stringify(options.ids)]
      : bindings;
    return options.all
      ? statement.bind(...scopeBindings)
      : statement.bind(...scopeBindings, limit);
  };
  const includeDetails = options.all || options.includeDetails;
  const statements = [
    prepareScoped(
      `SELECT * FROM item WHERE workspace_id = ? AND ${archivedClause}
       ORDER BY due_at IS NULL, due_at${options.all ? "" : " LIMIT ?"}`,
    ),
    prepareScoped(
      `SELECT * FROM field_override WHERE workspace_id = ? AND item_id IN (${itemScope})`,
      2,
    ),
  ];
  if (includeDetails) {
    statements.push(
      prepareScoped(
        `SELECT * FROM attachment_link WHERE workspace_id = ? AND item_id IN (${itemScope})`,
        2,
      ),
      prepareScoped(
        options.all
          ? `SELECT * FROM item_history WHERE workspace_id = ? AND item_id IN (${itemScope})
             ORDER BY created_at DESC`
          : `SELECT * FROM (
               SELECT item_history.*,
                      ROW_NUMBER() OVER (
                        PARTITION BY item_id ORDER BY created_at DESC
                      ) AS history_rank
               FROM item_history
               WHERE workspace_id = ? AND item_id IN (${itemScope})
             ) WHERE history_rank <= 20
             ORDER BY created_at DESC`,
        2,
      ),
    );
  }
  const results = await db.batch(statements);
  const itemResult = results[0]!;
  const overrideResult = results[1]!;
  const attachmentResult = results[2];
  const historyResult = results[3];
  const overrides = new Map<string, FieldOverride[]>();
  for (const row of overrideResult.results as Row[]) {
    const itemId = String(row.item_id);
    const list = overrides.get(itemId) ?? [];
    list.push({
      fieldName: String(row.field_name) as FieldOverride["fieldName"],
      value: parseJson(row.override_value_json, null),
      sourceValueAtOverride: parseJson(row.source_value_at_override_json, null),
      origin: row.origin as FieldOverride["origin"],
      updatedAt: String(row.updated_at),
    });
    overrides.set(itemId, list);
  }
  const attachments = new Map<string, AttachmentLink[]>();
  for (const row of (attachmentResult?.results ?? []) as Row[]) {
    const itemId = String(row.item_id);
    const list = attachments.get(itemId) ?? [];
    list.push({
      id: String(row.id),
      label: String(row.label),
      url: String(row.url),
      linkType: row.link_type as AttachmentLink["linkType"],
      createdAt: String(row.created_at),
    });
    attachments.set(itemId, list);
  }
  const history = new Map<string, HistoryEntry[]>();
  for (const row of (historyResult?.results ?? []) as Row[]) {
    const itemId = String(row.item_id);
    const list = history.get(itemId) ?? [];
    if (options.all || list.length < 20) {
      list.push({
        id: String(row.id),
        actorType: row.actor_type as HistoryEntry["actorType"],
        actorIdentity: String(row.actor_identity),
        action: String(row.action),
        summary: String(row.summary),
        createdAt: String(row.created_at),
        ...(row.before_json ? { before: parseJson(row.before_json, {}) } : {}),
        ...(row.after_json ? { after: parseJson(row.after_json, {}) } : {}),
      });
    }
    history.set(itemId, list);
  }
  return (itemResult.results as Row[]).map((row) =>
    mapItem(
      row,
      overrides.get(String(row.id)) ?? [],
      attachments.get(String(row.id)) ?? [],
      history.get(String(row.id)) ?? [],
    ),
  );
}

export async function getItem(
  db: D1Database,
  workspaceId: string,
  id: string,
): Promise<OrganatoItem | null> {
  const row = await db
    .prepare("SELECT * FROM item WHERE id = ? AND workspace_id = ?")
    .bind(id, workspaceId)
    .first<Row>();
  if (!row) return null;
  const [overrides, attachments, history] = await Promise.all([
    db
      .prepare(
        "SELECT * FROM field_override WHERE workspace_id = ? AND item_id = ?",
      )
      .bind(workspaceId, id)
      .all<Row>(),
    db
      .prepare(
        "SELECT * FROM attachment_link WHERE workspace_id = ? AND item_id = ?",
      )
      .bind(workspaceId, id)
      .all<Row>(),
    db
      .prepare(
        "SELECT * FROM item_history WHERE workspace_id = ? AND item_id = ? ORDER BY created_at DESC LIMIT 50",
      )
      .bind(workspaceId, id)
      .all<Row>(),
  ]);
  return mapItem(
    row,
    overrides.results.map((entry) => ({
      fieldName: String(entry.field_name) as FieldOverride["fieldName"],
      value: parseJson(entry.override_value_json, null),
      sourceValueAtOverride: parseJson(
        entry.source_value_at_override_json,
        null,
      ),
      origin: entry.origin as FieldOverride["origin"],
      updatedAt: String(entry.updated_at),
    })),
    attachments.results.map((entry) => ({
      id: String(entry.id),
      label: String(entry.label),
      url: String(entry.url),
      linkType: entry.link_type as AttachmentLink["linkType"],
      createdAt: String(entry.created_at),
    })),
    history.results.map((entry) => ({
      id: String(entry.id),
      actorType: entry.actor_type as HistoryEntry["actorType"],
      actorIdentity: String(entry.actor_identity),
      action: String(entry.action),
      summary: String(entry.summary),
      createdAt: String(entry.created_at),
    })),
  );
}

const patchColumns = new Map<string, string>([
  ["displayName", "display_name"],
  ["dueAt", "due_at"],
  ["dueDateLocal", "due_date_local"],
  ["dueHasExplicitTime", "due_has_explicit_time"],
  ["subjectId", "subject_id"],
  ["priority", "priority"],
  ["workingStatus", "working_status"],
  ["notesMarkdown", "notes_markdown"],
  ["calendarEnabled", "calendar_enabled"],
  ["remindersEnabled", "reminders_enabled"],
  ["calendarNote", "calendar_note"],
  ["pinned", "pinned"],
  ["sortRank", "sort_rank"],
  ["recurrenceRule", "recurrence_rule_json"],
  ["recurrenceSeriesId", "recurrence_series_id"],
]);

export async function patchItem(
  db: D1Database,
  workspaceId: string,
  id: string,
  version: number,
  patch: Record<string, unknown>,
  actorEmail: string,
  origin: "organato" | "google" = "organato",
): Promise<OrganatoItem> {
  const before = await getItem(db, workspaceId, id);
  if (!before) throw new Error("not_found");
  if (before.version !== version) throw new Error("version_conflict");
  const entries = Object.entries(patch).filter(([field]) =>
    patchColumns.has(field),
  );
  if (!entries.length) return before;
  const assignments = entries.map(
    ([field]) => `${patchColumns.get(field)} = ?`,
  );
  const values = entries.map(([field, value]) => {
    if (
      [
        "dueHasExplicitTime",
        "calendarEnabled",
        "remindersEnabled",
        "pinned",
      ].includes(field)
    ) {
      return value ? 1 : 0;
    }
    if (field === "recurrenceRule") {
      return value ? JSON.stringify(value) : null;
    }
    return value;
  });
  const now = new Date().toISOString();
  const status = patch.workingStatus;
  if (status === "completed") {
    assignments.push("completed_at = ?", "submitted_at = NULL");
    values.push(now);
  } else if (status === "submitted") {
    assignments.push("submitted_at = ?", "completed_at = NULL");
    values.push(now);
  } else if (typeof status === "string") {
    assignments.push("completed_at = NULL", "submitted_at = NULL");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "calendarEnabled")) {
    assignments.push("calendar_sync_state = ?");
    values.push(patch.calendarEnabled ? "pending" : "suppressed");
  } else if (before.calendarEnabled) {
    assignments.push("calendar_sync_state = 'pending'");
  }
  const historyId = crypto.randomUUID();
  const batch: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE item SET ${assignments.join(", ")}, version = version + 1,
         updated_at = ?
         WHERE id = ? AND workspace_id = ? AND version = ?`,
      )
      .bind(...values, now, id, workspaceId, version),
    db
      .prepare(
        `INSERT INTO item_history
          (id, workspace_id, item_id, actor_type, actor_identity, action, summary, before_json, after_json, undo_until, created_at)
         VALUES (?, ?, ?, ?, ?, 'edited', 'Item edited', ?, ?, ?, ?)`,
      )
      .bind(
        historyId,
        workspaceId,
        id,
        origin === "google" ? "google" : "user",
        actorEmail,
        JSON.stringify(
          Object.fromEntries(
            entries.map(([field]) => [
              field,
              before[field as keyof OrganatoItem],
            ]),
          ),
        ),
        JSON.stringify(Object.fromEntries(entries)),
        new Date(Date.now() + 10_000).toISOString(),
        now,
      ),
  ];
  if (before.sourceType === "canvas") {
    for (const [field, value] of entries) {
      const overrideField =
        field === "displayName"
          ? "name"
          : field === "dueAt" || field === "dueDateLocal"
            ? "due"
            : field === "subjectId"
              ? "subject"
              : field === "calendarNote"
                ? "calendarNote"
                : null;
      if (!overrideField) continue;
      const sourceValue =
        overrideField === "name"
          ? before.sourceName
          : overrideField === "due"
            ? before.sourceDueAt
            : overrideField === "subject"
              ? before.canvasCourseId
              : before.calendarNote;
      batch.push(
        db
          .prepare(
            `INSERT INTO field_override
              (workspace_id, item_id, field_name, override_value_json, source_value_at_override_json, origin, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(item_id, field_name) DO UPDATE SET
               override_value_json = excluded.override_value_json,
               origin = excluded.origin,
               updated_at = excluded.updated_at`,
          )
          .bind(
            workspaceId,
            id,
            overrideField,
            JSON.stringify(value),
            JSON.stringify(sourceValue),
            origin,
            now,
            now,
          ),
      );
    }
  }
  const results = await db.batch(batch);
  if (!results[0]?.meta.changes) throw new Error("version_conflict");
  return (await getItem(db, workspaceId, id))!;
}

export async function getSettings(
  db: D1Database,
  workspaceId: string,
): Promise<WorkspaceSettings> {
  const row = await db
    .prepare("SELECT settings_json FROM workspace WHERE id = ?")
    .bind(workspaceId)
    .first<{ settings_json: string }>();
  return { ...defaultSettings, ...parseJson(row?.settings_json, {}) };
}

export async function updateSettings(
  db: D1Database,
  workspaceId: string,
  patch: Partial<WorkspaceSettings>,
): Promise<WorkspaceSettings> {
  const settings = { ...(await getSettings(db, workspaceId)), ...patch };
  await db
    .prepare(
      "UPDATE workspace SET settings_json = ?, updated_at = ? WHERE id = ?",
    )
    .bind(JSON.stringify(settings), new Date().toISOString(), workspaceId)
    .run();
  return settings;
}
