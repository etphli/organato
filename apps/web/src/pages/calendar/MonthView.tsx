import {
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { format } from "date-fns";
import { CalendarEvent } from "./CalendarEvent";
import {
  dateFromKey,
  dateKeyFromDate,
  weekdayLabels,
  type CalendarEntry,
} from "./model";
import { useDialogFocus } from "../../components/useDialogFocus";

export function MonthView({
  anchorKey,
  dates,
  entries,
  selectedDateKey,
  todayDateKey,
  weekStartsOn,
  dragEnabled,
  filtersActive,
  onSelectDate,
  onCreate,
  onOpenEntry,
  onMoveEntry,
  onClearFilters,
}: {
  anchorKey: string;
  dates: Date[];
  entries: Map<string, CalendarEntry[]>;
  selectedDateKey: string;
  todayDateKey: string;
  weekStartsOn: 0 | 1;
  dragEnabled: boolean;
  filtersActive: boolean;
  onSelectDate(dateKey: string): void;
  onCreate(dateKey: string): void;
  onOpenEntry(entry: CalendarEntry): void;
  onMoveEntry(entry: CalendarEntry, dateKey: string): void;
  onClearFilters(): void;
}) {
  const [overflowDateKey, setOverflowDateKey] = useState<string | null>(null);
  const overflowDialogRef = useRef<HTMLDivElement>(null);
  const overflowCloseRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(
    overflowDateKey !== null,
    overflowDialogRef,
    overflowCloseRef,
    overflowDateKey ?? "closed",
  );
  const monthKey = anchorKey.slice(0, 7);
  const visibleDateKeys = new Set(dates.map(dateKeyFromDate));
  const visibleEntryCount = Array.from(entries).reduce(
    (total, [dateKey, dayEntries]) =>
      total + (visibleDateKeys.has(dateKey) ? dayEntries.length : 0),
    0,
  );
  const selectedEntries = entries.get(selectedDateKey) ?? [];
  // O(1) drag-drop lookup instead of flattening every entry on each drop.
  const entryByItemId = useMemo(() => {
    const index = new Map<string, CalendarEntry>();
    for (const dayEntries of entries.values()) {
      for (const entry of dayEntries) {
        if (!index.has(entry.item.id)) index.set(entry.item.id, entry);
      }
    }
    return index;
  }, [entries]);

  const focusDate = (
    event: KeyboardEvent<HTMLButtonElement>,
    dateKey: string,
  ) => {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const target = new Date(dateFromKey(dateKey));
    target.setDate(target.getDate() + offset);
    const targetKey = dateKeyFromDate(target);
    document
      .querySelector<HTMLButtonElement>(`[data-oc-date="${targetKey}"]`)
      ?.focus();
  };
  const closeOverflow = () => setOverflowDateKey(null);
  const weeks: Date[][] = [];
  for (let index = 0; index < dates.length; index += 7) {
    weeks.push(dates.slice(index, index + 7));
  }

  return (
    <section
      className="oc-month"
      aria-label={`${format(dateFromKey(anchorKey), "MMMM yyyy")} calendar`}
    >
      <div className="oc-month__weekdays" aria-hidden="true">
        {weekdayLabels(weekStartsOn).map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="oc-month__grid" role="grid" aria-label="Month days">
        {weeks.map((week, weekIndex) => (
          <div
            key={`week-${week[0] ? dateKeyFromDate(week[0]) : weekIndex}`}
            className="oc-month__week"
            role="row"
          >
            {week.map((date) => {
              const dateKey = dateKeyFromDate(date);
              const dayEntries = entries.get(dateKey) ?? [];
              const outside = !dateKey.startsWith(monthKey);
              const isToday = dateKey === todayDateKey;
              const isSelected = dateKey === selectedDateKey;
              const hiddenCount = Math.max(0, dayEntries.length - 3);
              return (
                <div
                  className={`oc-month-day${outside ? " is-outside" : ""}${
                    isToday ? " is-today" : ""
                  }${isSelected ? " is-selected" : ""}`}
                  key={dateKey}
                  role="gridcell"
                  aria-selected={isSelected}
                  onClick={() => {
                    onSelectDate(dateKey);
                  }}
                  onDragOver={(event) => {
                    if (dragEnabled) event.preventDefault();
                  }}
                  onDrop={(event: DragEvent<HTMLDivElement>) => {
                    if (!dragEnabled) return;
                    event.preventDefault();
                    const itemId = event.dataTransfer.getData(
                      "application/x-organato-item",
                    );
                    const entry = entryByItemId.get(itemId);
                    if (entry) onMoveEntry(entry, dateKey);
                  }}
                >
                  <button
                    type="button"
                    className="oc-day-number"
                    data-oc-date={dateKey}
                    tabIndex={isSelected ? 0 : -1}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={`${format(date, "EEEE d MMMM yyyy")}${dayEntries.length ? `, ${dayEntries.length} scheduled` : ", nothing scheduled"}`}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Escape" &&
                        overflowDateKey === dateKey
                      ) {
                        event.stopPropagation();
                        closeOverflow();
                        return;
                      }
                      focusDate(event, dateKey);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectDate(dateKey);
                    }}
                  >
                    {date.getDate()}
                  </button>
                  <button
                    type="button"
                    className="oc-day-add"
                    aria-label={`Add todo on ${format(date, "d MMMM")}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectDate(dateKey);
                      onCreate(dateKey);
                    }}
                  >
                    +
                  </button>
                  <div className="oc-day-events">
                    {dayEntries.slice(0, 3).map((entry) => (
                      <CalendarEvent
                        key={entry.item.id}
                        entry={entry}
                        variant="month"
                        draggable={dragEnabled}
                        onDragStart={(event) => {
                          event.stopPropagation();
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(
                            "application/x-organato-item",
                            entry.item.id,
                          );
                        }}
                        onOpen={() => onOpenEntry(entry)}
                      />
                    ))}
                    {hiddenCount ? (
                      <button
                        type="button"
                        className="oc-more-events"
                        onClick={(event) => {
                          event.stopPropagation();
                          setOverflowDateKey(dateKey);
                        }}
                      >
                        +{hiddenCount} more
                      </button>
                    ) : null}
                  </div>
                  {overflowDateKey === dateKey ? (
                    <div
                      ref={overflowDialogRef}
                      className="oc-day-popover"
                      role="dialog"
                      aria-label={`Items on ${format(date, "d MMMM")}`}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          closeOverflow();
                        }
                      }}
                    >
                      <header>
                        <strong>{format(date, "EEEE d MMMM")}</strong>
                        <button
                          ref={overflowCloseRef}
                          type="button"
                          onClick={() => closeOverflow()}
                          aria-label={`Close items on ${format(date, "d MMMM")}`}
                        >
                          ×
                        </button>
                      </header>
                      <div>
                        {dayEntries.map((entry) => (
                          <CalendarEvent
                            key={entry.item.id}
                            entry={entry}
                            variant="overflow"
                            onOpen={() => {
                              setOverflowDateKey(null);
                              onOpenEntry(entry);
                            }}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        className="oc-day-popover__add"
                        onClick={() => {
                          setOverflowDateKey(null);
                          onCreate(dateKey);
                        }}
                      >
                        + Add todo
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="oc-month-mobile-agenda">
        <header>
          <strong>{format(dateFromKey(selectedDateKey), "EEEE d MMMM")}</strong>
          <button type="button" onClick={() => onCreate(selectedDateKey)}>
            + Add todo
          </button>
        </header>
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
          <p>Nothing due this day.</p>
        )}
      </div>
      {!visibleEntryCount ? (
        <div className="oc-range-empty" role="status">
          <p>
            {filtersActive
              ? "No items match these filters."
              : `Nothing scheduled for ${format(
                  dateFromKey(anchorKey),
                  "MMMM",
                )}.`}
          </p>
          <button
            type="button"
            onClick={
              filtersActive ? onClearFilters : () => onCreate(selectedDateKey)
            }
          >
            {filtersActive ? "Clear filters" : "Add a todo"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
