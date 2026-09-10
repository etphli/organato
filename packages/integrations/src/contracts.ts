import type {
  CanvasAnnouncement,
  CanvasCourseSignals,
  CanvasGrade,
  CanvasModuleState,
  OrganatoItem,
  Subject,
} from "@organato/domain";

export interface CanvasIdentity {
  id: string;
  name: string;
  hostname: string;
}

export interface CanvasCourse {
  id: string;
  name: string;
  workflowState: string;
}

export interface CanvasAssignment {
  id: string;
  courseId: string;
  name: string;
  dueAt: string | null;
  htmlUrl: string;
  updatedAt: string;
  published: boolean;
  submitted: boolean;
}

export interface CanvasSyncResult {
  courses: CanvasCourse[];
  assignments: CanvasAssignment[];
  partialFailures: Array<{ courseId: string; category: string }>;
  successfulCourseIds: string[];
  catalogueComplete: boolean;
  skippedMalformedItems: number;
}

export type {
  CanvasAnnouncement,
  CanvasCourseSignals,
  CanvasGrade,
  CanvasModuleState,
};

export interface CanvasProvider {
  validateConnection(signal?: AbortSignal): Promise<CanvasIdentity>;
  fetchUpcomingAssignments(signal?: AbortSignal): Promise<CanvasSyncResult>;
  fetchCourseSignals(
    since: Date,
    signal?: AbortSignal,
  ): Promise<CanvasCourseSignals>;
}

export interface CalendarEventProjection {
  itemId: string;
  itemVersion: number;
  summary: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  description: string;
  privateProperties: Record<string, string>;
}

export interface CalendarEventRecord {
  id: string;
  etag?: string;
  status: "confirmed" | "cancelled";
  updated?: string;
  summary?: string;
  description?: string;
  start?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export interface CalendarChangePage {
  events: CalendarEventRecord[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface GoogleCalendarProvider {
  ensureOrganatoCalendar(storedCalendarId?: string): Promise<string>;
  upsertEvent(
    calendarId: string,
    projection: CalendarEventProjection,
    existingEventId?: string,
    etag?: string,
  ): Promise<CalendarEventRecord>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
  getEvent(
    calendarId: string,
    eventId: string,
  ): Promise<CalendarEventRecord | null>;
  listChanges(
    calendarId: string,
    syncToken?: string,
    pageToken?: string,
  ): Promise<CalendarChangePage>;
}

export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
  deliveryKey: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ messageId: string }>;
}

export interface SyncContext {
  items: OrganatoItem[];
  subjects: Subject[];
  now: Date;
}
