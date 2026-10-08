import { Plus, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import type {
  OrganatoItem,
  Subject,
  SubjectDefault,
  WorkspaceSettings,
} from "@organato/domain";
import {
  OrganatoDatePicker,
  OrganatoSelect,
  quarterHourOptions,
} from "../components/OrganatoControls";
import { useDialogFocus } from "../components/useDialogFocus";
import { localDateTimeToIso } from "./calendar/model";

export interface NewWorkItem {
  name: string;
  classification: "assignment";
  dueAt: string | null;
  dueDateLocal: string | null;
  dueHasExplicitTime: boolean;
  subjectId: string | null;
  priority: OrganatoItem["priority"];
  calendarEnabled?: boolean;
  remindersEnabled?: boolean;
}

interface CreateWorkFormProps {
  subjects: Subject[];
  timezone: string;
  settings: WorkspaceSettings;
  onCancel(): void;
  onCreate(item: NewWorkItem): void;
}

/**
 * Keep transient form state below WorkPage so typing does not rebuild the
 * TanStack row model and reconcile every visible work row.
 */
function subjectDefaultFor(
  settings: WorkspaceSettings,
  subjectId: string,
): SubjectDefault | undefined {
  return subjectId ? settings.subjectDefaults[subjectId] : undefined;
}

function CreateWorkFormComponent({
  subjects,
  timezone,
  settings,
  onCancel,
  onCreate,
}: CreateWorkFormProps) {
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState<
    NonNullable<OrganatoItem["priority"]> | ""
  >("");
  const priorityTouched = useRef(false);
  const applySubject = (subjectId: string) => {
    setSubject(subjectId);
    // Subject templates: fill priority from the subject default unless the
    // user already picked one. Calendar/reminder defaults ride the payload.
    if (!priorityTouched.current) {
      const preset = subjectDefaultFor(settings, subjectId)?.priority;
      setPriority(preset ?? "");
    }
  };
  const dialogRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useDialogFocus(true, dialogRef, nameRef, "assignments");
  const subjectOptions = useMemo(
    () => [
      { value: "", label: "No subject" },
      ...subjects
        .filter((entry) => entry.active)
        .map((entry) => ({
          value: entry.id,
          label: entry.displayName,
        })),
    ],
    [subjects],
  );

  const itemNoun = "assignment";

  return (
    <div
      className="create-work-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="create-work-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-work-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      >
        <header>
          <div>
            <span>New {itemNoun}</span>
            <h2 id="create-work-title">Add the details</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close create dialog"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </header>
        <form
          className="create-work-form"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmedName = name.trim();
            if (!trimmedName) return;
            onCreate({
              name: trimmedName,
              classification: "assignment",
              dueAt:
                dueDate && dueTime
                  ? localDateTimeToIso(dueDate, dueTime, timezone)
                  : null,
              dueDateLocal: dueDate && !dueTime ? dueDate : null,
              dueHasExplicitTime: Boolean(dueDate && dueTime),
              subjectId: subject || null,
              priority: priority || null,
              calendarEnabled:
                subjectDefaultFor(settings, subject)?.calendarEnabled ?? true,
              remindersEnabled:
                subjectDefaultFor(settings, subject)?.remindersEnabled ?? true,
            });
          }}
        >
          <label className="create-work-field create-work-field--wide">
            <span>Name</span>
            <input
              ref={nameRef}
              aria-label="Work item name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. English essay"
              required
            />
          </label>
          <div className="create-work-field create-work-field--wide">
            <span>Due</span>
            <div className="create-work-due">
              <OrganatoDatePicker
                ariaLabel="Due date"
                value={dueDate}
                onChange={setDueDate}
                placeholder="No date"
              />
              <OrganatoSelect
                ariaLabel="Due time"
                disabled={!dueDate}
                options={quarterHourOptions}
                value={dueTime}
                onChange={setDueTime}
              />
            </div>
          </div>
          <div className="create-work-field">
            <span>Subject</span>
            <OrganatoSelect
              ariaLabel="Subject"
              options={subjectOptions}
              value={subject}
              onChange={applySubject}
            />
          </div>
          <div className="create-work-field create-work-field--wide">
            <span>Priority</span>
            <OrganatoSelect
              ariaLabel="Priority"
              options={[
                { value: "", label: "No priority" },
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
                { value: "urgent", label: "Urgent" },
              ]}
              value={priority}
              onChange={(value) => {
                priorityTouched.current = true;
                setPriority(value as typeof priority);
              }}
            />
          </div>
          <footer>
            <button
              type="button"
              className="create-work-cancel"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button type="submit" className="create-work-submit">
              Create {itemNoun}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export const CreateWorkForm = memo(CreateWorkFormComponent);

function updateNewQuery(enabled: boolean) {
  const url = new URL(window.location.href);
  if (enabled) url.searchParams.set("new", "1");
  else url.searchParams.delete("new");
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

/** Own the transient open state so New/Cancel never re-render WorkPage. */
export const CreateWorkControl = memo(function CreateWorkControl({
  subjects,
  timezone,
  settings,
  onCreate,
}: Omit<CreateWorkFormProps, "onCancel">) {
  const { search } = useLocation();
  const [open, setOpen] = useState(
    () => new URLSearchParams(search).get("new") === "1",
  );
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const handlePopState = () => {
      setOpen(new URLSearchParams(window.location.search).get("new") === "1");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
  // React Router same-route navigations (e.g. linking to ?new=1 while
  // already on the page) update `search` without a popstate event.
  useEffect(() => {
    setOpen(new URLSearchParams(search).get("new") === "1");
  }, [search]);

  const close = useCallback(() => {
    updateNewQuery(false);
    setOpen(false);
  }, []);
  const create = useCallback(
    (item: NewWorkItem) => {
      onCreate(item);
      close();
    },
    [close, onCreate],
  );
  return (
    <>
      <button
        className="new-button"
        type="button"
        onClick={() => {
          updateNewQuery(true);
          setOpen(true);
        }}
      >
        <Plus size={16} /> New
      </button>
      {open && mounted
        ? createPortal(
            <CreateWorkForm
              subjects={subjects}
              timezone={timezone}
              settings={settings}
              onCancel={close}
              onCreate={create}
            />,
            document.body,
          )
        : null}
    </>
  );
});

export interface NewTodoItem {
  name: string;
  dueAt: string | null;
  dueDateLocal: string | null;
  dueHasExplicitTime: boolean;
  subjectId: string | null;
  priority: OrganatoItem["priority"];
  recurrenceRule: OrganatoItem["recurrenceRule"];
  calendarEnabled: boolean;
  remindersEnabled: boolean;
}

interface CreateTodoFormProps {
  subjects: Subject[];
  timezone: string;
  calendarDefault: boolean;
  remindersDefault: boolean;
  settings: WorkspaceSettings;
  onCancel(): void;
  onCreate(item: NewTodoItem): void;
}

const recurrenceOptions = [
  { value: "", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every two weeks" },
  { value: "monthly", label: "Monthly" },
];

function CreateTodoFormComponent({
  subjects,
  timezone,
  calendarDefault,
  remindersDefault,
  settings,
  onCancel,
  onCreate,
}: CreateTodoFormProps) {
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState<
    NonNullable<OrganatoItem["priority"]> | ""
  >("");
  const [recurrence, setRecurrence] = useState("");
  const [calendarEnabled, setCalendarEnabled] = useState(calendarDefault);
  const [remindersEnabled, setRemindersEnabled] = useState(remindersDefault);
  const touched = useRef({
    priority: false,
    calendar: false,
    reminders: false,
  });
  const applySubject = (subjectId: string) => {
    setSubject(subjectId);
    const preset = subjectDefaultFor(settings, subjectId);
    if (!touched.current.priority) setPriority(preset?.priority ?? "");
    if (!touched.current.calendar && preset?.calendarEnabled !== undefined) {
      setCalendarEnabled(preset.calendarEnabled);
    }
    if (!touched.current.reminders && preset?.remindersEnabled !== undefined) {
      setRemindersEnabled(preset.remindersEnabled);
    }
  };
  const dialogRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useDialogFocus(true, dialogRef, nameRef, "todo");
  const subjectOptions = useMemo(
    () => [
      { value: "", label: "No subject" },
      ...subjects
        .filter((entry) => entry.active)
        .map((entry) => ({
          value: entry.id,
          label: entry.displayName,
        })),
    ],
    [subjects],
  );
  const recurrenceError =
    recurrence && !dueDate ? "Pick a due date to repeat." : null;

  return (
    <div
      className="create-work-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="create-work-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-todo-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      >
        <header>
          <div>
            <span>New todo</span>
            <h2 id="create-todo-title">Add the details</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close create dialog"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </header>
        <form
          className="create-work-form"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmedName = name.trim();
            if (!trimmedName || recurrenceError) return;
            onCreate({
              name: trimmedName,
              dueAt:
                dueDate && dueTime
                  ? localDateTimeToIso(dueDate, dueTime, timezone)
                  : null,
              dueDateLocal: dueDate && !dueTime ? dueDate : null,
              dueHasExplicitTime: Boolean(dueDate && dueTime),
              subjectId: subject || null,
              priority: priority || null,
              recurrenceRule: recurrence
                ? {
                    frequency: recurrence as NonNullable<
                      OrganatoItem["recurrenceRule"]
                    >["frequency"],
                    interval: 1,
                    seriesId: crypto.randomUUID(),
                  }
                : null,
              calendarEnabled,
              remindersEnabled,
            });
          }}
        >
          <label className="create-work-field create-work-field--wide">
            <span>Name</span>
            <input
              ref={nameRef}
              aria-label="Todo name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Read chapter 4"
              required
            />
          </label>
          <div className="create-work-field create-work-field--wide">
            <span>Due</span>
            <div className="create-work-due">
              <OrganatoDatePicker
                ariaLabel="Due date"
                value={dueDate}
                onChange={setDueDate}
                placeholder="No date"
              />
              <OrganatoSelect
                ariaLabel="Due time"
                disabled={!dueDate}
                options={quarterHourOptions}
                value={dueTime}
                onChange={setDueTime}
              />
            </div>
          </div>
          <div className="create-work-field">
            <span>Subject</span>
            <OrganatoSelect
              ariaLabel="Subject"
              options={subjectOptions}
              value={subject}
              onChange={applySubject}
            />
          </div>
          <div className="create-work-field">
            <span>Priority</span>
            <OrganatoSelect
              ariaLabel="Priority"
              options={[
                { value: "", label: "No priority" },
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
                { value: "urgent", label: "Urgent" },
              ]}
              value={priority}
              onChange={(value) => {
                touched.current.priority = true;
                setPriority(value as typeof priority);
              }}
            />
          </div>
          <div className="create-work-field">
            <span>Repeat</span>
            <OrganatoSelect
              ariaLabel="Repeat"
              options={recurrenceOptions}
              value={recurrence}
              onChange={setRecurrence}
            />
          </div>
          {recurrenceError ? (
            <p className="empty-line" role="alert">
              {recurrenceError}
            </p>
          ) : null}
          <div className="create-work-field">
            <span>Calendar</span>
            <label className="create-work-switch">
              <span>Add to Google Calendar</span>
              <input
                type="checkbox"
                checked={calendarEnabled}
                onChange={(event) => {
                  touched.current.calendar = true;
                  setCalendarEnabled(event.target.checked);
                }}
                aria-label="Add to Google Calendar"
              />
            </label>
          </div>
          <div className="create-work-field">
            <span>Reminders</span>
            <label className="create-work-switch">
              <span>Email reminders</span>
              <input
                type="checkbox"
                checked={remindersEnabled}
                onChange={(event) => {
                  touched.current.reminders = true;
                  setRemindersEnabled(event.target.checked);
                }}
                aria-label="Email reminders"
              />
            </label>
          </div>
          <footer>
            <button
              type="button"
              className="create-work-cancel"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button type="submit" className="create-work-submit">
              Create todo
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export const CreateTodoForm = memo(CreateTodoFormComponent);

/** Own the transient open state so New never re-renders TodoPage. */
export const CreateTodoControl = memo(function CreateTodoControl({
  subjects,
  timezone,
  calendarDefault,
  remindersDefault,
  settings,
  onCreate,
}: Omit<CreateTodoFormProps, "onCancel">) {
  const { search } = useLocation();
  const [open, setOpen] = useState(
    () => new URLSearchParams(search).get("new") === "1",
  );
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const handlePopState = () => {
      setOpen(new URLSearchParams(window.location.search).get("new") === "1");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
  // React Router same-route navigations (e.g. linking to ?new=1 while
  // already on the page) update `search` without a popstate event.
  useEffect(() => {
    setOpen(new URLSearchParams(search).get("new") === "1");
  }, [search]);

  const close = useCallback(() => {
    updateNewQuery(false);
    setOpen(false);
  }, []);
  const create = useCallback(
    (item: NewTodoItem) => {
      onCreate(item);
      close();
    },
    [close, onCreate],
  );
  return (
    <>
      <button
        className="new-button"
        type="button"
        onClick={() => {
          updateNewQuery(true);
          setOpen(true);
        }}
      >
        <Plus size={16} /> New
      </button>
      {open && mounted
        ? createPortal(
            <CreateTodoForm
              subjects={subjects}
              timezone={timezone}
              calendarDefault={calendarDefault}
              remindersDefault={remindersDefault}
              settings={settings}
              onCancel={close}
              onCreate={create}
            />,
            document.body,
          )
        : null}
    </>
  );
});
