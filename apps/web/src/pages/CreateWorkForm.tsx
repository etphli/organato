import { Plus } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { OrganatoItem, Subject } from "@organato/domain";
import {
  OrganatoDatePicker,
  OrganatoSelect,
  quarterHourOptions,
} from "../components/OrganatoControls";
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

  return (
    <form
      className="create-work-line"
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
      <input
        aria-label="Work item name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Work item name"
        required
      />
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
      <OrganatoSelect
        ariaLabel="Classification"
        options={classificationOptions}
        value={classification}
        onChange={(value) => setClassification(value as typeof classification)}
      />
      <OrganatoSelect
        ariaLabel="Subject"
        options={subjectOptions}
        value={subject}
        onChange={setSubject}
      />
      <OrganatoSelect
        ariaLabel="Priority"
        options={[
          { value: "", label: "Blank priority" },
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
          { value: "urgent", label: "Urgent" },
        ]}
        value={priority}
        onChange={(value) => setPriority(value as typeof priority)}
      />
      <button type="submit">Create</button>
      <button className="create-work-cancel" type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
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
  const [open, setOpen] = useState(
    () => new URLSearchParams(window.location.search).get("new") === "1",
  );
  const [mounted, setMounted] = useState(false);
  const formHostId = `create-${page}-host`;

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
  const host = mounted ? document.getElementById(formHostId) : null;

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
      {open && host
        ? createPortal(
            <CreateWorkForm
              page={page}
              subjects={subjects}
              timezone={timezone}
              onCancel={close}
              onCreate={create}
            />,
            host,
          )
        : null}
    </>
  );
});
