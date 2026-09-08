import { Search, Settings2 } from "lucide-react";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { visibleStatus } from "@organato/domain";
import {
  useOrganatoActions,
  useOrganatoData,
  useOrganatoUi,
} from "../state/OrganatoProvider";
import { SubjectDot } from "./SubjectDot";
import { useDialogFocus } from "./useDialogFocus";

function fuzzyIncludes(text: string, needle: string): boolean {
  let index = 0;
  for (const character of text) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

export function SearchOverlay() {
  const { items, subjectsById, settings } = useOrganatoData();
  const { searchOpen } = useOrganatoUi();
  const { dispatch } = useOrganatoActions();
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem("organato_recent_searches") ?? "[]",
      ) as string[];
    } catch {
      return [];
    }
  });
  const navigate = useNavigate();
  useDialogFocus(
    searchOpen,
    dialogRef,
    inputRef,
    searchOpen ? "search-open" : "search-closed",
  );
  const rememberSearch = () => {
    const value = query.trim();
    if (!settings.recentSearches || !value) return;
    const next = [value, ...recent.filter((entry) => entry !== value)].slice(
      0,
      6,
    );
    setRecent(next);
    localStorage.setItem("organato_recent_searches", JSON.stringify(next));
  };
  const matches = useMemo(() => {
    if (!searchOpen) return [];
    const needle = deferredQuery.trim().toLowerCase();
    if (!needle) return items.filter((item) => !item.archivedAt).slice(0, 6);
    const tokens = needle.split(/\s+/);
    // Collect top hits with early exit instead of scanning everything.
    const collected: typeof items = [];
    for (const item of items) {
      if (collected.length >= 12) break;
      const subject = item.subjectId
        ? subjectsById.get(item.subjectId)?.displayName
        : "";
      const text = `${item.displayName} ${subject} ${
        settings.searchNotes ? item.notesMarkdown : ""
      } ${visibleStatus(item)}`.toLowerCase();
      const hit = tokens.every((token) => {
        if (token.startsWith("subject:"))
          return subject?.toLowerCase().includes(token.slice(8));
        if (token.startsWith("priority:"))
          return item.priority === token.slice(9);
        if (token.startsWith("status:"))
          return visibleStatus(item) === token.slice(7);
        return (
          text.includes(token) ||
          (settings.fuzzySearch && fuzzyIncludes(text, token))
        );
      });
      if (hit) collected.push(item);
    }
    return collected;
  }, [
    deferredQuery,
    items,
    searchOpen,
    settings.fuzzySearch,
    settings.searchNotes,
    subjectsById,
  ]);
  if (!searchOpen) return null;
  return (
    <div
      className="overlay search-layer"
      role="presentation"
      onMouseDown={() => dispatch({ type: "search", open: false })}
    >
      <section
        ref={dialogRef}
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search Organato"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label className="search-input">
          <Search size={19} aria-hidden="true" />
          <input
            ref={inputRef}
            aria-label="Search Organato"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search work, todos, subjects, and notes…"
          />
        </label>
        <div className="search-results">
          {!query && settings.recentSearches && recent.length ? (
            <div className="recent-searches" aria-label="Recent searches">
              {recent.map((entry) => (
                <button key={entry} onClick={() => setQuery(entry)}>
                  {entry}
                </button>
              ))}
            </div>
          ) : null}
          <div className="search-group-label">Items</div>
          {matches.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                rememberSearch();
                dispatch({ type: "select", id: item.id });
                dispatch({ type: "search", open: false });
              }}
            >
              <SubjectDot subjectId={item.subjectId} />
              <span>
                <strong>{item.displayName}</strong>
                <small>
                  {item.kind === "todo" ? "Todo" : item.classification} ·{" "}
                  {visibleStatus(item).replaceAll("_", " ")}
                </small>
              </span>
            </button>
          ))}
          {!matches.length ? (
            <p className="empty-line">Nothing matches this search.</p>
          ) : null}
          <button
            className="settings-result"
            onClick={() => {
              navigate("/settings");
              dispatch({ type: "search", open: false });
            }}
          >
            <Settings2 size={16} /> Search settings
          </button>
        </div>
        <footer>
          Try <code>subject:english</code>, <code>priority:high</code>, or{" "}
          <code>status:overdue</code>.
        </footer>
      </section>
    </div>
  );
}
