import {
  itemDeadline,
  localDateKey,
  type OrganatoItem,
  type Subject,
} from "@organato/domain";
import type { CalendarEventProjection } from "./contracts";

function escapeDescription(value: string): string {
  return value.replaceAll("\r", "").trim();
}

function nextLocalDate(localDate: string): string {
  const next = new Date(`${localDate}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function projectCalendarEvent(
  item: OrganatoItem,
  subject: Subject | undefined,
  appOrigin: string,
): CalendarEventProjection | null {
  const deadline = itemDeadline(item);
  if (!deadline || item.archivedAt || !item.calendarEnabled) return null;
  const allDayDate =
    !item.dueHasExplicitTime && (item.dueDateLocal ?? localDateKey(deadline));
  const start = item.dueHasExplicitTime
    ? { dateTime: deadline.toISOString(), timeZone: "Australia/Sydney" }
    : { date: allDayDate || localDateKey(deadline) };
  const end = item.dueHasExplicitTime
    ? {
        dateTime: new Date(deadline.getTime() + 30 * 60_000).toISOString(),
        timeZone: "Australia/Sydney",
      }
    : { date: nextLocalDate(allDayDate || localDateKey(deadline)) };
  const type =
    item.kind === "todo"
      ? "Todo"
      : item.classification === "both"
        ? "Assignment + checkpoint"
        : item.classification[0]?.toUpperCase() + item.classification.slice(1);
  const protectedLines = [
    type,
    subject?.displayName ? `Subject: ${subject.displayName}` : null,
    item.priority ? `Priority: ${item.priority}` : null,
    `Organato: ${appOrigin}/items/${item.id}`,
    item.canvasHtmlUrl ? `Canvas: ${item.canvasHtmlUrl}` : null,
  ].filter(Boolean);
  return {
    itemId: item.id,
    itemVersion: item.version,
    summary: item.displayName,
    start,
    end,
    description: [
      "— Organato (managed) —",
      ...protectedLines,
      "",
      "— Your calendar note —",
      escapeDescription(item.calendarNote),
    ].join("\n"),
    privateProperties: {
      organatoItemId: item.id,
      organatoItemVersion: String(item.version),
      organatoSchemaVersion: "1",
      organatoSourceType: item.sourceType,
    },
  };
}
