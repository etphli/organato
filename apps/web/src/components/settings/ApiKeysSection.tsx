import { useEffect, useState } from "react";
import type { ApiKeyPermission, ApiKeySummary } from "@organato/domain";
import {
  integrationRequest,
  IntegrationRequestError,
  reauthenticate,
} from "../../lib/integrationApi";
import "./ApiKeysSection.css";

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

export function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [permission, setPermission] = useState<ApiKeyPermission>("read");
  const [expiry, setExpiry] = useState("90");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void integrationRequest<{ keys: ApiKeySummary[] }>("/api/keys", {
      signal: controller.signal,
    })
      .then((result) => {
        setKeys(result.keys);
        setError("");
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "API keys could not be loaded.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);

  async function createKey() {
    setBusy(true);
    setError("");
    setNeedsSignIn(false);
    setCopied(false);
    try {
      const result = await integrationRequest<{
        key: ApiKeySummary;
        token: string;
      }>("/api/keys", {
        method: "POST",
        body: JSON.stringify({
          name,
          permission,
          expiresAt:
            expiry === "never"
              ? null
              : new Date(
                  Date.now() + Number(expiry) * 86_400_000,
                ).toISOString(),
        }),
      });
      setKeys((current) => [result.key, ...current]);
      setToken(result.token);
      setName("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "API key could not be created.",
      );
      setNeedsSignIn(
        cause instanceof IntegrationRequestError &&
          cause.code === "reauthentication_required",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(id: string) {
    setBusy(true);
    setError("");
    try {
      await integrationRequest("/api/keys/" + encodeURIComponent(id), {
        method: "DELETE",
        body: "{}",
      });
      setKeys((current) =>
        current.map((key) =>
          key.id === id ? { ...key, revokedAt: new Date().toISOString() } : key,
        ),
      );
      setRevoking(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "API key could not be revoked.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="settings-block">
        <h3>Connect your own tools</h3>
        <p className="api-key-description">
          Create as many keys as you need. Each key can access only your
          workspace. Use a separate key for each integration so you can revoke
          it independently.
        </p>
        <p className="api-key-description">
          Read assignments, checkpoints, todos, and subjects. Read and write
          keys can also create and edit work, deadlines, priorities, notes, and
          checklists.
        </p>
        <a
          className="text-button"
          href="https://github.com/etphli/organato/blob/main/docs/16-organato-api.md"
          target="_blank"
          rel="noreferrer"
        >
          Read the API guide
        </a>
        <form
          className="api-key-form"
          onSubmit={(event) => {
            event.preventDefault();
            void createKey();
          }}
        >
          <label>
            Key name
            <input
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My study planner"
              disabled={busy || token !== null}
            />
          </label>
          <label>
            Access
            <select
              value={permission}
              onChange={(event) =>
                setPermission(
                  event.target.value === "read_write" ? "read_write" : "read",
                )
              }
              disabled={busy || token !== null}
            >
              <option value="read">Read only</option>
              <option value="read_write">Read and write</option>
            </select>
          </label>
          <label>
            Expires after
            <select
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
              disabled={busy || token !== null}
            >
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
              <option value="never">Never</option>
            </select>
          </label>
          <button
            className="api-key-primary"
            type="submit"
            disabled={loading || busy || !name.trim() || token !== null}
          >
            {busy ? "Saving…" : "Create API key"}
          </button>
        </form>
        {token ? (
          <div className="api-key-reveal" role="status">
            <h4>Save your API key now</h4>
            <p>
              This is the only time you can see the full key. Keep it private.
              Anyone with this key has the access you selected.
            </p>
            <label>
              Your new API key
              <textarea
                readOnly
                value={token}
                spellCheck={false}
                onFocus={(event) => event.target.select()}
              />
            </label>
            <div className="api-key-actions">
              <button
                className="api-key-secondary"
                onClick={() => {
                  void Promise.resolve()
                    .then(() => navigator.clipboard.writeText(token))
                    .then(() => setCopied(true))
                    .catch(() =>
                      setError(
                        "Copy failed. Select the key above and copy it manually.",
                      ),
                    );
                }}
              >
                {copied ? "Copied" : "Copy key"}
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setToken(null);
                  setCopied(false);
                }}
              >
                I've saved this key
              </button>
            </div>
          </div>
        ) : null}
        {error ? (
          <p className="settings-inline-error" role="alert">
            {error}
          </p>
        ) : null}
        {needsSignIn ? (
          <button
            className="api-key-secondary"
            onClick={() => {
              void reauthenticate("/settings/api").catch((cause: unknown) =>
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Sign-in could not be started.",
                ),
              );
            }}
          >
            Confirm Google sign-in
          </button>
        ) : null}
      </div>
      <div className="settings-block">
        <div className="settings-block-heading">
          <h3>Your API keys</h3>
          <span className="settings-count">
            {
              keys.filter(
                (key) =>
                  !key.revokedAt &&
                  (!key.expiresAt || Date.parse(key.expiresAt) > Date.now()),
              ).length
            }{" "}
            active
          </span>
        </div>
        {loading ? (
          <p className="settings-quiet-state">Loading API keys…</p>
        ) : keys.length === 0 ? (
          <p className="settings-quiet-state">
            No API keys yet. Create one to connect your tools.
          </p>
        ) : (
          <ul className="api-key-list">
            {keys.map((key) => {
              const expired =
                key.expiresAt !== null &&
                Date.parse(key.expiresAt) <= Date.now();
              return (
                <li key={key.id}>
                  <div>
                    <strong>{key.name}</strong>
                    <small>
                      <code>{key.prefix}…</code> ·{" "}
                      {key.permission === "read"
                        ? "Read only"
                        : "Read and write"}{" "}
                      ·{" "}
                      {key.revokedAt
                        ? "Revoked"
                        : expired
                          ? "Expired"
                          : "Active"}
                    </small>
                    <small>
                      Created {dateLabel(key.createdAt)} · Last used{" "}
                      {dateLabel(key.lastUsedAt)} · Expires{" "}
                      {dateLabel(key.expiresAt)}
                    </small>
                  </div>
                  {!key.revokedAt ? (
                    revoking === key.id ? (
                      <div className="api-key-confirm">
                        <p>
                          Revoke this key? Its integrations will lose access
                          immediately.
                        </p>
                        <div className="api-key-actions">
                          <button
                            className="api-key-danger"
                            disabled={busy}
                            onClick={() => void revokeKey(key.id)}
                          >
                            Confirm revoke
                          </button>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => setRevoking(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => setRevoking(key.id)}
                        aria-label={`Revoke ${key.name}`}
                      >
                        Revoke
                      </button>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {!loading ? (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setReload((current) => current + 1)}
          >
            Refresh keys
          </button>
        ) : null}
      </div>
    </>
  );
}
