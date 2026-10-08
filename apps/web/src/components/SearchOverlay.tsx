import { History, Search, Settings2 } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { visibleStatus } from "@organato/domain/core";
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
  const [historyHits, setHistoryHits] = useState<
    Array<{
      summary: string;
      action: string;
      created_at: string;
      item_id: string;
      display_name: string;
    }>
  >([]);
  const [historyError, setHistoryError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    const needle = deferredQuery.trim();
    if (!searchOpen || needle.length < 2 || needle.includes(":")) {
      setHistoryHits([]);
      setHistoryError(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetch(`/api/search/all?q=${encodeURIComponent(needle)}`, {
        credentials: "same-origin",
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((result) => {
          if (cancelled) return;
          if (result) {
            setHistoryHits(result.history ?? []);
            setHistoryError(false);
          } else {
            setHistoryError(true);
          }
        })
        .catch(() => {
          if (!cancelled) setHistoryError(true);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [deferredQuery, searchOpen]);
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
    try {
      localStorage.setItem("organato_recent_searches", JSON.stringify(next));
    } catch {
      // Recent searches are a convenience; the search still works without them.
    }
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
  const allResults = [...matches, ...historyHits];
  const openResult = (index: number) => {
    const item = matches[index];
    if (item) {
      rememberSearch();
      dispatch({ type: "select", id: item.id });
      dispatch({ type: "search", open: false });
      return;
    }
    const history = historyHits[index - matches.length];
    if (history) {
      rememberSearch();
      dispatch({ type: "select", id: history.item_id });
      dispatch({ type: "search", open: false });
    }
  };
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
            aria-expanded="true"
            aria-controls="organato-search-listbox"
            aria-activedescendant={
              allResults.length
                ? `search-option-${Math.min(activeIndex, allResults.length - 1)}`
                : undefined
            }
            aria-describedby="search-hint"
            role="combobox"
            aria-autocomplete="list"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) =>
                  Math.min(current + 1, allResults.length - 1),
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter" && allResults.length) {
                event.preventDefault();
                openResult(Math.min(activeIndex, allResults.length - 1));
              }
            }}
            placeholder="Search work, todos, subjects, and notes…"
          />
        </label>
        <div
          className="search-results"
          role="listbox"
          id="organato-search-listbox"
          aria-label="Search results"
        >
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
          {matches.map((item, index) => (
            <button
              key={item.id}
              id={`search-option-${index}`}
              role="option"
              aria-selected={
                index === Math.min(activeIndex, allResults.length - 1)
              }
              className={
                index === Math.min(activeIndex, allResults.length - 1)
                  ? "is-active"
                  : ""
              }
              onMouseEnter={() => setActiveIndex(index)}
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
                  {item.kind === "todo" ? "Todo" : "Assignment"} ·{" "}
                  {visibleStatus(item).replaceAll("_", " ")}
                </small>
              </span>
            </button>
          ))}
          {!matches.length ? (
            <p className="empty-line">Nothing matches this search.</p>
          ) : null}
          {historyHits.length ? (
            <>
              <div className="search-group-label">History</div>
              {historyHits.map((entry, historyIndex) => {
                const optionIndex = matches.length + historyIndex;
                return (
                  <button
                    key={`${entry.item_id}-${entry.created_at}`}
                    id={`search-option-${optionIndex}`}
                    role="option"
                    aria-selected={
                      optionIndex ===
                      Math.min(activeIndex, allResults.length - 1)
                    }
                    className={
                      optionIndex ===
                      Math.min(activeIndex, allResults.length - 1)
                        ? "is-active"
                        : ""
                    }
                    onMouseEnter={() => setActiveIndex(optionIndex)}
                    onClick={() => {
                      rememberSearch();
                      dispatch({ type: "select", id: entry.item_id });
                      dispatch({ type: "search", open: false });
                    }}
                  >
                    <History size={15} aria-hidden="true" />
                    <span>
                      <strong>{entry.display_name}</strong>
                      <small>{entry.summary}</small>
                    </span>
                  </button>
                );
              })}
            </>
          ) : historyError ? (
            <p className="empty-line" role="status">
              History search is unavailable — item results above still work.
            </p>
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
        <footer id="search-hint">
          Try <code>subject:english</code>, <code>priority:high</code>, or{" "}
          <code>status:overdue</code>. Use ↑ ↓ then Enter to open a result.
        </footer>
      </section>
    </div>
  );
}
