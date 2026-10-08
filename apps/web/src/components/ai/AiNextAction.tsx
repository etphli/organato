import { useRef, useState } from "react";
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
    <section className="ai-panel" aria-label="What to do next">
      <header>
        <h2>What should I do next?</h2>
        <span>{aiDemoMode ? "Demo" : "AI"}</span>
      </header>
      <div className="ai-input-row">
        <label>
          Time available
          <select
            value={minutes}
            onChange={(event) => {
              setMinutes(Number(event.target.value));
              clear();
            }}
          >
            <option value={15}>15 minutes</option>
            <option value={25}>25 minutes</option>
            <option value={60}>60 minutes</option>
          </select>
        </label>
        <button
          type="button"
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
          {state.kind === "loading" ? "Choosing…" : "Suggest next action"}
        </button>
      </div>
      <AiNotice
        scope="up to 15 unfinished task titles, deadlines, priorities, statuses, time estimates and unfinished checklist steps"
        consent={consent}
        onConsent={setConsent}
      />
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
        <div className="ai-preview">
          <h3>{state.value.action}</h3>
          <p>
            {suggestedItem.displayName} · about {state.value.minutes} minutes
          </p>
          <p>{state.value.reason}</p>
          <button
            type="button"
            onClick={() => dispatch({ type: "select", id: suggestedItem.id })}
          >
            Open task
          </button>
        </div>
      ) : null}
      {state.kind === "ready" && !suggestedItem ? (
        <p role="status">Your work changed. Generate a fresh suggestion.</p>
      ) : null}
    </section>
  );
}
