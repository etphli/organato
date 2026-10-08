import { useRef, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { nextCandidates, type AiNext } from "@organato/domain/ai";
import { aiDemoMode, suggestNext } from "../../lib/ai";
import {
  useOrganatoActions,
  useOrganatoData,
} from "../../state/OrganatoProvider";
import { AiNotice } from "./AiNotice";
import { useAiAvailable, useAiSuggestion } from "./useAiSuggestion";
import "./ai.css";

export function AiNextAction() {
  const { items, settings } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  const available = useAiAvailable();
  const [minutes, setMinutes] = useState(25);
  const [consent, setConsent] = useState(false);
  const { state, generate, clear } = useAiSuggestion<AiNext>();
  const snapshot = useRef<typeof items | null>(null);
  const candidates = nextCandidates(items, settings.timezone);
  const suggestedItem =
    state.kind === "ready" && snapshot.current === items
      ? candidates.find((item) => item.id === state.value.itemId)
      : undefined;
  if (!available && !aiDemoMode) return null;
  return (
    <section className="ai-panel ai-next" aria-label="What to do next">
      <div className="ai-next-toolbar">
        <div className="ai-next-heading">
          <span className="ai-next-icon">
            <Sparkles size={17} aria-hidden="true" />
          </span>
          <div>
            <h2>Next up</h2>
            <p>One clear step to move things along.</p>
          </div>
        </div>
        <div className="ai-next-controls">
          <label>
            <span className="ai-sr-only">Time available</span>
            <select
              aria-label="Time available"
              value={minutes}
              onChange={(event) => {
                setMinutes(Number(event.target.value));
                clear();
              }}
            >
              <option value={15}>15 min</option>
              <option value={25}>25 min</option>
              <option value={60}>1 hour</option>
            </select>
          </label>
          <button
            type="button"
            className="ai-primary-button"
            aria-label="Suggest next action"
            disabled={
              !available ||
              !candidates.length ||
              state.kind === "loading" ||
              (!aiDemoMode && !consent)
            }
            onClick={() => {
              snapshot.current = items;
              void generate((signal) =>
                suggestNext(items, settings.timezone, minutes, signal),
              );
            }}
          >
            {state.kind === "loading" ? "Choosing…" : "Find a next step"}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      {!aiDemoMode ? (
        <AiNotice
          scope="up to 15 unfinished task titles, deadlines, priorities, statuses, time estimates and unfinished checklist steps"
          consent={consent}
          onConsent={setConsent}
        />
      ) : null}
      {!candidates.length ? (
        <p>Nothing unblocked needs attention. Enjoy the space.</p>
      ) : null}
      {state.kind === "loading" ? (
        <button type="button" onClick={clear}>
          Cancel
        </button>
      ) : null}
      {state.kind === "error" ? <p role="alert">{state.message}</p> : null}
      {state.kind === "ready" && suggestedItem ? (
        <div className="ai-preview ai-next-result">
          <h3>{state.value.action}</h3>
          <p>
            {suggestedItem.displayName} · about {state.value.minutes} minutes
          </p>
          <details className="ai-next-reason">
            <summary>Why this task?</summary>
            <p>{state.value.reason}</p>
          </details>
          <button
            type="button"
            onClick={() => dispatch({ type: "select", id: suggestedItem.id })}
          >
            Open task <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {state.kind === "ready" && !suggestedItem ? (
        <p role="status">Your work changed. Generate a fresh suggestion.</p>
      ) : null}
    </section>
  );
}
