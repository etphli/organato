import { ChevronLeft, ChevronRight, ExternalLink, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfWeek,
  format,
  isSameDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { PageHeader } from "../components/PageHeader";
import { SubjectDot } from "../components/SubjectDot";
import { useOrganato } from "../state/OrganatoProvider";

export default function CalendarPage() {
  const { items, subjectsById, settings, dispatch } = useOrganato();
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<"month" | "week" | "agenda">(() =>
    window.matchMedia("(max-width: 760px)").matches
      ? "agenda"
      : settings.calendarDefaultView,
  );
  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const monthDays = Array.from({ length: 42 }, (_, index) =>
    addDays(gridStart, index),
  );
  const dated = useMemo(
    () => items.filter((item) => !item.archivedAt && item.dueAt),
    [items],
  );
  const byDate = useMemo(() => {
    const map = new Map<string, typeof dated>();
    for (const item of dated) {
      const key = format(new Date(item.dueAt!), "yyyy-MM-dd");
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [dated]);
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(anchor, { weekStartsOn: 1 });
  const agenda = dated
    .filter((item) => {
      if (view !== "week") return true;
      const due = new Date(item.dueAt!);
      return due >= weekStart && due <= weekEnd;
    })
    .toSorted(
      (a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime(),
    );
  return (
    <div className="page calendar-page">
      <PageHeader
        title="Calendar"
        meta={format(anchor, "MMMM yyyy")}
        actions={
          <div
            className="view-switcher"
            role="group"
            aria-label="Calendar view"
          >
            {(["month", "week", "agenda"] as const).map((option) => (
              <button
                className={view === option ? "active" : ""}
                key={option}
                onClick={() => setView(option)}
              >
                {option}
              </button>
            ))}
          </div>
        }
      />
      <div className="calendar-toolbar">
        <div>
          <button
            aria-label="Previous period"
            onClick={() =>
              setAnchor((date) =>
                view === "month" ? addMonths(date, -1) : addWeeks(date, -1),
              )
            }
          >
            <ChevronLeft size={17} />
          </button>
          <button onClick={() => setAnchor(new Date())}>Today</button>
          <button
            aria-label="Next period"
            onClick={() =>
              setAnchor((date) =>
                view === "month" ? addMonths(date, 1) : addWeeks(date, 1),
              )
            }
          >
            <ChevronRight size={17} />
          </button>
        </div>
        <span>
          <i className="health-dot" /> Google Calendar connected · reconciled 3
          min ago
        </span>
        <a
          href="https://calendar.google.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Organato calendar <ExternalLink size={12} />
        </a>
      </div>
      {view === "month" ? (
        <section
          className="month-calendar"
          aria-label={`${format(anchor, "MMMM yyyy")} calendar`}
        >
          <div className="month-weekdays">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="month-grid">
            {monthDays.map((date) => {
              const key = format(date, "yyyy-MM-dd");
              const dayItems = byDate.get(key) ?? [];
              const outside = date.getMonth() !== anchor.getMonth();
              return (
                <div
                  className={`month-day${outside ? " outside" : ""}${
                    isSameDay(date, new Date()) ? " today" : ""
                  }`}
                  key={key}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    const itemId = event.dataTransfer.getData("text/plain");
                    const item = items.find((entry) => entry.id === itemId);
                    if (!item) return;
                    const old = item.dueAt ? new Date(item.dueAt) : date;
                    const moved = new Date(date);
                    moved.setHours(old.getHours(), old.getMinutes());
                    dispatch({
                      type: "patchItem",
                      id: item.id,
                      patch: {
                        dueAt: moved.toISOString(),
                        calendarSyncState: "pending",
                      },
                    });
                  }}
                >
                  <button
                    className="day-number"
                    onClick={() =>
                      dispatch({
                        type: "addTodo",
                        name: "New todo",
                        dueAt: date.toISOString(),
                      })
                    }
                  >
                    {date.getDate()}
                  </button>
                  <div className="day-events">
                    {dayItems.slice(0, 3).map((item) => (
                      <button
                        draggable
                        key={item.id}
                        onDragStart={(event) =>
                          event.dataTransfer.setData("text/plain", item.id)
                        }
                        onClick={() =>
                          dispatch({ type: "select", id: item.id })
                        }
                      >
                        <SubjectDot subjectId={item.subjectId} />
                        <span>{item.displayName}</span>
                        {item.dueHasExplicitTime ? (
                          <small>
                            {format(new Date(item.dueAt!), "h:mm a")}
                          </small>
                        ) : null}
                      </button>
                    ))}
                    {dayItems.length > 3 ? (
                      <small>+{dayItems.length - 3} more</small>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="agenda-list">
          <h2>
            {view === "week"
              ? `Week of ${format(
                  startOfWeek(anchor, { weekStartsOn: 1 }),
                  "d MMM",
                )}`
              : "Agenda"}
          </h2>
          {agenda.map((item) => (
            <button
              key={item.id}
              onClick={() => dispatch({ type: "select", id: item.id })}
            >
              <time>
                {format(new Date(item.dueAt!), "EEE d MMM")}
                <small>
                  {item.dueHasExplicitTime
                    ? format(new Date(item.dueAt!), "h:mm a")
                    : "All day"}
                </small>
              </time>
              <SubjectDot subjectId={item.subjectId} />
              <span>
                <strong>{item.displayName}</strong>
                <small>
                  {subjectsById.get(item.subjectId ?? "")?.displayName} ·{" "}
                  {item.kind === "todo" ? "Todo" : item.classification}
                </small>
              </span>
            </button>
          ))}
          <button
            className="agenda-new"
            onClick={() => dispatch({ type: "addTodo", name: "New todo" })}
          >
            <Plus size={16} /> Create todo
          </button>
        </section>
      )}
    </div>
  );
}
