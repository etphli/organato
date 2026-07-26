import type { CSSProperties, DragEvent, MouseEvent } from "react";
import { format } from "date-fns";
import { CalendarEvent } from "./CalendarEvent";
import {
  dateKeyFromDate,
  minutesInTimezone,
  type CalendarEntry,
} from "./model";

const startHour = 7;
const endHour = 24;
const visibleMinutes = (endHour - startHour) * 60;
const hours = Array.from(
  { length: endHour - startHour + 1 },
  (_, index) => startHour + index,
);

function minuteFromPointer(
  event: MouseEvent<HTMLElement> | DragEvent<HTMLElement>,
): number {
  const bounds = event.currentTarget.getBoundingClientRect();
  const ratio = Math.max(
    0,
    Math.min(1, (event.clientY - bounds.top) / bounds.height),
  );
  return Math.min(
    23 * 60 + 45,
    Math.max(
      startHour * 60,
      Math.round((startHour * 60 + ratio * visibleMinutes) / 15) * 15,
    ),
  );
}

export function WeekView({
  dates,
  entries,
  selectedDateKey,
  todayDateKey,
  timezone,
  dragEnabled,
  filtersActive,
  onSelectDate,
  onCreate,
  onOpenEntry,
  onMoveEntry,
  onClearFilters,
}: {
  dates: Date[];
  entries: Map<string, CalendarEntry[]>;
  selectedDateKey: string;
  todayDateKey: string;
  timezone: string;
  dragEnabled: boolean;
  filtersActive: boolean;
  onSelectDate(dateKey: string): void;
  onCreate(dateKey: string, minutes: number | null): void;
  onOpenEntry(entry: CalendarEntry): void;
  onMoveEntry(
    entry: CalendarEntry,
    dateKey: string,
    minutes: number | null,
  ): void;
  onClearFilters(): void;
}) {
  const weekKeys = dates.map(dateKeyFromDate);
  const visibleEntries = weekKeys.flatMap(
    (dateKey) => entries.get(dateKey) ?? [],
  );
  const now = new Date();
  const nowDateKey = todayDateKey;
  const currentMinutes = minutesInTimezone(now, timezone);
  const currentTop = ((currentMinutes - startHour * 60) / visibleMinutes) * 100;
  const selectedEntries = entries.get(selectedDateKey) ?? [];

  const findDragged = (event: DragEvent<HTMLElement>) => {
    const itemId = event.dataTransfer.getData("application/x-organato-item");
    return visibleEntries.find((entry) => entry.item.id === itemId);
  };

  return (
    <section className="oc-week" aria-label="Week calendar">
      <div className="oc-week__header">
        <span aria-hidden="true" />
        {dates.map((date) => {
          const dateKey = dateKeyFromDate(date);
          const isToday = dateKey === todayDateKey;
          const isSelected = dateKey === selectedDateKey;
          return (
            <button
              type="button"
              key={dateKey}
              className={`${isToday ? "is-today" : ""}${
                isSelected ? " is-selected" : ""
              }`}
              onClick={() => onSelectDate(dateKey)}
              aria-current={isToday ? "date" : undefined}
            >
              <span>{format(date, "EEE")}</span>
              <strong>{date.getDate()}</strong>
            </button>
          );
        })}
      </div>
      <div className="oc-week__all-day">
        <span>All day</span>
        {dates.map((date) => {
          const dateKey = dateKeyFromDate(date);
          const allDayEntries = (entries.get(dateKey) ?? []).filter(
            (entry) => entry.isAllDay,
          );
          return (
            <div
              key={dateKey}
              onClick={() => {
                onSelectDate(dateKey);
                onCreate(dateKey, null);
              }}
              onDragOver={(event) => {
                if (dragEnabled) event.preventDefault();
              }}
              onDrop={(event) => {
                if (!dragEnabled) return;
                event.preventDefault();
                const entry = findDragged(event);
                if (entry) onMoveEntry(entry, dateKey, null);
              }}
            >
              {allDayEntries.map((entry) => (
                <CalendarEvent
                  key={entry.item.id}
                  entry={entry}
                  variant="week"
                  draggable={dragEnabled}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    event.dataTransfer.setData(
                      "application/x-organato-item",
                      entry.item.id,
                    );
                  }}
                  onOpen={() => onOpenEntry(entry)}
                />
              ))}
            </div>
          );
        })}
      </div>
      <div className="oc-week__scroll">
        <div className="oc-week__time-axis" aria-hidden="true">
          {hours.map((hour) => (
            <span
              key={hour}
              style={
                {
                  "--oc-hour-position": `${
                    ((hour - startHour) / (endHour - startHour)) * 100
                  }%`,
                } as CSSProperties
              }
            >
              {hour === 24 ? "" : `${String(hour).padStart(2, "0")}:00`}
            </span>
          ))}
        </div>
        <div className="oc-week__days">
          {dates.map((date) => {
            const dateKey = dateKeyFromDate(date);
            const timedEntries = (entries.get(dateKey) ?? []).filter(
              (entry) => !entry.isAllDay,
            );
            return (
              <div
                className="oc-week-day-column"
                key={dateKey}
                role="button"
                tabIndex={0}
                aria-label={`Add timed todo on ${format(date, "EEEE d MMMM")}`}
                onClick={(event) => {
                  const minutes = minuteFromPointer(event);
                  onSelectDate(dateKey);
                  onCreate(dateKey, minutes);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onSelectDate(dateKey);
                    onCreate(dateKey, 9 * 60);
                  }
                }}
                onDragOver={(event) => {
                  if (dragEnabled) event.preventDefault();
                }}
                onDrop={(event) => {
                  if (!dragEnabled) return;
                  event.preventDefault();
                  const entry = findDragged(event);
                  if (entry) {
                    onMoveEntry(entry, dateKey, minuteFromPointer(event));
                  }
                }}
              >
                {dateKey === nowDateKey &&
                currentTop >= 0 &&
                currentTop <= 100 ? (
                  <span
                    className="oc-current-time"
                    style={{ top: `${currentTop}%` }}
                    aria-hidden="true"
                  />
                ) : null}
                {timedEntries.map((entry, index) => {
                  const top =
                    ((Math.max(
                      startHour * 60,
                      Math.min(endHour * 60, entry.startMinutes ?? 0),
                    ) -
                      startHour * 60) /
                      visibleMinutes) *
                    100;
                  const collisions = timedEntries
                    .slice(0, index)
                    .filter(
                      (candidate) =>
                        Math.abs(
                          (candidate.startMinutes ?? 0) -
                            (entry.startMinutes ?? 0),
                        ) < 25,
                    ).length;
                  return (
                    <div
                      className="oc-week-event-slot"
                      key={entry.item.id}
                      style={
                        {
                          "--oc-event-top": `${top}%`,
                          "--oc-collision": collisions,
                        } as CSSProperties
                      }
                    >
                      <CalendarEvent
                        entry={entry}
                        variant="week"
                        draggable={dragEnabled}
                        onDragStart={(event) => {
                          event.stopPropagation();
                          event.dataTransfer.setData(
                            "application/x-organato-item",
                            entry.item.id,
                          );
                        }}
                        onOpen={() => onOpenEntry(entry)}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="oc-week-mobile-agenda">
        <h2>
          {format(new Date(`${selectedDateKey}T12:00:00`), "EEEE d MMMM")}
        </h2>
        {selectedEntries.length ? (
          selectedEntries.map((entry) => (
            <CalendarEvent
              key={entry.item.id}
              entry={entry}
              variant="agenda"
              onOpen={() => onOpenEntry(entry)}
            />
          ))
        ) : (
          <div className="oc-inline-empty">
            <p>Nothing due this day.</p>
            <button
              type="button"
              onClick={() => onCreate(selectedDateKey, null)}
            >
              Add a todo
            </button>
          </div>
        )}
      </div>
      {!visibleEntries.length ? (
        <div className="oc-week-empty" role="status">
          <p>
            {filtersActive
              ? "No items match these filters."
              : "Nothing scheduled this week."}
          </p>
          <button
            type="button"
            onClick={
              filtersActive
                ? onClearFilters
                : () => onCreate(selectedDateKey, null)
            }
          >
            {filtersActive ? "Clear filters" : "Add a todo"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
