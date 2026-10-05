import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MoreHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  addDays,
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  createItemComparator,
  dateOnlyCutoffUtc,
  daysRemainingLabel,
  isInView,
  localDateKey,
  visibleStatus,
  type Classification,
  type OrganatoItem,
} from "@organato/domain/core";
import { PageHeader } from "../components/PageHeader";
import { SubjectDot } from "../components/SubjectDot";
import { useOrganatoActions, useOrganatoData } from "../state/OrganatoProvider";

function useToday() {
  // Rolls over at local midnight so an overnight session never shows a
  // stale "today" in the calendar, lists, and workload strip.
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    let cancelled = false;
    const schedule = () => {
      const now = new Date();
      const midnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      timer = window.setTimeout(
        () => {
          if (!cancelled) {
            setToday(new Date());
            schedule();
          }
        },
        Math.max(1000, midnight.getTime() - now.getTime()),
      );
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);
  return today;
}

function itemDueDate(
  item: Pick<OrganatoItem, "dueAt" | "dueDateLocal">,
  timezone = "Australia/Sydney",
) {
  if (item.dueAt) return new Date(item.dueAt);
  if (item.dueDateLocal) return dateOnlyCutoffUtc(item.dueDateLocal, timezone);
  return null;
}

function movedCloserByCanvas(item: OrganatoItem, now: Date): boolean {
  const weekAgo = now.getTime() - 7 * 86_400_000;
  return (item.history ?? []).some((entry) => {
    if (entry.action !== "canvas_source_updated") return false;
    if (Date.parse(entry.createdAt) < weekAgo) return false;
    const before = Date.parse(String(entry.before?.dueAt ?? ""));
    const after = Date.parse(String(entry.after?.dueAt ?? ""));
    return Number.isFinite(before) && Number.isFinite(after) && after < before;
  });
}

function TopBriefing() {
  const { items, settings } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  const today = useToday();
  const top = useMemo(
    () =>
      items
        .filter(
          (item) =>
            !item.archivedAt &&
            item.workingStatus !== "completed" &&
            itemDueDate(item, settings.timezone),
        )
        .toSorted(createItemComparator(today, settings.timezone))
        .slice(0, 3),
    [items, settings.timezone, today],
  );
  if (!top.length) return null;
  return (
    <section className="top-briefing" aria-label="Top priorities">
      <h2>Start here</h2>
      <ol>
        {top.map((item, index) => {
          const overdue =
            visibleStatus(item, today, settings.timezone) === "overdue";
          const due = itemDueDate(item, settings.timezone);
          return (
            <li key={item.id}>
              <button
                onClick={() => dispatch({ type: "select", id: item.id })}
                title={
                  due
                    ? due.toLocaleDateString("en-AU", {
                        timeZone: settings.timezone,
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })
                    : undefined
                }
              >
                <span className="top-briefing-rank">{index + 1}</span>
                <SubjectDot subjectId={item.subjectId} />
                <span className="top-briefing-name">{item.displayName}</span>
                <small
                  className={
                    overdue ? "due-chip due-chip--overdue" : "due-chip"
                  }
                >
                  {daysRemainingLabel(due, today, settings.timezone)}
                </small>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function effortMinutes(item: OrganatoItem): number {
  if (item.estimatedMinutes) return item.estimatedMinutes;
  if (item.kind === "todo") return 15;
  if (item.classification === "checkpoint") return 30;
  if (item.classification === "both") return 150;
  return 120;
}

function ForecastStrip() {
  const { items, settings } = useOrganatoData();
  const today = useToday();
  const days = useMemo(() => {
    const buckets: Array<{ key: string; label: string; minutes: number }> = [];
    // Key buckets by workspace-local dates: UTC ISO slices shift work around
    // midnight for non-UTC timezones.
    const [year = 0, month = 1, dayOfMonth = 1] = localDateKey(
      today,
      settings.timezone,
    )
      .split("-")
      .map(Number);
    const anchor = new Date(Date.UTC(year, month - 1, dayOfMonth, 12));
    for (let offset = 0; offset < 14; offset += 1) {
      const day = new Date(anchor.getTime() + offset * 86_400_000);
      buckets.push({
        key: localDateKey(day, settings.timezone),
        label: day.toLocaleDateString("en-AU", {
          timeZone: settings.timezone,
          weekday: "narrow",
        }),
        minutes: 0,
      });
    }
    for (const item of items) {
      if (
        item.archivedAt ||
        item.workingStatus === "completed" ||
        item.workingStatus === "submitted"
      ) {
        continue;
      }
      const due = itemDueDate(item, settings.timezone);
      if (!due) continue;
      const key = localDateKey(due, settings.timezone);
      const bucket = buckets.find((entry) => entry.key === key);
      if (bucket) bucket.minutes += effortMinutes(item);
    }
    return buckets;
  }, [items, settings.timezone, today]);
  const max = Math.max(240, ...days.map((day) => day.minutes));
  const overloaded = days.filter((day) => day.minutes > 240);
  const total = days.reduce((sum, day) => sum + day.minutes, 0);
  if (!total) return null;
  return (
    <section className="forecast-strip" aria-label="Workload forecast">
      <h2>Next 14 days · estimated effort</h2>
      {overloaded.length ? (
        <p className="forecast-warning" role="status">
          Crunch {overloaded.length === 1 ? "day" : "days"}:{" "}
          {overloaded
            .map(
              (day) => `${day.key.slice(5)} (${Math.round(day.minutes / 60)}h)`,
            )
            .join(", ")}{" "}
          — start early. <Link to="/calendar">Open calendar</Link>
        </p>
      ) : null}
      <div className="forecast-bars" role="list" aria-label="Daily effort">
        {days.map((day) => (
          <div
            key={day.key}
            role="listitem"
            tabIndex={0}
            aria-label={`${day.key}: ${Math.round(day.minutes / 60)} hours estimated`}
            title={`${day.key}: ${day.minutes} min`}
          >
            <span
              aria-hidden="true"
              style={{ height: `${Math.max(2, (day.minutes / max) * 44)}px` }}
            />
            <small aria-hidden="true">{day.label}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function RiskStrip() {
  const { items, settings } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  const today = useToday();
  const risks = useMemo(() => {
    const now = today.getTime();
    const soon = now + 2 * 86_400_000;
    const stale = now - 2 * 86_400_000;
    const flagged: Array<{ item: OrganatoItem; reason: string }> = [];
    for (const item of items) {
      if (item.archivedAt || item.workingStatus === "completed") continue;
      // Overdue has its own section; risks cover what is quietly going wrong.
      if (visibleStatus(item, today, settings.timezone) === "overdue") continue;
      const due = itemDueDate(item, settings.timezone)?.getTime();
      if (due === undefined) continue;
      if (
        due <= soon &&
        item.workingStatus === "not_started" &&
        Date.parse(item.createdAt) < stale
      ) {
        flagged.push({ item, reason: "Due soon, not started" });
      } else if (movedCloserByCanvas(item, today)) {
        flagged.push({ item, reason: "Canvas moved it closer" });
      }
      if (flagged.length >= 5) break;
    }
    return flagged;
  }, [items, settings.timezone, today]);
  if (!risks.length) return null;
  return (
    <section className="risk-strip" aria-label="Deadline risks">
      <h2>Needs attention</h2>
      {risks.map(({ item, reason }) => (
        <button
          key={item.id}
          onClick={() => dispatch({ type: "select", id: item.id })}
        >
          <span>{item.displayName}</span>
          <small>{reason}</small>
        </button>
      ))}
    </section>
  );
}

function ClassificationInbox() {
  const { items, subjectsById, settings, integrations } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  const today = useToday();
  const [snoozedIds, setSnoozedIds] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(
        localStorage.getItem("organato-classification-snoozed") ?? "{}",
      ) as Record<string, number>;
    } catch {
      return {};
    }
  });
  const snoozeActive = (id: string): boolean => {
    const until = snoozedIds[id];
    return typeof until === "number" && until > Date.now();
  };
  const snoozeItem = (id: string) => {
    const next = { ...snoozedIds, [id]: Date.now() + 24 * 3_600_000 };
    setSnoozedIds(next);
    try {
      localStorage.setItem(
        "organato-classification-snoozed",
        JSON.stringify(next),
      );
    } catch {
      // Snooze still applies for this session when storage is unavailable.
    }
    dispatch({ type: "toast", message: "Hidden until tomorrow" });
  };
  const unclassified = items.filter(
    (item) =>
      item.kind === "work" &&
      item.classification === "unclassified" &&
      !item.archivedAt &&
      !snoozeActive(item.id),
  );
  const active = unclassified[0];
  const navigate = useNavigate();
  const [optionsOpen, setOptionsOpen] = useState(false);
  if (!active) {
    const canvas = integrations.find(
      (integration) => integration.provider === "canvas",
    );
    const message =
      canvas?.state === "disconnected"
        ? "Nothing to classify. Connect Reshet when you’re ready to import upcoming work."
        : canvas?.state === "action_needed"
          ? "Nothing to classify. Reshet needs attention in Settings."
          : "Nothing to classify. Reshet has no new work waiting.";
    return (
      <p className="classification-empty">
        {message}{" "}
        {canvas?.state === "disconnected" ? (
          <a href="/settings/canvas">Connect</a>
        ) : null}
      </p>
    );
  }
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
        <button
          type="button"
          className="icon-button"
          aria-label="Classification options"
          aria-expanded={optionsOpen}
          onClick={() => setOptionsOpen((value) => !value)}
        >
          <MoreHorizontal size={17} />
        </button>
        {optionsOpen ? (
          <div className="classification-options" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOptionsOpen(false);
                navigate("/settings/appearance");
              }}
            >
              Open classification settings
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOptionsOpen(false);
                if (active) snoozeItem(active.id);
              }}
            >
              Keep this item for later
            </button>
          </div>
        ) : null}
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
          onClick={() => {
            if (active) snoozeItem(active.id);
          }}
          title="Hide this item from the inbox until tomorrow"
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
  const { items, settings, subjectsById } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  const today = useToday();
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarDays = Array.from({ length: 42 }, (_, index) =>
    addDays(gridStart, index),
  );
  const activeItems = useMemo(
    () =>
      items.filter(
        (item) => !item.archivedAt && itemDueDate(item, settings.timezone),
      ),
    [items, settings.timezone],
  );
  const itemsByDate = useMemo(() => {
    const grouped = new Map<string, OrganatoItem[]>();
    activeItems.forEach((item) => {
      const due = itemDueDate(item, settings.timezone);
      const key =
        item.dueDateLocal ??
        (due ? localDateKey(due, settings.timezone) : null);
      if (!key) return;
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    });
    grouped.forEach((entries, key) => {
      grouped.set(
        key,
        entries.toSorted(createItemComparator(today, settings.timezone)),
      );
    });
    return grouped;
  }, [activeItems, settings.timezone, today]);
  const selectedKey = localDateKey(selectedDate, settings.timezone);
  const selectedItems = (itemsByDate.get(selectedKey) ?? []).slice(0, 3);
  return (
    <section className="mini-calendar" aria-label="Upcoming calendar">
      <header>
        <h2>{format(monthStart, "MMMM yyyy")}</h2>
        <div>
          <button
            aria-label="Previous month"
            onClick={() => setMonthStart((current) => subMonths(current, 1))}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            aria-label="Today"
            onClick={() => {
              setMonthStart(startOfMonth(today));
              setSelectedDate(today);
            }}
          >
            <span className="mini-today-label">Today</span>
          </button>
          <button
            aria-label="Next month"
            onClick={() => setMonthStart((current) => addMonths(current, 1))}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </header>
      <div className="calendar-weekdays">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="mini-calendar-grid" role="grid" aria-label="Month picker">
        {calendarDays.map((day) => {
          const key = localDateKey(day, settings.timezone);
          const count = itemsByDate.get(key)?.length ?? 0;
          return (
            <button
              className={`${isSameDay(day, today) ? "today" : ""}${
                isSameDay(day, selectedDate) ? " selected" : ""
              }${!isSameMonth(day, monthStart) ? " muted" : ""}`}
              key={key}
              role="gridcell"
              onClick={() => setSelectedDate(day)}
              aria-label={`${format(day, "EEEE d MMMM")}${
                count ? `, ${count} scheduled` : ""
              }`}
              aria-pressed={isSameDay(day, selectedDate)}
            >
              {day.getDate()}
              {count ? <span className="mini-event-count">{count}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="mini-calendar-selection">
        <strong>{format(selectedDate, "EEEE, d MMMM")}</strong>
        {selectedItems.length ? (
          selectedItems.map((item) => (
            <button
              key={item.id}
              onClick={() => dispatch({ type: "select", id: item.id })}
            >
              <SubjectDot subjectId={item.subjectId} />
              <span>{item.displayName}</span>
              <small>
                {subjectsById.get(item.subjectId ?? "")?.displayName ??
                  (item.kind === "todo" ? "Todo" : "Work")}
              </small>
            </button>
          ))
        ) : (
          <span>Nothing due.</span>
        )}
        <Link to={`/calendar?date=${selectedKey}`}>Open calendar</Link>
      </div>
    </section>
  );
}

function TodayList() {
  const { items, subjectsById, settings } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  const [name, setName] = useState("");
  const today = useToday();
  const todos = items
    .filter((item) => item.kind === "todo" && !item.archivedAt)
    .toSorted(createItemComparator(today, settings.timezone))
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
          <button
            aria-label={`Open ${todo.displayName}`}
            onClick={() => dispatch({ type: "select", id: todo.id })}
          >
            <MoreHorizontal size={15} aria-hidden="true" />
          </button>
        </div>
      ))}
      {!todos.length ? (
        <p className="home-empty-state">
          Nothing needs attention today. <a href="/todo">Plan something</a>
        </p>
      ) : null}
    </section>
  );
}

function UpcomingList({ page }: { page: "assignments" | "checkpoints" }) {
  const { items, subjectsById, settings } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  const today = useToday();
  const limit =
    page === "assignments"
      ? settings.upcomingAssignmentCount
      : settings.upcomingCheckpointCount;
  const upcoming = useMemo(
    () =>
      items
        .filter((item) => {
          const due = itemDueDate(item, settings.timezone);
          const dueLocalDate = due
            ? localDateKey(due, settings.timezone)
            : null;
          return (
            item.kind === "work" &&
            !item.archivedAt &&
            item.workingStatus !== "completed" &&
            item.workingStatus !== "submitted" &&
            Boolean(
              dueLocalDate &&
              dueLocalDate >= localDateKey(today, settings.timezone),
            ) &&
            isInView(item.classification, page) &&
            (settings.includeBothInPanels || item.classification !== "both")
          );
        })
        .toSorted(createItemComparator(today, settings.timezone))
        .slice(0, limit),
    [
      items,
      limit,
      page,
      settings.includeBothInPanels,
      settings.timezone,
      today,
    ],
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
                itemDueDate(item, settings.timezone),
                today,
                settings.timezone,
              )}
            </strong>
            <small>
              {itemDueDate(item, settings.timezone)
                ? itemDueDate(item, settings.timezone)!.toLocaleDateString(
                    "en-AU",
                    {
                      timeZone: settings.timezone,
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    },
                  )
                : "No due date"}
            </small>
          </span>
        </button>
      ))}
      {!upcoming.length ? (
        <p className="home-empty-state">
          No upcoming {page === "assignments" ? "assignments" : "checkpoints"}.
        </p>
      ) : null}
      <Link to={`/${page}`}>View all {page} →</Link>
    </section>
  );
}

function OverdueList() {
  const { items, subjectsById, settings } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  const today = useToday();
  const overdue = useMemo(
    () =>
      items
        .filter(
          (item) =>
            !item.archivedAt &&
            visibleStatus(item, today, settings.timezone) === "overdue",
        )
        .toSorted(createItemComparator(today, settings.timezone))
        .slice(0, 8),
    [items, settings.timezone, today],
  );
  if (!overdue.length) return null;
  return (
    <section className="upcoming-list overdue-list" aria-label="Overdue">
      <h2>Overdue · {overdue.length}</h2>
      {overdue.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => dispatch({ type: "select", id: item.id })}
          aria-haspopup="dialog"
        >
          <span className="upcoming-name">
            <SubjectDot subjectId={item.subjectId} />
            {item.displayName}
          </span>
          <span>{subjectsById.get(item.subjectId ?? "")?.displayName}</span>
          <span>
            <strong className="danger-text">
              {daysRemainingLabel(
                itemDueDate(item, settings.timezone),
                today,
                settings.timezone,
              )}
            </strong>
          </span>
        </button>
      ))}
    </section>
  );
}

function WorkloadStrip() {
  const { items, settings } = useOrganatoData();
  const today = useToday();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index);
    const dateKey = localDateKey(date, settings.timezone);
    const count = items.filter((item) => {
      if (
        item.archivedAt ||
        ["completed", "submitted"].includes(item.workingStatus)
      ) {
        return false;
      }
      const due = itemDueDate(item, settings.timezone);
      if (!due) return false;
      return localDateKey(due, settings.timezone) === dateKey;
    }).length;
    const level =
      count === 0
        ? "Clear"
        : count === 1
          ? "Low"
          : count < 4
            ? "Medium"
            : "High";
    return [format(date, "EEE d MMM"), level, count] as const;
  });
  return (
    <section className="workload-strip" aria-label="7-day item counts">
      <h2>
        7-day workload · item counts <Link to="/calendar">Open calendar</Link>
      </h2>
      <div>
        {days.map(([date, level, count]) => (
          <span key={date}>
            <small>{date}</small>
            <strong>{level}</strong>
            <em>
              <i className={`workload-level workload-${level.toLowerCase()}`} />
              {count} {count === 1 ? "item" : "items"}
            </em>
          </span>
        ))}
      </div>
    </section>
  );
}

export default function HomePage() {
  const { settings } = useOrganatoData();
  const today = useToday();
  return (
    <div className="page home-page">
      <PageHeader title="Home" meta={format(today, "EEEE, d MMMM")} />
      <TopBriefing />
      <RiskStrip />
      <ClassificationInbox />
      <OverdueList />
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
      <ForecastStrip />
    </div>
  );
}
