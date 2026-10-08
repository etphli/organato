import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { ArrowUp, Sparkles, X } from "lucide-react";
import {
  aiTaskSchema,
  type AiDestination,
  type AiTask,
} from "@organato/domain/ai";
import { aiDemoMode, suggestTask } from "../../lib/ai";
import { localDateTimeToIso } from "../../pages/calendar/model";
import {
  useOrganatoActions,
  useOrganatoData,
} from "../../state/OrganatoProvider";
import { AiNotice } from "./AiNotice";
import { useAiAvailable, useAiSuggestion } from "./useAiSuggestion";
import "./ai.css";

export type AiQuickAddHandle = { preview(): void };

export function AiQuickAdd({
  variant = "embedded",
  destination = "todo",
  externalText,
  onSaved,
  ref,
}: {
  variant?: "toolbar" | "embedded" | "palette";
  destination?: AiDestination;
  externalText?: string;
  onSaved?: () => void;
  ref?: Ref<AiQuickAddHandle>;
}) {
  const { subjects, settings } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  const available = useAiAvailable();
  const id = useId();
  const container = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [consent, setConsent] = useState(false);
  const { state, generate, clear, edit } = useAiSuggestion<AiTask>();
  const [saveError, setSaveError] = useState<string | null>(null);
  const value = externalText ?? text;
  const preview = () => {
    if (!available || !value.trim() || state.kind === "loading") return;
    setExpanded(true);
    if (!aiDemoMode && !consent) return;
    setSaveError(null);
    void generate((signal) =>
      suggestTask(value, subjects, settings.timezone, signal, destination),
    );
  };
  useImperativeHandle(ref, () => ({ preview }));
  const dismiss = () => {
    clear();
    setExpanded(false);
    setSaveError(null);
    input.current?.focus();
  };
  useEffect(() => {
    if (variant === "embedded") input.current?.focus();
  }, [variant]);
  useEffect(() => {
    clear();
    setExpanded(false);
  }, [externalText, clear]);
  useEffect(() => {
    if (variant !== "toolbar" || !expanded) return;
    const outside = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target)
      ) {
        clear();
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [variant, expanded, clear]);
  if (!available && !aiDemoMode) return null;
  return (
    <section
      ref={container}
      className={`ai-creation ai-creation--${variant}`}
      aria-label={
        destination === "work"
          ? "Natural-language assignment"
          : destination === "auto"
            ? "Natural-language task"
            : "Natural-language todo"
      }
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.stopPropagation();
          dismiss();
        }
      }}
    >
      {variant !== "palette" ? (
        <form
          className="ai-capture"
          onSubmit={(event) => {
            event.preventDefault();
            preview();
          }}
        >
          <Sparkles size={15} aria-hidden="true" />
          <input
            ref={input}
            id={id}
            aria-label="What needs doing?"
            required
            maxLength={2000}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              clear();
              setExpanded(false);
            }}
            placeholder={
              destination === "work"
                ? "English essay next Friday at 5pm…"
                : "Add a todo in your own words…"
            }
          />
          <button
            type="submit"
            aria-label={
              destination === "work" ? "Preview assignment" : "Preview todo"
            }
            aria-expanded={expanded}
            disabled={!value.trim() || state.kind === "loading"}
          >
            <ArrowUp size={15} aria-hidden="true" />
          </button>
        </form>
      ) : value.trim() ? (
        <button
          type="button"
          className="ai-palette-create"
          aria-label="Create from this description"
          onClick={preview}
          disabled={state.kind === "loading"}
        >
          <Sparkles size={16} aria-hidden="true" />
          <span>Create from this description</span>
          <small>Todo or assignment</small>
        </button>
      ) : null}
      {expanded ? (
        <div className="ai-creation-review ai-panel">
          <div className="ai-review-topline">
            <span>
              {state.kind === "loading"
                ? "Understanding your task…"
                : "Review before saving"}
            </span>
            <button
              type="button"
              className="ai-icon-button"
              onClick={dismiss}
              aria-label="Close preview"
            >
              <X size={14} />
            </button>
          </div>
          <AiNotice
            scope="this text and your subject names"
            consent={consent}
            onConsent={setConsent}
          />
          {!aiDemoMode && state.kind === "idle" ? (
            <button type="button" onClick={preview} disabled={!consent}>
              Preview task
            </button>
          ) : null}
          {state.kind === "loading" ? (
            <button type="button" onClick={dismiss}>
              Cancel
            </button>
          ) : null}
          {state.kind === "error" ? <p role="alert">{state.message}</p> : null}
          {state.kind === "ready" ? (
            <form
              className="ai-preview"
              onSubmit={(event) => {
                event.preventDefault();
                const parsed = aiTaskSchema.safeParse(state.value);
                if (!parsed.success) {
                  setSaveError("Check the title, date and time before saving.");
                  return;
                }
                const draft = parsed.data;
                const fields = {
                  name: draft.name,
                  subjectId: draft.subjectId,
                  priority: draft.priority,
                  dueAt:
                    draft.date && draft.time
                      ? localDateTimeToIso(
                          draft.date,
                          draft.time,
                          settings.timezone,
                        )
                      : null,
                  dueDateLocal: draft.time ? null : draft.date,
                  dueHasExplicitTime: Boolean(draft.time),
                };
                const preset = draft.subjectId
                  ? settings.subjectDefaults[draft.subjectId]
                  : undefined;
                if (draft.itemKind === "work") {
                  dispatch({
                    type: "addWork",
                    classification: "assignment",
                    ...fields,
                    calendarEnabled: preset?.calendarEnabled ?? true,
                    remindersEnabled: preset?.remindersEnabled ?? true,
                  });
                } else {
                  dispatch({
                    type: "addTodo",
                    ...fields,
                    calendarEnabled:
                      preset?.calendarEnabled ?? settings.todoCalendarDefault,
                    remindersEnabled:
                      preset?.remindersEnabled ?? settings.todoRemindersDefault,
                  });
                }
                setText("");
                clear();
                setSaveError(null);
                setExpanded(false);
                onSaved?.();
              }}
            >
              <div className="ai-review-heading">
                <h3>Ready to add</h3>
                <label className="ai-destination">
                  <span>Save to</span>
                  <select
                    aria-label="Save to"
                    value={state.value.itemKind}
                    onChange={(event) => {
                      const itemKind =
                        event.target.value === "work" ? "work" : "todo";
                      edit((draft) => ({ ...draft, itemKind }));
                    }}
                  >
                    <option value="todo">Todo</option>
                    <option value="work">Assignments</option>
                  </select>
                </label>
              </div>
              {state.value.clarification ? (
                <p>{state.value.clarification}</p>
              ) : null}
              <label>
                Title
                <input
                  required
                  maxLength={500}
                  value={state.value.name}
                  onChange={(event) =>
                    edit((draft) => ({ ...draft, name: event.target.value }))
                  }
                />
              </label>
              <div className="ai-fields">
                <label>
                  Subject
                  <select
                    value={state.value.subjectId ?? ""}
                    onChange={(event) =>
                      edit((draft) => ({
                        ...draft,
                        subjectId: event.target.value || null,
                      }))
                    }
                  >
                    <option value="">No subject</option>
                    {subjects
                      .filter((subject) => subject.active)
                      .map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.displayName}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Date
                  <input
                    type="date"
                    value={state.value.date ?? ""}
                    onChange={(event) =>
                      edit((draft) => ({
                        ...draft,
                        date: event.target.value || null,
                      }))
                    }
                  />
                </label>
                <label>
                  Time
                  <input
                    type="time"
                    value={state.value.time ?? ""}
                    onChange={(event) =>
                      edit((draft) => ({
                        ...draft,
                        time: event.target.value || null,
                      }))
                    }
                  />
                </label>
                <label>
                  Priority
                  <select
                    value={state.value.priority ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      const priority =
                        value === "low" ||
                        value === "medium" ||
                        value === "high" ||
                        value === "urgent"
                          ? value
                          : null;
                      edit((draft) => ({ ...draft, priority }));
                    }}
                  >
                    <option value="">No priority</option>
                    {["low", "medium", "high", "urgent"].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="ai-note">
                Dates and times use {settings.timezone}. Calendar and reminder
                defaults apply when saved.
              </p>
              {saveError ? <p role="alert">{saveError}</p> : null}
              <div className="ai-actions">
                <button type="submit">
                  {state.value.itemKind === "work"
                    ? "Save assignment"
                    : "Save todo"}
                </button>
                <button type="button" onClick={dismiss}>
                  Discard
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
