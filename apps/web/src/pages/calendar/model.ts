import {
  localDateKey,
  visibleStatus,
  type OrganatoItem,
  type Priority,
  type Subject,
  type WorkspaceSettings,
} from "@organato/domain/core";
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";

export type CalendarView = "month" | "week" | "agenda";
export type CalendarTypeFilter =
  "assignment" | "checkpoint" | "todo" | "unclassified";
export type CalendarStatusFilter =
  "active" | "overdue" | "submitted" | "completed";

export interface CalendarFilters {
  types: CalendarTypeFilter[];
  subjectIds: string[];
  priorities: Array<NonNullable<Priority>>;
  statuses: CalendarStatusFilter[];
  showTodos: boolean;
}

export const defaultCalendarFilters: CalendarFilters = {
  types: [],
  subjectIds: [],
  priorities: [],
  statuses: [],
  showTodos: true,
};

export type CalendarEntryType =
  "assignment" | "checkpoint" | "both" | "todo" | "unclassified";

export interface CalendarEntry {
  item: OrganatoItem;
  dateKey: string;
  isAllDay: boolean;
  startMinutes: number | null;
  timeLabel: string;
  type: CalendarEntryType;
  subject: Subject | null;
  subjectColour: string;
  visibleStatus: ReturnType<typeof visibleStatus>;
  isCompleted: boolean;
}

export interface CalendarPreferences {
  view: CalendarView;
  anchorKey: string;
  selectedDateKey: string;
  filters: CalendarFilters;
}

const timePartsFormatters = new Map<string, Intl.DateTimeFormat>();
const entryTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function timePartsFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = timePartsFormatters.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  timePartsFormatters.set(timezone, formatter);
  return formatter;
}

function entryTimeFormatter(
  timezone: string,
  timeFormat: WorkspaceSettings["timeFormat"],
): Intl.DateTimeFormat {
  const key = `${timezone}:${timeFormat}`;
  const cached = entryTimeFormatters.get(key);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  });
  entryTimeFormatters.set(key, formatter);
  return formatter;
}

export function dateFromKey(key: string): Date {
  return new Date(`${key}T12:00:00`);
}

export function dateKeyFromDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function todayKey(
  timezone = "Australia/Sydney",
  now = new Date(),
): string {
  return localDateKey(now, timezone);
}

function entryType(item: OrganatoItem): CalendarEntryType {
  if (item.kind === "todo") return "todo";
  return item.classification;
}

function timeParts(
  date: Date,
  timezone: string,
): { hour: number; minute: number } {
  const parts = timePartsFormatter(timezone).formatToParts(date);
  const value = (type: "hour" | "minute") =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { hour: value("hour") % 24, minute: value("minute") };
}

export function minutesInTimezone(date: Date, timezone: string): number {
  const parts = timeParts(date, timezone);
  return parts.hour * 60 + parts.minute;
}

function formatEntryTime(
  date: Date,
  timezone: string,
  timeFormat: WorkspaceSettings["timeFormat"],
): string {
  return entryTimeFormatter(timezone, timeFormat).format(date);
}

function completedItemIsVisible(
  item: OrganatoItem,
  settings: WorkspaceSettings,
  now: Date,
): boolean {
  if (item.workingStatus !== "completed") return true;
  if (settings.completedVisibility === "immediately") return false;
  const completedAt = new Date(
    item.completedAt ?? item.updatedAt ?? item.dueAt ?? now,
  );
  if (settings.completedVisibility === "seven_days") {
    return completedAt.getTime() >= now.getTime() - 7 * 86_400_000;
  }
  return (
    localDateKey(completedAt, settings.timezone) ===
    todayKey(settings.timezone, now)
  );
}

function typeMatches(
  type: CalendarEntryType,
  selected: CalendarTypeFilter[],
): boolean {
  if (!selected.length) return true;
  if (type === "both") {
    return selected.includes("assignment") || selected.includes("checkpoint");
  }
  return selected.includes(type);
}

function statusMatches(
  status: ReturnType<typeof visibleStatus>,
  selected: CalendarStatusFilter[],
): boolean {
  if (!selected.length) return true;
  if (status === "overdue") return selected.includes("overdue");
  if (status === "completed") return selected.includes("completed");
  if (status === "submitted") return selected.includes("submitted");
  return selected.includes("active");
}

export function buildCalendarEntries(
  items: OrganatoItem[],
  subjectsById: Map<string, Subject>,
  settings: WorkspaceSettings,
  filters: CalendarFilters,
  now = new Date(),
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];
  for (const item of items) {
    if (item.archivedAt || (!item.dueAt && !item.dueDateLocal)) continue;
    if (!completedItemIsVisible(item, settings, now)) continue;
    const type = entryType(item);
    if (!filters.showTodos && type === "todo") continue;
    if (!typeMatches(type, filters.types)) continue;
    if (
      filters.subjectIds.length &&
      (!item.subjectId || !filters.subjectIds.includes(item.subjectId))
    ) {
      continue;
    }
    if (
      filters.priorities.length &&
      (!item.priority || !filters.priorities.includes(item.priority))
    ) {
      continue;
    }
    const status = visibleStatus(item, now, settings.timezone);
    if (!statusMatches(status, filters.statuses)) continue;

    const instant = item.dueAt ? new Date(item.dueAt) : null;
    const isAllDay = !item.dueHasExplicitTime || !instant;
    const parts = instant ? timeParts(instant, settings.timezone) : null;
    const subject = item.subjectId
      ? (subjectsById.get(item.subjectId) ?? null)
      : null;
    entries.push({
      item,
      dateKey:
        item.dueDateLocal ??
        (instant ? localDateKey(instant, settings.timezone) : ""),
      isAllDay,
      startMinutes: isAllDay || !parts ? null : parts.hour * 60 + parts.minute,
      timeLabel:
        isAllDay || !instant
          ? "All day"
          : formatEntryTime(instant, settings.timezone, settings.timeFormat),
      type,
      subject,
      subjectColour: subject?.colour ?? "#71717a",
      visibleStatus: status,
      isCompleted: item.workingStatus === "completed",
    });
  }
  return entries.toSorted(compareCalendarEntries);
}

export function compareCalendarEntries(
  left: CalendarEntry,
  right: CalendarEntry,
): number {
  if (left.dateKey !== right.dateKey) {
    return left.dateKey.localeCompare(right.dateKey);
  }
  if (left.isAllDay !== right.isAllDay) return left.isAllDay ? -1 : 1;
  const timeDifference = (left.startMinutes ?? -1) - (right.startMinutes ?? -1);
  if (timeDifference !== 0) return timeDifference;
  const priorityRank: Record<string, number> = {
    urgent: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  const priorityDifference =
    (priorityRank[right.item.priority ?? ""] ?? 0) -
    (priorityRank[left.item.priority ?? ""] ?? 0);
  if (priorityDifference !== 0) return priorityDifference;
  return left.item.displayName.localeCompare(right.item.displayName);
}

export function entriesByDate(
  entries: CalendarEntry[],
): Map<string, CalendarEntry[]> {
  const grouped = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const current = grouped.get(entry.dateKey);
    if (current) current.push(entry);
    else grouped.set(entry.dateKey, [entry]);
  }
  return grouped;
}

export function monthDates(anchorKey: string, weekStartsOn: 0 | 1): Date[] {
  const anchor = dateFromKey(anchorKey);
  const first = startOfWeek(startOfMonth(anchor), { weekStartsOn });
  const last = endOfWeek(endOfMonth(anchor), { weekStartsOn });
  const length = differenceInCalendarDays(last, first) + 1;
  return Array.from({ length }, (_, index) => addDays(first, index));
}

export function weekDates(anchorKey: string, weekStartsOn: 0 | 1): Date[] {
  const first = startOfWeek(dateFromKey(anchorKey), { weekStartsOn });
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

export function rangeTitle(
  anchorKey: string,
  view: CalendarView,
  weekStartsOn: 0 | 1,
): string {
  const anchor = dateFromKey(anchorKey);
  if (view !== "week") return format(anchor, "MMMM yyyy");
  const first = startOfWeek(anchor, { weekStartsOn });
  const last = endOfWeek(anchor, { weekStartsOn });
  if (first.getFullYear() !== last.getFullYear()) {
    return `${format(first, "d MMM yyyy")} – ${format(last, "d MMM yyyy")}`;
  }
  if (first.getMonth() !== last.getMonth()) {
    return `${format(first, "d MMM")} – ${format(last, "d MMM yyyy")}`;
  }
  return `${format(first, "d")}–${format(last, "d MMMM yyyy")}`;
}

export function moveAnchor(
  anchorKey: string,
  view: CalendarView,
  amount: number,
): string {
  const anchor = dateFromKey(anchorKey);
  return dateKeyFromDate(
    view === "week" ? addWeeks(anchor, amount) : addMonths(anchor, amount),
  );
}

export function weekdayLabels(weekStartsOn: 0 | 1): string[] {
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return weekStartsOn === 1 ? [...labels.slice(1), labels[0]!] : labels;
}

function timezoneOffsetMinutes(date: Date, timezone: string): number {
  const value =
    new Intl.DateTimeFormat("en-AU", {
      timeZone: timezone,
      timeZoneName: "longOffset",
      hour: "2-digit",
    })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = value.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0));
}

export function localDateTimeToIso(
  dateKey: string,
  time: string,
  timezone: string,
): string {
  const [year = 0, month = 1, day = 1] = dateKey.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  let guess = new Date(wallClock);
  let offset = timezoneOffsetMinutes(guess, timezone);
  guess = new Date(wallClock - offset * 60_000);
  offset = timezoneOffsetMinutes(guess, timezone);
  return new Date(wallClock - offset * 60_000).toISOString();
}

function minutesToTime(minutes: number): string {
  const bounded = Math.max(
    0,
    Math.min(23 * 60 + 59, Math.round(minutes / 15) * 15),
  );
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(
    bounded % 60,
  ).padStart(2, "0")}`;
}

export function rescheduleEntry(
  entry: CalendarEntry,
  targetDateKey: string,
  timezone: string,
  targetMinutes = entry.startMinutes,
): Pick<
  OrganatoItem,
  "dueAt" | "dueDateLocal" | "dueHasExplicitTime" | "calendarSyncState"
> {
  if (entry.isAllDay && targetMinutes === null) {
    return {
      dueAt: null,
      dueDateLocal: targetDateKey,
      dueHasExplicitTime: false,
      calendarSyncState: "pending",
    };
  }
  const minutes = targetMinutes ?? 9 * 60;
  return {
    dueAt: localDateTimeToIso(targetDateKey, minutesToTime(minutes), timezone),
    dueDateLocal: null,
    dueHasExplicitTime: true,
    calendarSyncState: "pending",
  };
}

export function filtersActiveCount(filters: CalendarFilters): number {
  return (
    filters.types.length +
    filters.subjectIds.length +
    filters.priorities.length +
    filters.statuses.length +
    (filters.showTodos ? 0 : 1)
  );
}

export function calendarEntryTypeLabel(type: CalendarEntryType): string {
  if (type === "both") return "Assignment and checkpoint";
  return `${type[0]?.toUpperCase() ?? ""}${type.slice(1)}`;
}
