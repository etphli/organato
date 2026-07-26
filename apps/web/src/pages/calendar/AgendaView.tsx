import { format } from "date-fns";
import { CalendarEvent } from "./CalendarEvent";
import { dateFromKey, type CalendarEntry } from "./model";

export function AgendaView({
  anchorKey,
  entries,
  selectedDateKey,
  todayDateKey,
  filtersActive,
  onSelectDate,
  onCreate,
  onOpenEntry,
  onClearFilters,
}: {
  anchorKey: string;
  entries: CalendarEntry[];
  selectedDateKey: string;
  todayDateKey: string;
  filtersActive: boolean;
  onSelectDate(dateKey: string): void;
  onCreate(dateKey: string): void;
  onOpenEntry(entry: CalendarEntry): void;
  onClearFilters(): void;
}) {
  const monthKey = anchorKey.slice(0, 7);
  const monthEntries = entries.filter((entry) =>
    entry.dateKey.startsWith(monthKey),
  );
  const grouped = new Map<string, CalendarEntry[]>();
  for (const entry of monthEntries) {
    const current = grouped.get(entry.dateKey);
    if (current) current.push(entry);
    else grouped.set(entry.dateKey, [entry]);
  }

  return (
    <section
      className="oc-agenda"
      aria-label={`${format(dateFromKey(anchorKey), "MMMM yyyy")} agenda`}
    >
      {monthEntries.length ? (
        Array.from(grouped).map(([dateKey, dayEntries]) => {
          const date = dateFromKey(dateKey);
          const isToday = dateKey === todayDateKey;
          return (
            <section
              className={`oc-agenda-day${
                dateKey === selectedDateKey ? " is-selected" : ""
              }`}
              key={dateKey}
            >
              <header>
                <button
                  type="button"
                  onClick={() => onSelectDate(dateKey)}
                  aria-current={isToday ? "date" : undefined}
                >
                  <strong>{isToday ? "Today" : format(date, "EEEE")}</strong>
                  <span>{format(date, "d MMMM")}</span>
                </button>
                <button type="button" onClick={() => onCreate(dateKey)}>
                  + Add todo
                </button>
              </header>
              <div>
                {dayEntries.map((entry) => (
                  <CalendarEvent
                    key={entry.item.id}
                    entry={entry}
                    variant="agenda"
                    onOpen={() => onOpenEntry(entry)}
                  />
                ))}
              </div>
            </section>
          );
        })
      ) : (
        <div className="oc-agenda-empty" role="status">
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
      )}
    </section>
  );
}
