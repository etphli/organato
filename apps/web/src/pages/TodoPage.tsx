import { CalendarPlus, Check, MoreHorizontal, Repeat2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  compareItems,
  daysRemainingLabel,
  itemDeadline,
  visibleStatus,
} from "@organato/domain";
import { PageHeader } from "../components/PageHeader";
import { OrganatoSelect } from "../components/OrganatoControls";
import { SubjectDot } from "../components/SubjectDot";
import { useOrganatoActions, useOrganatoData } from "../state/OrganatoProvider";
import { CreateTodoControl, type NewTodoItem } from "./CreateWorkForm";

const todoPageSize = 50;
const todoShowCompletedKey = "organato-todo-show-completed-v1";

function loadShowCompletedPreference(): boolean {
  try {
    return localStorage.getItem(todoShowCompletedKey) === "true";
  } catch {
    return false;
  }
}

export default function TodoPage() {
  const { items, subjects, subjectsById, settings } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  const [pageIndex, setPageIndex] = useState(0);
  const [showCompleted, setShowCompleted] = useState(
    loadShowCompletedPreference,
  );
  const openItem = useCallback(
    (id: string) => dispatch({ type: "select", id }),
    [dispatch],
  );
  const todos = useMemo(
    () =>
      items
        .filter((item) => {
          if (item.kind !== "todo" || item.archivedAt) return false;
          if (!showCompleted && item.workingStatus === "completed")
            return false;
          return true;
        })
        .toSorted((a, b) => compareItems(a, b, new Date())),
    [items, showCompleted],
  );
  const activeCount = useMemo(
    () =>
      items.filter(
        (item) =>
          item.kind === "todo" &&
          !item.archivedAt &&
          item.workingStatus !== "completed",
      ).length,
    [items],
  );
  const pageCount = Math.max(1, Math.ceil(todos.length / todoPageSize));
  const visibleTodos = todos.slice(
    pageIndex * todoPageSize,
    (pageIndex + 1) * todoPageSize,
  );
  useEffect(() => {
    setPageIndex((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);
  const toggleCompleted = () => {
    setShowCompleted((current) => {
      const next = !current;
      try {
        localStorage.setItem(todoShowCompletedKey, String(next));
      } catch {
        // The list still works when browser storage is unavailable.
      }
      return next;
    });
    setPageIndex(0);
  };
  const createFromDialog = useCallback(
    (item: NewTodoItem) => {
      dispatch({
        type: "addTodo",
        name: item.name,
        dueAt: item.dueAt,
        dueDateLocal: item.dueDateLocal,
        dueHasExplicitTime: item.dueHasExplicitTime,
        subjectId: item.subjectId,
        priority: item.priority,
        recurrenceRule: item.recurrenceRule,
        calendarEnabled: item.calendarEnabled,
        remindersEnabled: item.remindersEnabled,
      });
      setPageIndex(0);
    },
    [dispatch],
  );
  return (
    <div className="page todo-page">
      <PageHeader
        title="Todo"
        meta={`${activeCount} active${showCompleted ? ` · ${todos.length} shown` : ""}`}
        actions={
          <>
            <button
              type="button"
              aria-pressed={showCompleted}
              onClick={toggleCompleted}
            >
              {showCompleted ? "Hide completed" : "Show completed"}
            </button>
            <CreateTodoControl
              subjects={subjects}
              timezone={settings.timezone}
              calendarDefault={settings.todoCalendarDefault}
              remindersDefault={settings.todoRemindersDefault}
              onCreate={createFromDialog}
            />
          </>
        }
      />
      <section className="todo-list" aria-label="Todos">
        <div className="todo-list-head">
          <span>Task</span>
          <span>Due</span>
          <span>Subject</span>
          <span>Priority</span>
          <span>Recurrence</span>
        </div>
        {visibleTodos.map((todo) => {
          const status = visibleStatus(todo, new Date());
          return (
            <div
              className={`todo-record${status === "completed" ? " completed" : ""}`}
              key={todo.id}
            >
              <button
                className="todo-check"
                onClick={() =>
                  dispatch({
                    type: "patchItem",
                    id: todo.id,
                    patch: {
                      workingStatus:
                        status === "completed" ? "not_started" : "completed",
                      completedAt:
                        status === "completed"
                          ? null
                          : new Date().toISOString(),
                    },
                  })
                }
                aria-label={
                  status === "completed"
                    ? `Reopen ${todo.displayName}`
                    : `Complete ${todo.displayName}`
                }
              >
                {status === "completed" ? <Check size={15} /> : null}
              </button>
              <button
                className="todo-name"
                type="button"
                aria-haspopup="dialog"
                onClick={() => openItem(todo.id)}
              >
                {todo.displayName}
              </button>
              <span className={status === "overdue" ? "danger-text" : ""}>
                {daysRemainingLabel(
                  itemDeadline(todo),
                  new Date(),
                  settings.timezone,
                )}
                <small>
                  {itemDeadline(todo)
                    ? itemDeadline(todo)!.toLocaleDateString("en-AU", {
                        timeZone: settings.timezone,
                        day: "numeric",
                        month: "short",
                      })
                    : "No due date"}
                </small>
              </span>
              <OrganatoSelect
                ariaLabel={`Subject for ${todo.displayName}`}
                options={[
                  { value: "", label: "No subject" },
                  ...subjects.map((subject) => ({
                    value: subject.id,
                    label: subject.displayName,
                  })),
                ]}
                value={todo.subjectId ?? ""}
                onChange={(value) =>
                  dispatch({
                    type: "patchItem",
                    id: todo.id,
                    patch: { subjectId: value || null },
                  })
                }
              />
              <span className="todo-subject-mobile">
                <SubjectDot subjectId={todo.subjectId} />
                {subjectsById.get(todo.subjectId ?? "")?.displayName ??
                  "No subject"}
              </span>
              <OrganatoSelect
                ariaLabel={`Priority for ${todo.displayName}`}
                options={[
                  { value: "", label: "—" },
                  { value: "low", label: "Low" },
                  { value: "medium", label: "Medium" },
                  { value: "high", label: "High" },
                  { value: "urgent", label: "Urgent" },
                ]}
                value={todo.priority ?? ""}
                onChange={(value) =>
                  dispatch({
                    type: "patchItem",
                    id: todo.id,
                    patch: {
                      priority: (value || null) as typeof todo.priority,
                    },
                  })
                }
              />
              <span className="recurrence-label">
                {todo.recurrenceRule ? (
                  <>
                    <Repeat2 size={14} /> {todo.recurrenceRule.frequency}
                  </>
                ) : (
                  "Does not repeat"
                )}
              </span>
              <button
                className="row-menu"
                type="button"
                onClick={() => openItem(todo.id)}
                aria-label={`More actions for ${todo.displayName}`}
                aria-haspopup="dialog"
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
          );
        })}
        {!todos.length ? (
          <p className="empty-line">
            Nothing is due. Add a todo when something comes up.
          </p>
        ) : null}
      </section>
      {todos.length > todoPageSize ? (
        <nav className="list-pagination" aria-label="Todo pages">
          <span>
            {pageIndex * todoPageSize + 1}–
            {Math.min(todos.length, (pageIndex + 1) * todoPageSize)} of{" "}
            {todos.length}
          </span>
          <button
            type="button"
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={pageIndex >= pageCount - 1}
            onClick={() =>
              setPageIndex((current) => Math.min(pageCount - 1, current + 1))
            }
          >
            Next
          </button>
        </nav>
      ) : null}
      <p className="todo-help">
        <CalendarPlus size={14} /> Todos with dates appear once in the internal
        and dedicated Google calendars.
      </p>
    </div>
  );
}
