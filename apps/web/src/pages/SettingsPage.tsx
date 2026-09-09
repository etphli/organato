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
import { POST_RESTORE_RELOAD_DELAY_MS } from "../lib/timing";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  assertSecretFreeBackup,
  validateBackup,
  visibleStatus,
  type OrganatoItem,
  type WorkspaceSnapshot,
} from "@organato/domain";
import { PageHeader } from "../components/PageHeader";
import { OrganatoSelect } from "../components/OrganatoControls";
import { SubjectDot } from "../components/SubjectDot";
import { AccountAccessSection } from "../components/settings/AccountAccessSection";
import { CanvasConnectionSection } from "../components/settings/CanvasConnectionSection";
import { EmailDeliverySection } from "../components/settings/EmailDeliverySection";
import {
  SettingsNavigation,
  settingsCategories,
} from "../components/settings/SettingsNavigation";
import {
  beginGoogleConnection,
  IntegrationRequestError,
} from "../lib/integrationApi";
import { useOrganatoActions, useOrganatoData } from "../state/OrganatoProvider";

const archivePageSize = 50;

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

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function itemCsv(rows: OrganatoItem[], subjectNames: Map<string, string>) {
  const headers = [
    "Name",
    "Kind",
    "Classification",
    "Subject",
    "Due",
    "Priority",
    "Status",
    "Source",
    "Calendar",
    "Archive reason",
    "Notes",
  ];
  return [
    headers.map(csvCell).join(","),
    ...rows.map((item) =>
      [
        item.displayName,
        item.kind,
        item.classification,
        item.subjectId ? subjectNames.get(item.subjectId) : "",
        item.dueAt ?? item.dueDateLocal ?? "",
        item.priority,
        item.workingStatus,
        item.sourceType,
        item.calendarEnabled ? "Included" : "Excluded",
        item.archiveReason,
        item.notesMarkdown,
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\r\n");
}

function ToggleRows({ category }: { category: string }) {
  const { settings } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
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

interface DeliverySummary {
  delivery_key: string;
  delivery_type: string;
  local_date: string;
  status: string;
  attempt_count: number;
  created_at: string;
  sent_at: string | null;
  next_attempt_at: string | null;
  last_error_category: string | null;
}

function DeliveryHistory() {
  const { dispatch } = useOrganatoActions();
  const demoMode = import.meta.env.VITE_DEMO_MODE === "true";
  const [deliveries, setDeliveries] = useState<DeliverySummary[]>([]);
  const [loading, setLoading] = useState(!demoMode);
  const [retrying, setRetrying] = useState(false);

  const load = async () => {
    if (demoMode) return;
    setLoading(true);
    try {
      const response = await fetch("/api/reminder-deliveries", {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("delivery_history_unavailable");
      const result = (await response.json()) as {
        deliveries: DeliverySummary[];
      };
      setDeliveries(result.deliveries);
    } catch {
      dispatch({ type: "toast", message: "Delivery history is unavailable" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // This component loads once when the Email settings surface opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode]);

  const retryLatest = async () => {
    setRetrying(true);
    try {
      const response = await fetch("/api/integrations/google/retry-latest", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": sessionStorage.getItem("organato_csrf") ?? "",
        },
        body: "{}",
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? "Delivery could not be retried.");
      await load();
      dispatch({ type: "toast", message: "Latest delivery sent" });
    } catch (error) {
      dispatch({
        type: "toast",
        message:
          error instanceof Error ? error.message : "Retry could not complete",
      });
    } finally {
      setRetrying(false);
    }
  };

  const hasRetryable = deliveries.some(
    (delivery) => delivery.status === "failed_transient",
  );
  return (
    <div className="settings-block">
      <div className="settings-block-heading">
        <h3>Delivery history</h3>
        {hasRetryable ? (
          <button
            className="text-button"
            disabled={retrying}
            onClick={() => void retryLatest()}
          >
            Retry latest
          </button>
        ) : null}
      </div>
      {loading ? (
        <p className="settings-quiet-state">Loading delivery history…</p>
      ) : deliveries.length ? (
        deliveries.slice(0, 10).map((delivery) => (
          <div className="delivery-row" key={delivery.delivery_key}>
            <span
              className={`delivery-status ${delivery.status}`}
              aria-hidden="true"
            />
            <span>
              <strong>
                {delivery.delivery_type === "urgent_import"
                  ? "Canvas import alert"
                  : "Daily digest"}
              </strong>
              <small>
                {delivery.local_date} · {delivery.status.replaceAll("_", " ")}
                {delivery.attempt_count > 1
                  ? ` · ${delivery.attempt_count} attempts`
                  : ""}
              </small>
            </span>
            <time dateTime={delivery.sent_at ?? delivery.created_at}>
              {new Date(
                delivery.sent_at ?? delivery.created_at,
              ).toLocaleDateString("en-AU", {
                day: "numeric",
                month: "short",
              })}
            </time>
          </div>
        ))
      ) : (
        <p className="settings-quiet-state">No reminder deliveries yet.</p>
      )}
    </div>
  );
}

/**
 * Accessible two-step confirmation replacing window.confirm: the action
 * button becomes an explicit Confirm/Cancel pair so keyboard and
 * screen-reader users get a real form instead of a blocking native dialog.
 */
function ConfirmAction({
  label,
  confirmLabel,
  onConfirm,
  busy = false,
  danger = false,
}: {
  label: string;
  confirmLabel: string;
  onConfirm(): void | Promise<void>;
  busy?: boolean;
  danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        className={danger ? "danger-text" : undefined}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
    );
  }
  return (
    <span
      className="button-row"
      role="group"
      aria-label={`${label} confirmation`}
    >
      <button
        className={danger ? "danger-button" : "new-button"}
        disabled={busy}
        onClick={() => void onConfirm()}
      >
        {confirmLabel}
      </button>
      <button disabled={busy} onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}

export default function SettingsPage() {
  const { pathname } = useLocation();
  const active =
    settingsCategories.find(([id]) => pathname.endsWith(`/${id}`))?.[0] ??
    "account";
  const { items, subjects, settings, integrations, views, archivedReady } =
    useOrganatoData();
  const { dispatch, loadItemDetails, refresh } = useOrganatoActions();
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<WorkspaceSnapshot | null>(
    null,
  );
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [connectionBusy, setConnectionBusy] = useState<string | null>(null);
  const [connectionNeedsReauth, setConnectionNeedsReauth] = useState(false);
  const [addingSubject, setAddingSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectColour, setNewSubjectColour] = useState("#a78bfa");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteExternalAcknowledged, setDeleteExternalAcknowledged] =
    useState(false);
  const [deleteBackupAcknowledged, setDeleteBackupAcknowledged] =
    useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveKind, setArchiveKind] = useState<"all" | "work" | "todo">(
    "all",
  );
  const [archiveSubject, setArchiveSubject] = useState("all");
  const [archiveReason, setArchiveReason] = useState("all");
  const [archiveYear, setArchiveYear] = useState("all");
  const [archiveSelection, setArchiveSelection] = useState<string[]>([]);
  const [archivePreviewId, setArchivePreviewId] = useState<string | null>(null);
  const [archivePageIndex, setArchivePageIndex] = useState(0);
  const [itemDeleteConfirmation, setItemDeleteConfirmation] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const archiveLoadAttempted = useRef(false);
  const archived = useMemo(
    () => items.filter((item) => item.archivedAt),
    [items],
  );
  const filteredArchive = useMemo(() => {
    const query = archiveQuery.trim().toLowerCase();
    return archived.filter(
      (item) =>
        (archiveKind === "all" || item.kind === archiveKind) &&
        (archiveSubject === "all" || item.subjectId === archiveSubject) &&
        (archiveReason === "all" ||
          (item.archiveReason ?? "Archived") === archiveReason) &&
        (archiveYear === "all" ||
          item.archivedAt?.slice(0, 4) === archiveYear) &&
        (!query ||
          item.displayName.toLowerCase().includes(query) ||
          item.archiveReason?.toLowerCase().includes(query) ||
          subjects
            .find((subject) => subject.id === item.subjectId)
            ?.displayName.toLowerCase()
            .includes(query)),
    );
  }, [
    archiveKind,
    archiveQuery,
    archiveReason,
    archiveSubject,
    archiveYear,
    archived,
    subjects,
  ]);
  const archivePreview =
    archived.find((item) => item.id === archivePreviewId) ?? null;
  const archivePageCount = Math.max(
    1,
    Math.ceil(filteredArchive.length / archivePageSize),
  );
  const visibleArchive = filteredArchive.slice(
    archivePageIndex * archivePageSize,
    (archivePageIndex + 1) * archivePageSize,
  );
  useEffect(() => {
    if (active !== "data") {
      archiveLoadAttempted.current = false;
      if (archivedReady) dispatch({ type: "releaseArchived" });
      return;
    }
    if (archivedReady || archiveLoadAttempted.current) {
      return;
    }
    archiveLoadAttempted.current = true;
    void refresh({ includeArchived: true }).catch(() =>
      dispatch({
        type: "toast",
        message: "The archive could not be loaded. Try opening Data again.",
      }),
    );
  }, [active, archivedReady, dispatch, refresh]);
  useEffect(() => () => dispatch({ type: "releaseArchived" }), [dispatch]);
  useEffect(() => {
    setArchivePageIndex(0);
  }, [archiveKind, archiveQuery, archiveReason, archiveSubject, archiveYear]);
  useEffect(() => {
    setArchivePageIndex((current) => Math.min(current, archivePageCount - 1));
  }, [archivePageCount]);
  const activeCount = items.filter((item) => !item.archivedAt).length;
  const completedCount = items.filter(
    (item) => item.workingStatus === "completed",
  ).length;
  const overdueCount = items.filter(
    (item) => !item.archivedAt && visibleStatus(item) === "overdue",
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

  const loadFullSnapshot = async () => {
    if (import.meta.env.VITE_DEMO_MODE === "true") return snapshot;
    const response = await fetch("/api/export", {
      credentials: "same-origin",
    });
    const output = await response.text();
    if (!response.ok) {
      const result = JSON.parse(output) as { error?: string };
      throw new Error(result.error ?? "Backup could not be exported.");
    }
    if (!assertSecretFreeBackup(output))
      throw new Error("Backup safety check failed.");
    const parsed = validateBackup(JSON.parse(output));
    if (!parsed.success) throw new Error("Exported backup failed validation.");
    return parsed.data as WorkspaceSnapshot;
  };
  const exportJson = async () => {
    try {
      const exported = await loadFullSnapshot();
      const output = JSON.stringify(exported, null, 2);
      if (!assertSecretFreeBackup(output))
        throw new Error("Backup safety check failed.");
      download("organato-backup.json", output, "application/json");
      setDeleteBackupAcknowledged(true);
      dispatch({ type: "toast", message: "Secret-free backup exported" });
    } catch (error) {
      dispatch({
        type: "toast",
        message:
          error instanceof Error
            ? error.message
            : "Backup could not be exported",
      });
      throw error;
    }
  };
  const exportCsvSet = async () => {
    try {
      const exported = await loadFullSnapshot();
      const subjectNames = new Map(
        exported.subjects.map((subject) => [subject.id, subject.displayName]),
      );
      const files: Array<[string, OrganatoItem[]]> = [
        [
          "organato-assignments.csv",
          exported.items.filter(
            (item) =>
              !item.archivedAt &&
              ["assignment", "both"].includes(item.classification),
          ),
        ],
        [
          "organato-checkpoints.csv",
          exported.items.filter(
            (item) =>
              !item.archivedAt &&
              ["checkpoint", "both"].includes(item.classification),
          ),
        ],
        [
          "organato-todos.csv",
          exported.items.filter(
            (item) => !item.archivedAt && item.kind === "todo",
          ),
        ],
        [
          "organato-archive.csv",
          exported.items.filter((item) => Boolean(item.archivedAt)),
        ],
      ];
      for (const [filename, rows] of files) {
        download(
          filename,
          `\uFEFF${itemCsv(rows, subjectNames)}`,
          "text/csv;charset=utf-8",
        );
      }
      download(
        "organato-subjects.csv",
        `\uFEFF${[
          ["Name", "Short name", "Colour", "Active", "Canvas course ID"]
            .map(csvCell)
            .join(","),
          ...exported.subjects.map((subject) =>
            [
              subject.displayName,
              subject.shortName,
              subject.colour,
              subject.active ? "Yes" : "No",
              subject.canvasCourseId,
            ]
              .map(csvCell)
              .join(","),
          ),
        ].join("\r\n")}`,
        "text/csv;charset=utf-8",
      );
      dispatch({ type: "toast", message: "Five complete CSV exports created" });
    } catch (error) {
      dispatch({
        type: "toast",
        message:
          error instanceof Error
            ? error.message
            : "CSV exports could not be created",
      });
    }
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
    // Inline typed confirmation (replaces the blocking window.prompt so
    // screen-reader and keyboard users get a real form with an error state).
    if (restoreConfirmation !== "RESTORE") {
      setImportSummary(
        "Type RESTORE below to confirm, or cancel. Nothing was changed.",
      );
      return;
    }
    setConnectionBusy("restore");
    try {
      if (import.meta.env.VITE_DEMO_MODE === "true") {
        await exportJson();
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
          confirmation: "RESTORE ORGANATO",
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
      setRestoreOpen(false);
      setRestoreConfirmation("");
      setImportSummary(
        `Restored · ${result.merged.items} items · ${result.merged.subjects} subjects · ${result.merged.savedViews} views`,
      );
      window.setTimeout(
        () => window.location.reload(),
        POST_RESTORE_RELOAD_DELAY_MS,
      );
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
    await protectedPost("/api/auth/logout");
    window.location.reload();
  };
  const revokeAllSessions = async () => {
    await protectedPost("/api/sessions/revoke-all");
    if (import.meta.env.VITE_DEMO_MODE === "true") {
      dispatch({ type: "toast", message: "All demo sessions revoked" });
      return;
    }
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
  const permanentlyDeleteWorkspace = async () => {
    if (deleteConfirmation !== "Organato" || !deleteExternalAcknowledged) {
      return;
    }
    setConnectionBusy("delete-all");
    setDeleteError(null);
    try {
      if (import.meta.env.VITE_DEMO_MODE === "true") {
        dispatch({
          type: "hydrate",
          items: [],
          subjects: [],
          settings,
          integrations,
          views: [],
        });
        setDeleteOpen(false);
        dispatch({ type: "toast", message: "Demo workspace cleared" });
        return;
      }
      await protectedPost("/api/data/delete-all", {
        confirmation: deleteConfirmation,
        acknowledgeExternalData: deleteExternalAcknowledged,
        acknowledgeBackupOffer: deleteBackupAcknowledged,
      });
      sessionStorage.removeItem("organato_csrf");
      window.location.assign("/");
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "Permanent deletion could not be completed.",
      );
    } finally {
      setConnectionBusy(null);
    }
  };
  const permanentlyDeleteItem = async () => {
    if (
      !archivePreview ||
      itemDeleteConfirmation.trim().toLowerCase() !== "delete"
    ) {
      return;
    }
    setConnectionBusy(`delete-item:${archivePreview.id}`);
    setDeleteError(null);
    try {
      if (import.meta.env.VITE_DEMO_MODE !== "true") {
        await protectedPost(
          `/api/items/${encodeURIComponent(archivePreview.id)}/permanent-delete`,
          {
            version: archivePreview.version,
            confirmation: itemDeleteConfirmation,
          },
        );
        await refresh();
      } else {
        dispatch({
          type: "hydrate",
          items: items.filter((item) => item.id !== archivePreview.id),
          subjects,
          settings,
          integrations,
          views,
        });
      }
      setArchiveSelection((current) =>
        current.filter((id) => id !== archivePreview.id),
      );
      setArchivePreviewId(null);
      setItemDeleteConfirmation("");
      dispatch({ type: "toast", message: "Archived item permanently deleted" });
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "The archived item could not be deleted.",
      );
    } finally {
      setConnectionBusy(null);
    }
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
                <OrganatoSelect
                  ariaLabel="Theme"
                  options={[
                    { value: "obsidian", label: "Obsidian Dark" },
                    { value: "pure_black", label: "Pure Black" },
                    { value: "soft_dark", label: "Soft Dark" },
                    { value: "light", label: "Light" },
                    { value: "system", label: "System" },
                  ]}
                  value={settings.theme}
                  onChange={(value) =>
                    dispatch({
                      type: "settings",
                      patch: {
                        theme: value as typeof settings.theme,
                      },
                    })
                  }
                />
              </label>
              <label className="field-row">
                <span>Density</span>
                <OrganatoSelect
                  ariaLabel="Density"
                  options={[
                    { value: "compact", label: "Compact" },
                    { value: "comfortable", label: "Comfortable" },
                  ]}
                  value={settings.density}
                  onChange={(value) =>
                    dispatch({
                      type: "settings",
                      patch: {
                        density: value as typeof settings.density,
                      },
                    })
                  }
                />
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
                  aria-valuetext={`${Math.round(settings.fontScale * 100)} percent`}
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
                  <OrganatoSelect
                    ariaLabel="Default calendar view"
                    options={[
                      { value: "month", label: "Month" },
                      { value: "week", label: "Week" },
                      { value: "agenda", label: "Agenda" },
                    ]}
                    value={settings.calendarDefaultView}
                    onChange={(value) =>
                      dispatch({
                        type: "settings",
                        patch: {
                          calendarDefaultView:
                            value as typeof settings.calendarDefaultView,
                        },
                      })
                    }
                  />
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
              <div className="settings-block">
                <h3>Email delivery</h3>
                <p>
                  Send through your connected personal Gmail account to any
                  approved owner address.
                </p>
                <EmailDeliverySection onWorkspaceRefresh={refresh} />
              </div>
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
                <label className="setting-row">
                  <span>
                    <strong>Evening preview</strong>
                    <small>
                      Tomorrow plus overdue, at 8 PM Australia/Sydney.
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.eveningPreviewEnabled}
                    onChange={(event) =>
                      dispatch({
                        type: "settings",
                        patch: { eveningPreviewEnabled: event.target.checked },
                      })
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Evening hour</strong>
                    <small>24-hour Sydney time for the preview.</small>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={settings.eveningHour}
                    onChange={(event) => {
                      const hour = Number(event.target.value);
                      if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
                        dispatch({
                          type: "settings",
                          patch: { eveningHour: hour },
                        });
                      }
                    }}
                  />
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Sunday review</strong>
                    <small>
                      Done, slipped, and next week — Sundays 6 PM Sydney.
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.weeklyReviewEnabled}
                    onChange={(event) =>
                      dispatch({
                        type: "settings",
                        patch: { weeklyReviewEnabled: event.target.checked },
                      })
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Guardian copy</strong>
                    <small>Read-only weekly review to a second address.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.guardianWeeklyEnabled}
                    onChange={(event) =>
                      dispatch({
                        type: "settings",
                        patch: { guardianWeeklyEnabled: event.target.checked },
                      })
                    }
                  />
                </label>
                <label className="field-row">
                  <span>Guardian email</span>
                  <input
                    type="email"
                    value={settings.guardianEmail}
                    placeholder="parent@example.com"
                    onChange={(event) =>
                      dispatch({
                        type: "settings",
                        patch: { guardianEmail: event.target.value },
                      })
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Exam-day escalation</strong>
                    <small>
                      Urgent due-today items texted via your gateway each
                      morning.
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.examEscalationEnabled}
                    onChange={(event) =>
                      dispatch({
                        type: "settings",
                        patch: { examEscalationEnabled: event.target.checked },
                      })
                    }
                  />
                </label>
                <label className="field-row">
                  <span>SMS gateway address</span>
                  <input
                    type="email"
                    value={settings.smsGatewayAddress}
                    placeholder="04XXXXXXXX@sms-gateway.example"
                    onChange={(event) =>
                      dispatch({
                        type: "settings",
                        patch: { smsGatewayAddress: event.target.value },
                      })
                    }
                  />
                </label>
              </div>
              <DeliveryHistory />
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
                  <strong>{archivedReady ? archived.length : "…"}</strong>{" "}
                  archived
                </span>
                <span>
                  <strong>{overdueCount}</strong> overdue
                </span>
              </div>
              <div className="settings-block">
                <div className="settings-block-heading">
                  <h3>Archive</h3>
                  <span className="settings-count">
                    {filteredArchive.length} shown
                  </span>
                </div>
                <div className="archive-tools">
                  <input
                    type="search"
                    aria-label="Search archived items"
                    placeholder="Search archive"
                    value={archiveQuery}
                    onChange={(event) => setArchiveQuery(event.target.value)}
                  />
                  <OrganatoSelect
                    ariaLabel="Filter archive by item type"
                    options={[
                      { value: "all", label: "All types" },
                      { value: "work", label: "School work" },
                      { value: "todo", label: "Todos" },
                    ]}
                    value={archiveKind}
                    onChange={(value) =>
                      setArchiveKind(value as "all" | "work" | "todo")
                    }
                  />
                  <OrganatoSelect
                    ariaLabel="Filter archive by subject"
                    options={[
                      { value: "all", label: "All subjects" },
                      ...subjects.map((subject) => ({
                        value: subject.id,
                        label: subject.displayName,
                      })),
                    ]}
                    value={archiveSubject}
                    onChange={setArchiveSubject}
                  />
                  <OrganatoSelect
                    ariaLabel="Filter archive by reason"
                    options={[
                      { value: "all", label: "All reasons" },
                      ...[
                        ...new Set(
                          archived.map(
                            (item) => item.archiveReason ?? "Archived",
                          ),
                        ),
                      ].map((reason) => ({ value: reason, label: reason })),
                    ]}
                    value={archiveReason}
                    onChange={setArchiveReason}
                  />
                  <OrganatoSelect
                    ariaLabel="Filter archive by year"
                    options={[
                      { value: "all", label: "All years" },
                      ...[
                        ...new Set(
                          archived
                            .map((item) => item.archivedAt?.slice(0, 4))
                            .filter((year): year is string => Boolean(year)),
                        ),
                      ]
                        .sort()
                        .reverse()
                        .map((year) => ({ value: year, label: year })),
                    ]}
                    value={archiveYear}
                    onChange={setArchiveYear}
                  />
                </div>
                {archiveSelection.length ? (
                  <div className="archive-selection-bar">
                    <span>{archiveSelection.length} selected</span>
                    <button
                      onClick={() => {
                        const selected = archived.filter((item) =>
                          archiveSelection.includes(item.id),
                        );
                        const subjectNames = new Map(
                          subjects.map((subject) => [
                            subject.id,
                            subject.displayName,
                          ]),
                        );
                        download(
                          "organato-archive-selection.csv",
                          `\uFEFF${itemCsv(selected, subjectNames)}`,
                          "text/csv;charset=utf-8",
                        );
                      }}
                    >
                      Export selected
                    </button>
                    <button onClick={() => setArchiveSelection([])}>
                      Clear
                    </button>
                  </div>
                ) : null}
                {!archivedReady ? (
                  <p className="empty-line" role="status">
                    Loading archived items…
                  </p>
                ) : filteredArchive.length ? (
                  visibleArchive.map((item) => (
                    <div className="archive-row" key={item.id}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.displayName}`}
                        checked={archiveSelection.includes(item.id)}
                        onChange={(event) =>
                          setArchiveSelection((current) =>
                            event.target.checked
                              ? [...new Set([...current, item.id])]
                              : current.filter((id) => id !== item.id),
                          )
                        }
                      />
                      <Archive size={15} />
                      <button
                        className="archive-item-preview"
                        onClick={() => {
                          setArchivePreviewId(item.id);
                          setItemDeleteConfirmation("");
                          setDeleteError(null);
                          void loadItemDetails(item.id).catch(() =>
                            dispatch({
                              type: "toast",
                              message: "Item details could not be loaded.",
                            }),
                          );
                        }}
                      >
                        <strong>{item.displayName}</strong>
                        <small>
                          {item.archiveReason ?? "Archived"} ·{" "}
                          {item.classification}
                        </small>
                      </button>
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
                  <p className="empty-line">
                    {archived.length
                      ? "No archived items match these filters."
                      : "No archived items."}
                  </p>
                )}
                {filteredArchive.length > archivePageSize ? (
                  <nav className="list-pagination" aria-label="Archive pages">
                    <span>
                      {archivePageIndex * archivePageSize + 1}–
                      {Math.min(
                        filteredArchive.length,
                        (archivePageIndex + 1) * archivePageSize,
                      )}{" "}
                      of {filteredArchive.length}
                    </span>
                    <button
                      type="button"
                      disabled={archivePageIndex === 0}
                      onClick={() =>
                        setArchivePageIndex((current) =>
                          Math.max(0, current - 1),
                        )
                      }
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={archivePageIndex >= archivePageCount - 1}
                      onClick={() =>
                        setArchivePageIndex((current) =>
                          Math.min(archivePageCount - 1, current + 1),
                        )
                      }
                    >
                      Next
                    </button>
                  </nav>
                ) : null}
                {archivePreview ? (
                  <div className="archive-preview">
                    <div>
                      <span>
                        {archivePreview.kind === "todo"
                          ? "Todo"
                          : archivePreview.classification}
                      </span>
                      <button
                        aria-label="Close archive preview"
                        onClick={() => {
                          setArchivePreviewId(null);
                          setDeleteError(null);
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <h4>{archivePreview.displayName}</h4>
                    <p>
                      {archivePreview.archiveReason ?? "Archived"} ·{" "}
                      {archivePreview.archivedAt
                        ? new Date(
                            archivePreview.archivedAt,
                          ).toLocaleDateString("en-AU")
                        : "Unknown date"}
                    </p>
                    {archivePreview.notesMarkdown ? (
                      <p className="archive-preview-notes">
                        {archivePreview.notesMarkdown}
                      </p>
                    ) : null}
                    {archivePreview.history.length ? (
                      <ol>
                        {archivePreview.history.slice(0, 5).map((entry) => (
                          <li key={entry.id}>
                            <strong>{entry.summary}</strong>
                            <small>
                              {new Date(entry.createdAt).toLocaleString(
                                "en-AU",
                              )}
                            </small>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    <div className="archive-delete-control">
                      <label>
                        Type <strong>delete</strong> to permanently delete this
                        item
                        <input
                          value={itemDeleteConfirmation}
                          onChange={(event) =>
                            setItemDeleteConfirmation(event.target.value)
                          }
                        />
                      </label>
                      <button
                        className="danger-button"
                        disabled={
                          itemDeleteConfirmation.trim().toLowerCase() !==
                            "delete" ||
                          connectionBusy === `delete-item:${archivePreview.id}`
                        }
                        onClick={() => void permanentlyDeleteItem()}
                      >
                        Permanently delete item
                      </button>
                    </div>
                    {deleteError ? (
                      <p className="settings-inline-error" role="alert">
                        {deleteError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="settings-block">
                <h3>Export & backup</h3>
                <p>
                  Exports never include Canvas tokens, Google tokens, session
                  secrets, or encryption keys.
                </p>
                <div className="button-row">
                  <button
                    className="new-button"
                    onClick={() => void exportJson()}
                  >
                    <FileJson size={15} /> Export full JSON
                  </button>
                  <button onClick={() => void exportCsvSet()}>
                    <Download size={15} /> Export complete CSV set
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
                {pendingImport && !restoreOpen ? (
                  <button
                    className="new-button"
                    disabled={connectionBusy === "restore"}
                    onClick={() => {
                      setRestoreOpen(true);
                      setRestoreConfirmation("");
                    }}
                  >
                    Apply validated merge
                  </button>
                ) : null}
                {pendingImport && restoreOpen ? (
                  <div className="delete-confirmation">
                    <label>
                      <span>
                        A pre-restore backup downloads first. Type RESTORE to
                        merge this file.
                      </span>
                      <input
                        autoComplete="off"
                        value={restoreConfirmation}
                        onChange={(event) =>
                          setRestoreConfirmation(event.target.value)
                        }
                        placeholder="RESTORE"
                      />
                    </label>
                    <div className="button-row">
                      <button
                        className="new-button"
                        disabled={
                          restoreConfirmation !== "RESTORE" ||
                          connectionBusy === "restore"
                        }
                        onClick={() => void applyImport()}
                      >
                        Confirm restore
                      </button>
                      <button
                        disabled={connectionBusy === "restore"}
                        onClick={() => {
                          setRestoreOpen(false);
                          setRestoreConfirmation("");
                          setImportSummary(
                            "Restore cancelled. Nothing was changed.",
                          );
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="settings-block danger-zone">
                <h3>Permanent deletion</h3>
                <p>
                  Delete every Organato item, subject, integration credential,
                  reminder record, saved view, approved identity, and session.
                  Original records in Canvas and Google are not deleted.
                </p>
                {!deleteOpen ? (
                  <button
                    className="danger-text"
                    onClick={() => setDeleteOpen(true)}
                  >
                    Delete all Organato data
                  </button>
                ) : (
                  <div className="delete-confirmation">
                    <div className="button-row">
                      <button onClick={() => void exportJson()}>
                        <Download size={15} /> Download backup first
                      </button>
                    </div>
                    <label>
                      Type <strong>Organato</strong> to confirm
                      <input
                        autoComplete="off"
                        value={deleteConfirmation}
                        onChange={(event) =>
                          setDeleteConfirmation(event.target.value)
                        }
                      />
                    </label>
                    <label className="delete-acknowledgement">
                      <input
                        type="checkbox"
                        checked={deleteExternalAcknowledged}
                        onChange={(event) =>
                          setDeleteExternalAcknowledged(event.target.checked)
                        }
                      />
                      <span>
                        I understand this does not delete the original Canvas or
                        Google data and cannot be undone without a backup.
                      </span>
                    </label>
                    <div className="button-row">
                      <button
                        className="danger-button"
                        disabled={
                          deleteConfirmation !== "Organato" ||
                          !deleteExternalAcknowledged ||
                          connectionBusy === "delete-all"
                        }
                        onClick={() => void permanentlyDeleteWorkspace()}
                      >
                        Permanently delete everything
                      </button>
                      <button
                        disabled={connectionBusy === "delete-all"}
                        onClick={() => {
                          setDeleteOpen(false);
                          setDeleteConfirmation("");
                          setDeleteExternalAcknowledged(false);
                          setDeleteError(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                    {deleteError ? (
                      <p className="settings-inline-error" role="alert">
                        {deleteError}
                      </p>
                    ) : null}
                  </div>
                )}
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
                <ConfirmAction
                  label="Revoke all sessions"
                  confirmLabel="Revoke everything, including this session"
                  onConfirm={() => void revokeAllSessions()}
                />
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
                  window.location.reload();
                }}
              >
                <RotateCcw size={15} /> Reload latest Organato
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
      setConnectionNeedsReauth(false);
      try {
        await beginGoogleConnection();
      } catch (error) {
        if (
          error instanceof IntegrationRequestError &&
          error.code === "reauthentication_required"
        ) {
          setConnectionNeedsReauth(true);
        }
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
                ? "Reminder preview simulated · production sends through Gmail"
                : "Reminder preview sent"
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
    const disconnectGoogle = async () => {
      setConnectionBusy("google-disconnect");
      try {
        await protectedPost("/api/integrations/google/disconnect");
        await refresh();
        dispatch({ type: "toast", message: "Google disconnected" });
      } catch (error) {
        dispatch({
          type: "toast",
          message:
            error instanceof Error
              ? error.message
              : "Google could not be disconnected",
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
          {connectionNeedsReauth ? (
            <button
              disabled={Boolean(connectionBusy)}
              onClick={() => void reauthenticate()}
            >
              Confirm Google sign-in
            </button>
          ) : null}
          <button
            disabled={connectionBusy === provider || !connected}
            onClick={() => void runAction()}
          >
            {provider === "gmail" ? "Send preview" : "Reconcile now"}
          </button>
          <ConfirmAction
            label="Disconnect Google"
            confirmLabel="Disconnect (Organato data stays)"
            onConfirm={() => void disconnectGoogle()}
            busy={Boolean(connectionBusy)}
          />
        </div>
      </div>
    );
  }
}
