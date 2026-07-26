import {
  itemDeadline,
  type OrganatoItem,
  type Subject,
} from "@organato/domain";
import type { CalendarEventProjection } from "./contracts";

function escapeDescription(value: string): string {
  return value.replaceAll("\r", "").trim();
}

export function projectCalendarEvent(
  item: OrganatoItem,
  subject: Subject | undefined,
  appOrigin: string,
): CalendarEventProjection | null {
  const deadline = itemDeadline(item);
  if (!deadline || item.archivedAt || !item.calendarEnabled) return null;
  const start = item.dueHasExplicitTime
    ? { dateTime: deadline.toISOString(), timeZone: "Australia/Sydney" }
    : { date: item.dueDateLocal ?? deadline.toISOString().slice(0, 10) };
  const end = item.dueHasExplicitTime
    ? {
        dateTime: new Date(deadline.getTime() + 30 * 60_000).toISOString(),
        timeZone: "Australia/Sydney",
      }
    : { date: item.dueDateLocal ?? deadline.toISOString().slice(0, 10) };
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
      organatoSchemaVersion: "1",
      organatoSourceType: item.sourceType,
    },
  };
}
