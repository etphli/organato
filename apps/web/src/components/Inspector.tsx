import {
  Archive,
  CalendarDays,
  ExternalLink,
  Link2,
  RotateCcw,
  X,
} from "lucide-react";
import { useState } from "react";
import { visibleStatus } from "@organato/domain";
import { useOrganato } from "../state/OrganatoProvider";
import { SubjectDot } from "./SubjectDot";

const statusOptions = [
  "not_started",
  "in_progress",
  "submitted",
  "completed",
] as const;

export function Inspector() {
  const {
    selectedItem: item,
    subjects,
    subjectsById,
    dispatch,
  } = useOrganato();
  const [addingLink, setAddingLink] = useState(false);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkType, setLinkType] = useState<
    "reference" | "brief" | "rubric" | "working_document" | "other"
  >("other");
  if (!item) return null;
  const status = visibleStatus(item);
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
    <aside
      className="inspector"
      key={item.id}
      aria-label={`Details for ${item.displayName}`}
    >
      <header>
        <div className="inspector-title">
          <SubjectDot subjectId={item.subjectId} />
          <input
            defaultValue={item.displayName}
            onBlur={(event) => {
              const displayName = event.target.value.trim();
              if (displayName && displayName !== item.displayName) {
                dispatch({
                  type: "patchItem",
                  id: item.id,
                  patch: { displayName },
                });
              }
            }}
            aria-label="Item name"
          />
        </div>
        <button
          className="icon-button"
          onClick={() => dispatch({ type: "select", id: null })}
          aria-label="Close details"
        >
          <X size={18} />
        </button>
      </header>
      <div className="inspector-scroll">
        <select
          className={`plain-select status-${status}`}
          value={item.workingStatus}
          onChange={(event) =>
            dispatch({
              type: "patchItem",
              id: item.id,
              patch: {
                workingStatus: event.target.value as typeof item.workingStatus,
              },
            })
          }
          aria-label="Status"
        >
          {statusOptions
            .filter((value) => item.kind !== "todo" || value !== "submitted")
            .map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
        </select>
        <dl className="property-list">
          <div>
            <dt>Due</dt>
            <dd>
              <input
                type="datetime-local"
                value={item.dueAt?.slice(0, 16) ?? ""}
                onChange={(event) =>
                  dispatch({
                    type: "patchItem",
                    id: item.id,
                    patch: {
                      dueAt: event.target.value
                        ? new Date(event.target.value).toISOString()
                        : null,
                      dueHasExplicitTime: Boolean(event.target.value),
                    },
                  })
                }
              />
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
              <select
                value={item.subjectId ?? ""}
                onChange={(event) =>
                  dispatch({
                    type: "patchItem",
                    id: item.id,
                    patch: { subjectId: event.target.value || null },
                  })
                }
              >
                <option value="">None</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.displayName}
                  </option>
                ))}
              </select>
            </dd>
          </div>
          <div>
            <dt>Priority</dt>
            <dd>
              <select
                value={item.priority ?? ""}
                onChange={(event) =>
                  dispatch({
                    type: "patchItem",
                    id: item.id,
                    patch: {
                      priority: (event.target.value ||
                        null) as typeof item.priority,
                    },
                  })
                }
              >
                <option value="">Blank</option>
                <option>low</option>
                <option>medium</option>
                <option>high</option>
                <option>urgent</option>
              </select>
            </dd>
          </div>
          {item.kind === "work" ? (
            <div>
              <dt>Classification</dt>
              <dd>
                <select
                  value={item.classification}
                  onChange={(event) =>
                    dispatch({
                      type: "classify",
                      id: item.id,
                      classification: event.target
                        .value as typeof item.classification,
                    })
                  }
                >
                  <option value="assignment">Assignment</option>
                  <option value="checkpoint">Checkpoint</option>
                  <option value="both">Both</option>
                  <option value="unclassified">Decide later</option>
                </select>
              </dd>
            </div>
          ) : null}
          {item.kind === "todo" ? (
            <div>
              <dt>Repeat</dt>
              <dd>
                <select
                  value={item.recurrenceRule?.frequency ?? ""}
                  onChange={(event) => {
                    const frequency = event.target.value as NonNullable<
                      typeof item.recurrenceRule
                    >["frequency"];
                    const seriesId =
                      item.recurrenceSeriesId ?? crypto.randomUUID();
                    dispatch({
                      type: "patchItem",
                      id: item.id,
                      patch: event.target.value
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
                >
                  <option value="">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekdays">Weekdays</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every two weeks</option>
                  <option value="monthly">Monthly</option>
                </select>
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
        <section className="inspector-section">
          <h2>Linked attachments</h2>
          {item.attachments.length ? (
            item.attachments.map((attachment) => (
              <a
                className="attachment-row"
                key={attachment.id}
                href={attachment.url}
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
                if (!linkLabel.trim() || !linkUrl.startsWith("https://"))
                  return;
                dispatch({
                  type: "addAttachment",
                  itemId: item.id,
                  label: linkLabel.trim(),
                  url: linkUrl,
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
              <select
                aria-label="Link type"
                value={linkType}
                onChange={(event) =>
                  setLinkType(event.target.value as typeof linkType)
                }
              >
                <option value="reference">Reference</option>
                <option value="brief">Brief</option>
                <option value="rubric">Rubric</option>
                <option value="working_document">Working document</option>
                <option value="other">Other</option>
              </select>
              <div>
                <button type="submit">Add link</button>
                <button type="button" onClick={() => setAddingLink(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button className="text-button" onClick={() => setAddingLink(true)}>
              + Add a secure link
            </button>
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
        className="archive-button"
        onClick={() => dispatch({ type: "archive", id: item.id })}
      >
        <Archive size={15} /> Archive
      </button>
    </aside>
  );
}
