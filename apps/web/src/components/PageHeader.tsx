import type { ReactNode } from "react";
import { Command, RefreshCw, Search } from "lucide-react";
import { useOrganato } from "../state/OrganatoProvider";

export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: string;
  actions?: ReactNode;
}) {
  const { dispatch, syncing, syncNow } = useOrganato();
  return (
    <header className="page-header">
      <div className="page-heading">
        <h1>{title}</h1>
        {meta ? <span>{meta}</span> : null}
      </div>
      <div className="page-actions">
        {actions}
        <button
          className="text-button icon-labelled"
          onClick={() => dispatch({ type: "search", open: true })}
        >
          <Search size={17} aria-hidden="true" />
          <span className="desktop-action-label">Search</span>
        </button>
        <button
          className="text-button icon-labelled"
          onClick={syncNow}
          disabled={syncing}
        >
          <RefreshCw
            size={16}
            className={syncing ? "spin" : ""}
            aria-hidden="true"
          />
          <span>{syncing ? "Syncing…" : "Sync now"}</span>
        </button>
        <button
          className="shortcut-button"
          onClick={() => dispatch({ type: "command", open: true })}
          aria-label="Open command palette"
        >
          <Command size={15} aria-hidden="true" /> K
        </button>
      </div>
    </header>
  );
}
