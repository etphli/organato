import {
  Archive,
  CalendarDays,
  ExternalLink,
  Link2,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { visibleStatus, type OrganatoItem } from "@organato/domain";
import { localDateTimeToIso } from "../pages/calendar/model";
import {
  useOrganatoActions,
  useOrganatoItems,
  useOrganatoUi,
  useOrganatoWorkspace,
} from "../state/OrganatoProvider";
import {
  OrganatoDatePicker,
  OrganatoSelect,
  quarterHourOptions,
} from "./OrganatoControls";
import { SubjectDot } from "./SubjectDot";
import { useDialogFocus } from "./useDialogFocus";
import {
  IntegrationRequestError,
  addItemLink,
  addSubtask,
  attachmentHref,
  mergeDuplicate,
  resolveCalendarConflict,
  uploadAttachment,
} from "../lib/integrationApi";

function ConflictBanner({ itemId }: { itemId: string }) {
  const { dispatch, refresh } = useOrganatoActions();
  const [resolving, setResolving] = useState<"mine" | "theirs" | null>(null);
  const resolve = async (strategy: "mine" | "theirs") => {
    setResolving(strategy);
    try {
      await resolveCalendarConflict(itemId, strategy);
      await refresh();
    } catch (error) {
      dispatch({
        type: "toast",
        message:
          error instanceof IntegrationRequestError
            ? error.message
            : "The conflict could not be resolved.",
      });
      setResolving(null);
    }
  };
  return (
    <div className="conflict-banner" role="alert">
      <p>
        <strong>Edited in both places.</strong> This item changed in Organato
        and in Google Calendar. Choose which version wins.
      </p>
      <div>
        <button
          type="button"
          disabled={resolving !== null}
          onClick={() => void resolve("mine")}
        >
          {resolving === "mine" ? "Keeping…" : "Keep Organato"}
        </button>
        <button
          type="button"
          disabled={resolving !== null}
          onClick={() => void resolve("theirs")}
        >
          {resolving === "theirs" ? "Keeping…" : "Use Google"}
        </button>
      </div>
    </div>
  );
}

function SubtaskSection({ item }: { item: OrganatoItem }) {
  const { dispatch } = useOrganatoActions();
  const { settings } = useOrganatoWorkspace();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const done = item.subtasks.filter((subtask) => subtask.completed).length;
  const total = item.subtasks.length;
  const templateKey =
    item.kind === "todo"
      ? "todo"
      : item.classification === "both"
        ? "both"
        : item.classification === "checkpoint"
          ? "checkpoint"
          : "assignment";
  const template = settings.checklistTemplates[templateKey] ?? [];
  const add = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const updated = await addSubtask(item.id, trimmed);
      dispatch({ type: "replaceItem", item: updated });
      setTitle("");
    } catch (error) {
      dispatch({
        type: "toast",
        message:
          error instanceof IntegrationRequestError
            ? error.message
            : "The subtask could not be added.",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="inspector-section" aria-label="Checklist">
      <h2>
        Checklist
        {total ? (
          <small>
            {" "}
            {done}/{total}
          </small>
        ) : null}
      </h2>
      {total ? (
        <div
          className="subtask-progress"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Checklist progress"
        >
          <span style={{ width: `${(done / total) * 100}%` }} />
        </div>
      ) : null}
      {item.subtasks.map((subtask) => (
        <label key={subtask.id} className="subtask-row">
          <input
            type="checkbox"
            checked={subtask.completed}
            onChange={() =>
              dispatch({
                type: "patchSubtask",
                itemId: item.id,
                subtaskId: subtask.id,
                patch: { completed: !subtask.completed },
              })
            }
          />
          <span>{subtask.title}</span>
          <button
            type="button"
            className="icon-button"
            aria-label={`Delete subtask ${subtask.title}`}
            onClick={() =>
              dispatch({
                type: "deleteSubtask",
                itemId: item.id,
                subtaskId: subtask.id,
              })
            }
          >
            <X size={14} />
          </button>
        </label>
      ))}
      <form
        className="subtask-form"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a step…"
          aria-label="New subtask"
        />
        <button type="submit" disabled={!title.trim() || busy}>
          Add
        </button>
      </form>
      {!total && template.length ? (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              let current = item;
              for (const step of template) {
                current = await addSubtask(current.id, step);
              }
              dispatch({ type: "replaceItem", item: current });
            } catch (error) {
              dispatch({
                type: "toast",
                message:
                  error instanceof IntegrationRequestError
                    ? error.message
                    : "The template could not be applied.",
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          Add {templateKey} checklist ({template.length} steps)
        </button>
      ) : null}
    </section>
  );
}

function LinksSection({ item }: { item: OrganatoItem }) {
  const { items } = useOrganatoItems();
  const { dispatch } = useOrganatoActions();
  const [candidate, setCandidate] = useState("");
  const [busy, setBusy] = useState(false);
  const names = new Map(items.map((entry) => [entry.id, entry.displayName]));
  const options = items
    .filter(
      (entry) =>
        entry.id !== item.id &&
        !entry.archivedAt &&
        entry.workingStatus !== "completed",
    )
    .map((entry) => ({ value: entry.id, label: entry.displayName }))
    .slice(0, 200);
  const add = async () => {
    if (!candidate || busy) return;
    setBusy(true);
    try {
      const updated = await addItemLink(item.id, candidate);
      dispatch({ type: "replaceItem", item: updated });
      setCandidate("");
    } catch (error) {
      dispatch({
        type: "toast",
        message:
          error instanceof IntegrationRequestError
            ? error.message
            : "The dependency could not be added.",
      });
    } finally {
      setBusy(false);
    }
  };
  const blockedNames = item.links.blockedBy.map(
    (ref) => names.get(ref.itemId) ?? "Unknown item",
  );
  return (
    <section className="inspector-section" aria-label="Dependencies">
      <h2>Depends on</h2>
      {item.links.blockedBy.length ? (
        <ul className="link-list">
          {item.links.blockedBy.map((ref, index) => (
            <li key={ref.linkId}>
              <span>{blockedNames[index]}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove dependency on ${blockedNames[index]}`}
                onClick={() =>
                  dispatch({
                    type: "deleteLink",
                    itemId: item.id,
                    linkId: ref.linkId,
                  })
                }
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-line">No dependencies.</p>
      )}
      {item.links.blocking.length ? (
        <p className="empty-line">
          Blocking:{" "}
          {item.links.blocking
            .map((ref) => names.get(ref.itemId) ?? "Unknown item")
            .join(", ")}
        </p>
      ) : null}
      <form
        className="subtask-form"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <OrganatoSelect
          ariaLabel="Item this depends on"
          options={[{ value: "", label: "Depends on…" }, ...options]}
          value={candidate}
          onChange={setCandidate}
        />
        <button type="submit" disabled={!candidate || busy}>
          Add
        </button>
      </form>
    </section>
  );
}

function findDuplicates(
  items: OrganatoItem[],
  item: OrganatoItem,
): OrganatoItem[] {
  const name = item.displayName.trim().toLowerCase();
  if (!name) return [];
  const due = item.dueAt ?? item.dueDateLocal ?? null;
  return items.filter(
    (other) =>
      other.id !== item.id &&
      !other.archivedAt &&
      other.displayName.trim().toLowerCase() === name &&
      (other.dueAt ?? other.dueDateLocal ?? null) === due,
  );
}

function DuplicateBanner({ item }: { item: OrganatoItem }) {
  const { items } = useOrganatoItems();
  const { dispatch } = useOrganatoActions();
  const [arming, setArming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const duplicates = findDuplicates(items, item);
  if (!duplicates.length) return null;
  const merge = async (duplicateId: string) => {
    setBusy(true);
    try {
      const updated = await mergeDuplicate(item.id, duplicateId);
      dispatch({ type: "replaceItem", item: updated });
      dispatch({ type: "toast", message: "Duplicates merged" });
      setArming(null);
    } catch (error) {
      dispatch({
        type: "toast",
        message:
          error instanceof IntegrationRequestError
            ? error.message
            : "The merge could not be completed.",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="conflict-banner" role="alert">
      <p>
        <strong>
          Possible {duplicates.length === 1 ? "duplicate" : "duplicates"}.
        </strong>{" "}
        Same name and due date
        {duplicates.some((entry) => entry.sourceType !== item.sourceType)
          ? " across sources"
          : ""}
        :
      </p>
      {duplicates.map((duplicate) => (
        <div key={duplicate.id}>
          <span>
            {duplicate.displayName} (
            {duplicate.sourceType === "canvas" ? "Canvas" : "manual"})
          </span>{" "}
          {arming === duplicate.id ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void merge(duplicate.id)}
              >
                Confirm merge
              </button>{" "}
              <button type="button" onClick={() => setArming(null)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setArming(duplicate.id)}>
              Merge into this
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function EffortInput({ item }: { item: OrganatoItem }) {
  const { dispatch } = useOrganatoActions();
  return (
    <label className="effort-row">
      <span>Effort (minutes)</span>
      <input
        type="number"
        min={1}
        max={10000}
        value={item.estimatedMinutes ?? ""}
        placeholder="—"
        aria-label="Estimated effort in minutes"
        onChange={(event) => {
          const value = event.target.value;
          dispatch({
            type: "patchItem",
            id: item.id,
            patch: {
              estimatedMinutes:
                value === "" ? null : Math.max(1, Number(value) || 0),
            },
          });
        }}
      />
    </label>
  );
}

const statusOptions = [
  "not_started",
  "in_progress",
  "submitted",
  "completed",
] as const;

type DueInputValues = {
  date: string;
  time: string;
};

type DuePatch = Pick<
  OrganatoItem,
  "dueAt" | "dueDateLocal" | "dueHasExplicitTime"
>;

function partValue(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function dueInputValues(
  item: Pick<OrganatoItem, "dueAt" | "dueDateLocal" | "dueHasExplicitTime">,
  timezone: string,
): DueInputValues {
  if (item.dueDateLocal && !item.dueHasExplicitTime) {
    return { date: item.dueDateLocal, time: "" };
  }
  if (!item.dueAt) {
    return { date: item.dueDateLocal ?? "", time: "" };
  }
  const instant = new Date(item.dueAt);
  if (Number.isNaN(instant.getTime())) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-CA-u-hc-h23", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return {
    date: `${partValue(parts, "year")}-${partValue(parts, "month")}-${partValue(parts, "day")}`,
    time: `${partValue(parts, "hour")}:${partValue(parts, "minute")}`,
  };
}

export function duePatchFromInputs(
  date: string,
  time: string,
  timezone: string,
): DuePatch {
  if (!date) {
    return {
      dueAt: null,
      dueDateLocal: null,
      dueHasExplicitTime: false,
    };
  }
  if (!time) {
    return {
      dueAt: null,
      dueDateLocal: date,
      dueHasExplicitTime: false,
    };
  }
  return {
    dueAt: localDateTimeToIso(date, time, timezone),
    dueDateLocal: null,
    dueHasExplicitTime: true,
  };
}

export function Inspector() {
  const { subjects, subjectsById, settings } = useOrganatoWorkspace();
  const { selectedItem } = useOrganatoUi();
  const { dispatch } = useOrganatoActions();
  const retainedItemRef = useRef<OrganatoItem | null>(null);
  if (selectedItem) retainedItemRef.current = selectedItem;
  const item = selectedItem ?? retainedItemRef.current;
  const inspectorRef = useRef<HTMLElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [linkType, setLinkType] = useState<
    "reference" | "brief" | "rubric" | "working_document" | "other"
  >("other");
  const [linkError, setLinkError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const uploadFile = async (file: File) => {
    if (!item || uploading) return;
    if (file.size > 10_000_000) {
      dispatch({
        type: "toast",
        message: "That file is over the 10 MB limit.",
      });
      return;
    }
    setUploading(true);
    try {
      const { item: updated } = await uploadAttachment(
        item.id,
        file,
        file.name,
        linkType,
      );
      dispatch({ type: "replaceItem", item: updated });
      dispatch({ type: "toast", message: "File attached" });
    } catch (error) {
      dispatch({
        type: "toast",
        message:
          error instanceof IntegrationRequestError
            ? error.message
            : "The file could not be attached.",
      });
    } finally {
      setUploading(false);
    }
  };
  const close = () => {
    // Flush unsaved notes before closing: an un-blurred textarea would
    // otherwise silently drop the edit.
    const draft = notesRef.current?.value;
    if (item && draft !== undefined && draft !== item.notesMarkdown) {
      dispatch({
        type: "patchItem",
        id: item.id,
        patch: { notesMarkdown: draft },
      });
    }
    dispatch({ type: "select", id: null });
  };
  useDialogFocus(
    Boolean(selectedItem),
    inspectorRef,
    nameInputRef,
    item?.id ?? "inspector-closed",
  );
  useEffect(() => {
    if (selectedItem) setNameDraft(selectedItem.displayName);
  }, [selectedItem]);
  useEffect(() => {
    if (selectedItem) return;
    setAddingLink(false);
    setLinkLabel("");
    setLinkUrl("");
    setConfirmingDelete(false);
    setDeleteConfirm("");
  }, [selectedItem]);
  useEffect(() => {
    setConfirmingDelete(false);
    setDeleteConfirm("");
  }, [item?.id]);
  if (!item) return null;
  const status = visibleStatus(item);
  const dueInput = dueInputValues(item, settings.timezone);
  const sourceSubject = subjects.find(
    (subject) => subject.canvasCourseId === item.canvasCourseId,
  );
  const sourceDifferences =
    item.sourceType === "canvas"
      ? [
          ...(item.sourceName !== item.displayName
            ? [
                {
                  fieldName: "name" as const,
                  label: "Canvas name",
                  value: item.sourceName ?? "Untitled",
                },
              ]
            : []),
          ...(item.sourceDueAt !== item.dueAt
            ? [
                {
                  fieldName: "due" as const,
                  label: "Canvas due date",
                  value: item.sourceDueAt
                    ? new Date(item.sourceDueAt).toLocaleString("en-AU", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "No due date",
                },
              ]
            : []),
          ...(sourceSubject && sourceSubject.id !== item.subjectId
            ? [
                {
                  fieldName: "subject" as const,
                  label: "Canvas subject",
                  value: sourceSubject.displayName,
                },
              ]
            : []),
        ]
      : [];
  return (
    <div
      className="inspector-backdrop"
      role="presentation"
      hidden={!selectedItem}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) close();
      }}
    >
      <aside
        ref={inspectorRef}
        className="inspector"
        hidden={!selectedItem}
        inert={!selectedItem}
        role="dialog"
        aria-modal="true"
        aria-hidden={!selectedItem}
        aria-label={`Details for ${item.displayName}`}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
          }
        }}
      >
        <header>
          <div className="inspector-title">
            <SubjectDot subjectId={item.subjectId} />
            <input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={(event) => {
                const displayName = event.target.value.trim();
                if (displayName && displayName !== item.displayName) {
                  dispatch({
                    type: "patchItem",
                    id: item.id,
                    patch: { displayName },
                  });
                } else if (!displayName) {
                  setNameDraft(item.displayName);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  event.currentTarget.blur();
                  close();
                }
              }}
              aria-label="Item name"
            />
          </div>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close details"
          >
            <X size={18} />
          </button>
        </header>
        {item.calendarSyncState === "conflict" ? (
          <ConflictBanner itemId={item.id} />
        ) : null}
        <DuplicateBanner item={item} />
        <div className="inspector-scroll">
          <OrganatoSelect
            className={`plain-select status-${status}`}
            ariaLabel="Status"
            options={statusOptions
              .filter((value) => item.kind !== "todo" || value !== "submitted")
              .map((value) => ({
                value,
                label: value.replaceAll("_", " "),
              }))}
            value={item.workingStatus}
            onChange={(value) =>
              dispatch({
                type: "patchItem",
                id: item.id,
                patch: {
                  workingStatus: value as typeof item.workingStatus,
                },
              })
            }
          />
          <dl className="property-list">
            <div>
              <dt>Due</dt>
              <dd>
                <span className="due-inputs">
                  <OrganatoDatePicker
                    ariaLabel="Due date"
                    value={dueInput.date}
                    onChange={(date) =>
                      dispatch({
                        type: "patchItem",
                        id: item.id,
                        patch: duePatchFromInputs(
                          date,
                          dueInput.time,
                          settings.timezone,
                        ),
                      })
                    }
                    placeholder="No due date"
                  />
                  <OrganatoSelect
                    ariaLabel="Due time (optional)"
                    disabled={!dueInput.date}
                    options={quarterHourOptions}
                    value={dueInput.time}
                    onChange={(time) =>
                      dispatch({
                        type: "patchItem",
                        id: item.id,
                        patch: duePatchFromInputs(
                          dueInput.date,
                          time,
                          settings.timezone,
                        ),
                      })
                    }
                  />
                </span>
                {item.sourceType === "canvas" &&
                item.overrides.some((entry) => entry.fieldName === "due") ? (
                  <button
                    className="icon-button"
                    aria-label="Reset due override"
                    onClick={() =>
                      dispatch({
                        type: "resetOverride",
                        id: item.id,
                        fieldName: "due",
                      })
                    }
                  >
                    <RotateCcw size={13} />
                  </button>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd>
                <OrganatoSelect
                  ariaLabel="Subject"
                  options={[
                    { value: "", label: "None" },
                    ...subjects.map((subject) => ({
                      value: subject.id,
                      label: subject.displayName,
                    })),
                  ]}
                  value={item.subjectId ?? ""}
                  onChange={(value) =>
                    dispatch({
                      type: "patchItem",
                      id: item.id,
                      patch: { subjectId: value || null },
                    })
                  }
                />
              </dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>
                <OrganatoSelect
                  ariaLabel="Priority"
                  options={[
                    { value: "", label: "Blank" },
                    { value: "low", label: "low" },
                    { value: "medium", label: "medium" },
                    { value: "high", label: "high" },
                    { value: "urgent", label: "urgent" },
                  ]}
                  value={item.priority ?? ""}
                  onChange={(value) =>
                    dispatch({
                      type: "patchItem",
                      id: item.id,
                      patch: {
                        priority: (value || null) as typeof item.priority,
                      },
                    })
                  }
                />
              </dd>
            </div>
            {item.kind === "work" ? (
              <div>
                <dt>Classification</dt>
                <dd>
                  <OrganatoSelect
                    ariaLabel="Classification"
                    options={[
                      { value: "assignment", label: "Assignment" },
                      { value: "checkpoint", label: "Checkpoint" },
                      { value: "both", label: "Both" },
                      { value: "unclassified", label: "Decide later" },
                    ]}
                    value={item.classification}
                    onChange={(value) =>
                      dispatch({
                        type: "classify",
                        id: item.id,
                        classification: value as typeof item.classification,
                      })
                    }
                  />
                </dd>
              </div>
            ) : null}
            {item.kind === "todo" ? (
              <div>
                <dt>Repeat</dt>
                <dd>
                  <OrganatoSelect
                    ariaLabel="Repeat"
                    options={[
                      { value: "", label: "Does not repeat" },
                      { value: "daily", label: "Daily" },
                      { value: "weekdays", label: "Weekdays" },
                      { value: "weekly", label: "Weekly" },
                      { value: "biweekly", label: "Every two weeks" },
                      { value: "monthly", label: "Monthly" },
                    ]}
                    value={item.recurrenceRule?.frequency ?? ""}
                    onChange={(value) => {
                      const frequency = value as NonNullable<
                        typeof item.recurrenceRule
                      >["frequency"];
                      const seriesId =
                        item.recurrenceSeriesId ?? crypto.randomUUID();
                      dispatch({
                        type: "patchItem",
                        id: item.id,
                        patch: value
                          ? {
                              recurrenceRule: {
                                frequency,
                                interval: 1,
                                seriesId,
                              },
                              recurrenceSeriesId: seriesId,
                            }
                          : {
                              recurrenceRule: null,
                              recurrenceSeriesId: null,
                            },
                      });
                    }}
                  />
                </dd>
              </div>
            ) : null}
          </dl>
          {item.sourceType === "canvas" ? (
            <section className="inspector-section source-section">
              <h2>Canvas source</h2>
              <p>
                {subjectsById.get(item.subjectId ?? "")?.sourceName ??
                  "Canvas course"}
              </p>
              <a
                href={item.canvasHtmlUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open assignment <ExternalLink size={13} />
              </a>
            </section>
          ) : null}
          <section className="inspector-section">
            <h2>Notes</h2>
            <textarea
              aria-label="Notes"
              ref={notesRef}
              defaultValue={item.notesMarkdown}
              onBlur={(event) => {
                if (event.target.value !== item.notesMarkdown) {
                  dispatch({
                    type: "patchItem",
                    id: item.id,
                    patch: { notesMarkdown: event.target.value },
                  });
                }
              }}
              placeholder="Add notes in Markdown…"
            />
          </section>
          <SubtaskSection item={item} />
          <section className="inspector-section">
            <h2>Linked attachments</h2>
            {item.attachments.length ? (
              item.attachments.map((attachment) => (
                <a
                  className="attachment-row"
                  key={attachment.id}
                  href={attachmentHref(attachment)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Link2 size={14} /> {attachment.label}{" "}
                  <ExternalLink size={12} />
                </a>
              ))
            ) : (
              <p className="empty-line">No links yet.</p>
            )}
            {addingLink ? (
              <form
                className="attachment-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  // Normalize instead of silently rejecting: trim stray
                  // whitespace and assume https when no scheme is pasted.
                  let url = linkUrl.trim();
                  if (url && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
                    url = `https://${url}`;
                  }
                  if (!linkLabel.trim() || !url.startsWith("https://")) {
                    setLinkError(
                      "Add a label and an https:// link (http links are not accepted).",
                    );
                    return;
                  }
                  setLinkError(null);
                  dispatch({
                    type: "addAttachment",
                    itemId: item.id,
                    label: linkLabel.trim(),
                    url,
                    linkType,
                  });
                  setLinkLabel("");
                  setLinkUrl("");
                  setLinkType("other");
                  setAddingLink(false);
                }}
              >
                <input
                  value={linkLabel}
                  onChange={(event) => setLinkLabel(event.target.value)}
                  placeholder="Link label"
                  aria-label="Link label"
                  required
                />
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  placeholder="https://…"
                  aria-label="HTTPS link"
                  pattern="https://.*"
                  required
                />
                <OrganatoSelect
                  ariaLabel="Link type"
                  options={[
                    { value: "reference", label: "Reference" },
                    { value: "brief", label: "Brief" },
                    { value: "rubric", label: "Rubric" },
                    {
                      value: "working_document",
                      label: "Working document",
                    },
                    { value: "other", label: "Other" },
                  ]}
                  value={linkType}
                  onChange={(value) => setLinkType(value as typeof linkType)}
                />
                <div>
                  <button type="submit">Add link</button>
                  <button type="button" onClick={() => setAddingLink(false)}>
                    Cancel
                  </button>
                </div>
                {linkError ? (
                  <p className="settings-inline-error" role="alert">
                    {linkError}
                  </p>
                ) : null}
              </form>
            ) : (
              <>
                <button
                  className="text-button"
                  onClick={() => {
                    setLinkError(null);
                    setAddingLink(true);
                  }}
                >
                  + Add a secure link
                </button>
                <button
                  className="text-button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? "Uploading…" : "+ Upload PDF / Word"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  aria-label="Upload a file attachment"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void uploadFile(file);
                  }}
                />
              </>
            )}
          </section>
          <section className="toggle-lines" aria-label="Automation">
            <label>
              <span>
                <CalendarDays size={15} /> Google Calendar
              </span>
              <input
                type="checkbox"
                checked={item.calendarEnabled}
                onChange={(event) =>
                  dispatch({
                    type: "patchItem",
                    id: item.id,
                    patch: {
                      calendarEnabled: event.target.checked,
                      calendarSyncState: event.target.checked
                        ? "pending"
                        : "suppressed",
                    },
                  })
                }
              />
            </label>
            <label>
              <span>✉ Email reminders</span>
              <input
                type="checkbox"
                checked={item.remindersEnabled}
                onChange={(event) =>
                  dispatch({
                    type: "patchItem",
                    id: item.id,
                    patch: { remindersEnabled: event.target.checked },
                  })
                }
              />
            </label>
          </section>
          {sourceDifferences.map((difference) => (
            <section className="source-comparison" key={difference.fieldName}>
              <p>
                <strong>{difference.label}</strong> · {difference.value}
              </p>
              <div>
                <button
                  onClick={() =>
                    dispatch({
                      type: "toast",
                      message: "Your Organato override remains active",
                    })
                  }
                >
                  Keep my value
                </button>
                <button
                  onClick={() =>
                    dispatch({
                      type: "resetOverride",
                      id: item.id,
                      fieldName: difference.fieldName,
                    })
                  }
                >
                  Use Canvas value
                </button>
              </div>
            </section>
          ))}
          <section className="inspector-section activity">
            <h2>Recent activity</h2>
            {item.history.slice(0, 5).map((entry) => (
              <div key={entry.id}>
                <span className="activity-dot" />{" "}
                <p>
                  {entry.summary}
                  <small>
                    {new Date(entry.createdAt).toLocaleString("en-AU")}
                  </small>
                </p>
              </div>
            ))}
          </section>
        </div>
        <button
          className="text-button"
          type="button"
          onClick={async () => {
            const url = `${window.location.origin}/items/${item.id}`;
            try {
              await navigator.clipboard.writeText(url);
              dispatch({ type: "toast", message: "Link copied" });
            } catch {
              dispatch({
                type: "toast",
                message: "Link copy failed — copy it from the address bar",
              });
            }
          }}
        >
          Copy link
        </button>
        <LinksSection item={item} />
        <section className="inspector-section" aria-label="Planning">
          <h2>Planning</h2>
          <EffortInput item={item} />
        </section>
        <section
          className="inspector-section inspector-manage"
          aria-label="Danger zone"
        >
          <h2>Manage</h2>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              if (item.kind === "todo") {
                dispatch({
                  type: "addTodo",
                  name: `${item.displayName} (copy)`,
                  dueAt: item.dueAt,
                  dueDateLocal: item.dueDateLocal,
                  dueHasExplicitTime: item.dueHasExplicitTime,
                  subjectId: item.subjectId,
                  priority: item.priority,
                  recurrenceRule: item.recurrenceRule,
                  calendarEnabled: item.calendarEnabled,
                  remindersEnabled: item.remindersEnabled,
                  notesMarkdown: item.notesMarkdown,
                  calendarNote: item.calendarNote,
                });
              } else {
                dispatch({
                  type: "addWork",
                  name: `${item.displayName} (copy)`,
                  classification:
                    item.classification === "unclassified"
                      ? "assignment"
                      : item.classification,
                  dueAt: item.dueAt,
                  dueDateLocal: item.dueDateLocal,
                  dueHasExplicitTime: item.dueHasExplicitTime,
                  subjectId: item.subjectId,
                  priority: item.priority,
                  notesMarkdown: item.notesMarkdown,
                  calendarNote: item.calendarNote,
                });
              }
              close();
            }}
          >
            Duplicate
          </button>
          <button
            className="text-button"
            type="button"
            aria-pressed={item.pinned}
            onClick={() =>
              dispatch({
                type: "patchItem",
                id: item.id,
                patch: { pinned: !item.pinned },
              })
            }
          >
            {item.pinned ? "Unpin" : "Pin to top"}
          </button>
          {item.archivedAt ? (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                dispatch({ type: "restore", id: item.id });
                close();
              }}
            >
              Restore from archive
            </button>
          ) : (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                dispatch({ type: "archive", id: item.id });
                close();
              }}
            >
              Archive
            </button>
          )}
          {confirmingDelete ? (
            <form
              className="attachment-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (deleteConfirm.trim().toLowerCase() !== "delete") return;
                dispatch({
                  type: "deleteItem",
                  id: item.id,
                  confirmation: "delete",
                });
                close();
              }}
            >
              <p className="empty-line">
                Permanently delete <strong>{item.displayName}</strong>? Type
                delete to confirm.
              </p>
              <input
                value={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.value)}
                placeholder="delete"
                aria-label="Type delete to confirm permanent deletion"
                autoComplete="off"
              />
              <div>
                <button
                  type="submit"
                  className="danger-button"
                  disabled={deleteConfirm.trim().toLowerCase() !== "delete"}
                >
                  Delete forever
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setDeleteConfirm("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              className="text-button danger-text"
              type="button"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete forever…
            </button>
          )}
        </section>
        <Link className="archive-button" to="/settings/data" onClick={close}>
          <Archive size={15} /> Manage archive in Settings
        </Link>
      </aside>
    </div>
  );
}
