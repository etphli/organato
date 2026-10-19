export const classifications = [
  "unclassified",
  "assignment",
  "checkpoint",
  "both",
] as const;
export type Classification = (typeof classifications)[number];

export const priorities = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof priorities)[number] | null;

export const workingStatuses = [
  "not_started",
  "in_progress",
  "submitted",
  "completed",
] as const;
export type WorkingStatus = (typeof workingStatuses)[number];

export type VisibleStatus = WorkingStatus | "overdue" | "archived";
export type ItemKind = "work" | "todo";
export type SourceType = "canvas" | "manual";
export type CalendarSyncState =
  "synced" | "pending" | "conflict" | "suppressed" | "error";

export interface Subject {
  id: string;
  canvasCourseId: string | null;
  sourceName: string | null;
  displayName: string;
  shortName: string | null;
  colour: string;
  active: boolean;
}

export interface FieldOverride {
  fieldName: "name" | "due" | "subject" | "calendarNote";
  value: unknown;
  sourceValueAtOverride: unknown;
  origin: "organato" | "google";
  updatedAt: string;
}

export interface AttachmentLink {
  id: string;
  label: string;
  url: string;
  linkType: "reference" | "brief" | "rubric" | "working_document" | "other";
  createdAt: string;
}

export interface HistoryEntry {
  id: string;
  actorType: "user" | "canvas" | "google" | "system";
  actorIdentity: string;
  action: string;
  summary: string;
  createdAt: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface RecurrenceRule {
  frequency:
    "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "custom";
  interval: number;
  seriesId: string;
}

export interface OrganatoItem {
  id: string;
  version: number;
  kind: ItemKind;
  classification: Classification;
  sourceType: SourceType;
  canvasAssignmentId: string | null;
  canvasCourseId: string | null;
  canvasHtmlUrl: string | null;
  sourceName: string | null;
  sourceDueAt: string | null;
  sourceUpdatedAt: string | null;
  sourcePayloadHash: string | null;
  displayName: string;
  dueAt: string | null;
  dueDateLocal: string | null;
  dueHasExplicitTime: boolean;
  subjectId: string | null;
  priority: Priority;
  workingStatus: WorkingStatus;
  completedAt: string | null;
  submittedAt: string | null;
  notesMarkdown: string;
  recurrenceRule: RecurrenceRule | null;
  recurrenceSeriesId: string | null;
  calendarEnabled: boolean;
  remindersEnabled: boolean;
  calendarSyncState: CalendarSyncState;
  calendarNote: string;
  pinned: boolean;
  sortRank: number;
  estimatedMinutes: number | null;
  archivedAt: string | null;
  archiveReason: string | null;
  sourceMissingSince: string | null;
  missingSyncCount: number;
  createdAt: string;
  updatedAt: string;
  overrides: FieldOverride[];
  attachments: AttachmentLink[];
  history: HistoryEntry[];
  subtasks: Subtask[];
  links: ItemLinkSummary;
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  sortRank: number;
  createdAt: string;
  updatedAt: string;
}

export interface ItemLinkRef {
  itemId: string;
  linkId: string;
}
export interface ItemLinkSummary {
  /** Items that must finish first. */
  blockedBy: ItemLinkRef[];
  /** Items waiting on this one. */
  blocking: ItemLinkRef[];
}

export interface CanvasAnnouncement {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  excerpt: string;
  url: string | null;
  postedAt: string | null;
}

export interface CanvasGrade {
  courseId: string;
  courseName: string;
  score: number | null;
  grade: string | null;
}

export interface CanvasModuleState {
  courseId: string;
  courseName: string;
  moduleId: string;
  moduleName: string;
  state: string | null;
}

export interface CanvasCourseSignals {
  announcements: CanvasAnnouncement[];
  grades: CanvasGrade[];
  modules: CanvasModuleState[];
}

export interface SavedView {
  id: string;
  page: "assignments" | "checkpoints" | "todo" | "archive";
  name: string;
  filters: ItemFilters;
  sort: SortRule[];
  columns: string[];
  columnWidths: Record<string, number>;
  isDefault: boolean;
}

export interface SortRule {
  field: "due" | "priority" | "name" | "status" | "subject" | "created";
  direction: "asc" | "desc";
}

export interface ItemFilters {
  query?: string;
  classifications?: Classification[];
  kinds?: ItemKind[];
  subjectIds?: string[];
  priorities?: Array<NonNullable<Priority>>;
  statuses?: VisibleStatus[];
  sources?: SourceType[];
  due?: "today" | "this_week" | "overdue" | "unscheduled";
  hasNotes?: boolean;
  hasAttachments?: boolean;
  calendarStates?: CalendarSyncState[];
}

export interface WorkspaceSettings {
  timezone: string;
  dateFormat: string;
  timeFormat: "12h" | "24h";
  firstDayOfWeek: 0 | 1;
  theme: "obsidian" | "pure_black" | "soft_dark" | "light" | "system";
  density: "comfortable" | "compact";
  sidebar: "expanded" | "collapsed" | "remember";
  fontScale: number;
  reduceMotion: boolean;
  highContrast: boolean;
  underlineExternalLinks: boolean;
  calendarDefaultView: "month" | "week" | "agenda";
  upcomingAssignmentCount: number;
  upcomingCheckpointCount: number;
  completedVisibility: "end_of_day" | "seven_days" | "immediately";
  dailyDigestEnabled: boolean;
  digestHour: number;
  eveningPreviewEnabled: boolean;
  eveningHour: number;
  weeklyReviewEnabled: boolean;
  guardianEmail: string;
  guardianWeeklyEnabled: boolean;
  smsGatewayAddress: string;
  examEscalationEnabled: boolean;
  subjectDefaults: Record<string, SubjectDefault>;
  checklistTemplates: Record<string, string[]>;
  reminderWindowDays: number;
  immediateImportAlert: boolean;
  naturalTodoParsing: boolean;
  autoExpandClassification: boolean;
  showMiniCalendar: boolean;
  showQuickTodo: boolean;
  includeBothInPanels: boolean;
  showWorkloadStrip: boolean;
  stickyNameColumn: boolean;
  inlineEditing: boolean;
  showSourceIcons: boolean;
  showSubmittedActive: boolean;
  confirmBulkArchive: boolean;
  todoCalendarDefault: boolean;
  todoRemindersDefault: boolean;
  recurrenceOnCompletion: boolean;
  showAttachmentIndicator: boolean;
  searchNotes: boolean;
  fuzzySearch: boolean;
  recentSearches: boolean;
  showKeyboardHints: boolean;
  multiKeyNavigation: boolean;
  alwaysShowIconText: boolean;
  screenReaderAnnouncements: boolean;
  dragCalendarReschedule: boolean;
  onboardingCompleted: boolean;
}

export interface SubjectDefault {
  priority?: Priority;
  calendarEnabled?: boolean;
  remindersEnabled?: boolean;
}

export interface IntegrationHealth {
  provider: "canvas" | "google_calendar" | "gmail";
  state: "healthy" | "delayed" | "partial" | "action_needed" | "disconnected";
  label: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface CanvasConnectionStatus {
  installation: {
    name: string;
    hostname: string;
    readOnly: true;
  };
  state: IntegrationHealth["state"];
  connection: {
    userId: string;
    userName: string;
    connectedAt: string;
    lastValidatedAt: string;
    lastSuccessfulSyncAt: string | null;
    nextExpectedSyncAt: string | null;
  } | null;
  counts: {
    activeCourses: number;
    upcomingItems: number;
  };
  latestSync: {
    startedAt: string;
    finishedAt: string | null;
    result: string;
    fetched: number;
    created: number;
    updated: number;
    archived: number;
  } | null;
}

export interface CanvasConnectResponse {
  connection: NonNullable<CanvasConnectionStatus["connection"]>;
  initialSync:
    | {
        status: "success" | "partial";
        runId: string;
        courses: number;
        fetched: number;
        created: number;
        updated: number;
      }
    | {
        status: "failed";
        message: string;
      };
}

export interface WorkspaceSnapshot {
  version: 1;
  exportedAt: string;
  settings: WorkspaceSettings;
  subjects: Subject[];
  items: OrganatoItem[];
  savedViews: SavedView[];
}

export type ApiKeyPermission = "read" | "read_write";

/** Safe key metadata. The bearer token is returned only when a key is created. */
export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  permission: ApiKeyPermission;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
