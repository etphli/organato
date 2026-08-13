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
  bootError: string | null;
  selectedItemId: string | null;
  commandOpen: boolean;
  searchOpen: boolean;
  syncing: boolean;
  toast: string | null;
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
    }
  | { type: "replaceItem"; item: OrganatoItem }
  | { type: "rollbackItem"; item: OrganatoItem }
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
          bootError: null,
          selectedItemId: null,
          commandOpen: false,
          searchOpen: false,
          syncing: false,
          toast: null,
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
    bootError: null,
    selectedItemId: null,
    commandOpen: false,
    searchOpen: false,
    syncing: false,
    toast: null,
    undo: null,
  };
}

function persist(state: State): State {
  if (demoMode) {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        items: state.items,
        subjects: state.subjects,
        settings: state.settings,
        views: state.views,
      }),
    );
  }
  return state;
}

function reducer(state: State, action: Action): State {
  if (action.type === "hydrate") {
    return persist({
      ...state,
      items: action.items,
      subjects: action.subjects,
      settings: action.settings,
      integrations: action.integrations,
      views: action.views,
      ready: true,
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
    return {
      ...state,
      items: exists
        ? state.items.map((item) =>
            item.id === action.item.id ? action.item : item,
          )
        : [action.item, ...state.items],
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
    };
  }
  if (isOffline() && isServerMutation(action)) {
    return { ...state, toast: "Offline · this change was not saved" };
  }
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
  if (action.type === "select") return { ...state, selectedItemId: action.id };
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
    if (!current || action.confirmation !== current.displayName) return state;
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
      toast: `${itemLabel} deleted`,
      undo: null,
    });
  }
  if (action.type === "addTodo" || action.type === "addWork") {
    const now = new Date().toISOString();
    const isTodo = action.type === "addTodo";
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
      recurrenceRule: null,
      recurrenceSeriesId: null,
      calendarEnabled: isTodo ? state.settings.todoCalendarDefault : true,
      remindersEnabled: isTodo ? state.settings.todoRemindersDefault : true,
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

interface ContextValue extends State {
  subjectsById: Map<string, Subject>;
  selectedItem: OrganatoItem | null;
  dispatch: React.Dispatch<Action>;
  refresh(): Promise<void>;
  syncNow(): void;
}

const OrganatoContext = createContext<ContextValue | null>(null);

export function OrganatoProvider({ children }: { children: ReactNode }) {
  const [state, baseDispatch] = useReducer(reducer, undefined, initialState);
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
      const response = await fetch(path, {
        ...init,
        headers,
        credentials: "same-origin",
      });
      const body = (await response.json().catch(() => ({}))) as T & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "The request could not be completed.");
      }
      return body;
    },
    [],
  );
  const refresh = useCallback(async () => {
    if (demoMode) return;
    const [active, archived, subjects, settings, integrations, views] =
      await Promise.all([
        apiRequest<{ items: OrganatoItem[] }>("/api/items?limit=2000"),
        apiRequest<{ items: OrganatoItem[] }>(
          "/api/items?archived=true&limit=2000",
        ),
        apiRequest<{ subjects: Subject[] }>("/api/subjects"),
        apiRequest<{ settings: WorkspaceSettings }>("/api/settings"),
        apiRequest<{
          integrations: Array<{
            provider: "canvas" | "google";
            status: IntegrationHealth["state"];
            last_success_at: string | null;
            last_attempt_at: string | null;
            last_error_category: string | null;
            reconnect_needed: number;
          }>;
        }>("/api/integrations"),
        apiRequest<{ views: SavedView[] }>("/api/views"),
      ]);
    const integrationHealth = seedIntegrations.map((fallback) => {
      const provider = fallback.provider === "canvas" ? "canvas" : "google";
      const connection = integrations.integrations.find(
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
      items: [...active.items, ...archived.items],
      subjects: subjects.subjects,
      settings: { ...seedSettings, ...settings.settings },
      integrations: integrationHealth,
      views: views.views,
    });
  }, [apiRequest]);

  const loadWorkspace = useCallback(async () => {
    baseDispatch({ type: "bootStarted" });
    try {
      await refresh();
    } catch {
      baseDispatch({
        type: "bootFailed",
        message:
          typeof navigator !== "undefined" && !navigator.onLine
            ? "Reconnect to load your private workspace, then try again."
            : "One or more workspace requests failed. Your data is safe; try again.",
      });
    }
  }, [refresh]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const mutationQueue = useRef(Promise.resolve());
  const dispatch = useCallback(
    (action: Action) => {
      const current =
        "id" in action
          ? state.items.find((item) => item.id === action.id)
          : null;
      const undoState = state.undo;
      const optimistic =
        demoMode || !["addTodo", "addWork"].includes(action.type);
      if (optimistic) baseDispatch(action);
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
      mutationQueue.current = mutationQueue.current
        .then(async () => {
          if (action.type === "patchItem" && current) {
            const result = await apiRequest<{
              item: OrganatoItem;
              nextOccurrence?: OrganatoItem | null;
            }>(`/api/items/${encodeURIComponent(action.id)}`, {
              method: "PATCH",
              body: JSON.stringify({
                version: current.version,
                ...action.patch,
              }),
            });
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
            const result = await apiRequest<{ item: OrganatoItem }>(
              `/api/items/${encodeURIComponent(action.id)}/classify`,
              {
                method: "POST",
                body: JSON.stringify({
                  version: current.version,
                  classification: action.classification,
                }),
              },
            );
            baseDispatch({ type: "replaceItem", item: result.item });
            return;
          }
          if (action.type === "archive") {
            if (!current) return;
            const result = await apiRequest<{ item: OrganatoItem }>(
              `/api/items/${encodeURIComponent(action.id)}/archive`,
              {
                method: "POST",
                body: JSON.stringify({ version: current.version }),
              },
            );
            baseDispatch({ type: "replaceItem", item: result.item });
            return;
          }
          if (action.type === "restore") {
            if (!current) return;
            const result = await apiRequest<{ item: OrganatoItem }>(
              `/api/items/${encodeURIComponent(action.id)}/restore`,
              {
                method: "POST",
                body: JSON.stringify({ version: current.version }),
              },
            );
            baseDispatch({ type: "replaceItem", item: result.item });
            return;
          }
          if (action.type === "deleteItem") {
            if (!current) return;
            await apiRequest(
              `/api/items/${encodeURIComponent(action.id)}/permanent-delete`,
              {
                method: "POST",
                body: JSON.stringify({
                  version: current.version,
                  confirmation: action.confirmation,
                }),
              },
            );
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
                  recurrenceRule: null,
                  calendarEnabled: isTodo
                    ? state.settings.todoCalendarDefault
                    : true,
                  remindersEnabled: isTodo
                    ? state.settings.todoRemindersDefault
                    : true,
                }),
              },
            );
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
            baseDispatch({ type: "replaceItem", item: result.item });
            return;
          }
          if (action.type === "patchSubject") {
            await apiRequest<{ subjects: Subject[] }>(
              `/api/subjects/${encodeURIComponent(action.id)}`,
              {
                method: "PATCH",
                body: JSON.stringify(action.patch),
              },
            );
            await refresh();
            return;
          }
          if (action.type === "addSubject") {
            await apiRequest<{ subjects: Subject[] }>("/api/subjects", {
              method: "POST",
              body: JSON.stringify({
                displayName: action.displayName,
                shortName: action.shortName ?? null,
                colour: action.colour ?? "#a78bfa",
              }),
            });
            await refresh();
            return;
          }
          if (action.type === "undo" && undoState) {
            const currentItem = state.items.find(
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
                    version: currentItem.version,
                    ...patch,
                  }),
                },
              );
              baseDispatch({ type: "replaceItem", item: result.item });
              return;
            }
            if (undoState.kind === "classify" && currentItem) {
              const result = await apiRequest<{ item: OrganatoItem }>(
                `/api/items/${encodeURIComponent(currentItem.id)}/classify`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    version: currentItem.version,
                    classification: undoState.item.classification,
                  }),
                },
              );
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
              await apiRequest(
                `/api/items/${encodeURIComponent(undoState.item.id)}/${path}`,
                {
                  method: "POST",
                  body: JSON.stringify({ version: currentItem.version }),
                },
              );
              await refresh();
            }
          }
        })
        .catch(async (error) => {
          if (current) baseDispatch({ type: "rollbackItem", item: current });
          const message =
            error instanceof Error
              ? error.message
              : "The change could not be saved.";
          let refreshFailed = false;
          try {
            await refresh();
          } catch {
            refreshFailed = true;
          }
          baseDispatch({
            type: "toast",
            message: refreshFailed
              ? `${message} The workspace could not refresh; reconnect and try again.`
              : message,
          });
        });
    },
    [apiRequest, refresh, state.items, state.settings, state.undo],
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
        .then(refresh)
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
  const value = useMemo<ContextValue>(
    () => ({
      ...state,
      subjectsById: new Map(
        state.subjects.map((subject) => [subject.id, subject]),
      ),
      selectedItem:
        state.items.find((item) => item.id === state.selectedItemId) ?? null,
      views: state.views,
      integrations: state.integrations,
      dispatch,
      refresh,
      syncNow,
    }),
    [dispatch, refresh, state, syncNow],
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
    <OrganatoContext.Provider value={value}>
      {children}
    </OrganatoContext.Provider>
  );
}

export function useOrganato() {
  const context = useContext(OrganatoContext);
  if (!context)
    throw new Error("useOrganato must be used inside OrganatoProvider");
  return context;
}
