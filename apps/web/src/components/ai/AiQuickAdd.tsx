import { useState } from "react";
import { aiTaskSchema, type AiTask } from "@organato/domain/ai";
import { aiDemoMode, suggestTask } from "../../lib/ai";
import { localDateTimeToIso } from "../../pages/calendar/model";
import {
  useOrganatoActions,
  useOrganatoData,
} from "../../state/OrganatoProvider";
import { AiNotice } from "./AiNotice";
import { useAiAvailable, useAiSuggestion } from "./useAiSuggestion";
import "./ai.css";

export function AiQuickAdd() {
  const { subjects, settings } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  const available = useAiAvailable();
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const { state, generate, clear, edit } = useAiSuggestion<AiTask>();
  const [saveError, setSaveError] = useState<string | null>(null);
  if (!available && !aiDemoMode) return null;
  return (
    <section className="ai-panel" aria-label="Natural-language todo">
      <header>
        <h2>Add a todo naturally</h2>
        <span>{aiDemoMode ? "Demo" : "AI"}</span>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSaveError(null);
          void generate((signal) =>
            suggestTask(text, subjects, settings.timezone, signal),
          );
        }}
      >
        <label htmlFor="ai-task-text">What needs doing?</label>
        <div className="ai-input-row">
          <input
            id="ai-task-text"
            required
            maxLength={2000}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              clear();
            }}
            placeholder="Finish my English draft next Thursday at 5pm, high priority"
          />
          <button
            disabled={
              !available ||
              state.kind === "loading" ||
              !text.trim() ||
              (!aiDemoMode && !consent)
            }
          >
            {state.kind === "loading" ? "Understanding…" : "Preview todo"}
          </button>
        </div>
        <AiNotice
          scope="this text and your subject names"
          consent={consent}
          onConsent={setConsent}
        />
        {!available && !aiDemoMode ? (
          <p className="ai-note">
            AI is unavailable. Use the usual New todo control.
          </p>
        ) : null}
      </form>
      {state.kind === "loading" ? (
        <button type="button" onClick={clear}>
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
            dispatch({
              type: "addTodo",
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
              calendarEnabled: settings.todoCalendarDefault,
              remindersEnabled: settings.todoRemindersDefault,
            });
            setText("");
            clear();
            setSaveError(null);
          }}
        >
          <h3>Review your todo</h3>
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
            <button type="submit">Save todo</button>
            <button type="button" onClick={clear}>
              Discard
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
