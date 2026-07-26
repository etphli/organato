import {
  Archive,
  Check,
  Download,
  ExternalLink,
  FileJson,
  KeyRound,
  RotateCcw,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  assertSecretFreeBackup,
  validateBackup,
  type WorkspaceSnapshot,
} from "@organato/domain";
import { PageHeader } from "../components/PageHeader";
import { SubjectDot } from "../components/SubjectDot";
import { AccountAccessSection } from "../components/settings/AccountAccessSection";
import { CanvasConnectionSection } from "../components/settings/CanvasConnectionSection";
import {
  SettingsNavigation,
  settingsCategories,
} from "../components/settings/SettingsNavigation";
import { useOrganato } from "../state/OrganatoProvider";

const genericOptions: Record<string, Array<[string, string]>> = {
  home: [
    [
      "Auto-expand classification inbox",
      "New imports stay visible until classified.",
    ],
    ["Show mini calendar", "Use the compact month on desktop."],
    ["Show quick todo", "Keep fast creation on Home."],
    ["Include Both in both panels", "Both remains one underlying record."],
    ["Show workload strip", "Summarise the next seven days."],
  ],
  work: [
    ["Sticky Name column", "Keep identity visible on wide tables."],
    ["Inline editing", "Save cell changes immediately."],
    ["Show source icons", "Canvas and override signals."],
    ["Show Submitted in active tables", "Do not archive automatically."],
    ["Ask before bulk archive", "Archive remains reversible."],
  ],
  todo: [
    [
      "Natural shorthand parsing",
      "Preview ambiguous date, subject, and priority.",
    ],
    ["Calendar inclusion by default", "New dated todos get one event."],
    ["Reminder inclusion by default", "Incomplete work can enter the digest."],
    [
      "Generate recurrence on completion",
      "Never create an unbounded future series.",
    ],
    ["Show attachment indicator", "Links only in version one."],
  ],
  search: [
    ["Include notes", "Search private Markdown notes."],
    ["Fuzzy matching", "Allow close text matches."],
    ["Recent searches", "Saved on this device only."],
    ["Show keyboard hints", "Keep shortcuts discoverable."],
    ["Multi-key navigation sequences", "G then H, A, C, T, or L."],
  ],
  accessibility: [
    ["Respect reduced motion", "System setting is the default."],
    ["Increase contrast", "Strengthen borders and secondary text."],
    ["Underline external links", "Never rely on the icon alone."],
    ["Always show text with icons", "Improve control recognition."],
    [
      "Screen-reader save announcements",
      "Announce sync and mutation outcomes.",
    ],
  ],
};

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ToggleRows({ category }: { category: string }) {
  const { settings, dispatch } = useOrganato();
  const settingFields: Record<string, keyof typeof settings> = {
    "Auto-expand classification inbox": "autoExpandClassification",
    "Show mini calendar": "showMiniCalendar",
    "Show quick todo": "showQuickTodo",
    "Include Both in both panels": "includeBothInPanels",
    "Show workload strip": "showWorkloadStrip",
    "Sticky Name column": "stickyNameColumn",
    "Inline editing": "inlineEditing",
    "Show source icons": "showSourceIcons",
    "Show Submitted in active tables": "showSubmittedActive",
    "Ask before bulk archive": "confirmBulkArchive",
    "Natural shorthand parsing": "naturalTodoParsing",
    "Calendar inclusion by default": "todoCalendarDefault",
    "Reminder inclusion by default": "todoRemindersDefault",
    "Generate recurrence on completion": "recurrenceOnCompletion",
    "Show attachment indicator": "showAttachmentIndicator",
    "Include notes": "searchNotes",
    "Fuzzy matching": "fuzzySearch",
    "Recent searches": "recentSearches",
    "Show keyboard hints": "showKeyboardHints",
    "Multi-key navigation sequences": "multiKeyNavigation",
    "Respect reduced motion": "reduceMotion",
    "Increase contrast": "highContrast",
    "Underline external links": "underlineExternalLinks",
    "Always show text with icons": "alwaysShowIconText",
    "Screen-reader save announcements": "screenReaderAnnouncements",
  };
  return (
    <div className="setting-list">
      {(genericOptions[category] ?? []).map(([label, description]) => (
        <label className="setting-row" key={label}>
          <span>
            <strong>{label}</strong>
            <small>{description}</small>
          </span>
          <input
            type="checkbox"
            checked={Boolean(settings[settingFields[label]!])}
            onChange={(event) => {
              const field = settingFields[label]!;
              dispatch({
                type: "settings",
                patch: {
                  [field]: event.target.checked,
                } as Partial<typeof settings>,
              });
            }}
          />
        </label>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const { pathname } = useLocation();
  const active =
    settingsCategories.find(([id]) => pathname.endsWith(`/${id}`))?.[0] ??
    "account";
  const { items, subjects, settings, integrations, views, dispatch, refresh } =
    useOrganato();
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<WorkspaceSnapshot | null>(
    null,
  );
  const [connectionBusy, setConnectionBusy] = useState<string | null>(null);
  const [addingSubject, setAddingSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectColour, setNewSubjectColour] = useState("#a78bfa");
  const fileInput = useRef<HTMLInputElement>(null);
  const archived = items.filter((item) => item.archivedAt);
  const activeCount = items.filter((item) => !item.archivedAt).length;
  const completedCount = items.filter(
    (item) => item.workingStatus === "completed",
  ).length;
  const classifiedWithinDay = items.filter((item) =>
    item.history.some(
      (entry) =>
        entry.action === "classified" &&
        new Date(entry.createdAt).getTime() >= Date.now() - 86_400_000,
    ),
  ).length;
  const snapshot = useMemo<WorkspaceSnapshot>(
    () => ({
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      subjects,
      items,
      savedViews: views,
    }),
    [items, settings, subjects, views],
  );

  const exportJson = () => {
    const output = JSON.stringify(snapshot, null, 2);
    if (!assertSecretFreeBackup(output))
      throw new Error("Backup safety check failed.");
    download("organato-backup.json", output, "application/json");
    dispatch({ type: "toast", message: "Secret-free backup exported" });
  };
  const handleImport = async (file: File) => {
    const text = await file.text();
    if (text.length > 25_000_000) {
      setImportSummary("The file is too large. Nothing was changed.");
      return;
    }
    try {
      const parsed = JSON.parse(text) as Partial<WorkspaceSnapshot>;
      const validation = validateBackup(parsed);
      if (!validation.success) {
        setPendingImport(null);
        setImportSummary(
          `Validation failed · ${validation.error.issues[0]?.message ?? "invalid backup"}`,
        );
        return;
      }
      const backup = validation.data as WorkspaceSnapshot;
      if (import.meta.env.VITE_DEMO_MODE !== "true") {
        const response = await fetch("/api/import/preview", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": sessionStorage.getItem("organato_csrf") ?? "",
          },
          body: JSON.stringify(backup),
        });
        const result = (await response.json()) as {
          error?: string;
          dryRun?: {
            items: number;
            subjects: number;
            savedViews: number;
            mode: string;
          };
        };
        if (!response.ok || !result.dryRun) {
          throw new Error(result.error ?? "Restore preview failed safely.");
        }
        setImportSummary(
          `Dry run · ${result.dryRun.items} items · ${result.dryRun.subjects} subjects · ${result.dryRun.savedViews} views · ${result.dryRun.mode}`,
        );
        setPendingImport(backup);
        return;
      }
      setImportSummary(
        `Dry run · ${backup.items.length} items · ${backup.subjects.length} subjects · ${backup.savedViews.length} views · merge`,
      );
      setPendingImport(backup);
    } catch (error) {
      setImportSummary(
        error instanceof SyntaxError
          ? "This is not valid JSON. Nothing was changed."
          : error instanceof Error
            ? error.message
            : "Restore preview failed safely. Nothing was changed.",
      );
    }
  };
  const applyImport = async () => {
    if (!pendingImport) return;
    const confirmation = window.prompt(
      "Type RESTORE ORGANATO to create a pre-restore backup and merge this file.",
    );
    if (confirmation !== "RESTORE ORGANATO") {
      setImportSummary("Restore cancelled. Nothing was changed.");
      return;
    }
    setConnectionBusy("restore");
    try {
      if (import.meta.env.VITE_DEMO_MODE === "true") {
        exportJson();
        const mergeById = <T extends { id: string }>(
          current: T[],
          imported: T[],
        ) => [
          ...current.filter(
            (entry) => !imported.some((value) => value.id === entry.id),
          ),
          ...imported,
        ];
        dispatch({
          type: "hydrate",
          items: mergeById(items, pendingImport.items),
          subjects: mergeById(subjects, pendingImport.subjects),
          settings: pendingImport.settings,
          integrations,
          views: mergeById(views, pendingImport.savedViews),
        });
        setPendingImport(null);
        setImportSummary(
          "Restore merged successfully · pre-restore backup saved",
        );
        return;
      }
      const backupResponse = await fetch("/api/export", {
        credentials: "same-origin",
      });
      const preRestoreBackup = await backupResponse.text();
      if (!backupResponse.ok || !assertSecretFreeBackup(preRestoreBackup)) {
        throw new Error(
          "The required pre-restore backup could not be created.",
        );
      }
      download(
        `organato-pre-restore-${new Date().toISOString().slice(0, 10)}.json`,
        preRestoreBackup,
        "application/json",
      );
      const response = await fetch("/api/import/apply", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": sessionStorage.getItem("organato_csrf") ?? "",
        },
        body: JSON.stringify({
          backup: pendingImport,
          confirmation,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        merged?: { items: number; subjects: number; savedViews: number };
      };
      if (!response.ok || !result.merged) {
        throw new Error(result.error ?? "Restore could not be applied.");
      }
      setPendingImport(null);
      setImportSummary(
        `Restored · ${result.merged.items} items · ${result.merged.subjects} subjects · ${result.merged.savedViews} views`,
      );
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setImportSummary(
        error instanceof Error
          ? error.message
          : "Restore failed safely. Use the pre-restore backup if needed.",
      );
    } finally {
      setConnectionBusy(null);
    }
  };
  const protectedPost = async (
    path: string,
    body?: Record<string, unknown>,
  ) => {
    if (import.meta.env.VITE_DEMO_MODE === "true") {
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      return { ok: true, demo: true };
    }
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": sessionStorage.getItem("organato_csrf") ?? "",
      },
      body: JSON.stringify(body ?? {}),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      authorizationUrl?: string;
    };
    if (!response.ok)
      throw new Error(result.error ?? "The connection could not be updated.");
    return result;
  };
  const reauthenticate = async () => {
    if (import.meta.env.VITE_DEMO_MODE === "true") {
      dispatch({
        type: "toast",
        message: "Production reauthentication returns to Google sign-in",
      });
      return;
    }
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    window.location.reload();
  };
  const revokeAllSessions = async () => {
    if (!window.confirm("Revoke every Organato session, including this one?"))
      return;
    await protectedPost("/api/sessions/revoke-all");
    if (import.meta.env.VITE_DEMO_MODE === "true") {
      dispatch({ type: "toast", message: "All demo sessions revoked" });
      return;
    }
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    window.location.reload();
  };
  const downloadDiagnostic = async () => {
    if (import.meta.env.VITE_DEMO_MODE === "true") {
      download(
        "organato-diagnostic.json",
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            app: { name: "Organato", version: "0.1.0", schemaVersion: 1 },
            counts: { items: items.length, subjects: subjects.length },
            integrations: integrations.map(
              ({ provider, state, lastError }) => ({
                provider,
                state,
                lastError,
              }),
            ),
            secretsIncluded: false,
            mode: "redacted-demo",
          },
          null,
          2,
        ),
        "application/json",
      );
      return;
    }
    const response = await fetch("/api/diagnostic", {
      credentials: "same-origin",
    });
    const text = await response.text();
    if (!response.ok) throw new Error("Diagnostic could not be generated.");
    download("organato-diagnostic.json", text, "application/json");
  };
  const runAdvancedAction = async (label: string) => {
    if (label === "Clear non-secret device preferences") {
      localStorage.removeItem("organato_recent_searches");
      sessionStorage.removeItem("organato_recent_commands");
      dispatch({
        type: "toast",
        message: "Non-secret device preferences cleared",
      });
      return;
    }
    if (label === "Enable verbose sanitized diagnostics") {
      const enabled =
        sessionStorage.getItem("organato_verbose_diagnostics") !== "true";
      sessionStorage.setItem("organato_verbose_diagnostics", String(enabled));
      dispatch({
        type: "toast",
        message: `Sanitized diagnostics ${enabled ? "enabled for this session" : "disabled"}`,
      });
      return;
    }
    const paths: Record<string, string> = {
      "Force Canvas full rescan": "/api/integrations/canvas/sync",
      "Rebuild missing Calendar events": "/api/integrations/google/rebuild",
      "Clear Calendar incremental sync token":
        "/api/integrations/google/clear-sync-token",
    };
    await protectedPost(paths[label]!);
    dispatch({ type: "toast", message: `${label} completed` });
  };

  return (
    <div className="page settings-page">
      <PageHeader title="Settings" showSync={false} />
      <div className="settings-layout">
        <SettingsNavigation active={active} />
        <section className="settings-content">
          {active !== "canvas" ? (
            <h2>{settingsCategories.find(([id]) => id === active)?.[1]}</h2>
          ) : null}
          {active === "account" ? <AccountAccessSection /> : null}
          {active === "appearance" ? (
            <div className="settings-block">
              <h3>Interface</h3>
              <label className="field-row">
                <span>
                  Theme
                  <small>Surfaces change; semantic meaning does not.</small>
                </span>
                <select
                  value={settings.theme}
                  onChange={(event) =>
                    dispatch({
                      type: "settings",
                      patch: {
                        theme: event.target.value as typeof settings.theme,
                      },
                    })
                  }
                >
                  <option value="obsidian">Obsidian Dark</option>
                  <option value="pure_black">Pure Black</option>
                  <option value="soft_dark">Soft Dark</option>
                  <option value="light">Light</option>
                  <option value="system">System</option>
                </select>
              </label>
              <label className="field-row">
                <span>Density</span>
                <select
                  value={settings.density}
                  onChange={(event) =>
                    dispatch({
                      type: "settings",
                      patch: {
                        density: event.target.value as typeof settings.density,
                      },
                    })
                  }
                >
                  <option value="compact">Compact</option>
                  <option value="comfortable">Comfortable</option>
                </select>
              </label>
              <label className="field-row">
                <span>
                  Font size <small>90–120%</small>
                </span>
                <input
                  type="range"
                  min=".9"
                  max="1.2"
                  step=".05"
                  value={settings.fontScale}
                  onChange={(event) =>
                    dispatch({
                      type: "settings",
                      patch: { fontScale: Number(event.target.value) },
                    })
                  }
                />
              </label>
            </div>
          ) : null}
          {genericOptions[active] ? <ToggleRows category={active} /> : null}
          {active === "calendar" ? (
            <>
              <div className="settings-block">
                <h3>Internal calendar</h3>
                <label className="field-row">
                  <span>Default view</span>
                  <select
                    value={settings.calendarDefaultView}
                    onChange={(event) =>
                      dispatch({
                        type: "settings",
                        patch: {
                          calendarDefaultView: event.target
                            .value as typeof settings.calendarDefaultView,
                        },
                      })
                    }
                  >
                    <option value="month">Month</option>
                    <option value="week">Week</option>
                    <option value="agenda">Agenda</option>
                  </select>
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Drag to reschedule</strong>
                    <small>
                      Canvas items receive a durable due-date override.
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.dragCalendarReschedule}
                    onChange={(event) =>
                      dispatch({
                        type: "settings",
                        patch: {
                          dragCalendarReschedule: event.target.checked,
                        },
                      })
                    }
                  />
                </label>
              </div>
              <IntegrationCard provider="google_calendar" />
            </>
          ) : null}
          {active === "canvas" ? (
            <CanvasConnectionSection onWorkspaceRefresh={refresh} />
          ) : null}
          {active === "email" ? (
            <>
              <IntegrationCard provider="gmail" />
              <div className="settings-block">
                <h3>Schedule</h3>
                <label className="setting-row">
                  <span>
                    <strong>Daily digest</strong>
                    <small>
                      One message only when work is due within seven days.
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.dailyDigestEnabled}
                    onChange={(event) =>
                      dispatch({
                        type: "settings",
                        patch: { dailyDigestEnabled: event.target.checked },
                      })
                    }
                  />
                </label>
                <div className="locked-setting">
                  <Check size={15} /> 6:00 AM · Australia/Sydney · highlights 7,
                  3, 2, and 1 days
                </div>
                <label className="setting-row">
                  <span>
                    <strong>Immediate short-notice import alert</strong>
                    <small>
                      At most one message for the entire Canvas sync batch.
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.immediateImportAlert}
                    onChange={(event) =>
                      dispatch({
                        type: "settings",
                        patch: { immediateImportAlert: event.target.checked },
                      })
                    }
                  />
                </label>
              </div>
            </>
          ) : null}
          {active === "subjects" ? (
            <div className="settings-block">
              <h3>Subjects</h3>
              {subjects.map((subject) => (
                <div className="subject-setting" key={subject.id}>
                  <SubjectDot subjectId={subject.id} />
                  <input
                    aria-label={`${subject.displayName} display name`}
                    defaultValue={subject.displayName}
                    onBlur={(event) =>
                      event.target.value.trim() &&
                      dispatch({
                        type: "patchSubject",
                        id: subject.id,
                        patch: { displayName: event.target.value.trim() },
                      })
                    }
                  />
                  <input
                    aria-label={`${subject.displayName} short name`}
                    defaultValue={subject.shortName ?? ""}
                    maxLength={12}
                    onBlur={(event) =>
                      dispatch({
                        type: "patchSubject",
                        id: subject.id,
                        patch: { shortName: event.target.value || null },
                      })
                    }
                  />
                  <input
                    aria-label={`${subject.displayName} colour`}
                    type="color"
                    value={subject.colour}
                    onChange={(event) =>
                      dispatch({
                        type: "patchSubject",
                        id: subject.id,
                        patch: { colour: event.target.value },
                      })
                    }
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={subject.active}
                      onChange={(event) =>
                        dispatch({
                          type: "patchSubject",
                          id: subject.id,
                          patch: { active: event.target.checked },
                        })
                      }
                    />{" "}
                    Active
                  </label>
                </div>
              ))}
              {addingSubject ? (
                <form
                  className="subject-create"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!newSubjectName.trim()) return;
                    dispatch({
                      type: "addSubject",
                      displayName: newSubjectName.trim(),
                      colour: newSubjectColour,
                    });
                    setNewSubjectName("");
                    setAddingSubject(false);
                  }}
                >
                  <input
                    autoFocus
                    aria-label="New subject name"
                    value={newSubjectName}
                    onChange={(event) => setNewSubjectName(event.target.value)}
                    placeholder="Subject name"
                    required
                  />
                  <input
                    aria-label="New subject colour"
                    type="color"
                    value={newSubjectColour}
                    onChange={(event) =>
                      setNewSubjectColour(event.target.value)
                    }
                  />
                  <button type="submit">Add</button>
                  <button type="button" onClick={() => setAddingSubject(false)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <button
                  className="text-button"
                  onClick={() => setAddingSubject(true)}
                >
                  + Add manual subject
                </button>
              )}
            </div>
          ) : null}
          {active === "data" ? (
            <>
              <div className="stats-line">
                <span>
                  <strong>{activeCount}</strong> active items
                </span>
                <span>
                  <strong>{completedCount}</strong> completed
                </span>
                <span>
                  <strong>{archived.length}</strong> archived
                </span>
                <span>
                  <strong>{classifiedWithinDay}</strong> classified within 24h
                </span>
              </div>
              <div className="settings-block">
                <h3>Archive</h3>
                {archived.length ? (
                  archived.map((item) => (
                    <div className="archive-row" key={item.id}>
                      <Archive size={15} />
                      <span>
                        <strong>{item.displayName}</strong>
                        <small>
                          {item.archiveReason} · {item.classification}
                        </small>
                      </span>
                      <button
                        onClick={() =>
                          dispatch({ type: "restore", id: item.id })
                        }
                      >
                        Restore
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="empty-line">No archived items.</p>
                )}
              </div>
              <div className="settings-block">
                <h3>Export & backup</h3>
                <p>
                  Exports never include Canvas tokens, Google tokens, session
                  secrets, or encryption keys.
                </p>
                <div className="button-row">
                  <button className="new-button" onClick={exportJson}>
                    <FileJson size={15} /> Export full JSON
                  </button>
                  <button
                    onClick={() =>
                      download(
                        "organato-items.csv",
                        `Name,Type,Status\n${items.map((item) => `"${item.displayName.replaceAll('"', '""')}",${item.kind},${item.workingStatus}`).join("\n")}`,
                        "text/csv",
                      )
                    }
                  >
                    <Download size={15} /> Export CSV
                  </button>
                </div>
              </div>
              <div className="settings-block">
                <h3>Import</h3>
                <p>
                  A restore is validated and previewed before any write. Merge
                  is the default.
                </p>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(event) =>
                    event.target.files?.[0] &&
                    void handleImport(event.target.files[0])
                  }
                />
                <button onClick={() => fileInput.current?.click()}>
                  <Upload size={15} /> Select JSON backup
                </button>
                {importSummary ? (
                  <p className="import-summary">{importSummary}</p>
                ) : null}
                {pendingImport ? (
                  <button
                    className="new-button"
                    disabled={connectionBusy === "restore"}
                    onClick={() => void applyImport()}
                  >
                    Apply validated merge
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
          {active === "security" ? (
            <>
              <div className="settings-block">
                <h3>Requested scopes</h3>
                <div className="scope-row">
                  <KeyRound size={17} />
                  <span>
                    <strong>Google identity</strong>
                    <small>openid, email, profile</small>
                  </span>
                </div>
                <div className="scope-row">
                  <KeyRound size={17} />
                  <span>
                    <strong>App-created Calendar only</strong>
                    <small>calendar.app.created</small>
                  </span>
                </div>
                <div className="scope-row">
                  <KeyRound size={17} />
                  <span>
                    <strong>Send email only</strong>
                    <small>gmail.send · inbox is never read</small>
                  </span>
                </div>
              </div>
              <div className="settings-block">
                <h3>Security controls</h3>
                <button onClick={() => void reauthenticate()}>
                  Reauthenticate now
                </button>
                <button onClick={() => void revokeAllSessions()}>
                  Revoke all sessions
                </button>
                <button onClick={() => void downloadDiagnostic()}>
                  Download sanitized diagnostic
                </button>
              </div>
            </>
          ) : null}
          {active === "advanced" ? (
            <div className="settings-block">
              <h3>Advanced</h3>
              <p>
                These recovery controls are intentionally quiet. None can enable
                billing.
              </p>
              {[
                "Force Canvas full rescan",
                "Rebuild missing Calendar events",
                "Clear Calendar incremental sync token",
                "Clear non-secret device preferences",
                "Enable verbose sanitized diagnostics",
              ].map((label) => (
                <button
                  className="advanced-action"
                  key={label}
                  onClick={() =>
                    void runAdvancedAction(label).catch((error) =>
                      dispatch({
                        type: "toast",
                        message:
                          error instanceof Error
                            ? error.message
                            : "Advanced action could not complete",
                      }),
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          {active === "about" ? (
            <div className="settings-block">
              <h3>Organato 0.1.0</h3>
              <p>Database schema 1 · free self-hosted release</p>
              <a href="/privacy.html" target="_blank">
                Privacy policy <ExternalLink size={12} />
              </a>
              <p>
                Free-only policy: no payment card, expiring trial, paid
                developer account, commercial component licence, premium
                FullCalendar module, third-party analytics, or tracking.
              </p>
              <button
                onClick={() => {
                  void navigator.serviceWorker
                    ?.getRegistration()
                    .then((registration) => registration?.update())
                    .then(() =>
                      dispatch({
                        type: "toast",
                        message:
                          "Organato is using the latest available app shell",
                      }),
                    );
                }}
              >
                <RotateCcw size={15} /> Check for PWA update
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );

  function IntegrationCard({
    provider,
  }: {
    provider: "google_calendar" | "gmail";
  }) {
    const integration = integrations.find(
      (entry) => entry.provider === provider,
    )!;
    const connected = integration.state !== "disconnected";
    const stateLabels = {
      healthy: "Connected",
      delayed: "Delayed",
      partial: "Partially connected",
      action_needed: "Action needed",
      disconnected: "Not connected",
    } as const;
    const connectGoogle = async () => {
      setConnectionBusy(provider);
      try {
        const result = await protectedPost("/api/integrations/google/start");
        if ("authorizationUrl" in result && result.authorizationUrl) {
          window.location.assign(result.authorizationUrl);
          return;
        }
        dispatch({
          type: "toast",
          message: "Google connection flow is ready in production",
        });
      } catch (error) {
        dispatch({
          type: "toast",
          message:
            error instanceof Error
              ? error.message
              : "Google connection could not start",
        });
      } finally {
        setConnectionBusy(null);
      }
    };
    const runAction = async () => {
      setConnectionBusy(provider);
      try {
        const path =
          provider === "google_calendar"
            ? "/api/integrations/google/reconcile"
            : "/api/integrations/google/test-email";
        await protectedPost(path);
        dispatch({
          type: "toast",
          message:
            provider === "gmail"
              ? import.meta.env.VITE_DEMO_MODE === "true"
                ? "Test delivery simulated · production sends through Gmail"
                : "Test email sent"
              : "Integration is up to date",
        });
      } catch (error) {
        dispatch({
          type: "toast",
          message:
            error instanceof Error
              ? error.message
              : "Action could not complete",
        });
      } finally {
        setConnectionBusy(null);
      }
    };
    return (
      <div className="settings-block integration-card">
        <h3>{integration.label}</h3>
        <div className="integration-state">
          <i
            className={`health-dot ${
              integration.state === "healthy"
                ? "healthy"
                : integration.state === "disconnected"
                  ? "neutral"
                  : integration.state === "action_needed"
                    ? "action-needed"
                    : integration.state
            }`}
          />
          <span>
            <strong>{stateLabels[integration.state]}</strong>
            <small>
              {integration.lastSuccessAt
                ? `Last success ${new Date(
                    integration.lastSuccessAt,
                  ).toLocaleString("en-AU")}`
                : connected
                  ? "No successful operation recorded yet"
                  : "Not connected yet"}
            </small>
          </span>
        </div>
        <p>
          {provider === "google_calendar"
            ? "Dedicated Organato calendar · unrelated events are never read."
            : "Predetermined HTML/plain-text digest · at most 10 messages/day."}
        </p>
        <div className="button-row">
          <button
            disabled={connectionBusy === provider}
            onClick={() => void connectGoogle()}
          >
            {connected ? "Reconnect" : "Connect"}
          </button>
          <button
            disabled={connectionBusy === provider || !connected}
            onClick={() => void runAction()}
          >
            {provider === "gmail" ? "Send test" : "Reconcile now"}
          </button>
        </div>
      </div>
    );
  }
}
