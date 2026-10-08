import type { CSSProperties, DragEvent } from "react";
import {
  CalendarOff,
  CheckSquare2,
  CircleAlert,
  ClipboardList,
  Clock3,
  Flag,
  TriangleAlert,
} from "lucide-react";
import { calendarEntryTypeLabel, type CalendarEntry } from "./model";

function TypeIcon({ entry }: { entry: CalendarEntry }) {
  const props = { size: 11, strokeWidth: 1.8, "aria-hidden": true };
  if (entry.type === "todo") return <CheckSquare2 {...props} />;
  return <ClipboardList {...props} />;
}

function SyncStateIcon({ entry }: { entry: CalendarEntry }) {
  const props = { size: 11, strokeWidth: 1.8, "aria-hidden": true };
  if (
    !entry.item.calendarEnabled ||
    entry.item.calendarSyncState === "suppressed"
  ) {
    return <CalendarOff {...props} />;
  }
  if (entry.item.calendarSyncState === "pending") return <Clock3 {...props} />;
  if (entry.item.calendarSyncState === "conflict") {
    return <TriangleAlert {...props} />;
  }
  if (entry.item.calendarSyncState === "error") {
    return <CircleAlert {...props} />;
  }
  return null;
}

export function CalendarEvent({
  entry,
  variant,
  draggable = false,
  onOpen,
  onDragStart,
}: {
  entry: CalendarEntry;
  variant: "month" | "week" | "agenda" | "overflow";
  draggable?: boolean;
  onOpen(): void;
  onDragStart?(event: DragEvent<HTMLButtonElement>): void;
}) {
  const isDeadline = entry.item.kind === "work";
  const typeLabel = calendarEntryTypeLabel(entry.type);
  const syncState =
    !entry.item.calendarEnabled || entry.item.calendarSyncState === "suppressed"
      ? "not in Google Calendar"
      : entry.item.calendarSyncState === "synced"
        ? "synchronized"
        : entry.item.calendarSyncState;
  return (
    <button
      type="button"
      className={`oc-event oc-event--${variant}${
        isDeadline ? " oc-event--deadline" : ""
      }${entry.isCompleted ? " is-completed" : ""}`}
      style={{ "--oc-subject": entry.subjectColour } as CSSProperties}
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      aria-label={`${entry.item.displayName}, ${entry.timeLabel}, ${
        entry.subject?.displayName ?? "no subject"
      }, ${typeLabel}, ${syncState}`}
      title={`${entry.item.displayName} · ${entry.timeLabel}`}
    >
      {isDeadline ? (
        <span className="oc-event__rail" aria-hidden="true" />
      ) : (
        <span className="oc-event__dot" aria-hidden="true" />
      )}
      <span className="oc-event__copy">
        <span className="oc-event__primary">
          {!isDeadline && !entry.isAllDay ? (
            <time>{entry.timeLabel}</time>
          ) : null}
          <strong>{entry.item.displayName}</strong>
        </span>
        {isDeadline ? (
          <small>{entry.isAllDay ? "All day" : `Due ${entry.timeLabel}`}</small>
        ) : null}
      </span>
      <span className="oc-event__signals">
        {entry.item.priority === "high" || entry.item.priority === "urgent" ? (
          <Flag
            className={`oc-priority oc-priority--${entry.item.priority}`}
            size={11}
            strokeWidth={1.8}
            aria-label={`${entry.item.priority} priority`}
          />
        ) : null}
        <TypeIcon entry={entry} />
        <SyncStateIcon entry={entry} />
      </span>
    </button>
  );
}
