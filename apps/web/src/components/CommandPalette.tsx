import {
  Archive,
  CalendarDays,
  CheckSquare2,
  ClipboardList,
  Download,
  Flag,
  Home,
  Moon,
  RefreshCw,
  Settings,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useOrganatoActions,
  useOrganatoUi,
  useOrganatoWorkspace,
} from "../state/OrganatoProvider";
import { useDialogFocus } from "./useDialogFocus";

const baseCommands = [
  { label: "Go to Home", icon: Home, path: "/" },
  { label: "Go to Assignments", icon: ClipboardList, path: "/assignments" },
  { label: "Go to Checkpoints", icon: Flag, path: "/checkpoints" },
  { label: "Go to Calendar", icon: CalendarDays, path: "/calendar" },
  { label: "Create todo", icon: CheckSquare2, path: "/todo?new=1" },
  { label: "Search archive", icon: Archive, path: "/settings/data" },
  { label: "Open Settings", icon: Settings, path: "/settings" },
  { label: "Export backup", icon: Download, path: "/settings/data" },
];

export function CommandPalette() {
  const { settings } = useOrganatoWorkspace();
  const { commandOpen } = useOrganatoUi();
  const { dispatch, syncNow } = useOrganatoActions();
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  useDialogFocus(
    commandOpen,
    dialogRef,
    inputRef,
    commandOpen ? "command-open" : "command-closed",
  );
  const commands = useMemo(
    () =>
      commandOpen
        ? [
            ...baseCommands,
            { label: "Sync now", icon: RefreshCw, action: syncNow },
            {
              label: "Toggle theme",
              icon: Moon,
              action: () =>
                dispatch({
                  type: "settings",
                  patch: {
                    theme: settings.theme === "light" ? "obsidian" : "light",
                  },
                }),
            },
          ]
        : [],
    [commandOpen, dispatch, settings.theme, syncNow],
  );
  const filtered = useMemo(
    () =>
      commands.filter((command) =>
        command.label.toLowerCase().includes(query.toLowerCase()),
      ),
    [commands, query],
  );

  useEffect(() => {
    if (!commandOpen) {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [commandOpen]);
  useEffect(() => setSelectedIndex(0), [query]);
  if (!commandOpen) return null;
  const runCommand = (command: (typeof commands)[number]) => {
    if ("path" in command && command.path) navigate(command.path);
    if ("action" in command && command.action) command.action();
    dispatch({ type: "command", open: false });
  };
  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={() => dispatch({ type: "command", open: false })}
    >
      <section
        ref={dialogRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelectedIndex((index) =>
                Math.min(index + 1, filtered.length - 1),
              );
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelectedIndex((index) => Math.max(index - 1, 0));
            }
            if (event.key === "Enter" && filtered[selectedIndex]) {
              event.preventDefault();
              runCommand(filtered[selectedIndex]);
            }
          }}
          placeholder="Type a command…"
          aria-label="Command"
        />
        <div className="command-list">
          {filtered.map((command, index) => {
            const { label, icon: Icon } = command;
            return (
              <button
                key={label}
                className={index === selectedIndex ? "active" : ""}
                onClick={() => runCommand(command)}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
          {!filtered.length ? (
            <p className="empty-line">No matching command.</p>
          ) : null}
        </div>
        {settings.showKeyboardHints ? (
          <footer>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate <kbd>Enter</kbd> run <kbd>Esc</kbd> close
          </footer>
        ) : null}
      </section>
    </div>
  );
}
