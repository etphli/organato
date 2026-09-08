import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { API_TIMEOUT_MS } from "../lib/timing";
import type {
  AttachmentLink,
  Classification,
  IntegrationHealth,
  OrganatoItem,
  SavedView,
  Subject,
  WorkspaceSettings,
} from "@organato/domain";
import { nextRecurrenceDeadline } from "@organato/domain";
import { BrandMark } from "../components/BrandMark";
import {
  seedIntegrations,
  seedItems,
  seedSettings,
  seedSubjects,
  seedViews,
} from "../data/seed";

interface State {
  items: OrganatoItem[];
  subjects: Subject[];
  settings: WorkspaceSettings;
  integrations: IntegrationHealth[];
  views: SavedView[];
  ready: boolean;
  archivedReady: boolean;
  bootError: string | null;
  selectedItemId: string | null;
  selectedItemDetail: OrganatoItem | null;
  commandOpen: boolean;
  searchOpen: boolean;
  syncing: boolean;
  toast: string | null;
  toastSeq: number;
  undo: {
    kind: "patch" | "classify" | "archive" | "restore";
    item: OrganatoItem;
    fields?: Array<keyof OrganatoItem>;
  } | null;
}

type Action =
  | {
      type: "hydrate";
      items: OrganatoItem[];
      subjects: Subject[];
      settings: WorkspaceSettings;
      integrations: IntegrationHealth[];
      views: SavedView[];
      preserveArchived?: boolean;
      archivedReady?: boolean;
    }
  | { type: "replaceItem"; item: OrganatoItem }
  | { type: "rollbackItem"; item: OrganatoItem }
  | { type: "detailLoaded"; item: OrganatoItem }
  | { type: "syncSubjects"; subjects: Subject[] }
  | { type: "releaseArchived" }
  | {
      type: "resetOverride";
      id: string;
      fieldName: "name" | "due" | "subject" | "calendarNote";
    }
  | {
      type: "patchSubject";
      id: string;
      patch: Partial<
        Pick<Subject, "displayName" | "shortName" | "colour" | "active">
      >;
    }
  | {
      type: "addSubject";
      displayName: string;
      shortName?: string | null;
      colour?: string;
    }
  | { type: "saveView"; view: SavedView }
  | {
      type: "addAttachment";
      itemId: string;
      label: string;
      url: string;
      linkType: AttachmentLink["linkType"];
    }
  | { type: "select"; id: string | null }
  | { type: "patchItem"; id: string; patch: Partial<OrganatoItem> }
  | { type: "classify"; id: string; classification: Classification }
  | { type: "archive"; id: string; reason?: string }
  | { type: "restore"; id: string }
  | { type: "deleteItem"; id: string; confirmation: string }
  | {
      type: "addTodo";
      name: string;
      dueAt?: string | null;
      dueDateLocal?: string | null;
      dueHasExplicitTime?: boolean;
      subjectId?: string | null;
      priority?: OrganatoItem["priority"];
      recurrenceRule?: OrganatoItem["recurrenceRule"];
      calendarEnabled?: boolean;
      remindersEnabled?: boolean;
    }
  | {
      type: "addWork";
      name: string;
      classification: Classification;
      dueAt?: string | null;
      dueDateLocal?: string | null;
      dueHasExplicitTime?: boolean;
      subjectId?: string | null;
      priority?: OrganatoItem["priority"];
    }
  | { type: "settings"; patch: Partial<WorkspaceSettings> }
  | { type: "command"; open: boolean }
  | { type: "search"; open: boolean }
  | { type: "syncing"; value: boolean }
  | { type: "toast"; message: string | null }
  | { type: "bootStarted" }
  | { type: "bootFailed"; message: string }
  | { type: "undo" }
  | { type: "reset" };

const storageKey = "organato-demo-state-v1";
const demoMode = import.meta.env.VITE_DEMO_MODE === "true";
const serverMutationTypes = new Set<Action["type"]>([
  "resetOverride",
  "patchSubject",
  "addSubject",
  "undo",
  "saveView",
  "addAttachment",
  "patchItem",
  "classify",
  "archive",
  "restore",
  "deleteItem",
  "addTodo",
  "addWork",
  "settings",
]);

function isOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

function isServerMutation(action: Action): boolean {
  return serverMutationTypes.has(action.type);
}

function initialState(): State {
  if (demoMode) {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Pick<
          State,
          "items" | "subjects" | "settings"
        >;
        return {
          ...parsed,
          integrations: seedIntegrations,
          views: "views" in parsed ? (parsed as State).views : seedViews,
          ready: true,
          archivedReady: true,
          bootError: null,
          selectedItemId: null,
          selectedItemDetail: null,
          commandOpen: false,
          searchOpen: false,
          syncing: false,
          toast: null,
          toastSeq: 0,
          undo: null,
        };
      }
    } catch {
      // A corrupt local demo cache must not prevent the app from opening.
    }
  }
  return {
    items: demoMode ? seedItems : [],
    subjects: demoMode ? seedSubjects : [],
    settings: seedSettings,
    integrations: seedIntegrations,
    views: demoMode ? seedViews : [],
    ready: demoMode,
    archivedReady: demoMode,
    bootError: null,
    selectedItemId: null,
    selectedItemDetail: null,
    commandOpen: false,
    searchOpen: false,
    syncing: false,
    toast: null,
    toastSeq: 0,
    undo: null,
  };
}

function persist(state: State): State {
  return state;
}

function listItem(item: OrganatoItem): OrganatoItem {
  return demoMode ? item : { ...item, attachments: [], history: [] };
}

function baseReducer(state: State, action: Action): State {
  if (action.type === "hydrate") {
    const nextItems = action.preserveArchived
      ? [
          ...action.items.filter((item) => !item.archivedAt),
          ...state.items.filter((item) => item.archivedAt),
        ]
      : action.items;
    const selectedStillExists =
      state.selectedItemId != null &&
      nextItems.some((item) => item.id === state.selectedItemId);
    return persist({
      ...state,
      items: nextItems,
      subjects: action.subjects,
      settings: action.settings,
      integrations: action.integrations,
      views: action.views,
      ready: true,
      archivedReady: action.archivedReady ?? state.archivedReady,
      selectedItemDetail: selectedStillExists ? state.selectedItemDetail : null,
      bootError: null,
    });
  }
  if (action.type === "bootStarted") {
    return { ...state, bootError: null };
  }
  if (action.type === "bootFailed") {
    return {
      ...state,
      ready: false,
      bootError: action.message,
    };
  }
  if (action.type === "replaceItem") {
    const exists = state.items.some((item) => item.id === action.item.id);
    const compactItem = listItem(action.item);
    return {
      ...state,
      items: exists
        ? state.items.map((item) =>
            item.id === action.item.id ? compactItem : item,
          )
        : [compactItem, ...state.items],
      selectedItemDetail:
        state.selectedItemId === action.item.id
          ? action.item
          : state.selectedItemDetail,
    };
  }
  if (action.type === "rollbackItem") {
    const exists = state.items.some((item) => item.id === action.item.id);
    return {
      ...state,
      items: exists
        ? state.items.map((item) =>
            item.id === action.item.id ? action.item : item,
          )
        : [action.item, ...state.items],
      undo: null,
      selectedItemDetail:
        state.selectedItemId === action.item.id
          ? action.item
          : state.selectedItemDetail,
    };
  }
  if (action.type === "detailLoaded") {
    if (state.selectedItemId !== action.item.id) return state;
    return { ...state, selectedItemDetail: action.item };
  }
  if (action.type === "syncSubjects") {
    return { ...state, subjects: action.subjects };
  }
  if (action.type === "releaseArchived") {
    if (!state.archivedReady) return state;
    const selectedIsArchived = state.selectedItemDetail?.archivedAt != null;
    return {
      ...state,
      items: state.items.filter((item) => !item.archivedAt),
      archivedReady: false,
      selectedItemId: selectedIsArchived ? null : state.selectedItemId,
      selectedItemDetail: selectedIsArchived ? null : state.selectedItemDetail,
    };
  }
  // Offline guard lives in the dispatch wrapper (which can read navigator and
  // roll back optimistic updates). Keep the reducer pure for tests/time-travel.
  if (action.type === "resetOverride") {
    const current = state.items.find((item) => item.id === action.id);
    if (!current) return state;
    const sourceSubject = state.subjects.find(
      (subject) => subject.canvasCourseId === current.canvasCourseId,
    );
    return persist({
      ...state,
      items: state.items.map((item) =>
        item.id === action.id
          ? {
              ...item,
              ...(action.fieldName === "name" && item.sourceName
                ? { displayName: item.sourceName }
                : {}),
              ...(action.fieldName === "due"
                ? {
                    dueAt: item.sourceDueAt,
                    dueDateLocal: null,
                    dueHasExplicitTime: Boolean(item.sourceDueAt),
                  }
                : {}),
              ...(action.fieldName === "subject"
                ? { subjectId: sourceSubject?.id ?? null }
                : {}),
              ...(action.fieldName === "calendarNote"
                ? { calendarNote: "" }
                : {}),
              overrides: item.overrides.filter(
                (entry) => entry.fieldName !== action.fieldName,
              ),
              version: item.version + 1,
              calendarSyncState: "pending",
            }
          : item,
      ),
      toast: "Canvas source value restored",
      undo: null,
    });
  }
  if (action.type === "patchSubject") {
    return persist({
      ...state,
      subjects: state.subjects.map((subject) =>
        subject.id === action.id ? { ...subject, ...action.patch } : subject,
      ),
      toast: "Subject updated",
      undo: null,
    });
  }
  if (action.type === "addSubject") {
    const subject: Subject = {
      id: crypto.randomUUID(),
      canvasCourseId: null,
      sourceName: null,
      displayName: action.displayName,
      shortName: action.shortName ?? null,
      colour: action.colour ?? "#a78bfa",
      active: true,
    };
    return persist({
      ...state,
      subjects: [...state.subjects, subject],
      toast: "Subject added",
      undo: null,
    });
  }
  if (action.type === "undo") {
    if (!state.undo) return state;
    return persist({
      ...state,
      items: state.items.map((item) =>
        item.id === state.undo?.item.id ? state.undo.item : item,
      ),
      selectedItemId:
        state.undo.kind === "archive"
          ? state.undo.item.id
          : state.selectedItemId,
      toast: "Last change undone",
      undo: null,
    });
  }
  if (action.type === "saveView") {
    return persist({
      ...state,
      views: [
        ...state.views.filter((view) => view.id !== action.view.id),
        action.view,
      ],
      toast: `Saved view “${action.view.name}”`,
      undo: null,
    });
  }
  if (action.type === "addAttachment") {
    const createdAt = new Date().toISOString();
    return persist({
      ...state,
      items: state.items.map((item) =>
        item.id === action.itemId
          ? {
              ...item,
              attachments: [
                ...item.attachments,
                {
                  id: crypto.randomUUID(),
                  label: action.label,
                  url: action.url,
                  linkType: action.linkType,
                  createdAt,
                },
              ],
            }
          : item,
      ),
      toast: "Secure link added",
      undo: null,
    });
  }
  if (action.type === "select") {
    return {
      ...state,
      selectedItemId: action.id,
      selectedItemDetail:
        action.id && state.selectedItemDetail?.id === action.id
          ? state.selectedItemDetail
          : null,
    };
  }
  if (action.type === "command") return { ...state, commandOpen: action.open };
  if (action.type === "search") return { ...state, searchOpen: action.open };
  if (action.type === "syncing") return { ...state, syncing: action.value };
  if (action.type === "toast") return { ...state, toast: action.message };
  if (action.type === "reset") {
    localStorage.removeItem(storageKey);
    return initialState();
  }
  if (action.type === "patchItem") {
    const current = state.items.find((item) => item.id === action.id);
    const completedNow =
      current?.workingStatus !== "completed" &&
      action.patch.workingStatus === "completed";
    const nextDeadline =
      completedNow &&
      state.settings.recurrenceOnCompletion &&
      current?.recurrenceRule
        ? nextRecurrenceDeadline(current, current.recurrenceRule)
        : null;
    const occurrence =
      demoMode && current?.recurrenceRule && nextDeadline
        ? {
            ...current,
            id: crypto.randomUUID(),
            version: 1,
            ...nextDeadline,
            recurrenceSeriesId:
              current.recurrenceSeriesId ?? current.recurrenceRule.seriesId,
            workingStatus: "not_started" as const,
            completedAt: null,
            submittedAt: null,
            calendarSyncState: "pending" as const,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            history: [
              {
                id: crypto.randomUUID(),
                actorType: "system" as const,
                actorIdentity: "Organato",
                action: "recurrence_created",
                summary: "Created when the previous occurrence was completed",
                createdAt: new Date().toISOString(),
              },
            ],
          }
        : null;
    return persist({
      ...state,
      items: [
        ...(occurrence ? [occurrence] : []),
        ...state.items.map((item) =>
          item.id === action.id
            ? {
                ...item,
                ...action.patch,
                completedAt: completedNow
                  ? new Date().toISOString()
                  : item.completedAt,
                version: item.version + 1,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      ],
      toast: "Change saved",
      undo:
        current && !(completedNow && current.recurrenceRule)
          ? {
              kind: "patch",
              item: current,
              fields: Object.keys(action.patch) as Array<keyof OrganatoItem>,
            }
          : null,
    });
  }
  if (action.type === "classify") {
    return persist({
      ...state,
      items: state.items.map((item) =>
        item.id === action.id
          ? {
              ...item,
              classification: action.classification,
              version: item.version + 1,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
      toast: `Classified as ${action.classification}`,
      undo: state.items.find((item) => item.id === action.id)
        ? {
            kind: "classify",
            item: state.items.find((item) => item.id === action.id)!,
          }
        : null,
    });
  }
  if (action.type === "archive") {
    return persist({
      ...state,
      selectedItemId: null,
      selectedItemDetail: null,
      items: state.items.map((item) =>
        item.id === action.id
          ? {
              ...item,
              archivedAt: new Date().toISOString(),
              archiveReason: action.reason ?? "Manual archive",
              version: item.version + 1,
            }
          : item,
      ),
      toast: "Item archived",
      undo: state.items.find((item) => item.id === action.id)
        ? {
            kind: "archive",
            item: state.items.find((item) => item.id === action.id)!,
          }
        : null,
    });
  }
  if (action.type === "restore") {
    return persist({
      ...state,
      items: state.items.map((item) =>
        item.id === action.id
          ? {
              ...item,
              archivedAt: null,
              archiveReason: null,
              version: item.version + 1,
            }
          : item,
      ),
      toast: "Item restored",
      undo: state.items.find((item) => item.id === action.id)
        ? {
            kind: "restore",
            item: state.items.find((item) => item.id === action.id)!,
          }
        : null,
    });
  }
  if (action.type === "deleteItem") {
    const current = state.items.find((item) => item.id === action.id);
    if (!current || action.confirmation.trim().toLowerCase() !== "delete")
      return state;
    const itemLabel =
      current.kind === "todo"
        ? "Todo"
        : current.classification === "checkpoint"
          ? "Checkpoint"
          : current.classification === "both"
            ? "Assignment and checkpoint"
            : "Assignment";
    return persist({
      ...state,
      items: state.items.filter((item) => item.id !== action.id),
      selectedItemId: null,
      selectedItemDetail: null,
      toast: `${itemLabel} deleted`,
      undo: null,
    });
  }
  if (action.type === "addTodo" || action.type === "addWork") {
    const now = new Date().toISOString();
    const isTodo = action.type === "addTodo";
    const recurrenceRule =
      isTodo && "recurrenceRule" in action
        ? (action.recurrenceRule ?? null)
        : null;
    const todo: OrganatoItem = {
      id: crypto.randomUUID(),
      version: 1,
      kind: isTodo ? "todo" : "work",
      classification: isTodo ? "unclassified" : action.classification,
      sourceType: "manual",
      canvasAssignmentId: null,
      canvasCourseId: null,
      canvasHtmlUrl: null,
      sourceName: null,
      sourceDueAt: null,
      sourceUpdatedAt: null,
      sourcePayloadHash: null,
      displayName: action.name,
      dueAt: action.dueAt ?? null,
      dueDateLocal: action.dueDateLocal ?? null,
      dueHasExplicitTime: action.dueHasExplicitTime ?? Boolean(action.dueAt),
      subjectId: action.subjectId ?? null,
      priority: action.priority ?? null,
      workingStatus: "not_started",
      completedAt: null,
      submittedAt: null,
      notesMarkdown: "",
      recurrenceRule,
      recurrenceSeriesId: recurrenceRule?.seriesId ?? null,
      calendarEnabled:
        "calendarEnabled" in action && action.calendarEnabled !== undefined
          ? action.calendarEnabled
          : isTodo
            ? state.settings.todoCalendarDefault
            : true,
      remindersEnabled:
        "remindersEnabled" in action && action.remindersEnabled !== undefined
          ? action.remindersEnabled
          : isTodo
            ? state.settings.todoRemindersDefault
            : true,
      calendarSyncState:
        action.dueAt || action.dueDateLocal ? "pending" : "synced",
      calendarNote: "",
      pinned: false,
      sortRank: 0,
      archivedAt: null,
      archiveReason: null,
      sourceMissingSince: null,
      missingSyncCount: 0,
      createdAt: now,
      updatedAt: now,
      overrides: [],
      attachments: [],
      history: [
        {
          id: crypto.randomUUID(),
          actorType: "user",
          actorIdentity: "Alex Smith",
          action: "created",
          summary: isTodo ? "Created todo" : "Created work item",
          createdAt: now,
        },
      ],
    };
    return persist({
      ...state,
      items: [todo, ...state.items],
      toast: isTodo ? "Todo created" : "Work item created",
      undo: null,
    });
  }
  return persist({
    ...state,
    settings: { ...state.settings, ...action.patch },
    undo: null,
  });
}

function reducer(state: State, action: Action): State {
  const next = baseReducer(state, action);
  if (next.toast !== state.toast) {
    return { ...next, toastSeq: state.toastSeq + 1 };
  }
  if (action.type === "toast") {
    // Same message twice should still retrigger the auto-dismiss timer.
    return { ...next, toastSeq: state.toastSeq + 1 };
  }
  return next;
}

interface ActionsContextValue {
  dispatch: React.Dispatch<Action>;
  refresh(options?: { includeArchived?: boolean }): Promise<void>;
  loadItemDetails(id: string): Promise<void>;
  syncNow(): void;
}

type ItemsContextValue = Pick<State, "items" | "archivedReady">;
type WorkspaceContextValue = Pick<
  State,
  "subjects" | "settings" | "integrations" | "views" | "ready" | "bootError"
> & { subjectsById: Map<string, Subject> };
type UiContextValue = Pick<
  State,
  | "selectedItemId"
  | "commandOpen"
  | "searchOpen"
  | "syncing"
  | "toast"
  | "toastSeq"
  | "undo"
> & { selectedItem: OrganatoItem | null };

const OrganatoItemsContext = createContext<ItemsContextValue | null>(null);
const OrganatoWorkspaceContext = createContext<WorkspaceContextValue | null>(
  null,
);
const OrganatoUiContext = createContext<UiContextValue | null>(null);
const OrganatoActionsContext = createContext<ActionsContextValue | null>(null);

export function OrganatoProvider({ children }: { children: ReactNode }) {
  const [state, baseDispatch] = useReducer(reducer, undefined, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const archivedRequest = useRef<Promise<{ items: OrganatoItem[] }> | null>(
    null,
  );
  const detailedItemRequest = useRef<{
    id: string;
    promise: Promise<OrganatoItem>;
  } | null>(null);
  const lastDetailedItem = useRef<OrganatoItem | null>(null);
  const serverVersions = useRef(new Map<string, number>());
  useEffect(() => {
    if (!demoMode) return;
    const timeout = window.setTimeout(() => {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            items: state.items,
            subjects: state.subjects,
            settings: state.settings,
            views: state.views,
          }),
        );
      } catch {
        // Storage limits must not take down the interactive app.
      }
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [state.items, state.settings, state.subjects, state.views]);
  const apiRequest = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const headers = new Headers(init.headers);
      if (init.method && !["GET", "HEAD"].includes(init.method)) {
        headers.set(
          "X-CSRF-Token",
          sessionStorage.getItem("organato_csrf") ?? "",
        );
      }
      if (init.body) headers.set("Content-Type", "application/json");
      const controller = new AbortController();
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, API_TIMEOUT_MS);
      const abortFromCaller = () => controller.abort(init.signal?.reason);
      if (init.signal?.aborted) abortFromCaller();
      else
        init.signal?.addEventListener("abort", abortFromCaller, { once: true });
      try {
        const response = await fetch(path, {
          ...init,
          headers,
          credentials: "same-origin",
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => ({}))) as T & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? "The request could not be completed.");
        }
        return body;
      } catch (error) {
        if (timedOut) {
          throw new Error("The request timed out. Please try again.");
        }
        throw error;
      } finally {
        window.clearTimeout(timeout);
        init.signal?.removeEventListener("abort", abortFromCaller);
      }
    },
    [],
  );
  const refresh = useCallback(
    async (options?: { includeArchived?: boolean }) => {
      if (demoMode) return;
      if (options?.includeArchived && !archivedRequest.current) {
        archivedRequest.current = apiRequest<{ items: OrganatoItem[] }>(
          "/api/items?archived=true&limit=2000",
        ).then(
          (result) => {
            archivedRequest.current = null;
            return result;
          },
          (error: unknown) => {
            archivedRequest.current = null;
            throw error;
          },
        );
      }
      // Partial hydration: a single failing slice (views, integrations,
      // …) no longer blocks the whole workspace. Only items are critical.
      const [active, archived, subjects, settings, integrations, views] =
        await Promise.all([
          apiRequest<{ items: OrganatoItem[] }>("/api/items?limit=2000"),
          options?.includeArchived
            ? archivedRequest.current
            : Promise.resolve(null),
          apiRequest<{ subjects: Subject[] }>("/api/subjects").catch(
            () => null,
          ),
          apiRequest<{ settings: WorkspaceSettings }>("/api/settings").catch(
            () => null,
          ),
          apiRequest<{
            integrations: Array<{
              provider: "canvas" | "google";
              status: IntegrationHealth["state"];
              last_success_at: string | null;
              last_attempt_at: string | null;
              last_error_category: string | null;
              reconnect_needed: number;
            }>;
          }>("/api/integrations").catch(() => null),
          apiRequest<{ views: SavedView[] }>("/api/views").catch(() => null),
        ]);
      const degraded = [
        !subjects && "subjects",
        !settings && "settings",
        !integrations && "integrations",
        !views && "views",
      ].filter(Boolean) as string[];
      detailedItemRequest.current = null;
      lastDetailedItem.current = null;
      serverVersions.current = new Map(
        [...active.items, ...(archived?.items ?? [])].map((item) => [
          item.id,
          item.version,
        ]),
      );
      const integrationHealth = seedIntegrations.map((fallback) => {
        const provider = fallback.provider === "canvas" ? "canvas" : "google";
        const connection = integrations?.integrations.find(
          (entry) => entry.provider === provider,
        );
        if (!connection) {
          return {
            ...fallback,
            state: "disconnected" as const,
            lastAttemptAt: null,
            lastSuccessAt: null,
            lastError: null,
          };
        }
        return {
          ...fallback,
          state: connection.reconnect_needed
            ? ("action_needed" as const)
            : connection.status,
          lastAttemptAt: connection.last_attempt_at,
          lastSuccessAt: connection.last_success_at,
          lastError: connection.last_error_category,
        };
      });
      baseDispatch({
        type: "hydrate",
        items: archived ? [...active.items, ...archived.items] : active.items,
        subjects: subjects?.subjects ?? [],
        settings: { ...seedSettings, ...settings?.settings },
        integrations: integrationHealth,
        views: views?.views ?? [],
        preserveArchived: archived === null,
        ...(archived ? { archivedReady: true } : {}),
      });
      if (degraded.length) {
        baseDispatch({
          type: "toast",
          message: `Some workspace data (${degraded.join(", ")}) could not load. Core work is available; reload to retry.`,
        });
      }
    },
    [apiRequest],
  );

  const loadWorkspace = useCallback(async () => {
    baseDispatch({ type: "bootStarted" });
    try {
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      baseDispatch({
        type: "bootFailed",
        message:
          typeof navigator !== "undefined" && !navigator.onLine
            ? "Reconnect to load your private workspace, then try again."
            : /session|authentication|sign-in/i.test(message)
              ? "Your sign-in expired. Sign in again to reload your workspace."
              : "One or more workspace requests failed. Your data is safe; try again.",
      });
    }
  }, [refresh]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const mutationQueues = useRef(new Map<string, Promise<void>>());
  const loadItemDetails = useCallback(
    async (id: string) => {
      if (demoMode) return;
      if (lastDetailedItem.current?.id === id) {
        baseDispatch({ type: "detailLoaded", item: lastDetailedItem.current });
        return;
      }
      const pending = detailedItemRequest.current;
      if (pending?.id === id) {
        const item = await pending.promise;
        baseDispatch({ type: "detailLoaded", item });
        return;
      }
      const promise = apiRequest<{ item: OrganatoItem }>(
        `/api/items/${encodeURIComponent(id)}`,
      ).then((result) => result.item);
      detailedItemRequest.current = { id, promise };
      try {
        const item = await promise;
        lastDetailedItem.current = item;
        baseDispatch({ type: "detailLoaded", item });
      } finally {
        if (detailedItemRequest.current?.promise === promise) {
          detailedItemRequest.current = null;
        }
      }
    },
    [apiRequest],
  );
  useEffect(() => {
    if (!state.selectedItemId) return;
    void loadItemDetails(state.selectedItemId).catch(() => undefined);
  }, [loadItemDetails, state.selectedItemId]);
  const dispatch = useCallback(
    (action: Action) => {
      const currentState = stateRef.current;
      const current =
        "id" in action
          ? currentState.items.find((item) => item.id === action.id)
          : null;
      const undoState = currentState.undo;
      const optimistic =
        demoMode || !["addTodo", "addWork"].includes(action.type);
      if (optimistic) baseDispatch(action);
      if (!demoMode && action.type === "select" && action.id) {
        void loadItemDetails(action.id).catch(() => undefined);
      }
      if (isOffline() && isServerMutation(action)) {
        if (current) baseDispatch({ type: "rollbackItem", item: current });
        baseDispatch({
          type: "toast",
          message: "Offline · this change was not saved",
        });
        return;
      }
      if (
        demoMode ||
        [
          "hydrate",
          "replaceItem",
          "rollbackItem",
          "detailLoaded",
          "syncSubjects",
          "releaseArchived",
          "select",
          "command",
          "search",
          "syncing",
          "toast",
          "bootStarted",
          "bootFailed",
          "reset",
        ].includes(action.type)
      ) {
        return;
      }
      const queueKey =
        action.type === "addTodo" || action.type === "addWork"
          ? `${action.type}:${crypto.randomUUID()}`
          : "id" in action && typeof action.id === "string"
            ? `item:${action.id}`
            : action.type === "addAttachment"
              ? `item:${action.itemId}`
              : action.type === "patchSubject"
                ? `subject:${action.id}`
                : action.type === "settings"
                  ? "settings"
                  : action.type === "undo" && undoState
                    ? `item:${undoState.item.id}`
                    : action.type;
      const previous =
        mutationQueues.current.get(queueKey) ?? Promise.resolve();
      const operation = previous
        .catch(() => undefined)
        .then(async () => {
          if (action.type === "patchItem" && current) {
            const version =
              serverVersions.current.get(current.id) ?? current.version;
            const result = await apiRequest<{
              item: OrganatoItem;
              nextOccurrence?: OrganatoItem | null;
            }>(`/api/items/${encodeURIComponent(action.id)}`, {
              method: "PATCH",
              body: JSON.stringify({
                version,
                ...action.patch,
              }),
            });
            serverVersions.current.set(result.item.id, result.item.version);
            baseDispatch({ type: "replaceItem", item: result.item });
            if (result.nextOccurrence) {
              baseDispatch({
                type: "replaceItem",
                item: result.nextOccurrence,
              });
            }
            return;
          }
          if (action.type === "classify" && current) {
            const version =
              serverVersions.current.get(current.id) ?? current.version;
            const result = await apiRequest<{ item: OrganatoItem }>(
              `/api/items/${encodeURIComponent(action.id)}/classify`,
              {
                method: "POST",
                body: JSON.stringify({
                  version,
                  classification: action.classification,
                }),
              },
            );
            serverVersions.current.set(result.item.id, result.item.version);
            baseDispatch({ type: "replaceItem", item: result.item });
            return;
          }
          if (action.type === "archive") {
            if (!current) return;
            const version =
              serverVersions.current.get(current.id) ?? current.version;
            const result = await apiRequest<{ item: OrganatoItem }>(
              `/api/items/${encodeURIComponent(action.id)}/archive`,
              {
                method: "POST",
                body: JSON.stringify({ version }),
              },
            );
            serverVersions.current.set(result.item.id, result.item.version);
            baseDispatch({ type: "replaceItem", item: result.item });
            return;
          }
          if (action.type === "restore") {
            if (!current) return;
            const version =
              serverVersions.current.get(current.id) ?? current.version;
            const result = await apiRequest<{ item: OrganatoItem }>(
              `/api/items/${encodeURIComponent(action.id)}/restore`,
              {
                method: "POST",
                body: JSON.stringify({ version }),
              },
            );
            serverVersions.current.set(result.item.id, result.item.version);
            baseDispatch({ type: "replaceItem", item: result.item });
            return;
          }
          if (action.type === "deleteItem") {
            if (!current) return;
            const version =
              serverVersions.current.get(current.id) ?? current.version;
            await apiRequest(
              `/api/items/${encodeURIComponent(action.id)}/permanent-delete`,
              {
                method: "POST",
                body: JSON.stringify({
                  version,
                  confirmation: action.confirmation,
                }),
              },
            );
            serverVersions.current.delete(current.id);
            return;
          }
          if (action.type === "addTodo" || action.type === "addWork") {
            const isTodo = action.type === "addTodo";
            const result = await apiRequest<{ item: OrganatoItem }>(
              "/api/items",
              {
                method: "POST",
                body: JSON.stringify({
                  kind: isTodo ? "todo" : "work",
                  classification: isTodo
                    ? "unclassified"
                    : action.classification,
                  displayName: action.name,
                  dueAt: action.dueAt ?? null,
                  dueDateLocal:
                    "dueDateLocal" in action
                      ? (action.dueDateLocal ?? null)
                      : null,
                  dueHasExplicitTime:
                    "dueHasExplicitTime" in action
                      ? (action.dueHasExplicitTime ?? Boolean(action.dueAt))
                      : Boolean(action.dueAt),
                  subjectId: action.subjectId ?? null,
                  priority: action.priority ?? null,
                  recurrenceRule:
                    isTodo && "recurrenceRule" in action
                      ? (action.recurrenceRule ?? null)
                      : null,
                  calendarEnabled:
                    "calendarEnabled" in action &&
                    action.calendarEnabled !== undefined
                      ? action.calendarEnabled
                      : isTodo
                        ? currentState.settings.todoCalendarDefault
                        : true,
                  remindersEnabled:
                    "remindersEnabled" in action &&
                    action.remindersEnabled !== undefined
                      ? action.remindersEnabled
                      : isTodo
                        ? currentState.settings.todoRemindersDefault
                        : true,
                }),
              },
            );
            serverVersions.current.set(result.item.id, result.item.version);
            baseDispatch({ type: "replaceItem", item: result.item });
            baseDispatch({
              type: "toast",
              message: isTodo
                ? "Todo created"
                : action.classification === "checkpoint"
                  ? "Checkpoint created"
                  : action.classification === "both"
                    ? "Assignment and checkpoint created"
                    : "Assignment created",
            });
            return;
          }
          if (action.type === "settings") {
            await apiRequest("/api/settings", {
              method: "PATCH",
              body: JSON.stringify(action.patch),
            });
            return;
          }
          if (action.type === "saveView") {
            await apiRequest("/api/views", {
              method: "POST",
              body: JSON.stringify(action.view),
            });
            return;
          }
          if (action.type === "addAttachment") {
            const result = await apiRequest<{ item: OrganatoItem }>(
              `/api/items/${encodeURIComponent(action.itemId)}/attachments`,
              {
                method: "POST",
                body: JSON.stringify({
                  label: action.label,
                  url: action.url,
                  linkType: action.linkType,
                }),
              },
            );
            serverVersions.current.set(result.item.id, result.item.version);
            baseDispatch({ type: "replaceItem", item: result.item });
            return;
          }
          if (action.type === "resetOverride") {
            const result = await apiRequest<{ item: OrganatoItem }>(
              `/api/items/${encodeURIComponent(action.id)}/reset-override`,
              {
                method: "POST",
                body: JSON.stringify({ fieldName: action.fieldName }),
              },
            );
            serverVersions.current.set(result.item.id, result.item.version);
            baseDispatch({ type: "replaceItem", item: result.item });
            return;
          }
          if (action.type === "patchSubject") {
            const result = await apiRequest<{ subjects: Subject[] }>(
              `/api/subjects/${encodeURIComponent(action.id)}`,
              {
                method: "PATCH",
                body: JSON.stringify(action.patch),
              },
            );
            baseDispatch({ type: "syncSubjects", subjects: result.subjects });
            return;
          }
          if (action.type === "addSubject") {
            const result = await apiRequest<{ subjects: Subject[] }>(
              "/api/subjects",
              {
                method: "POST",
                body: JSON.stringify({
                  displayName: action.displayName,
                  shortName: action.shortName ?? null,
                  colour: action.colour ?? "#a78bfa",
                }),
              },
            );
            baseDispatch({ type: "syncSubjects", subjects: result.subjects });
            return;
          }
          if (action.type === "undo" && undoState) {
            const currentItem = currentState.items.find(
              (item) => item.id === undoState.item.id,
            );
            if (undoState.kind === "patch" && currentItem) {
              const patch = Object.fromEntries(
                (undoState.fields ?? []).map((field) => [
                  field,
                  undoState.item[field],
                ]),
              );
              const result = await apiRequest<{ item: OrganatoItem }>(
                `/api/items/${encodeURIComponent(currentItem.id)}`,
                {
                  method: "PATCH",
                  body: JSON.stringify({
                    version:
                      serverVersions.current.get(currentItem.id) ??
                      currentItem.version,
                    ...patch,
                  }),
                },
              );
              serverVersions.current.set(result.item.id, result.item.version);
              baseDispatch({ type: "replaceItem", item: result.item });
              return;
            }
            if (undoState.kind === "classify" && currentItem) {
              const result = await apiRequest<{ item: OrganatoItem }>(
                `/api/items/${encodeURIComponent(currentItem.id)}/classify`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    version:
                      serverVersions.current.get(currentItem.id) ??
                      currentItem.version,
                    classification: undoState.item.classification,
                  }),
                },
              );
              serverVersions.current.set(result.item.id, result.item.version);
              baseDispatch({ type: "replaceItem", item: result.item });
              return;
            }
            const path =
              undoState.kind === "archive"
                ? "restore"
                : undoState.kind === "restore"
                  ? "archive"
                  : null;
            if (path) {
              if (!currentItem) return;
              const result = await apiRequest<{ item: OrganatoItem }>(
                `/api/items/${encodeURIComponent(undoState.item.id)}/${path}`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    version:
                      serverVersions.current.get(currentItem.id) ??
                      currentItem.version,
                  }),
                },
              );
              serverVersions.current.set(result.item.id, result.item.version);
              baseDispatch({ type: "replaceItem", item: result.item });
            }
          }
        })
        .catch(async (error) => {
          if (current) baseDispatch({ type: "rollbackItem", item: current });
          const message =
            error instanceof Error
              ? error.message
              : "The change could not be saved.";
          let recoveryFailed = false;
          if (current) {
            try {
              const result = await apiRequest<{ item: OrganatoItem }>(
                `/api/items/${encodeURIComponent(current.id)}`,
              );
              serverVersions.current.set(result.item.id, result.item.version);
              baseDispatch({ type: "replaceItem", item: result.item });
            } catch {
              recoveryFailed = true;
            }
          }
          baseDispatch({
            type: "toast",
            message: recoveryFailed
              ? `${message} The item could not refresh; reconnect and try again.`
              : message,
          });
        })
        .finally(() => {
          if (mutationQueues.current.get(queueKey) === operation) {
            mutationQueues.current.delete(queueKey);
          }
        });
      mutationQueues.current.set(queueKey, operation);
    },
    [apiRequest, loadItemDetails],
  );
  const syncNow = useCallback(() => {
    if (isOffline()) {
      baseDispatch({
        type: "toast",
        message: "Offline · reconnect before syncing",
      });
      return;
    }
    if (!demoMode) {
      baseDispatch({ type: "syncing", value: true });
      void apiRequest("/api/integrations/canvas/sync", {
        method: "POST",
        body: JSON.stringify({}),
      })
        .then(() => refresh())
        .then(() =>
          baseDispatch({
            type: "toast",
            message: "Canvas and Calendar are up to date",
          }),
        )
        .catch((error) =>
          baseDispatch({
            type: "toast",
            message:
              error instanceof Error
                ? error.message
                : "Sync could not complete.",
          }),
        )
        .finally(() => baseDispatch({ type: "syncing", value: false }));
      return;
    }
    dispatch({ type: "syncing", value: true });
    window.setTimeout(() => {
      dispatch({ type: "syncing", value: false });
      dispatch({
        type: "toast",
        message: "Canvas and Calendar are up to date",
      });
    }, 900);
  }, [apiRequest, dispatch, refresh]);
  const subjectsById = useMemo(
    () => new Map(state.subjects.map((subject) => [subject.id, subject])),
    [state.subjects],
  );
  const itemsValue = useMemo<ItemsContextValue>(
    () => ({ items: state.items, archivedReady: state.archivedReady }),
    [state.archivedReady, state.items],
  );
  const workspaceValue = useMemo<WorkspaceContextValue>(
    () => ({
      subjects: state.subjects,
      settings: state.settings,
      integrations: state.integrations,
      views: state.views,
      ready: state.ready,
      bootError: state.bootError,
      subjectsById,
    }),
    [
      state.bootError,
      state.integrations,
      state.ready,
      state.settings,
      state.subjects,
      state.views,
      subjectsById,
    ],
  );
  const selectedItem = useMemo(
    () =>
      state.selectedItemDetail ??
      state.items.find((item) => item.id === state.selectedItemId) ??
      null,
    [state.items, state.selectedItemDetail, state.selectedItemId],
  );
  const uiValue = useMemo<UiContextValue>(
    () => ({
      selectedItemId: state.selectedItemId,
      selectedItem,
      commandOpen: state.commandOpen,
      searchOpen: state.searchOpen,
      syncing: state.syncing,
      toast: state.toast,
      toastSeq: state.toastSeq,
      undo: state.undo,
    }),
    [
      selectedItem,
      state.commandOpen,
      state.searchOpen,
      state.selectedItemId,
      state.syncing,
      state.toast,
      state.toastSeq,
      state.undo,
    ],
  );
  const actionsValue = useMemo<ActionsContextValue>(
    () => ({ dispatch, refresh, loadItemDetails, syncNow }),
    [dispatch, loadItemDetails, refresh, syncNow],
  );
  if (!state.ready) {
    if (state.bootError) {
      return (
        <main className="auth-page">
          <section
            aria-labelledby="workspace-load-error-title"
            aria-live="assertive"
            role="alert"
          >
            <span className="auth-mark">
              <BrandMark size={24} />
            </span>
            <h1 id="workspace-load-error-title">Workspace couldn’t open</h1>
            <p>{state.bootError}</p>
            <button type="button" onClick={() => void loadWorkspace()}>
              Try again
            </button>
            <small>Nothing was changed while Organato was reconnecting.</small>
          </section>
        </main>
      );
    }
    return <div className="auth-loading" aria-label="Loading workspace" />;
  }
  return (
    <OrganatoActionsContext.Provider value={actionsValue}>
      <OrganatoWorkspaceContext.Provider value={workspaceValue}>
        <OrganatoItemsContext.Provider value={itemsValue}>
          <OrganatoUiContext.Provider value={uiValue}>
            {children}
          </OrganatoUiContext.Provider>
        </OrganatoItemsContext.Provider>
      </OrganatoWorkspaceContext.Provider>
    </OrganatoActionsContext.Provider>
  );
}

export function useOrganatoItems() {
  const context = useContext(OrganatoItemsContext);
  if (!context)
    throw new Error("useOrganatoItems must be used inside OrganatoProvider");
  return context;
}

export function useOrganatoWorkspace() {
  const context = useContext(OrganatoWorkspaceContext);
  if (!context)
    throw new Error(
      "useOrganatoWorkspace must be used inside OrganatoProvider",
    );
  return context;
}

export function useOrganatoData() {
  return { ...useOrganatoItems(), ...useOrganatoWorkspace() };
}

export function useOrganatoUi() {
  const context = useContext(OrganatoUiContext);
  if (!context)
    throw new Error("useOrganatoUi must be used inside OrganatoProvider");
  return context;
}

export function useOrganatoActions() {
  const context = useContext(OrganatoActionsContext);
  if (!context)
    throw new Error("useOrganatoActions must be used inside OrganatoProvider");
  return context;
}
