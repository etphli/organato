import { useState } from "react";
import type { OrganatoItem } from "@organato/domain/core";
import { aiBreakdownSchema } from "@organato/domain/ai";
import { aiDemoMode, suggestBreakdown } from "../../lib/ai";
import { integrationRequest } from "../../lib/integrationApi";
import { useOrganatoActions } from "../../state/OrganatoProvider";
import { AiNotice } from "./AiNotice";
import { useAiAvailable, useAiSuggestion } from "./useAiSuggestion";
import "./ai.css";

type StepDraft = {
  id: string;
  title: string;
  minutes: number;
  included: boolean;
};

export function AiBreakdown({ item }: { item: OrganatoItem }) {
  const { dispatch } = useOrganatoActions();
  const available = useAiAvailable();
  const [brief, setBrief] = useState("");
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { state, generate, clear, edit } = useAiSuggestion<StepDraft[]>();
  const save = async (draft: StepDraft[]) => {
    const steps = draft.filter((step) => step.included);
    if (
      !aiBreakdownSchema.safeParse({
        steps: steps.map(({ title, minutes }) => ({ title, minutes })),
      }).success
    ) {
      setSaveError(
        "Select at least one step and give every selected step a title.",
      );
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const titles = steps.map(({ id, title }) => ({
        id,
        title: title.trim(),
      }));
      if (aiDemoMode)
        dispatch({ type: "appendSubtasks", itemId: item.id, steps: titles });
      else {
        const result = await integrationRequest<{ item: OrganatoItem }>(
          `/api/items/${encodeURIComponent(item.id)}/subtasks/batch`,
          { method: "POST", body: JSON.stringify({ steps: titles }) },
        );
        dispatch({ type: "replaceItem", item: result.item });
      }
      clear();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Steps could not be saved. You can retry safely.",
      );
    } finally {
      setSaving(false);
    }
  };
  if (!available && !aiDemoMode) return null;
  return (
    <section
      className="ai-panel ai-breakdown"
      aria-label="Assignment breakdown"
    >
      <header>
        <h2>Break into steps</h2>
        <span>{aiDemoMode ? "Demo" : "AI"}</span>
      </header>
      <label>
        Instructions to use, optional
        <textarea
          maxLength={6000}
          value={brief}
          onChange={(event) => {
            setBrief(event.target.value);
            clear();
          }}
          disabled={saving}
          placeholder="Paste the brief to get more specific planning steps. Your notes and files are not sent."
        />
      </label>
      <AiNotice
        scope="this assignment's title, deadline, checklist and any instructions pasted above"
        consent={consent}
        onConsent={setConsent}
      />
      <button
        type="button"
        disabled={
          !available ||
          saving ||
          state.kind === "loading" ||
          (!aiDemoMode && !consent)
        }
        onClick={() => {
          setSaveError(null);
          void generate(async (signal) =>
            (await suggestBreakdown(item, brief, signal)).steps
              .filter(
                (step) =>
                  !item.subtasks.some(
                    (existing) =>
                      existing.title.toLowerCase() === step.title.toLowerCase(),
                  ),
              )
              .map((step) => ({
                ...step,
                id: crypto.randomUUID(),
                included: true,
              })),
          );
        }}
      >
        {state.kind === "loading" ? "Planning…" : "Suggest steps"}
      </button>
      {state.kind === "loading" ? (
        <button type="button" onClick={clear}>
          Cancel
        </button>
      ) : null}
      {state.kind === "error" ? <p role="alert">{state.message}</p> : null}
      {state.kind === "ready" ? (
        <div className="ai-preview">
          <h3>Review suggested steps</h3>
          <p className="ai-note">
            Time estimates are approximate. Selected steps are added to your
            personal checklist; the assignment deadline stays unchanged.
          </p>
          {!state.value.length ? (
            <p>These steps are already in your checklist.</p>
          ) : null}
          {state.value.map((step, index) => (
            <div className="ai-step" key={step.id}>
              <input
                type="checkbox"
                aria-label={`Include step ${index + 1}`}
                checked={step.included}
                disabled={saving}
                onChange={(event) =>
                  edit((steps) =>
                    steps.map((entry) =>
                      entry.id === step.id
                        ? { ...entry, included: event.target.checked }
                        : entry,
                    ),
                  )
                }
              />
              <input
                aria-label={`Step ${index + 1} title`}
                value={step.title}
                maxLength={500}
                disabled={saving}
                onChange={(event) =>
                  edit((steps) =>
                    steps.map((entry) =>
                      entry.id === step.id
                        ? { ...entry, title: event.target.value }
                        : entry,
                    ),
                  )
                }
              />
              <small>~{step.minutes} min</small>
            </div>
          ))}
          <div className="ai-actions">
            <button
              type="button"
              disabled={saving || !state.value.some((step) => step.included)}
              onClick={() => void save(state.value)}
            >
              {saving ? "Adding…" : "Add selected steps"}
            </button>
            <button type="button" disabled={saving} onClick={clear}>
              Discard
            </button>
          </div>
        </div>
      ) : null}
      {saveError ? <p role="alert">{saveError}</p> : null}
    </section>
  );
}
