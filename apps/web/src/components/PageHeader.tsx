import type { ReactNode } from "react";
import { Command, RefreshCw, Search } from "lucide-react";
import {
  useOrganatoActions,
  useOrganatoUi,
  useOrganatoWorkspace,
} from "../state/OrganatoProvider";

export function PageHeader({
  title,
  meta,
  actions,
  creation,
  showSync = true,
}: {
  title: string;
  meta?: string;
  actions?: ReactNode;
  creation?: ReactNode;
  showSync?: boolean;
}) {
  const { integrations } = useOrganatoWorkspace();
  const { syncing } = useOrganatoUi();
  const { dispatch, syncNow } = useOrganatoActions();
  const canvas = integrations.find(
    (integration) => integration.provider === "canvas",
  );
  const syncUnavailable = canvas?.state === "disconnected";
  return (
    <header className={`page-header${creation ? " has-creation" : ""}`}>
      <div className="page-heading">
        <h1>{title}</h1>
        {meta ? <span>{meta}</span> : null}
      </div>
      {creation ? <div className="page-header-creation">{creation}</div> : null}
      <div className="page-actions">
        {actions ? <div className="page-context-actions">{actions}</div> : null}
        <div className="page-global-actions">
          <button
            className="text-button icon-labelled"
            onClick={() => dispatch({ type: "search", open: true })}
            aria-label="Search Organato"
          >
            <Search size={17} aria-hidden="true" />
            <span className="desktop-action-label">Search</span>
          </button>
          {showSync ? (
            syncUnavailable ? (
              <a
                className="text-button icon-labelled sync-action"
                href="/settings/canvas"
              >
                <RefreshCw size={16} aria-hidden="true" />
                <span>Connect Reshet</span>
              </a>
            ) : (
              <button
                className="text-button icon-labelled sync-action"
                onClick={syncNow}
                disabled={syncing}
                aria-label={syncing ? "Syncing Canvas" : "Sync Canvas now"}
              >
                <RefreshCw
                  size={16}
                  className={syncing ? "spin" : ""}
                  aria-hidden="true"
                />
                <span>{syncing ? "Syncing…" : "Sync"}</span>
              </button>
            )
          ) : null}
          <button
            className="shortcut-button"
            onClick={() => dispatch({ type: "command", open: true })}
            aria-label="Open command palette"
          >
            <Command size={15} aria-hidden="true" />
            <span aria-hidden="true">K</span>
          </button>
        </div>
      </div>
    </header>
  );
}
