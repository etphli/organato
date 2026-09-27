import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  integrationRequest,
  resolveCalendarConflict,
} from "../../lib/integrationApi";
import { useOrganatoActions } from "../../state/OrganatoProvider";

type Conflict = {
  id: string;
  title: string;
  dueAt: string | null;
  dueDateLocal: string | null;
  workingStatus: string;
  archivedAt: string | null;
};

export function CalendarConflicts() {
  const { refresh } = useOrganatoActions();
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const result = await integrationRequest<{ conflicts: Conflict[] }>(
      "/api/integrations/google/conflicts",
    );
    setConflicts(result.conflicts);
  }, []);
  useEffect(() => {
    if (import.meta.env.VITE_DEMO_MODE === "true") {
      setConflicts([]);
      return;
    }
    void load().catch(() =>
      setError("Calendar conflicts could not be loaded."),
    );
  }, [load]);
  const resolve = async (id: string, strategy: "mine" | "theirs") => {
    setBusy(id);
    setError(null);
    try {
      await resolveCalendarConflict(id, strategy);
      await Promise.all([load(), refresh()]);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The conflict could not be resolved.",
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <section
      className="settings-block"
      aria-labelledby="calendar-conflicts-title"
    >
      <h3 id="calendar-conflicts-title">
        Calendar conflicts {conflicts?.length ? `(${conflicts.length})` : ""}
      </h3>
      <p>
        Choose which version to keep when an item changed in both places.
        Completed and archived items are included.
      </p>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            onClick={() =>
              void load()
                .then(() => setError(null))
                .catch(() =>
                  setError("Calendar conflicts could not be loaded."),
                )
            }
          >
            Retry
          </button>
        </p>
      ) : null}
      {conflicts === null && !error ? (
        <p role="status">Loading conflicts…</p>
      ) : null}
      {conflicts?.length === 0 ? (
        <p role="status">No calendar conflicts.</p>
      ) : null}
      {conflicts?.map((item) => (
        <article key={item.id} className="conflict-banner">
          <p>
            <strong>
              <Link to={`/items/${item.id}`}>{item.title}</Link>
            </strong>
            <br />
            Organato date:{" "}
            {item.dueDateLocal ??
              (item.dueAt ? new Date(item.dueAt).toLocaleString() : "No date")}
            {item.archivedAt
              ? " · Archived"
              : item.workingStatus === "complete" ||
                  item.workingStatus === "submitted"
                ? " · Completed"
                : ""}
          </p>
          <p>
            Keep Organato saves its current title, date and calendar note to
            Google. Use Google applies Google's current title, date and note
            here, or stops calendar inclusion if the event was deleted.
          </p>
          <div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void resolve(item.id, "mine")}
            >
              {busy === item.id ? "Saving…" : "Keep Organato"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void resolve(item.id, "theirs")}
            >
              Use Google
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
