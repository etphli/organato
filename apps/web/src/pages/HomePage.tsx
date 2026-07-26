import { ExternalLink, MoreHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import {
  addDays,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  compareItems,
  daysRemainingLabel,
  isInView,
  type Classification,
} from "@organato/domain";
import { PageHeader } from "../components/PageHeader";
import { SubjectDot } from "../components/SubjectDot";
import { useOrganato } from "../state/OrganatoProvider";

const today = new Date();

function ClassificationInbox() {
  const { items, subjectsById, settings, dispatch } = useOrganato();
  const unclassified = items.filter(
    (item) =>
      item.kind === "work" &&
      item.classification === "unclassified" &&
      !item.archivedAt,
  );
  const active = unclassified[0];
  if (!active)
    return (
      <p className="classification-empty">
        Nothing to classify. Canvas is up to date.
      </p>
    );
  const classify = (classification: Classification) =>
    dispatch({ type: "classify", id: active.id, classification });
  return (
    <section
      className="classification-band"
      aria-labelledby="classification-title"
    >
      <div className="classification-count">
        <h2 id="classification-title">
          {unclassified.length} items to classify
        </h2>
        <button className="icon-button" aria-label="Classification options">
          <MoreHorizontal size={17} />
        </button>
      </div>
      <div className="classification-main">
        <SubjectDot subjectId={active.subjectId} />
        <div className="classification-copy">
          <button
            className="row-title"
            onClick={() => dispatch({ type: "select", id: active.id })}
          >
            {active.displayName}
          </button>
          <p>
            {subjectsById.get(active.subjectId ?? "")?.displayName}{" "}
            {active.dueAt ? (
              <>
                <span>·</span>{" "}
                {format(new Date(active.dueAt), "EEE d MMM · h:mm a")}{" "}
              </>
            ) : null}
            <span>·</span>{" "}
            <a
              href={active.canvasHtmlUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Canvas <ExternalLink size={11} />
            </a>
          </p>
        </div>
      </div>
      <div className="classification-actions">
        <button
          className="focused-action"
          onClick={() => classify("assignment")}
        >
          Assignment
        </button>
        <button onClick={() => classify("checkpoint")}>Checkpoint</button>
        <button onClick={() => classify("both")}>Both</button>
        <button
          onClick={() => dispatch({ type: "toast", message: "Kept for later" })}
        >
          Later
        </button>
        <span className="keyboard-hint">Tab / ↵ to navigate</span>
      </div>
      {settings.autoExpandClassification
        ? unclassified.slice(1).map((item) => (
            <button
              className="queued-classification"
              key={item.id}
              onClick={() => dispatch({ type: "select", id: item.id })}
            >
              <SubjectDot subjectId={item.subjectId} />
              <span>{item.displayName}</span>
              <small>
                {subjectsById.get(item.subjectId ?? "")?.displayName} ·{" "}
                {daysRemainingLabel(
                  item.dueAt ? new Date(item.dueAt) : null,
                  today,
                )}
              </small>
              <MoreHorizontal size={15} />
            </button>
          ))
        : null}
    </section>
  );
}

function MiniCalendar() {
  const monthStart = startOfMonth(today);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarDays = Array.from({ length: 35 }, (_, index) =>
    addDays(gridStart, index),
  );
  return (
    <section
      className="mini-calendar"
      aria-label={format(monthStart, "MMMM yyyy")}
    >
      <header>
        <h2>{format(monthStart, "MMMM yyyy")}</h2>
        <div>
          <button aria-label="Previous month">‹</button>
          <button aria-label="Next month">›</button>
        </div>
      </header>
      <div className="calendar-weekdays">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="mini-calendar-grid">
        {calendarDays.map((day) => (
          <button
            className={`${isSameDay(day, today) ? "today" : ""}${
              !isSameMonth(day, monthStart) ? " muted" : ""
            }`}
            key={day.toISOString()}
          >
            {day.getDate()}
            {isSameDay(day, today) ? <span /> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

function TodayList() {
  const { items, subjectsById, settings, dispatch } = useOrganato();
  const [name, setName] = useState("");
  const todos = items
    .filter((item) => item.kind === "todo" && !item.archivedAt)
    .slice(0, 3);
  const create = () => {
    if (!name.trim()) return;
    dispatch({ type: "addTodo", name: name.trim() });
    setName("");
  };
  return (
    <section className="today-list">
      <header>
        <h2>Today</h2>
        <span>{todos.length} todos</span>
      </header>
      {settings.showQuickTodo ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Add a todo…"
            aria-label="Quick add todo"
          />
        </form>
      ) : null}
      {todos.map((todo) => (
        <div className="today-row" key={todo.id}>
          <input
            type="checkbox"
            checked={todo.workingStatus === "completed"}
            onChange={(event) =>
              dispatch({
                type: "patchItem",
                id: todo.id,
                patch: {
                  workingStatus: event.target.checked
                    ? "completed"
                    : "not_started",
                  completedAt: event.target.checked
                    ? new Date().toISOString()
                    : null,
                },
              })
            }
            aria-label={`Complete ${todo.displayName}`}
          />
          <button onClick={() => dispatch({ type: "select", id: todo.id })}>
            {todo.displayName}
          </button>
          <span>
            <SubjectDot subjectId={todo.subjectId} />
            {subjectsById.get(todo.subjectId ?? "")?.displayName}
          </span>
          <MoreHorizontal size={15} aria-hidden="true" />
        </div>
      ))}
    </section>
  );
}

function UpcomingList({ page }: { page: "assignments" | "checkpoints" }) {
  const { items, subjectsById, settings, dispatch } = useOrganato();
  const limit =
    page === "assignments"
      ? settings.upcomingAssignmentCount
      : settings.upcomingCheckpointCount;
  const upcoming = useMemo(
    () =>
      items
        .filter(
          (item) =>
            item.kind === "work" &&
            !item.archivedAt &&
            isInView(item.classification, page) &&
            (settings.includeBothInPanels || item.classification !== "both"),
        )
        .toSorted((a, b) => compareItems(a, b, today))
        .slice(0, limit),
    [items, limit, page, settings.includeBothInPanels],
  );
  return (
    <section className="upcoming-list">
      <h2>Upcoming {page}</h2>
      <div className="upcoming-head">
        <span>Title</span>
        <span>Subject</span>
        <span>Due</span>
      </div>
      {upcoming.map((item) => (
        <button
          key={item.id}
          onClick={() => dispatch({ type: "select", id: item.id })}
        >
          <span className="upcoming-name">
            <SubjectDot subjectId={item.subjectId} />
            {item.displayName}
          </span>
          <span>{subjectsById.get(item.subjectId ?? "")?.displayName}</span>
          <span>
            <strong>
              {daysRemainingLabel(
                item.dueAt ? new Date(item.dueAt) : null,
                today,
              )}
            </strong>
            <small>
              {item.dueAt
                ? new Date(item.dueAt).toLocaleDateString("en-AU", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })
                : "No due date"}
            </small>
          </span>
        </button>
      ))}
      <a href={`/${page}`}>View all {page} →</a>
    </section>
  );
}

function WorkloadStrip() {
  const { items } = useOrganato();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index);
    const count = items.filter(
      (item) =>
        !item.archivedAt &&
        !["completed", "submitted"].includes(item.workingStatus) &&
        item.dueAt &&
        isSameDay(new Date(item.dueAt), date),
    ).length;
    const level =
      count === 0
        ? "Clear"
        : count === 1
          ? "Low"
          : count < 4
            ? "Medium"
            : "High";
    const colour =
      count === 0
        ? "var(--muted)"
        : count === 1
          ? "#7bd66a"
          : count < 4
            ? "#f59e0b"
            : "#f87171";
    return [format(date, "EEE d MMM"), level, count, colour] as const;
  });
  return (
    <section className="workload-strip">
      <h2>7-day workload</h2>
      <div>
        {days.map(([date, level, count, colour]) => (
          <span key={date}>
            <small>{date}</small>
            <strong>{level}</strong>
            <em>
              <i style={{ background: colour }} />
              {count} {count === 1 ? "item" : "items"}
            </em>
          </span>
        ))}
      </div>
    </section>
  );
}

export default function HomePage() {
  const { settings } = useOrganato();
  return (
    <div className="page home-page">
      <PageHeader title="Home" meta={format(today, "EEEE, d MMMM")} />
      <ClassificationInbox />
      <div
        className={`home-middle${settings.showMiniCalendar ? "" : " single"}`}
      >
        {settings.showMiniCalendar ? <MiniCalendar /> : null}
        <TodayList />
      </div>
      <div className="home-upcoming">
        <UpcomingList page="assignments" />
        <UpcomingList page="checkpoints" />
      </div>
      {settings.showWorkloadStrip ? <WorkloadStrip /> : null}
    </div>
  );
}
