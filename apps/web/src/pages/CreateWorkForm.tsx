import { Plus, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import type { OrganatoItem, Subject } from "@organato/domain";
import {
  OrganatoDatePicker,
  OrganatoSelect,
  quarterHourOptions,
} from "../components/OrganatoControls";
import { useDialogFocus } from "../components/useDialogFocus";
import { localDateTimeToIso } from "./calendar/model";

export interface NewWorkItem {
  name: string;
  classification: "assignment" | "checkpoint" | "both";
  dueAt: string | null;
  dueDateLocal: string | null;
  dueHasExplicitTime: boolean;
  subjectId: string | null;
  priority: OrganatoItem["priority"];
}

interface CreateWorkFormProps {
  page: "assignments" | "checkpoints";
  subjects: Subject[];
  timezone: string;
  onCancel(): void;
  onCreate(item: NewWorkItem): void;
}

/**
 * Keep transient form state below WorkPage so typing does not rebuild the
 * TanStack row model and reconcile every visible work row.
 */
function CreateWorkFormComponent({
  page,
  subjects,
  timezone,
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
  const [classification, setClassification] = useState<
    "assignment" | "checkpoint" | "both"
  >(page === "assignments" ? "assignment" : "checkpoint");
  const dialogRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useDialogFocus(true, dialogRef, nameRef, page);
  const classificationOptions = useMemo(
    () => [
      {
        value: page === "assignments" ? "assignment" : "checkpoint",
        label: page === "assignments" ? "Assignment" : "Checkpoint",
      },
      { value: "both", label: "Both" },
    ],
    [page],
  );
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

  const itemNoun = page === "assignments" ? "assignment" : "checkpoint";

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
              classification,
              dueAt:
                dueDate && dueTime
                  ? localDateTimeToIso(dueDate, dueTime, timezone)
                  : null,
              dueDateLocal: dueDate && !dueTime ? dueDate : null,
              dueHasExplicitTime: Boolean(dueDate && dueTime),
              subjectId: subject || null,
              priority: priority || null,
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
              placeholder={`e.g. ${page === "assignments" ? "English essay" : "Science practical"}`}
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
            <span>Type</span>
            <OrganatoSelect
              ariaLabel="Classification"
              options={classificationOptions}
              value={classification}
              onChange={(value) =>
                setClassification(value as typeof classification)
              }
            />
          </div>
          <div className="create-work-field">
            <span>Subject</span>
            <OrganatoSelect
              ariaLabel="Subject"
              options={subjectOptions}
              value={subject}
              onChange={setSubject}
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
              onChange={(value) => setPriority(value as typeof priority)}
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
  page,
  subjects,
  timezone,
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
              page={page}
              subjects={subjects}
              timezone={timezone}
              onCancel={close}
              onCreate={create}
            />,
            document.body,
          )
        : null}
    </>
  );
});
