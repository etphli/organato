import "./AiSettingsSection.css";
import { useEffect, useState } from "react";
import { aiSettingsSchema, type AiSettings } from "@organato/domain/ai";
import { aiDemoMode } from "../../lib/ai";
import {
  integrationRequest,
  IntegrationRequestError,
  reauthenticate,
} from "../../lib/integrationApi";

export function AiSettingsSection() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [model, setModel] = useState("nvidia/nemotron-3-super-120b-a12b:free");
  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [needsReauth, setNeedsReauth] = useState(false);
  async function load(signal?: AbortSignal) {
    const result = aiSettingsSchema.parse(
      await integrationRequest<unknown>(
        "/api/ai/settings",
        signal ? { signal } : {},
      ),
    );
    setSettings(result);
    setModel(result.model);
    setEnabled(result.enabled);
  }
  useEffect(() => {
    if (aiDemoMode) return;
    const controller = new AbortController();
    void load(controller.signal).catch(() => {
      if (!controller.signal.aborted)
        setMessage("AI settings could not load. Reload to try again.");
    });
    return () => controller.abort();
  }, []);
  async function act(action: "save" | "test" | "remove") {
    setBusy(true);
    setMessage("");
    setNeedsReauth(false);
    try {
      await integrationRequest(
        action === "test" ? "/api/ai/test" : "/api/ai/settings",
        {
          method: action === "remove" ? "DELETE" : "POST",
          ...(action === "save"
            ? {
                body: JSON.stringify({
                  model,
                  enabled,
                  ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
                }),
              }
            : {}),
        },
      );
      setApiKey("");
      if (action !== "test") await load();
      setMessage(
        action === "save"
          ? "AI settings saved."
          : action === "test"
            ? "OpenRouter verified your saved key."
            : "Personal key removed. Installation defaults restored.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The request failed. Try again.",
      );
      setNeedsReauth(
        error instanceof IntegrationRequestError &&
          error.code === "reauthentication_required",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-block ai-settings">
      <h3>OpenRouter connection</h3>
      <p>
        Use your own API key for task capture, assignment steps, and next-action
        suggestions. Suggestions are reviewed before they change your work.
      </p>
      <p>
        Only free models are supported. Your key is encrypted on the server and
        excluded from backups. Task text and relevant planning details are sent
        to OpenRouter when you request a suggestion.
      </p>
      <p>
        <a
          href="https://openrouter.ai/settings/keys"
          target="_blank"
          rel="noreferrer"
        >
          Create an OpenRouter key
        </a>
      </p>
      {aiDemoMode ? (
        <p role="status">
          Demo workspace uses sample suggestions. API keys are configured in
          your signed-in workspace.
        </p>
      ) : (
        <>
          {settings ? (
            <p>
              {settings.hasKey
                ? "Personal key saved."
                : settings.sharedAvailable && !settings.personal
                  ? "Using the installation connection."
                  : "No personal key saved."}
            </p>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void act("save");
            }}
          >
            <fieldset disabled={busy || !settings}>
              <label className="field-row setting-row">
                <span>Enable AI suggestions</span>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
              </label>
              <label className="field-row setting-row">
                <span>
                  OpenRouter API key
                  <small>
                    {settings?.hasKey
                      ? "Leave blank to keep the saved key."
                      : "Paste a key from your OpenRouter account."}
                  </small>
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={settings?.hasKey ? "Key saved" : "Paste API key"}
                />
              </label>
              <label className="field-row setting-row">
                <span>
                  Model
                  <small>Enter an OpenRouter model ID ending in :free.</small>
                </span>
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  required
                  pattern="[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+:free"
                  aria-label="AI model"
                />
              </label>
              <div className="button-row">
                <button type="submit">
                  {busy ? "Working…" : "Save AI settings"}
                </button>
                <button
                  type="button"
                  disabled={!settings?.hasKey}
                  onClick={() => void act("test")}
                >
                  Test connection
                </button>
                <button
                  type="button"
                  disabled={!settings?.personal}
                  onClick={() => void act("remove")}
                >
                  Remove personal connection
                </button>
              </div>
            </fieldset>
          </form>
        </>
      )}
      {message ? <p role="status">{message}</p> : null}
      {needsReauth ? (
        <button onClick={() => void reauthenticate("/settings/ai")}>
          Confirm Google sign-in
        </button>
      ) : null}
    </div>
  );
}
