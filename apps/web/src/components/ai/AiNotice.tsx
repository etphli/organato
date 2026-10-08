import { aiDemoMode } from "../../lib/ai";

export function AiNotice({
  consent,
  onConsent,
  scope,
}: {
  consent: boolean;
  onConsent: (value: boolean) => void;
  scope: string;
}) {
  if (aiDemoMode)
    return (
      <p className="ai-note">
        Demo suggestions run locally. No API key or external requests. Live AI
        may give different results.
      </p>
    );
  return (
    <label className="ai-consent">
      <input
        type="checkbox"
        checked={consent}
        onChange={(event) => onConsent(event.target.checked)}
      />
      <span>
        Send {scope} to the AI provider through OpenRouter for this suggestion.
      </span>
    </label>
  );
}
