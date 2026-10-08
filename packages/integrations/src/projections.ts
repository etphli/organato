import {
  itemDeadline,
  itemTypeLabel,
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
  timezone = "Australia/Sydney",
): CalendarEventProjection | null {
  const deadline = itemDeadline(item, timezone);
  if (!deadline || item.archivedAt || !item.calendarEnabled) return null;
  const allDayDate =
    !item.dueHasExplicitTime &&
    (item.dueDateLocal ?? localDateKey(deadline, timezone));
  const start = item.dueHasExplicitTime
    ? { dateTime: deadline.toISOString(), timeZone: timezone }
    : { date: allDayDate || localDateKey(deadline, timezone) };
  const end = item.dueHasExplicitTime
    ? {
        dateTime: new Date(deadline.getTime() + 30 * 60_000).toISOString(),
        timeZone: timezone,
      }
    : {
        date: nextLocalDate(allDayDate || localDateKey(deadline, timezone)),
      };
  const type = itemTypeLabel(item);
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
