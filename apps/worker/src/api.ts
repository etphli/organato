import { zValidator } from "@hono/zod-validator";
import {
  assertSecretFreeBackup,
  classifications,
  InvalidDeadlineError,
  localDateKey,
  mergeDeadlineFields,
  nextRecurrenceDeadline,
  normalizeDeadlineFields,
  priorities,
  type CanvasConnectResponse,
  type CanvasConnectionStatus,
  validateBackup,
  workingStatuses,
} from "@organato/domain";
import { CanvasRestProvider } from "@organato/integrations";
import { Hono } from "hono";
import { z } from "zod";
import {
  getItem,
  getSettings,
  listItems,
  listSubjects,
  patchItem,
  updateSettings,
} from "./db";
import {
  canvasConnectionErrorCategory,
  canvasConnectionErrorCode,
  canvasConnectSchema,
  configuredCanvasInstallation,
  createCanvasConnectionMetadata,
  nextHourlySyncAt,
  parseCanvasConnectionMetadata,
  safeCanvasConnectionError,
} from "./canvas-connection";
import {
  clearSessionCookies,
  encryptSecret,
  getOrCreateCsrfToken,
  hasRecentAuthentication,
  rateLimit,
  recordSecurityEvent,
  requireRecentSession,
  sha256,
} from "./security";
import { runCalendarReconciliation, runCanvasSync } from "./sync";
import type { Env, Variables } from "./types";

const prioritySchema = z.enum(priorities).nullable();
const recurrenceRuleSchema = z
  .object({
    frequency: z.enum([
      "daily",
      "weekdays",
      "weekly",
      "biweekly",
      "monthly",
      "custom",
    ]),
    interval: z.number().int().positive().max(365),
    seriesId: z.string().min(1).max(200),
  })
  .strict();
const itemPatchSchema = z.object({
  version: z.number().int().positive(),
  displayName: z.string().min(1).max(500).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  dueDateLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  dueHasExplicitTime: z.boolean().optional(),
  subjectId: z.string().nullable().optional(),
  priority: prioritySchema.optional(),
  workingStatus: z.enum(workingStatuses).optional(),
  notesMarkdown: z.string().max(100_000).optional(),
  calendarEnabled: z.boolean().optional(),
  remindersEnabled: z.boolean().optional(),
  calendarNote: z.string().max(20_000).optional(),
  pinned: z.boolean().optional(),
  sortRank: z.number().optional(),
  recurrenceRule: recurrenceRuleSchema.nullable().optional(),
  recurrenceSeriesId: z.string().max(200).nullable().optional(),
});

const createItemSchema = z
  .object({
    kind: z.enum(["work", "todo"]),
    classification: z.enum(classifications).default("unclassified"),
    displayName: z.string().min(1).max(500),
    dueAt: z.string().datetime().nullable().default(null),
    dueDateLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    dueHasExplicitTime: z.boolean().default(false),
    subjectId: z.string().nullable().default(null),
    priority: prioritySchema.default(null),
    recurrenceRule: recurrenceRuleSchema.nullable().default(null),
    calendarEnabled: z.boolean().default(true),
    remindersEnabled: z.boolean().default(true),
  })
  .superRefine((input, refinement) => {
    try {
      normalizeDeadlineFields(input);
    } catch (error) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          error instanceof Error ? error.message : "Choose one valid deadline.",
        path: ["dueAt"],
      });
    }
    if (input.kind !== "todo" && input.recurrenceRule) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only todos can recur.",
        path: ["recurrenceRule"],
      });
    }
    if (input.recurrenceRule && !input.dueAt && !input.dueDateLocal) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A recurring todo needs a deadline.",
        path: ["recurrenceRule"],
      });
    }
  });
const savedViewSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  page: z.enum(["assignments", "checkpoints", "todo", "archive"]),
  name: z.string().min(1).max(100),
  filters: z.record(z.unknown()).default({}),
  sort: z.array(z.record(z.unknown())).max(20).default([]),
  columns: z.array(z.string().max(80)).max(30).default([]),
  columnWidths: z.record(z.number().positive().max(2_000)).default({}),
  isDefault: z.boolean().default(false),
});
const workspaceSettingsPatchSchema = z
  .object({
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en-AU", { timeZone: value }).format(
            new Date(),
          );
          return true;
        } catch {
          return false;
        }
      }, "Choose a valid IANA timezone."),
    dateFormat: z.enum(["D MMM YYYY", "DD/MM/YYYY", "YYYY-MM-DD"]),
    timeFormat: z.enum(["12h", "24h"]),
    firstDayOfWeek: z.union([z.literal(0), z.literal(1)]),
    theme: z.enum(["obsidian", "pure_black", "soft_dark", "light", "system"]),
    density: z.enum(["comfortable", "compact"]),
    sidebar: z.enum(["expanded", "collapsed", "remember"]),
    fontScale: z.number().min(0.9).max(1.2),
    reduceMotion: z.boolean(),
    highContrast: z.boolean(),
    underlineExternalLinks: z.boolean(),
    calendarDefaultView: z.enum(["month", "week", "agenda"]),
    upcomingAssignmentCount: z.number().int().min(1).max(50),
    upcomingCheckpointCount: z.number().int().min(1).max(50),
    completedVisibility: z.enum(["end_of_day", "seven_days", "immediately"]),
    dailyDigestEnabled: z.boolean(),
    digestHour: z.number().int().min(0).max(23),
    reminderWindowDays: z.number().int().min(1).max(90),
    immediateImportAlert: z.boolean(),
    naturalTodoParsing: z.boolean(),
    autoExpandClassification: z.boolean(),
    showMiniCalendar: z.boolean(),
    showQuickTodo: z.boolean(),
    includeBothInPanels: z.boolean(),
    showWorkloadStrip: z.boolean(),
    stickyNameColumn: z.boolean(),
    inlineEditing: z.boolean(),
    showSourceIcons: z.boolean(),
    showSubmittedActive: z.boolean(),
    confirmBulkArchive: z.boolean(),
    todoCalendarDefault: z.boolean(),
    todoRemindersDefault: z.boolean(),
    recurrenceOnCompletion: z.boolean(),
    showAttachmentIndicator: z.boolean(),
    searchNotes: z.boolean(),
    fuzzySearch: z.boolean(),
    recentSearches: z.boolean(),
    showKeyboardHints: z.boolean(),
    multiKeyNavigation: z.boolean(),
    alwaysShowIconText: z.boolean(),
    screenReaderAnnouncements: z.boolean(),
    dragCalendarReschedule: z.boolean(),
    onboardingCompleted: z.boolean(),
  })
  .partial()
  .strict();
const identityEmailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const addIdentitySchema = z
  .object({
    email: identityEmailSchema,
    displayName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
const identityStateSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
const deleteWorkspaceDataSchema = z
  .object({
    confirmation: z.literal("Organato"),
    acknowledgeExternalData: z.literal(true),
    acknowledgeBackupOffer: z.boolean(),
  })
  .strict();
const permanentDeleteItemSchema = z
  .object({
    version: z.number().int().positive(),
    confirmation: z.string().min(1).max(500),
  })
  .strict();
const itemVersionSchema = z
  .object({ version: z.number().int().positive() })
  .strict();

function identityFromRoute(value: string) {
  try {
    return identityEmailSchema.safeParse(decodeURIComponent(value));
  } catch {
    return identityEmailSchema.safeParse(value);
  }
}

class InvalidItemMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidItemMutationError";
  }
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown";
  if (message === "not_found")
    return { error: "Item not found.", status: 404 as const };
  if (message === "version_conflict") {
    return {
      error: "This item changed elsewhere. Refresh and try again.",
      status: 409 as const,
    };
  }
  if (
    error instanceof InvalidDeadlineError ||
    error instanceof InvalidItemMutationError
  ) {
    return { error: error.message, status: 400 as const };
  }
  return {
    error: "The change could not be saved. Existing data is unchanged.",
    status: 500 as const,
  };
}

async function runBatches(
  db: D1Database,
  statements: D1PreparedStatement[],
  size = 50,
) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

function canvasConnectionState(
  value: string | null,
  reconnectNeeded: number,
): CanvasConnectionStatus["state"] {
  if (reconnectNeeded) return "action_needed";
  if (
    value === "healthy" ||
    value === "delayed" ||
    value === "partial" ||
    value === "action_needed" ||
    value === "disconnected"
  ) {
    return value;
  }
  return "action_needed";
}

async function getCanvasConnectionStatus(
  env: Env,
): Promise<CanvasConnectionStatus> {
  const installation = configuredCanvasInstallation(env);
  const [connection, latestSync, activeCourses, upcomingItems] =
    await Promise.all([
      env.DB.prepare(
        `SELECT account_label, status, last_success_at, reconnect_needed,
                metadata_json
         FROM integration_connection WHERE provider = 'canvas'`,
      ).first<{
        account_label: string;
        status: string;
        last_success_at: string | null;
        reconnect_needed: number;
        metadata_json: string;
      }>(),
      env.DB.prepare(
        `SELECT started_at, finished_at, result, fetched_count, created_count,
                updated_count, archived_count
         FROM sync_run WHERE provider = 'canvas'
         ORDER BY started_at DESC LIMIT 1`,
      ).first<{
        started_at: string;
        finished_at: string | null;
        result: string;
        fetched_count: number;
        created_count: number;
        updated_count: number;
        archived_count: number;
      }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count FROM subject
         WHERE canvas_course_id IS NOT NULL AND active = 1`,
      ).first<{ count: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count FROM item
         WHERE source_type = 'canvas' AND archived_at IS NULL
           AND working_status NOT IN ('completed', 'submitted')`,
      ).first<{ count: number }>(),
    ]);
  const metadata = connection
    ? parseCanvasConnectionMetadata(
        connection.metadata_json,
        connection.account_label,
      )
    : null;
  const connected =
    Boolean(connection) &&
    connection?.status !== "disconnected" &&
    Boolean(metadata);
  return {
    installation: {
      name: installation.name,
      hostname: installation.baseUrl.hostname,
      readOnly: true,
    },
    state: connected
      ? canvasConnectionState(
          connection?.status ?? null,
          connection?.reconnect_needed ?? 0,
        )
      : "disconnected",
    connection:
      connected && metadata
        ? {
            userId: metadata.userId,
            userName: metadata.userName,
            connectedAt: metadata.connectedAt,
            lastValidatedAt: metadata.lastValidatedAt,
            lastSuccessfulSyncAt: connection?.last_success_at ?? null,
            nextExpectedSyncAt: nextHourlySyncAt(),
          }
        : null,
    counts: {
      activeCourses: Number(activeCourses?.count ?? 0),
      upcomingItems: Number(upcomingItems?.count ?? 0),
    },
    latestSync: latestSync
      ? {
          startedAt: latestSync.started_at,
          finishedAt: latestSync.finished_at,
          result: latestSync.result,
          fetched: Number(latestSync.fetched_count),
          created: Number(latestSync.created_count),
          updated: Number(latestSync.updated_count),
          archived: Number(latestSync.archived_count),
        }
      : null,
  };
}

export const apiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

apiRoutes.get("/session", async (context) => {
  const user = context.get("user");
  const csrfToken = await getOrCreateCsrfToken(context);
  return context.json({
    authenticated: true,
    owner: { email: user.email, displayName: user.displayName },
    csrfToken,
    recentAuthentication: hasRecentAuthentication(user.authenticatedAt),
    workspace: { id: "workspace", name: "Organato" },
  });
});

apiRoutes.get("/home", async (context) => {
  const [items, subjects] = await Promise.all([
    listItems(context.env.DB, { limit: 250 }),
    listSubjects(context.env.DB),
  ]);
  return context.json({
    unclassified: items.filter(
      (item) => item.kind === "work" && item.classification === "unclassified",
    ),
    todos: items.filter((item) => item.kind === "todo").slice(0, 10),
    assignments: items
      .filter((item) => ["assignment", "both"].includes(item.classification))
      .slice(0, 8),
    checkpoints: items
      .filter((item) => ["checkpoint", "both"].includes(item.classification))
      .slice(0, 8),
    subjects,
  });
});

apiRoutes.get("/items", async (context) => {
  const archived = context.req.query("archived") === "true";
  const limit = Number(context.req.query("limit") ?? 500);
  return context.json({
    items: await listItems(context.env.DB, { archived, limit }),
  });
});

apiRoutes.get("/items/:id", async (context) => {
  const item = await getItem(context.env.DB, context.req.param("id"));
  return item
    ? context.json({ item })
    : context.json({ error: "Item not found." }, 404);
});

apiRoutes.post(
  "/items",
  zValidator("json", createItemSchema),
  async (context) => {
    try {
      const input = context.req.valid("json");
      const deadline = normalizeDeadlineFields(input);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      await context.env.DB.batch([
        context.env.DB.prepare(
          `INSERT INTO item
             (id, kind, classification, source_type, display_name, due_at, due_date_local,
              due_has_explicit_time, subject_id, priority, working_status, recurrence_rule_json,
              recurrence_series_id, calendar_enabled, reminders_enabled, calendar_sync_state,
              created_at, updated_at)
             VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, 'not_started', ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          input.kind,
          input.kind === "todo" ? "unclassified" : input.classification,
          input.displayName,
          deadline.dueAt,
          deadline.dueDateLocal,
          deadline.dueHasExplicitTime ? 1 : 0,
          input.subjectId,
          input.priority,
          input.recurrenceRule ? JSON.stringify(input.recurrenceRule) : null,
          input.recurrenceRule?.seriesId ?? null,
          input.calendarEnabled ? 1 : 0,
          input.remindersEnabled ? 1 : 0,
          deadline.dueAt || deadline.dueDateLocal ? "pending" : "synced",
          now,
          now,
        ),
        context.env.DB.prepare(
          `INSERT INTO item_history
             (id, item_id, actor_type, actor_identity, action, summary, created_at)
             VALUES (?, ?, 'user', ?, 'created', 'Created in Organato', ?)`,
        ).bind(crypto.randomUUID(), id, context.get("user").email, now),
      ]);
      return context.json({ item: await getItem(context.env.DB, id) }, 201);
    } catch (error) {
      const response = errorResponse(error);
      return context.json({ error: response.error }, response.status);
    }
  },
);

apiRoutes.patch(
  "/items/:id",
  zValidator("json", itemPatchSchema),
  async (context) => {
    const { version, ...patch } = context.req.valid("json");
    try {
      const before = await getItem(context.env.DB, context.req.param("id"));
      if (!before) throw new Error("not_found");
      const deadlineChanged = [
        "dueAt",
        "dueDateLocal",
        "dueHasExplicitTime",
      ].some((field) => Object.prototype.hasOwnProperty.call(patch, field));
      const deadlinePatch = Object.fromEntries(
        Object.entries({
          dueAt: patch.dueAt,
          dueDateLocal: patch.dueDateLocal,
          dueHasExplicitTime: patch.dueHasExplicitTime,
        }).filter(([, value]) => value !== undefined),
      ) as Parameters<typeof mergeDeadlineFields>[1];
      const deadline = deadlineChanged
        ? mergeDeadlineFields(before, deadlinePatch)
        : normalizeDeadlineFields(before);
      const recurrenceRule =
        patch.recurrenceRule !== undefined
          ? patch.recurrenceRule
          : before.recurrenceRule;
      if (before.kind !== "todo" && recurrenceRule) {
        throw new InvalidItemMutationError("Only todos can recur.");
      }
      if (before.kind === "todo" && patch.workingStatus === "submitted") {
        throw new InvalidItemMutationError(
          "Todos can be completed, but not submitted.",
        );
      }
      if (recurrenceRule && !deadline.dueAt && !deadline.dueDateLocal) {
        throw new InvalidItemMutationError(
          "A recurring todo needs a deadline.",
        );
      }
      const normalizedPatch: Record<string, unknown> = { ...patch };
      if (deadlineChanged) Object.assign(normalizedPatch, deadline);
      if (recurrenceRule) {
        normalizedPatch.recurrenceSeriesId = recurrenceRule.seriesId;
      } else if (
        patch.recurrenceRule === null ||
        patch.recurrenceSeriesId !== undefined
      ) {
        normalizedPatch.recurrenceSeriesId = null;
      }
      const updated = await patchItem(
        context.env.DB,
        context.req.param("id"),
        version,
        normalizedPatch,
        context.get("user").email,
      );
      let nextOccurrence = null;
      if (
        before.kind === "todo" &&
        before.workingStatus !== "completed" &&
        updated.workingStatus === "completed" &&
        updated.recurrenceRule &&
        (await getSettings(context.env.DB)).recurrenceOnCompletion
      ) {
        const nextDeadline = nextRecurrenceDeadline(
          updated,
          updated.recurrenceRule,
        );
        if (nextDeadline) {
          const now = new Date().toISOString();
          const nextId = crypto.randomUUID();
          await context.env.DB.batch([
            context.env.DB.prepare(
              `INSERT INTO item
                (id, kind, classification, source_type, display_name, due_at,
                 due_date_local, due_has_explicit_time, subject_id, priority,
                 working_status, notes_markdown, recurrence_rule_json,
                 recurrence_series_id, calendar_enabled, reminders_enabled,
                 calendar_sync_state, calendar_note, pinned, sort_rank,
                 created_at, updated_at)
               VALUES (?, 'todo', 'unclassified', 'manual', ?, ?, ?, ?, ?, ?,
                       'not_started', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).bind(
              nextId,
              updated.displayName,
              nextDeadline.dueAt,
              nextDeadline.dueDateLocal,
              nextDeadline.dueHasExplicitTime ? 1 : 0,
              updated.subjectId,
              updated.priority,
              updated.notesMarkdown,
              JSON.stringify(updated.recurrenceRule),
              updated.recurrenceSeriesId ?? updated.recurrenceRule.seriesId,
              updated.calendarEnabled ? 1 : 0,
              updated.remindersEnabled ? 1 : 0,
              updated.calendarEnabled ? "pending" : "suppressed",
              updated.calendarNote,
              updated.pinned ? 1 : 0,
              updated.sortRank,
              now,
              now,
            ),
            context.env.DB.prepare(
              `INSERT INTO item_history
                (id, item_id, actor_type, actor_identity, action, summary, created_at)
               VALUES (?, ?, 'system', 'Organato', 'recurrence_created',
                       'Created when the previous occurrence was completed', ?)`,
            ).bind(crypto.randomUUID(), nextId, now),
          ]);
          nextOccurrence = await getItem(context.env.DB, nextId);
        }
      }
      return context.json({
        item: updated,
        nextOccurrence,
      });
    } catch (error) {
      const response = errorResponse(error);
      return context.json({ error: response.error }, response.status);
    }
  },
);

apiRoutes.post(
  "/items/:id/classify",
  zValidator(
    "json",
    z.object({
      version: z.number().int(),
      classification: z.enum(classifications),
    }),
  ),
  async (context) => {
    const input = context.req.valid("json");
    const id = context.req.param("id");
    const now = new Date().toISOString();
    const results = await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE item SET classification = ?, version = version + 1,
           updated_at = ?
         WHERE id = ? AND version = ? AND archived_at IS NULL`,
      ).bind(input.classification, now, id, input.version),
      context.env.DB.prepare(
        `INSERT INTO item_history
           (id, item_id, actor_type, actor_identity, action, summary,
            undo_until, created_at)
         SELECT ?, ?, 'user', ?, 'classified', ?, ?, ?
         WHERE changes() > 0`,
      ).bind(
        crypto.randomUUID(),
        id,
        context.get("user").email,
        `Classified as ${input.classification}`,
        new Date(Date.now() + 10_000).toISOString(),
        now,
      ),
    ]);
    if (!results[0]?.meta.changes)
      return context.json({ error: "Item changed elsewhere." }, 409);
    return context.json({ item: await getItem(context.env.DB, id) });
  },
);

apiRoutes.post(
  "/items/:id/archive",
  zValidator("json", itemVersionSchema),
  async (context) => {
    const id = context.req.param("id");
    const { version } = context.req.valid("json");
    const now = new Date().toISOString();
    const results = await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE item SET archived_at = ?, archive_reason = 'Manual archive',
           manual_archive = 1, calendar_sync_state = 'pending',
           version = version + 1, updated_at = ?
         WHERE id = ? AND version = ? AND archived_at IS NULL`,
      ).bind(now, now, id, version),
      context.env.DB.prepare(
        `INSERT INTO item_history
           (id, item_id, actor_type, actor_identity, action, summary,
            undo_until, created_at)
         SELECT ?, ?, 'user', ?, 'archived', 'Archived manually', ?, ?
         WHERE changes() > 0`,
      ).bind(
        crypto.randomUUID(),
        id,
        context.get("user").email,
        new Date(Date.now() + 10_000).toISOString(),
        now,
      ),
    ]);
    if (!results[0]?.meta.changes)
      return context.json({ error: "Item changed elsewhere." }, 409);
    return context.json({ item: await getItem(context.env.DB, id) });
  },
);

apiRoutes.post(
  "/items/:id/restore",
  zValidator("json", itemVersionSchema),
  async (context) => {
    const id = context.req.param("id");
    const { version } = context.req.valid("json");
    const now = new Date().toISOString();
    const results = await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE item SET archived_at = NULL, archive_reason = NULL,
           manual_archive = 0,
           calendar_sync_state = CASE WHEN calendar_enabled = 1
             THEN 'pending' ELSE 'suppressed' END,
           version = version + 1, updated_at = ?
         WHERE id = ? AND version = ? AND archived_at IS NOT NULL`,
      ).bind(now, id, version),
      context.env.DB.prepare(
        `INSERT INTO item_history
           (id, item_id, actor_type, actor_identity, action, summary,
            undo_until, created_at)
         SELECT ?, ?, 'user', ?, 'restored', 'Restored from archive', ?, ?
         WHERE changes() > 0`,
      ).bind(
        crypto.randomUUID(),
        id,
        context.get("user").email,
        new Date(Date.now() + 10_000).toISOString(),
        now,
      ),
    ]);
    if (!results[0]?.meta.changes)
      return context.json({ error: "Item changed elsewhere." }, 409);
    return context.json({ item: await getItem(context.env.DB, id) });
  },
);

apiRoutes.post(
  "/items/:id/permanent-delete",
  requireRecentSession(),
  zValidator("json", permanentDeleteItemSchema),
  async (context) => {
    const id = context.req.param("id");
    const input = context.req.valid("json");
    const item = await getItem(context.env.DB, id);
    if (!item) return context.json({ error: "Item not found." }, 404);
    if (!item.archivedAt) {
      return context.json(
        { error: "Only archived items can be permanently deleted." },
        409,
      );
    }
    if (item.version !== input.version) {
      return context.json({ error: "Item changed elsewhere." }, 409);
    }
    if (input.confirmation !== item.displayName) {
      return context.json(
        { error: "Type the exact item name to confirm deletion." },
        400,
      );
    }
    const linkedEvent = await context.env.DB.prepare(
      `SELECT google_event_id FROM calendar_link WHERE item_id = ?`,
    )
      .bind(id)
      .first<{ google_event_id: string | null }>();
    if (linkedEvent?.google_event_id) {
      try {
        await runCalendarReconciliation(context.env);
      } catch {
        return context.json(
          {
            error:
              "The linked Google event could not be removed. Reconnect Google and retry so Organato does not orphan an event.",
          },
          502,
        );
      }
      const remaining = await context.env.DB.prepare(
        `SELECT google_event_id FROM calendar_link
         WHERE item_id = ? AND google_event_id IS NOT NULL`,
      )
        .bind(id)
        .first();
      if (remaining) {
        return context.json(
          {
            error:
              "Calendar cleanup is still pending. Reconcile Calendar and retry.",
          },
          409,
        );
      }
    }
    const now = new Date().toISOString();
    const result = await context.env.DB.batch([
      context.env.DB.prepare(
        `DELETE FROM item WHERE id = ? AND version = ?
         AND archived_at IS NOT NULL`,
      ).bind(id, input.version),
      context.env.DB.prepare(
        `INSERT INTO security_event
          (id, category, actor_email, summary, created_at)
         SELECT ?, 'item_permanently_deleted', ?, ?, ?
         WHERE changes() > 0`,
      ).bind(
        crypto.randomUUID(),
        context.get("user").email,
        `Permanently deleted archived ${item.kind} "${item.displayName}".`,
        now,
      ),
    ]);
    if (!result[0]?.meta.changes) {
      return context.json({ error: "Item changed elsewhere." }, 409);
    }
    return context.json({ ok: true });
  },
);

apiRoutes.post(
  "/items/:id/reset-override",
  zValidator(
    "json",
    z.object({ fieldName: z.enum(["name", "due", "subject", "calendarNote"]) }),
  ),
  async (context) => {
    try {
      const id = context.req.param("id");
      const { fieldName } = context.req.valid("json");
      const item = await getItem(context.env.DB, id);
      if (!item) throw new Error("not_found");
      if (fieldName !== "calendarNote" && item.sourceType !== "canvas") {
        throw new InvalidItemMutationError(
          "Only Canvas-backed fields can follow a source value.",
        );
      }
      const now = new Date().toISOString();
      let update: D1PreparedStatement;
      if (fieldName === "name") {
        if (!item.sourceName) {
          throw new InvalidItemMutationError(
            "This item has no Canvas name to restore.",
          );
        }
        update = context.env.DB.prepare(
          `UPDATE item SET display_name = ?, version = version + 1,
           calendar_sync_state = CASE WHEN calendar_enabled = 1 THEN 'pending' ELSE calendar_sync_state END,
           updated_at = ? WHERE id = ?`,
        ).bind(item.sourceName, now, id);
      } else if (fieldName === "due") {
        const sourceDeadline = normalizeDeadlineFields({
          dueAt: item.sourceDueAt,
          dueDateLocal: null,
          dueHasExplicitTime: Boolean(item.sourceDueAt),
        });
        update = context.env.DB.prepare(
          `UPDATE item SET due_at = ?, due_date_local = ?,
           due_has_explicit_time = ?, version = version + 1,
           calendar_sync_state = CASE WHEN calendar_enabled = 1 THEN 'pending' ELSE calendar_sync_state END,
           updated_at = ? WHERE id = ?`,
        ).bind(
          sourceDeadline.dueAt,
          sourceDeadline.dueDateLocal,
          sourceDeadline.dueHasExplicitTime ? 1 : 0,
          now,
          id,
        );
      } else if (fieldName === "subject") {
        const sourceSubject = item.canvasCourseId
          ? await context.env.DB.prepare(
              "SELECT id FROM subject WHERE canvas_course_id = ?",
            )
              .bind(item.canvasCourseId)
              .first<{ id: string }>()
          : null;
        update = context.env.DB.prepare(
          `UPDATE item SET subject_id = ?, version = version + 1,
           calendar_sync_state = CASE WHEN calendar_enabled = 1 THEN 'pending' ELSE calendar_sync_state END,
           updated_at = ? WHERE id = ?`,
        ).bind(sourceSubject?.id ?? null, now, id);
      } else {
        update = context.env.DB.prepare(
          `UPDATE item SET calendar_note = '', version = version + 1,
           calendar_sync_state = CASE WHEN calendar_enabled = 1 THEN 'pending' ELSE calendar_sync_state END,
           updated_at = ? WHERE id = ?`,
        ).bind(now, id);
      }
      await context.env.DB.batch([
        context.env.DB.prepare(
          "DELETE FROM field_override WHERE item_id = ? AND field_name = ?",
        ).bind(id, fieldName),
        update,
        context.env.DB.prepare(
          `INSERT INTO item_history
             (id, item_id, actor_type, actor_identity, action, summary, created_at)
           VALUES (?, ?, 'user', ?, 'override_reset', ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          id,
          context.get("user").email,
          `Restored ${fieldName} to its source value`,
          now,
        ),
      ]);
      return context.json({ item: await getItem(context.env.DB, id) });
    } catch (error) {
      const response = errorResponse(error);
      return context.json({ error: response.error }, response.status);
    }
  },
);

apiRoutes.post(
  "/items/:id/attachments",
  zValidator(
    "json",
    z.object({
      label: z.string().min(1).max(200),
      url: z
        .string()
        .url()
        .refine((value) => new URL(value).protocol === "https:", {
          message: "Attachment links must use HTTPS.",
        }),
      linkType: z
        .enum(["reference", "brief", "rubric", "working_document", "other"])
        .default("other"),
    }),
  ),
  async (context) => {
    const input = context.req.valid("json");
    const id = crypto.randomUUID();
    const itemId = context.req.param("id");
    const now = new Date().toISOString();
    const item = await getItem(context.env.DB, itemId);
    if (!item) return context.json({ error: "Item not found." }, 404);
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO attachment_link
          (id, item_id, label, url, link_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(id, itemId, input.label, input.url, input.linkType, now),
      context.env.DB.prepare(
        `INSERT INTO item_history
          (id, item_id, actor_type, actor_identity, action, summary, created_at)
         VALUES (?, ?, 'user', ?, 'attachment_added', 'Added linked attachment', ?)`,
      ).bind(crypto.randomUUID(), itemId, context.get("user").email, now),
    ]);
    return context.json({ item: await getItem(context.env.DB, itemId) }, 201);
  },
);

apiRoutes.delete("/items/:id/attachments/:attachmentId", async (context) => {
  await context.env.DB.prepare(
    "DELETE FROM attachment_link WHERE id = ? AND item_id = ?",
  )
    .bind(context.req.param("attachmentId"), context.req.param("id"))
    .run();
  return context.json({
    item: await getItem(context.env.DB, context.req.param("id")),
  });
});

apiRoutes.get("/subjects", async (context) =>
  context.json({ subjects: await listSubjects(context.env.DB) }),
);

apiRoutes.post(
  "/subjects",
  zValidator(
    "json",
    z.object({
      displayName: z.string().min(1).max(200),
      shortName: z.string().max(12).nullable().default(null),
      colour: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .default("#a78bfa"),
    }),
  ),
  async (context) => {
    const input = context.req.valid("json");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `INSERT INTO subject
        (id, canvas_course_id, source_name, display_name, short_name,
         colour, active, created_at, updated_at)
       VALUES (?, NULL, NULL, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(id, input.displayName, input.shortName, input.colour, now, now)
      .run();
    return context.json({ subjects: await listSubjects(context.env.DB) }, 201);
  },
);

apiRoutes.patch(
  "/subjects/:id",
  zValidator(
    "json",
    z.object({
      displayName: z.string().min(1).max(200).optional(),
      shortName: z.string().max(12).nullable().optional(),
      colour: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .optional(),
      active: z.boolean().optional(),
    }),
  ),
  async (context) => {
    const input = context.req.valid("json");
    const mapping: Record<string, string> = {
      displayName: "display_name",
      shortName: "short_name",
      colour: "colour",
      active: "active",
    };
    const entries = Object.entries(input);
    if (entries.length) {
      await context.env.DB.prepare(
        `UPDATE subject SET ${entries.map(([key]) => `${mapping[key]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
      )
        .bind(
          ...entries.map(([key, value]) =>
            key === "active" ? (value ? 1 : 0) : value,
          ),
          new Date().toISOString(),
          context.req.param("id"),
        )
        .run();
    }
    return context.json({ subjects: await listSubjects(context.env.DB) });
  },
);

apiRoutes.get("/settings", async (context) =>
  context.json({ settings: await getSettings(context.env.DB) }),
);

apiRoutes.patch(
  "/settings",
  zValidator("json", workspaceSettingsPatchSchema),
  async (context) => {
    const patch = Object.fromEntries(
      Object.entries(context.req.valid("json")).filter(
        ([, value]) => value !== undefined,
      ),
    ) as Parameters<typeof updateSettings>[1];
    return context.json({
      settings: await updateSettings(context.env.DB, patch),
    });
  },
);

apiRoutes.get("/views", async (context) => {
  const result = await context.env.DB.prepare(
    `SELECT id, page, name, filters_json, sort_json, columns_json,
            column_widths_json, is_default
     FROM saved_view ORDER BY page, is_default DESC, name`,
  ).all<{
    id: string;
    page: string;
    name: string;
    filters_json: string;
    sort_json: string;
    columns_json: string;
    column_widths_json: string;
    is_default: number;
  }>();
  return context.json({
    views: result.results.map((row) => ({
      id: row.id,
      page: row.page,
      name: row.name,
      filters: JSON.parse(row.filters_json),
      sort: JSON.parse(row.sort_json),
      columns: JSON.parse(row.columns_json),
      columnWidths: JSON.parse(row.column_widths_json),
      isDefault: Boolean(row.is_default),
    })),
  });
});

apiRoutes.post(
  "/views",
  zValidator("json", savedViewSchema),
  async (context) => {
    const input = context.req.valid("json");
    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    if (input.isDefault) {
      await context.env.DB.prepare(
        "UPDATE saved_view SET is_default = 0, updated_at = ? WHERE page = ?",
      )
        .bind(now, input.page)
        .run();
    }
    await context.env.DB.prepare(
      `INSERT INTO saved_view
        (id, page, name, filters_json, sort_json, columns_json,
         column_widths_json, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         page = excluded.page,
         name = excluded.name,
         filters_json = excluded.filters_json,
         sort_json = excluded.sort_json,
         columns_json = excluded.columns_json,
         column_widths_json = excluded.column_widths_json,
         is_default = excluded.is_default,
         updated_at = excluded.updated_at`,
    )
      .bind(
        id,
        input.page,
        input.name,
        JSON.stringify(input.filters),
        JSON.stringify(input.sort),
        JSON.stringify(input.columns),
        JSON.stringify(input.columnWidths),
        input.isDefault ? 1 : 0,
        now,
        now,
      )
      .run();
    return context.json({ view: { ...input, id } }, 201);
  },
);

apiRoutes.delete("/views/:id", async (context) => {
  await context.env.DB.prepare("DELETE FROM saved_view WHERE id = ?")
    .bind(context.req.param("id"))
    .run();
  return context.json({ ok: true });
});

apiRoutes.get("/integrations", async (context) => {
  const result = await context.env.DB.prepare(
    `SELECT provider, account_label, status, scopes_json, last_success_at,
            last_attempt_at, last_error_category, reconnect_needed
     FROM integration_connection`,
  ).all();
  return context.json({ integrations: result.results });
});

apiRoutes.get("/reminder-deliveries", async (context) => {
  const result = await context.env.DB.prepare(
    `SELECT delivery_key, delivery_type, local_date, item_snapshot_json,
            gmail_message_id, status, attempt_count, created_at, sent_at,
            last_attempt_at, next_attempt_at, last_error_category
     FROM reminder_delivery ORDER BY created_at DESC LIMIT 50`,
  ).all();
  return context.json({ deliveries: result.results });
});

apiRoutes.get("/integrations/canvas/status", async (context) => {
  try {
    return context.json(await getCanvasConnectionStatus(context.env));
  } catch (error) {
    return context.json({ error: safeCanvasConnectionError(error) }, 503);
  }
});

apiRoutes.get("/integrations/canvas/reachability", async (context) => {
  const allowed = await rateLimit(
    context,
    `canvas-reachability:${context.get("user").email}`,
    5,
  );
  if (!allowed) return context.json({ error: "Try again later." }, 429);
  try {
    const installation = configuredCanvasInstallation(context.env);
    const provider = new CanvasRestProvider(
      installation.baseUrl.origin,
      "organato-reachability-check",
    );
    await provider.validateConnection(AbortSignal.timeout(10_000));
    return context.json({ reachable: true, result: "unexpected_acceptance" });
  } catch (error) {
    const category = canvasConnectionErrorCategory(error);
    return context.json({
      reachable:
        category.startsWith("token_rejected_") ||
        category.startsWith("api_access_denied_"),
      result: category,
    });
  }
});

apiRoutes.post(
  "/integrations/canvas/connect",
  requireRecentSession(),
  zValidator("json", canvasConnectSchema),
  async (context) => {
    const allowed = await rateLimit(
      context,
      `canvas-connect:${context.get("user").email}`,
      10,
    );
    if (!allowed) {
      return context.json(
        {
          error:
            "Too many connection attempts. Create a new Reshet token, then try again at the start of the next hour.",
          code: "rate_limited",
        },
        429,
      );
    }
    const input = context.req.valid("json");
    let installation: ReturnType<typeof configuredCanvasInstallation>;
    try {
      installation = configuredCanvasInstallation(context.env);
    } catch (error) {
      return context.json({ error: safeCanvasConnectionError(error) }, 503);
    }
    const provider = new CanvasRestProvider(
      installation.baseUrl.origin,
      input.token,
    );
    let identity: Awaited<ReturnType<typeof provider.validateConnection>>;
    try {
      identity = await provider.validateConnection(AbortSignal.timeout(15_000));
    } catch (error) {
      const category = canvasConnectionErrorCategory(error);
      await recordSecurityEvent(
        context.env.DB,
        "canvas_connect_failed",
        context.get("user").email,
        `Reshet token validation stopped safely (${category}).`,
      );
      return context.json(
        {
          error: safeCanvasConnectionError(error),
          code: canvasConnectionErrorCode(error),
        },
        400,
      );
    }
    const now = new Date().toISOString();
    const metadata = createCanvasConnectionMetadata({
      baseUrl: provider.baseUrl,
      userId: identity.id,
      userName: identity.name,
      now,
    });
    const encrypted = await encryptSecret(
      input.token,
      context.env.DATA_ENCRYPTION_KEY,
      metadata.credentialAad,
    );
    await context.env.DB.prepare(
      `INSERT INTO integration_connection
          (provider, account_label, status, scopes_json, encrypted_credential,
           credential_key_version, last_success_at, last_attempt_at, reconnect_needed,
           metadata_json, updated_at)
         VALUES ('canvas', ?, 'healthy', '["read-only"]', ?, 1, NULL, ?, 0, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET
           account_label = excluded.account_label,
           status = excluded.status,
           encrypted_credential = excluded.encrypted_credential,
           last_attempt_at = excluded.last_attempt_at,
           last_error_category = NULL,
           reconnect_needed = 0,
           metadata_json = excluded.metadata_json,
           updated_at = excluded.updated_at`,
    )
      .bind(
        `${identity.name} · ${identity.hostname}`,
        encrypted,
        now,
        JSON.stringify(metadata),
        now,
      )
      .run();
    let initialSync: CanvasConnectResponse["initialSync"];
    try {
      const sync = await runCanvasSync(context.env, "manual");
      initialSync = {
        status: sync.result === "partial" ? "partial" : "success",
        runId: sync.runId,
        courses: sync.courses,
        fetched: sync.fetched,
        created: sync.created,
        updated: sync.updated,
      };
    } catch {
      initialSync = {
        status: "failed",
        message: "Reshet is connected, but the first import needs another try.",
      };
    }
    const status = await getCanvasConnectionStatus(context.env);
    if (!status.connection) {
      throw new Error("Canvas connection could not be read after saving.");
    }
    const response: CanvasConnectResponse = {
      connection: status.connection,
      initialSync,
    };
    return context.json(response, 201);
  },
);

apiRoutes.post(
  "/integrations/canvas/disconnect",
  requireRecentSession(),
  async (context) => {
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `UPDATE integration_connection
     SET status = 'disconnected', encrypted_credential = NULL,
         reconnect_needed = 0, last_error_category = NULL,
         last_attempt_at = ?, updated_at = ?
     WHERE provider = 'canvas'`,
    )
      .bind(now, now)
      .run();
    return context.json(await getCanvasConnectionStatus(context.env));
  },
);

apiRoutes.get("/statistics", async (context) => {
  const settings = await getSettings(context.env.DB);
  const [active, archived, overdue, completed] = await context.env.DB.batch([
    context.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM item WHERE archived_at IS NULL",
    ),
    context.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM item WHERE archived_at IS NOT NULL",
    ),
    context.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM item
       WHERE archived_at IS NULL
         AND (
           due_at < ?
           OR (due_at IS NULL AND due_date_local < ?)
         )
         AND working_status NOT IN ('completed', 'submitted')`,
    ).bind(
      new Date().toISOString(),
      localDateKey(new Date(), settings.timezone),
    ),
    context.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM item WHERE working_status = 'completed'",
    ),
  ]);
  const count = (result: D1Result | undefined) =>
    Number((result?.results[0] as { count?: number } | undefined)?.count ?? 0);
  return context.json({
    active: count(active),
    archived: count(archived),
    overdue: count(overdue),
    completed: count(completed),
  });
});

apiRoutes.get("/export", requireRecentSession(), async (context) => {
  const [items, archived, subjects, settings, savedViews] = await Promise.all([
    listItems(context.env.DB, { all: true }),
    listItems(context.env.DB, { archived: true, all: true }),
    listSubjects(context.env.DB),
    getSettings(context.env.DB),
    context.env.DB.prepare(
      `SELECT id, page, name, filters_json, sort_json, columns_json,
                column_widths_json, is_default
         FROM saved_view ORDER BY page, is_default DESC, name`,
    ).all<{
      id: string;
      page: string;
      name: string;
      filters_json: string;
      sort_json: string;
      columns_json: string;
      column_widths_json: string;
      is_default: number;
    }>(),
  ]);
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    subjects,
    items: [...items, ...archived],
    savedViews: savedViews.results.map((row) => ({
      id: row.id,
      page: row.page,
      name: row.name,
      filters: JSON.parse(row.filters_json),
      sort: JSON.parse(row.sort_json),
      columns: JSON.parse(row.columns_json),
      columnWidths: JSON.parse(row.column_widths_json),
      isDefault: Boolean(row.is_default),
    })),
  };
  const serialized = JSON.stringify(backup);
  if (!assertSecretFreeBackup(serialized)) {
    return context.json({ error: "Backup safety check failed." }, 500);
  }
  if (new TextEncoder().encode(serialized).byteLength > 25_000_000) {
    return context.json(
      {
        error:
          "Backup is larger than the 25 MB safety limit. Export the CSV files instead.",
      },
      413,
    );
  }
  return context.body(serialized, 200, {
    "Content-Type": "application/json",
    "Content-Disposition": 'attachment; filename="organato-backup.json"',
  });
});

apiRoutes.post("/import/preview", requireRecentSession(), async (context) => {
  const length = Number(context.req.header("Content-Length") ?? 0);
  if (length > 25_000_000)
    return context.json({ error: "Backup is too large." }, 413);
  const value = await context.req.json().catch(() => null);
  const result = validateBackup(value);
  if (!result.success) {
    return context.json(
      { valid: false, errors: result.error.issues.slice(0, 20) },
      400,
    );
  }
  return context.json({
    valid: true,
    dryRun: {
      items: result.data.items.length,
      subjects: result.data.subjects.length,
      savedViews: result.data.savedViews.length,
      mode: "merge",
      requiresPreRestoreBackup: true,
    },
  });
});

apiRoutes.post("/import/apply", requireRecentSession(), async (context) => {
  const length = Number(context.req.header("Content-Length") ?? 0);
  if (length > 25_000_000)
    return context.json({ error: "Backup is too large." }, 413);
  if (
    !(await rateLimit(context, `restore:${context.get("user").email}`, 3, 60))
  ) {
    return context.json({ error: "Restore limit reached. Try later." }, 429);
  }
  const request = (await context.req.json().catch(() => null)) as {
    backup?: unknown;
    confirmation?: string;
  } | null;
  if (request?.confirmation !== "RESTORE ORGANATO") {
    return context.json({ error: "Restore confirmation is required." }, 400);
  }
  const result = validateBackup(request.backup);
  if (!result.success) {
    return context.json(
      { error: "Backup validation failed. Nothing was changed." },
      400,
    );
  }
  const backup = result.data;
  const knownSubjectIds = new Set([
    ...backup.subjects.map((subject) => subject.id),
    ...(await listSubjects(context.env.DB)).map((subject) => subject.id),
  ]);
  if (
    backup.items.some(
      (item) => item.subjectId && !knownSubjectIds.has(item.subjectId),
    )
  ) {
    return context.json(
      { error: "Backup references an unknown subject. Nothing was changed." },
      400,
    );
  }
  let canvasBaseHash: string | null = null;
  try {
    canvasBaseHash = await sha256(
      configuredCanvasInstallation(context.env).baseUrl.origin,
    );
  } catch {
    // Manual-only deployments can still restore non-Canvas backups.
  }
  const now = new Date().toISOString();
  try {
    const subjectStatements = backup.subjects.map((subject) =>
      context.env.DB.prepare(
        `INSERT INTO subject
            (id, canvas_course_id, source_name, display_name, short_name,
             colour, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             canvas_course_id = excluded.canvas_course_id,
             source_name = excluded.source_name,
             display_name = excluded.display_name,
             short_name = excluded.short_name,
             colour = excluded.colour,
             active = excluded.active,
             updated_at = excluded.updated_at`,
      ).bind(
        subject.id,
        subject.canvasCourseId,
        subject.sourceName,
        subject.displayName,
        subject.shortName,
        subject.colour,
        subject.active ? 1 : 0,
        now,
        now,
      ),
    );
    await runBatches(context.env.DB, subjectStatements);

    const itemColumns = [
      "id",
      "version",
      "kind",
      "classification",
      "source_type",
      "canvas_base_url_hash",
      "canvas_assignment_id",
      "canvas_course_id",
      "canvas_html_url",
      "source_name",
      "source_due_at",
      "source_updated_at",
      "source_payload_hash",
      "display_name",
      "due_at",
      "due_date_local",
      "due_has_explicit_time",
      "subject_id",
      "priority",
      "working_status",
      "completed_at",
      "submitted_at",
      "notes_markdown",
      "recurrence_rule_json",
      "recurrence_series_id",
      "calendar_enabled",
      "reminders_enabled",
      "calendar_sync_state",
      "calendar_note",
      "pinned",
      "sort_rank",
      "archived_at",
      "archive_reason",
      "source_missing_since",
      "missing_sync_count",
      "manual_archive",
      "created_at",
      "updated_at",
    ] as const;
    const preservedOnUpdate = new Set([
      "id",
      "canvas_base_url_hash",
      "created_at",
    ]);
    const itemSql = `INSERT INTO item (${itemColumns.join(", ")})
      VALUES (${itemColumns.map(() => "?").join(", ")})
      ON CONFLICT(id) DO UPDATE SET ${itemColumns
        .filter((column) => !preservedOnUpdate.has(column))
        .map((column) => `${column} = excluded.${column}`)
        .join(", ")}`;
    const itemStatements = backup.items.map((item) =>
      context.env.DB.prepare(itemSql).bind(
        item.id,
        item.version,
        item.kind,
        item.classification,
        item.sourceType,
        item.sourceType === "canvas" ? canvasBaseHash : null,
        item.canvasAssignmentId,
        item.canvasCourseId,
        item.canvasHtmlUrl,
        item.sourceName,
        item.sourceDueAt,
        item.sourceUpdatedAt,
        item.sourcePayloadHash,
        item.displayName,
        item.dueAt,
        item.dueDateLocal,
        item.dueHasExplicitTime ? 1 : 0,
        item.subjectId,
        item.priority,
        item.workingStatus,
        item.completedAt,
        item.submittedAt,
        item.notesMarkdown,
        item.recurrenceRule ? JSON.stringify(item.recurrenceRule) : null,
        item.recurrenceSeriesId,
        item.calendarEnabled ? 1 : 0,
        item.remindersEnabled ? 1 : 0,
        item.calendarEnabled ? "pending" : "suppressed",
        item.calendarNote,
        item.pinned ? 1 : 0,
        item.sortRank,
        item.archivedAt,
        item.archiveReason,
        item.sourceMissingSince,
        item.missingSyncCount,
        item.archiveReason === "Manual archive" ? 1 : 0,
        item.createdAt,
        now,
      ),
    );
    await runBatches(context.env.DB, itemStatements);

    const childStatements = backup.items.flatMap((item) => [
      context.env.DB.prepare(
        "DELETE FROM field_override WHERE item_id = ?",
      ).bind(item.id),
      context.env.DB.prepare(
        "DELETE FROM attachment_link WHERE item_id = ?",
      ).bind(item.id),
      context.env.DB.prepare("DELETE FROM item_history WHERE item_id = ?").bind(
        item.id,
      ),
      ...item.overrides.map((override) =>
        context.env.DB.prepare(
          `INSERT INTO field_override
              (item_id, field_name, override_value_json,
               source_value_at_override_json, origin, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          item.id,
          override.fieldName,
          JSON.stringify(override.value),
          JSON.stringify(override.sourceValueAtOverride),
          override.origin,
          override.updatedAt,
          override.updatedAt,
        ),
      ),
      ...item.attachments.map((attachment) =>
        context.env.DB.prepare(
          `INSERT INTO attachment_link
              (id, item_id, label, url, link_type, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          attachment.id,
          item.id,
          attachment.label,
          attachment.url,
          attachment.linkType,
          attachment.createdAt,
        ),
      ),
      ...item.history.map((entry) =>
        context.env.DB.prepare(
          `INSERT INTO item_history
              (id, item_id, actor_type, actor_identity, action, summary,
               before_json, after_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          entry.id,
          item.id,
          entry.actorType,
          entry.actorIdentity,
          entry.action,
          entry.summary,
          entry.before ? JSON.stringify(entry.before) : null,
          entry.after ? JSON.stringify(entry.after) : null,
          entry.createdAt,
        ),
      ),
    ]);
    await runBatches(context.env.DB, childStatements);

    const viewStatements = backup.savedViews.map((view) =>
      context.env.DB.prepare(
        `INSERT INTO saved_view
            (id, page, name, filters_json, sort_json, columns_json,
             column_widths_json, is_default, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             page = excluded.page,
             name = excluded.name,
             filters_json = excluded.filters_json,
             sort_json = excluded.sort_json,
             columns_json = excluded.columns_json,
             column_widths_json = excluded.column_widths_json,
             is_default = excluded.is_default,
             updated_at = excluded.updated_at`,
      ).bind(
        view.id,
        view.page,
        view.name,
        JSON.stringify(view.filters),
        JSON.stringify(view.sort),
        JSON.stringify(view.columns),
        JSON.stringify(view.columnWidths),
        view.isDefault ? 1 : 0,
        now,
        now,
      ),
    );
    await runBatches(context.env.DB, viewStatements);
    await updateSettings(context.env.DB, backup.settings);
    await context.env.DB.prepare(
      `INSERT INTO security_event
        (id, category, actor_email, summary, created_at)
       VALUES (?, 'backup_restore', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        context.get("user").email,
        `Merged ${backup.items.length} items from a validated backup`,
        now,
      )
      .run();
    return context.json({
      ok: true,
      merged: {
        items: backup.items.length,
        subjects: backup.subjects.length,
        savedViews: backup.savedViews.length,
      },
    });
  } catch {
    return context.json(
      {
        error:
          "Restore could not finish. Use the pre-restore backup to recover and review the sanitized diagnostic.",
      },
      500,
    );
  }
});

apiRoutes.get("/sessions", async (context) => {
  const result = await context.env.DB.prepare(
    `SELECT email_normalized, user_agent, created_at, last_activity_at,
            idle_expires_at,
            CASE WHEN id_hash = ? THEN 1 ELSE 0 END AS is_current
     FROM session WHERE revoked_at IS NULL
     ORDER BY last_activity_at DESC`,
  )
    .bind(context.get("user").sessionIdHash)
    .all();
  return context.json({ sessions: result.results });
});

apiRoutes.get("/identities", async (context) => {
  const [identities, workspace] = await Promise.all([
    context.env.DB.prepare(
      `SELECT email_normalized, display_name, google_subject, enabled,
              is_owner, last_login_at, created_at
       FROM allowed_identity ORDER BY enabled DESC, email_normalized`,
    ).all(),
    context.env.DB.prepare(
      `SELECT integration_owner_email FROM workspace WHERE id = 'workspace'`,
    ).first<{ integration_owner_email: string | null }>(),
  ]);
  return context.json({
    identities: identities.results.map((identity) => ({
      ...identity,
      is_current:
        identity.email_normalized === context.get("user").email ? 1 : 0,
    })),
    integrationOwnerEmail: workspace?.integration_owner_email ?? null,
  });
});

apiRoutes.post(
  "/identities",
  requireRecentSession(),
  zValidator("json", addIdentitySchema),
  async (context) => {
    if (
      !(await rateLimit(
        context,
        `identity-admin:${context.get("user").email}`,
        10,
        60,
      ))
    ) {
      return context.json({ error: "Try again in an hour." }, 429);
    }
    const input = context.req.valid("json");
    const now = new Date().toISOString();
    const existing = await context.env.DB.prepare(
      `SELECT google_subject FROM allowed_identity WHERE email_normalized = ?`,
    )
      .bind(input.email)
      .first<{ google_subject: string | null }>();
    if (existing?.google_subject) {
      return context.json(
        { error: "That verified identity already exists." },
        409,
      );
    }
    await context.env.DB.prepare(
      `INSERT INTO allowed_identity
        (email_normalized, display_name, enabled, is_owner, created_at)
       VALUES (?, ?, 1, 1, ?)
       ON CONFLICT(email_normalized) DO UPDATE SET
         display_name = excluded.display_name, enabled = 1, is_owner = 1`,
    )
      .bind(
        input.email,
        input.displayName ?? input.email.split("@")[0] ?? input.email,
        now,
      )
      .run();
    await recordSecurityEvent(
      context.env.DB,
      "identity_added",
      context.get("user").email,
      `Approved ${input.email} for owner sign-in; Google verification is still required.`,
    );
    return context.json({ ok: true }, 201);
  },
);

apiRoutes.patch(
  "/identities/:email",
  requireRecentSession(),
  zValidator("json", identityStateSchema),
  async (context) => {
    const parsed = identityFromRoute(context.req.param("email"));
    if (!parsed.success)
      return context.json({ error: "Identity email is invalid." }, 400);
    const email = parsed.data;
    const input = context.req.valid("json");
    if (!input.enabled) {
      const workspace = await context.env.DB.prepare(
        `SELECT integration_owner_email FROM workspace WHERE id = 'workspace'`,
      ).first<{ integration_owner_email: string | null }>();
      if (workspace?.integration_owner_email === email) {
        return context.json(
          {
            error:
              "Disconnect Google or choose another integration owner first.",
          },
          409,
        );
      }
      const remaining = await context.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM allowed_identity
         WHERE enabled = 1 AND is_owner = 1 AND email_normalized <> ?`,
      )
        .bind(email)
        .first<{ count: number }>();
      if (!remaining?.count) {
        return context.json(
          { error: "At least one approved owner must remain." },
          409,
        );
      }
    }
    const changed = await context.env.DB.prepare(
      `UPDATE allowed_identity SET enabled = ?
       WHERE email_normalized = ?`,
    )
      .bind(input.enabled ? 1 : 0, email)
      .run();
    if (!changed.meta.changes)
      return context.json({ error: "Identity was not found." }, 404);
    if (!input.enabled) {
      await context.env.DB.prepare(
        `UPDATE session SET revoked_at = ?
         WHERE email_normalized = ? AND revoked_at IS NULL`,
      )
        .bind(new Date().toISOString(), email)
        .run();
      if (email === context.get("user").email) clearSessionCookies(context);
    }
    await recordSecurityEvent(
      context.env.DB,
      input.enabled ? "identity_enabled" : "identity_disabled",
      context.get("user").email,
      `${email} was ${input.enabled ? "enabled" : "disabled"} for sign-in.`,
    );
    return context.json({ ok: true });
  },
);

apiRoutes.delete(
  "/identities/:email",
  requireRecentSession(),
  async (context) => {
    const parsed = identityFromRoute(context.req.param("email"));
    if (!parsed.success)
      return context.json({ error: "Identity email is invalid." }, 400);
    const email = parsed.data;
    if (email === context.get("user").email) {
      return context.json(
        { error: "Sign in with another owner before removing this identity." },
        409,
      );
    }
    const identity = await context.env.DB.prepare(
      `SELECT google_subject, last_login_at FROM allowed_identity
       WHERE email_normalized = ?`,
    )
      .bind(email)
      .first<{
        google_subject: string | null;
        last_login_at: string | null;
      }>();
    if (!identity)
      return context.json({ error: "Identity was not found." }, 404);
    if (identity.google_subject || identity.last_login_at) {
      return context.json(
        {
          error:
            "Verified identities are retained for audit safety; disable this identity instead.",
        },
        409,
      );
    }
    await context.env.DB.prepare(
      "DELETE FROM allowed_identity WHERE email_normalized = ?",
    )
      .bind(email)
      .run();
    await recordSecurityEvent(
      context.env.DB,
      "identity_removed",
      context.get("user").email,
      `Unused identity ${email} was removed.`,
    );
    return context.json({ ok: true });
  },
);

apiRoutes.post(
  "/identities/:email/integration-owner",
  requireRecentSession(),
  async (context) => {
    const parsed = identityFromRoute(context.req.param("email"));
    if (!parsed.success)
      return context.json({ error: "Identity email is invalid." }, 400);
    const email = parsed.data;
    if (email !== context.get("user").email) {
      return context.json(
        { error: "Sign in as that identity before making it the owner." },
        409,
      );
    }
    const identity = await context.env.DB.prepare(
      `SELECT google_subject, enabled FROM allowed_identity
       WHERE email_normalized = ? AND is_owner = 1`,
    )
      .bind(email)
      .first<{ google_subject: string | null; enabled: number }>();
    if (!identity?.enabled || !identity.google_subject) {
      return context.json(
        { error: "That identity must complete Google sign-in first." },
        409,
      );
    }
    const google = await context.env.DB.prepare(
      `SELECT status, metadata_json FROM integration_connection
       WHERE provider = 'google'`,
    ).first<{ status: string; metadata_json: string }>();
    let connectedEmail: string | null = null;
    try {
      connectedEmail =
        (
          JSON.parse(google?.metadata_json ?? "{}") as { email?: string }
        ).email?.toLowerCase() ?? null;
    } catch {
      connectedEmail = null;
    }
    if (
      google &&
      google.status !== "disconnected" &&
      connectedEmail !== email
    ) {
      return context.json(
        {
          error:
            "Disconnect the existing Google integration, then connect it while signed in as this identity.",
        },
        409,
      );
    }
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `UPDATE workspace SET integration_owner_email = ?, updated_at = ?
       WHERE id = 'workspace'`,
    )
      .bind(email, now)
      .run();
    await recordSecurityEvent(
      context.env.DB,
      "integration_owner_changed",
      context.get("user").email,
      `${email} is the designated integration owner.`,
    );
    return context.json({
      ok: true,
      googleReconnectRequired:
        !google || google.status === "disconnected" || !connectedEmail,
    });
  },
);

apiRoutes.post("/sessions/revoke-others", async (context) => {
  await context.env.DB.prepare(
    "UPDATE session SET revoked_at = ? WHERE id_hash <> ? AND revoked_at IS NULL",
  )
    .bind(new Date().toISOString(), context.get("user").sessionIdHash)
    .run();
  await recordSecurityEvent(
    context.env.DB,
    "sessions_revoked",
    context.get("user").email,
    "All other active Organato sessions were revoked.",
  );
  return context.json({ ok: true });
});

apiRoutes.post("/sessions/revoke-all", async (context) => {
  await context.env.DB.prepare(
    "UPDATE session SET revoked_at = ? WHERE revoked_at IS NULL",
  )
    .bind(new Date().toISOString())
    .run();
  await recordSecurityEvent(
    context.env.DB,
    "sessions_revoked",
    context.get("user").email,
    "Every active Organato session was revoked.",
  );
  clearSessionCookies(context);
  return context.json({ ok: true });
});

apiRoutes.get("/diagnostic", async (context) => {
  const [itemCount, subjectCount, integrations, recentRuns] =
    await context.env.DB.batch([
      context.env.DB.prepare("SELECT COUNT(*) AS count FROM item"),
      context.env.DB.prepare("SELECT COUNT(*) AS count FROM subject"),
      context.env.DB.prepare(
        `SELECT provider, status, credential_key_version, last_success_at,
                last_attempt_at, last_error_category, reconnect_needed
         FROM integration_connection ORDER BY provider`,
      ),
      context.env.DB.prepare(
        `SELECT provider, trigger_type, started_at, finished_at, result,
                error_category, created_count, updated_count, archived_count,
                skipped_count
         FROM sync_run ORDER BY started_at DESC LIMIT 20`,
      ),
    ]);
  const count = (result: D1Result | undefined) =>
    Number((result?.results[0] as { count?: number } | undefined)?.count ?? 0);
  return context.json({
    generatedAt: new Date().toISOString(),
    app: { name: "Organato", version: "0.1.0", schemaVersion: 1 },
    deployment: {
      origin: context.env.APP_ORIGIN,
      schedulerMode: context.env.SCHEDULER_MODE ?? "local",
      demoMode: context.env.DEMO_MODE === "true",
    },
    counts: {
      items: count(itemCount),
      subjects: count(subjectCount),
    },
    integrations: integrations?.results ?? [],
    recentRuns: recentRuns?.results ?? [],
    secretsIncluded: false,
  });
});

apiRoutes.post(
  "/data/delete-all",
  requireRecentSession(),
  zValidator("json", deleteWorkspaceDataSchema),
  async (context) => {
    const user = context.get("user");
    if (!(await rateLimit(context, `delete-all:${user.email}`, 2, 24 * 60))) {
      return context.json(
        { error: "Permanent deletion is temporarily rate-limited." },
        429,
      );
    }
    const input = context.req.valid("json");
    const now = new Date().toISOString();
    await context.env.DB.batch([
      context.env.DB.prepare("DELETE FROM item"),
      context.env.DB.prepare("DELETE FROM subject"),
      context.env.DB.prepare("DELETE FROM saved_view"),
      context.env.DB.prepare("DELETE FROM reminder_delivery"),
      context.env.DB.prepare("DELETE FROM sync_run"),
      context.env.DB.prepare("DELETE FROM integration_connection"),
      context.env.DB.prepare("DELETE FROM oauth_transaction"),
      context.env.DB.prepare("DELETE FROM security_event"),
      context.env.DB.prepare("DELETE FROM rate_limit"),
      context.env.DB.prepare("DELETE FROM session"),
      context.env.DB.prepare("DELETE FROM allowed_identity"),
      context.env.DB.prepare(
        `UPDATE workspace
           SET name = 'Organato', timezone = 'Australia/Sydney',
               integration_owner_email = NULL, settings_json = '{}',
               updated_at = ?
           WHERE id = 'workspace'`,
      ).bind(now),
    ]);
    clearSessionCookies(context);
    return context.json({
      ok: true,
      deleted: true,
      backupOfferAcknowledged: input.acknowledgeBackupOffer,
      externalProviderDataDeleted: false,
    });
  },
);
