import { z } from "zod";
import { isValidLocalDate } from "./items";

const stringOrNull = z.string().max(20_000).nullable();
const timestampOrNull = z.string().datetime().nullable();
const localDateOrNull = z
  .string()
  .refine(isValidLocalDate, "Date-only values must be real calendar dates.")
  .nullable();

export function isTrustedCanvasItemUrl(value: string): boolean {
  // Any https URL without embedded credentials: the server recomputes
  // Canvas identity per installation on restore, so the URL itself is only
  // ever rendered as a display link. Pinning a single host here rejected
  // valid multi-install backups.
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

const subjectSchema = z
  .object({
    id: z.string().min(1),
    canvasCourseId: stringOrNull,
    sourceName: stringOrNull,
    displayName: z.string().min(1),
    shortName: stringOrNull,
    colour: z.string().regex(/^#[0-9a-f]{6}$/i),
    active: z.boolean(),
  })
  .strict();

const historySchema = z
  .object({
    id: z.string().min(1),
    actorType: z.enum(["user", "canvas", "google", "system"]),
    actorIdentity: z.string().max(500),
    action: z.string().max(200),
    summary: z.string().max(2_000),
    createdAt: z.string().datetime(),
    before: z.record(z.unknown()).optional(),
    after: z.record(z.unknown()).optional(),
  })
  .strict();

const itemSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    kind: z.enum(["work", "todo"]),
    classification: z.enum([
      "unclassified",
      "assignment",
      "checkpoint",
      "both",
    ]),
    sourceType: z.enum(["canvas", "manual"]),
    canvasAssignmentId: stringOrNull,
    canvasCourseId: stringOrNull,
    canvasHtmlUrl: z
      .string()
      .url()
      .refine(isTrustedCanvasItemUrl, {
        message: "Canvas links must use the configured Emanuel School host.",
      })
      .nullable(),
    sourceName: z.string().max(500).nullable(),
    sourceDueAt: timestampOrNull,
    sourceUpdatedAt: timestampOrNull,
    sourcePayloadHash: z.string().max(200).nullable(),
    displayName: z.string().min(1).max(500),
    dueAt: timestampOrNull,
    dueDateLocal: localDateOrNull,
    dueHasExplicitTime: z.boolean(),
    subjectId: stringOrNull,
    priority: z.enum(["low", "medium", "high", "urgent"]).nullable(),
    workingStatus: z.enum([
      "not_started",
      "in_progress",
      "submitted",
      "completed",
    ]),
    completedAt: timestampOrNull,
    submittedAt: timestampOrNull,
    notesMarkdown: z.string().max(100_000),
    recurrenceRule: z
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
        seriesId: z.string().min(1),
      })
      .nullable(),
    recurrenceSeriesId: stringOrNull,
    calendarEnabled: z.boolean(),
    remindersEnabled: z.boolean(),
    calendarSyncState: z.enum([
      "synced",
      "pending",
      "conflict",
      "suppressed",
      "error",
    ]),
    calendarNote: z.string().max(20_000),
    pinned: z.boolean(),
    sortRank: z.number(),
    archivedAt: timestampOrNull,
    archiveReason: stringOrNull,
    sourceMissingSince: timestampOrNull,
    missingSyncCount: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    overrides: z
      .array(
        z.object({
          fieldName: z.enum(["name", "due", "subject", "calendarNote"]),
          value: z.unknown(),
          sourceValueAtOverride: z.unknown(),
          origin: z.enum(["organato", "google"]),
          updatedAt: z.string().datetime(),
        }),
      )
      .max(4),
    attachments: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1).max(200),
          url: z
            .string()
            .url()
            .refine((value) => new URL(value).protocol === "https:", {
              message: "Attachment links must use HTTPS.",
            }),
          linkType: z.enum([
            "reference",
            "brief",
            "rubric",
            "working_document",
            "other",
          ]),
          createdAt: z.string().datetime(),
        }),
      )
      .max(1_000),
    history: z.array(historySchema).max(10_000),
  })
  .strict()
  .superRefine((item, context) => {
    const hasTimedDeadline = Boolean(item.dueAt);
    const hasDateOnlyDeadline = Boolean(item.dueDateLocal);
    if (
      (hasTimedDeadline && hasDateOnlyDeadline) ||
      item.dueHasExplicitTime !== hasTimedDeadline
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueHasExplicitTime"],
        message: "Backup item deadline fields are inconsistent.",
      });
    }
    if (
      item.sourceType === "canvas" &&
      (!item.canvasAssignmentId || !item.canvasCourseId || !item.canvasHtmlUrl)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceType"],
        message: "Canvas backup items require their external identity.",
      });
    }
    if (
      item.sourceType === "manual" &&
      (item.canvasAssignmentId || item.canvasCourseId || item.canvasHtmlUrl)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceType"],
        message: "Manual backup items cannot claim a Canvas identity.",
      });
    }
  });

const savedViewSchema = z
  .object({
    id: z.string().min(1),
    page: z.enum(["assignments", "checkpoints", "todo", "archive"]),
    name: z.string().min(1).max(100),
    filters: z.object({
      query: z.string().optional(),
      classifications: z
        .array(z.enum(["unclassified", "assignment", "checkpoint", "both"]))
        .optional(),
      kinds: z.array(z.enum(["work", "todo"])).optional(),
      subjectIds: z.array(z.string()).optional(),
      priorities: z
        .array(z.enum(["low", "medium", "high", "urgent"]))
        .optional(),
      statuses: z
        .array(
          z.enum([
            "not_started",
            "in_progress",
            "submitted",
            "completed",
            "overdue",
            "archived",
          ]),
        )
        .optional(),
      sources: z.array(z.enum(["canvas", "manual"])).optional(),
      due: z.enum(["today", "this_week", "overdue", "unscheduled"]).optional(),
      hasNotes: z.boolean().optional(),
      hasAttachments: z.boolean().optional(),
      calendarStates: z
        .array(z.enum(["synced", "pending", "conflict", "suppressed", "error"]))
        .optional(),
    }),
    sort: z
      .array(
        z.object({
          field: z.enum([
            "due",
            "priority",
            "name",
            "status",
            "subject",
            "created",
          ]),
          direction: z.enum(["asc", "desc"]),
        }),
      )
      .max(20),
    columns: z.array(z.string().max(80)).max(30),
    columnWidths: z.record(z.number().positive().max(2_000)),
    isDefault: z.boolean(),
  })
  .strict();

const settingsSchema = z
  .object({
    timezone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat("en-AU", { timeZone: value }).format(
          new Date(),
        );
        return true;
      } catch {
        return false;
      }
    }, "Backup has an invalid IANA timezone."),
    dateFormat: z.string(),
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
    autoExpandClassification: z.boolean().default(true),
    showMiniCalendar: z.boolean().default(true),
    showQuickTodo: z.boolean().default(true),
    includeBothInPanels: z.boolean().default(true),
    showWorkloadStrip: z.boolean().default(true),
    stickyNameColumn: z.boolean().default(true),
    inlineEditing: z.boolean().default(true),
    showSourceIcons: z.boolean().default(true),
    showSubmittedActive: z.boolean().default(false),
    confirmBulkArchive: z.boolean().default(true),
    todoCalendarDefault: z.boolean().default(true),
    todoRemindersDefault: z.boolean().default(true),
    recurrenceOnCompletion: z.boolean().default(true),
    showAttachmentIndicator: z.boolean().default(true),
    searchNotes: z.boolean().default(true),
    fuzzySearch: z.boolean().default(true),
    recentSearches: z.boolean().default(true),
    showKeyboardHints: z.boolean().default(true),
    multiKeyNavigation: z.boolean().default(true),
    alwaysShowIconText: z.boolean().default(false),
    screenReaderAnnouncements: z.boolean().default(true),
    dragCalendarReschedule: z.boolean().default(true),
    onboardingCompleted: z.boolean().default(false),
  })
  .strict();

export const workspaceBackupSchema = z
  .object({
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    settings: settingsSchema,
    subjects: z.array(subjectSchema).max(10_000),
    items: z.array(itemSchema).max(100_000),
    savedViews: z.array(savedViewSchema).max(1_000),
  })
  .strict();

export function validateBackup(value: unknown) {
  return workspaceBackupSchema.safeParse(value);
}

export function validateBackupItem(value: unknown) {
  return itemSchema.safeParse(value);
}

export function assertSecretFreeBackup(serialized: string): boolean {
  const forbidden = [
    /refresh[_-]?token/i,
    /access[_-]?token/i,
    /canvas[_-]?token/i,
    /client[_-]?secret/i,
    /session[_-]?secret/i,
    /encryption[_-]?key/i,
  ];
  return forbidden.every((pattern) => !pattern.test(serialized));
}
