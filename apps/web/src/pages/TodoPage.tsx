import {
  CalendarPlus,
  Check,
  MoreHorizontal,
  Plus,
  Repeat2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { addDays, format } from "date-fns";
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

const todoPageSize = 50;

function parseQuickTodo(input: string) {
  const priorityMatch = input.match(/!(low|medium|high|urgent)\b/i);
  const subjectMatch = input.match(/#([\w-]+)/);
  const tomorrow = /\btomorrow\b/i.test(input);
  const tomorrowKey = format(addDays(new Date(), 1), "yyyy-MM-dd");
  const cleaned = input
    .replace(/!(low|medium|high|urgent)\b/gi, "")
    .replace(/#([\w-]+)/g, "")
    .replace(/\btomorrow\b/gi, "")
    .trim();
  return {
    name: cleaned,
    priority: priorityMatch?.[1]?.toLowerCase() ?? null,
    subject: subjectMatch?.[1] ?? null,
    dueDateLocal: tomorrow ? tomorrowKey : null,
  };
}

export default function TodoPage() {
  const { items, subjects, subjectsById, settings } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  const [searchParams, setSearchParams] = useSearchParams();
  const quickAddRef = useRef<HTMLInputElement>(null);
  const [entry, setEntry] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [preview, setPreview] = useState<ReturnType<
    typeof parseQuickTodo
  > | null>(null);
  const todos = useMemo(
    () =>
      items
        .filter((item) => item.kind === "todo" && !item.archivedAt)
        .toSorted((a, b) => compareItems(a, b, new Date())),
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
  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    quickAddRef.current?.focus();
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const submit = () => {
    const parsed = parseQuickTodo(entry);
    if (!parsed.name) return;
    if (
      settings.naturalTodoParsing &&
      (parsed.priority || parsed.subject || parsed.dueDateLocal) &&
      !preview
    ) {
      setPreview(parsed);
      return;
    }
    const subject = subjects.find(
      (entry) =>
        parsed.subject &&
        [entry.displayName, entry.shortName, entry.sourceName]
          .filter(Boolean)
          .some(
            (value) => value?.toLowerCase() === parsed.subject?.toLowerCase(),
          ),
    );
    dispatch({
      type: "addTodo",
      name: parsed.name,
      dueDateLocal: parsed.dueDateLocal,
      dueHasExplicitTime: false,
      subjectId: subject?.id ?? null,
      priority: parsed.priority as "low" | "medium" | "high" | "urgent" | null,
    });
    setEntry("");
    setPreview(null);
  };
  return (
    <div className="page todo-page">
      <PageHeader
        title="Todo"
        meta={`${todos.length} active`}
        actions={
          <button
            className="new-button"
            onClick={() => quickAddRef.current?.focus()}
          >
            <Plus size={16} /> New
          </button>
        }
      />
      <section className="todo-quick">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Plus size={18} aria-hidden="true" />
          <input
            ref={quickAddRef}
            id="todo-quick-add"
            aria-label="New todo"
            value={entry}
            onChange={(event) => {
              setEntry(event.target.value);
              setPreview(null);
            }}
            placeholder="Add a todo… try “Essay outline tomorrow #English !high”"
          />
          <kbd>Enter</kbd>
        </form>
        {preview ? (
          <div className="parse-preview" role="status">
            <span>
              Create “{preview.name}”{preview.dueDateLocal ? " · tomorrow" : ""}
              {preview.subject ? ` · #${preview.subject}` : ""}
              {preview.priority ? ` · ${preview.priority}` : ""}?
            </span>
            <button onClick={submit}>Create</button>
            <button onClick={() => setPreview(null)}>Edit</button>
          </div>
        ) : null}
      </section>
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
                onClick={() => dispatch({ type: "select", id: todo.id })}
              >
                {todo.displayName}
              </button>
              <span className={status === "overdue" ? "danger-text" : ""}>
                {daysRemainingLabel(itemDeadline(todo), new Date(), settings.timezone)}
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
                onClick={() => dispatch({ type: "select", id: todo.id })}
                aria-label={`More actions for ${todo.displayName}`}
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
