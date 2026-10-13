import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import {
  Archive,
  Columns3,
  Eye,
  EyeOff,
  ExternalLink,
  Filter,
  GitCompareArrows,
  Link2,
  MoreHorizontal,
  Pin,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  daysRemainingLabel,
  itemDeadline,
  visibleStatus,
  type OrganatoItem,
  type SavedView,
} from "@organato/domain/core";
import { PageHeader } from "../components/PageHeader";
import {
  OrganatoActionMenu,
  OrganatoSelect,
} from "../components/OrganatoControls";
import { SubjectDot } from "../components/SubjectDot";
import { useOrganatoActions, useOrganatoData } from "../state/OrganatoProvider";
import { CreateWorkControl, type NewWorkItem } from "./CreateWorkForm";
import { DeleteWorkDialog } from "./DeleteWorkDialog";

const columnHelper = createColumnHelper<OrganatoItem>();
const defaultPageSize = 50;
const priorityOptions = [
  { value: "", label: "—" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];
const statusOptions = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "submitted", label: "Submitted" },
  { value: "completed", label: "Completed" },
];
const assignmentsShowCompletedKey = "organato-assignments-show-completed-v1";
function loadShowCompletedPreference(): boolean {
  try {
    return (
      (localStorage.getItem(assignmentsShowCompletedKey) ??
        localStorage.getItem("organato-checkpoints-show-completed-v1")) ===
      "true"
    );
  } catch {
    return false;
  }
}

function saveShowCompletedPreference(value: boolean): void {
  try {
    localStorage.setItem(assignmentsShowCompletedKey, String(value));
  } catch {
    // The table still works when browser storage is unavailable.
  }
}

const sortFieldOptions = [
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "name", label: "Name" },
  { value: "status", label: "Status" },
  { value: "subject", label: "Subject" },
];

export default function WorkPage() {
  const page = "assignments";
  const { items, subjects, subjectsById, views, settings } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "due", desc: false },
  ]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  });
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [showCompleted, setShowCompleted] = useState(() =>
    loadShowCompletedPreference(),
  );
  const [priorityFilter, setPriorityFilter] = useState("");
  const [viewName, setViewName] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeView, setActiveView] = useState(
    () => searchParams.get("view") ?? "active",
  );
  const [deleteCandidate, setDeleteCandidate] = useState<OrganatoItem | null>(
    null,
  );
  const mobileActionsRef = useRef<HTMLDetailsElement>(null);
  const itemNoun = "assignment";
  // Recompute "now" every minute (and when the tab regains focus) so
  // overnight tabs do not keep stale overdue/week/remaining-day values.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  // Filtering to a smaller set must not strand the table on an empty page.
  useEffect(() => {
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }, [query, priorityFilter, activeView]);
  const closeMobileActions = () => {
    if (mobileActionsRef.current) mobileActionsRef.current.open = false;
  };
  const pageViews = useMemo(
    () =>
      views.filter(
        (view) => view.page === "assignments" || view.page === "checkpoints",
      ),
    [views],
  );
  const createWork = useCallback(
    (item: NewWorkItem) => {
      dispatch({ type: "addWork", ...item });
    },
    [dispatch],
  );
  const closeDeleteDialog = useCallback(() => setDeleteCandidate(null), []);
  const deleteWork = useCallback(
    (candidate: OrganatoItem, confirmation: string) => {
      dispatch({ type: "deleteItem", id: candidate.id, confirmation });
      setDeleteCandidate(null);
    },
    [dispatch],
  );
  const viewOptions = useMemo(
    () => [
      { value: "active", label: "All active" },
      {
        value: "all",
        label: "All assignments",
      },
      ...views
        .filter(
          (view) => view.page === "assignments" || view.page === "checkpoints",
        )
        .map((view) => ({ value: view.id, label: view.name })),
    ],
    [views],
  );
  const data = useMemo(
    () =>
      items.filter((item) => {
        if (item.kind !== "work" || item.archivedAt) {
          return false;
        }
        if (priorityFilter && item.priority !== priorityFilter) return false;
        if (activeView === "active") {
          const status = visibleStatus(item, now, settings.timezone);
          if (status === "completed" && !showCompleted) return false;
          if (status === "submitted" && !settings.showSubmittedActive)
            return false;
        }
        const selectedView = pageViews.find((view) => view.id === activeView);
        if (selectedView?.filters.due === "overdue") {
          return visibleStatus(item, now, settings.timezone) === "overdue";
        }
        if (selectedView?.filters.due === "this_week") {
          const deadline = itemDeadline(item, settings.timezone);
          return Boolean(
            deadline &&
            deadline.getTime() >= now.getTime() &&
            deadline.getTime() <= now.getTime() + 7 * 86_400_000,
          );
        }
        return true;
      }),
    [
      activeView,
      items,
      now,
      pageViews,
      priorityFilter,
      settings.showSubmittedActive,
      settings.timezone,
      showCompleted,
    ],
  );
  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "select",
        size: 34,
        header: ({ table }) => (
          <input
            aria-label="Select all visible items"
            aria-checked={
              table.getIsSomePageRowsSelected()
                ? "mixed"
                : table.getIsAllPageRowsSelected()
                  ? "true"
                  : "false"
            }
            type="checkbox"
            checked={table.getIsAllPageRowsSelected()}
            ref={(element) => {
              if (element)
                element.indeterminate = table.getIsSomePageRowsSelected();
            }}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
            onClick={(event) => event.stopPropagation()}
          />
        ),
        cell: ({ row }) => (
          <input
            aria-label={`Select ${row.original.displayName}`}
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(event) => event.stopPropagation()}
          />
        ),
      }),
      columnHelper.accessor("displayName", {
        id: "name",
        size: 280,
        header: "Name",
        cell: ({ row }) => (
          <span className="work-name">
            <SubjectDot subjectId={row.original.subjectId} />
            <strong>{row.original.displayName}</strong>
            {settings.showSourceIcons &&
            row.original.sourceType === "canvas" ? (
              row.original.canvasHtmlUrl ? (
                <a
                  className="work-source-link"
                  href={row.original.canvasHtmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Open Canvas assignment"
                  aria-label={`Open Canvas assignment for ${row.original.displayName}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <ExternalLink size={12} />
                </a>
              ) : (
                <small title="Canvas source" aria-label="Canvas source">
                  <ExternalLink size={12} />
                </small>
              )
            ) : null}
            {settings.showSourceIcons && row.original.overrides.length ? (
              <small title="Manual override" aria-label="Manual override">
                <GitCompareArrows size={12} />
              </small>
            ) : null}
          </span>
        ),
      }),
      columnHelper.accessor(
        (item) => itemDeadline(item, settings.timezone)?.toISOString() ?? null,
        {
          id: "due",
          size: 150,
          header: "Due",
          sortingFn: "datetime",
          cell: ({ getValue, row }) =>
            getValue() ? (
              <span className="date-cell">
                {new Date(getValue()!).toLocaleDateString("en-AU", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: settings.timezone,
                })}
                {row.original.dueHasExplicitTime ? (
                  <small>
                    {new Date(getValue()!).toLocaleTimeString("en-AU", {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: settings.timezone,
                    })}
                  </small>
                ) : (
                  <small>All day</small>
                )}
              </span>
            ) : (
              <span className="muted-text">—</span>
            ),
        },
      ),
      columnHelper.display({
        id: "days",
        size: 125,
        header: "Days remaining",
        cell: ({ row }) => (
          <span
            className={
              visibleStatus(row.original, now, settings.timezone) === "overdue"
                ? "danger-text"
                : ""
            }
          >
            {daysRemainingLabel(
              itemDeadline(row.original, settings.timezone),
              now,
              settings.timezone,
            )}
          </span>
        ),
      }),
      columnHelper.accessor("subjectId", {
        id: "subject",
        size: 115,
        header: "Subject",
        cell: ({ getValue }) =>
          subjectsById.get(getValue() ?? "")?.displayName ?? "—",
      }),
      columnHelper.accessor("priority", {
        size: 95,
        header: "Priority",
        cell: ({ row, getValue }) => (
          <OrganatoSelect
            ariaLabel={`Priority for ${row.original.displayName}`}
            className={`inline-select priority-${getValue() ?? "blank"}`}
            disabled={!settings.inlineEditing}
            options={priorityOptions}
            value={getValue() ?? ""}
            onChange={(value) =>
              dispatch({
                type: "patchItem",
                id: row.original.id,
                patch: {
                  priority: (value || null) as OrganatoItem["priority"],
                },
              })
            }
          />
        ),
      }),
      columnHelper.accessor("workingStatus", {
        id: "status",
        size: 130,
        header: "Status",
        cell: ({ row }) => {
          const status = visibleStatus(row.original, now, settings.timezone);
          return (
            <OrganatoSelect
              ariaLabel={`Status for ${row.original.displayName}`}
              className={`inline-select status-${status}`}
              disabled={!settings.inlineEditing}
              options={statusOptions}
              value={row.original.workingStatus}
              onChange={(value) =>
                dispatch({
                  type: "patchItem",
                  id: row.original.id,
                  patch: {
                    workingStatus: value as OrganatoItem["workingStatus"],
                  },
                })
              }
            />
          );
        },
      }),
      columnHelper.display({
        id: "actions",
        size: 32,
        cell: ({ row }) => (
          <OrganatoActionMenu
            ariaLabel={`Actions for ${row.original.displayName}`}
            items={[
              {
                label: "Open details",
                onSelect: () =>
                  dispatch({ type: "select", id: row.original.id }),
              },
              {
                label: `Archive ${itemNoun}`,
                icon: <Archive size={14} aria-hidden="true" />,
                onSelect: () =>
                  dispatch({ type: "archive", id: row.original.id }),
              },
              {
                label: `Delete ${itemNoun}`,
                icon: <Trash2 size={14} aria-hidden="true" />,
                danger: true,
                onSelect: () => setDeleteCandidate(row.original),
              },
            ]}
          />
        ),
      }),
    ],
    [
      dispatch,
      now,
      settings.inlineEditing,
      settings.showSourceIcons,
      itemNoun,
      settings.timezone,
      subjectsById,
      setDeleteCandidate,
    ],
  );
  const tableState = useMemo(
    () => ({ sorting, globalFilter: query, rowSelection, pagination }),
    [sorting, query, rowSelection, pagination],
  );
  const table = useReactTable({
    data,
    columns,
    state: tableState,
    onSortingChange: setSorting,
    onGlobalFilterChange: setQuery,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    enableRowSelection: true,
    columnResizeMode: "onChange",
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
  const filteredRowCount = table.getFilteredRowModel().rows.length;
  const firstVisibleRow = filteredRowCount
    ? pagination.pageIndex * pagination.pageSize + 1
    : 0;
  const lastVisibleRow = Math.min(
    filteredRowCount,
    (pagination.pageIndex + 1) * pagination.pageSize,
  );
  const applySavedView = (id: string) => {
    if (id === "active" || id === "all") {
      setActiveView(id);
      setSearchParams(
        (current) => {
          current.delete("view");
          return current;
        },
        { replace: true },
      );
      setQuery("");
      setPriorityFilter("");
      setSorting([{ id: "due", desc: false }]);
      return;
    }
    const selected = pageViews.find((view) => view.id === id);
    if (!selected) return;
    setActiveView(id);
    setSearchParams(
      (current) => {
        current.set("view", id);
        return current;
      },
      { replace: true },
    );
    setQuery(selected?.filters.query ?? "");
    setPriorityFilter(selected?.filters.priorities?.[0] ?? "");
    if (selected?.sort.length) {
      setSorting(
        selected.sort.map((rule) => ({
          id: rule.field,
          desc: rule.direction === "desc",
        })),
      );
    }
    if (selected?.columns.length) {
      table.getAllLeafColumns().forEach((column) => {
        if (!["select", "actions"].includes(column.id)) {
          column.toggleVisibility(selected.columns.includes(column.id));
        }
      });
    }
  };
  // Apply a shared ?view= link on load once saved views arrive.
  const appliedSharedView = useRef(false);
  useEffect(() => {
    if (appliedSharedView.current) return;
    const shared = pageViews.find((view) => view.id === activeView);
    if (activeView !== "active" && activeView !== "all" && !shared) return;
    if (!shared) {
      if (activeView !== "active" && activeView !== "all") {
        setActiveView("active");
        setSearchParams(
          (current) => {
            current.delete("view");
            return current;
          },
          { replace: true },
        );
      }
      return;
    }
    appliedSharedView.current = true;
    applySavedView(shared.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageViews]);
  const toggleCompleted = () => {
    const next = !showCompleted;
    setShowCompleted(next);
    setRowSelection({});
    saveShowCompletedPreference(next);
  };
  const completedVisibleCount = data.filter(
    (item) => item.workingStatus === "completed",
  ).length;
  const activeVisibleCount = data.length - completedVisibleCount;
  return (
    <div className="page work-page">
      <PageHeader
        title="Assignments"
        meta={
          completedVisibleCount
            ? `${activeVisibleCount} active · ${completedVisibleCount} completed`
            : `${activeVisibleCount} active`
        }
        actions={
          <>
            <OrganatoSelect
              ariaLabel="Assignment view"
              className="view-picker"
              options={viewOptions}
              value={activeView}
              onChange={applySavedView}
            />
            {pageViews.some((view) => view.id === activeView) ? (
              <>
                <button
                  className="text-button icon-labelled work-secondary-action"
                  aria-pressed={
                    pageViews.find((view) => view.id === activeView)
                      ?.isDefault ?? false
                  }
                  onClick={() => {
                    const current = pageViews.find(
                      (view) => view.id === activeView,
                    );
                    if (current) {
                      dispatch({
                        type: "saveView",
                        view: { ...current, isDefault: !current.isDefault },
                      });
                    }
                  }}
                >
                  <Pin size={16} />
                  {pageViews.find((view) => view.id === activeView)?.isDefault
                    ? "Unpin"
                    : "Pin"}
                </button>
                <button
                  className="text-button icon-labelled work-secondary-action"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(window.location.href);
                      dispatch({
                        type: "toast",
                        message: "View link copied",
                      });
                    } catch {
                      dispatch({
                        type: "toast",
                        message:
                          "Link copy failed — copy it from the address bar",
                      });
                    }
                  }}
                >
                  <Link2 size={16} /> Copy link
                </button>
              </>
            ) : null}
            <button
              className="text-button icon-labelled work-secondary-action"
              aria-pressed={showFilters}
              onClick={() => setShowFilters((value) => !value)}
            >
              <Filter size={16} /> Filter
              {query || priorityFilter ? (
                <span className="filter-badge" aria-label="Filters active">
                  •
                </span>
              ) : null}
            </button>
            <button
              className="text-button icon-labelled work-secondary-action"
              aria-pressed={showSort}
              aria-label={`Sort by ${sorting[0]?.id ?? "due"} ${
                sorting[0]?.desc ? "descending" : "ascending"
              } — open sort options`}
              onClick={() => {
                setShowSort((value) => !value);
                setShowColumns(false);
              }}
            >
              <SlidersHorizontal size={16} /> Sort
              <span aria-hidden="true">
                {" "}
                · {sorting[0]?.id ?? "due"}
                {sorting[0]?.desc ? " ↓" : " ↑"}
              </span>
            </button>
            <button
              className="text-button icon-labelled work-secondary-action"
              aria-pressed={showColumns}
              onClick={() => {
                setShowColumns((value) => !value);
                setShowSort(false);
              }}
            >
              <Columns3 size={16} /> Columns
            </button>
            <button
              aria-pressed={showCompleted}
              className="text-button icon-labelled work-secondary-action"
              onClick={toggleCompleted}
            >
              {showCompleted ? <EyeOff size={16} /> : <Eye size={16} />}
              {showCompleted ? "Hide completed" : "Show completed"}
            </button>
            <CreateWorkControl
              subjects={subjects}
              timezone={settings.timezone}
              settings={settings}
              onCreate={createWork}
            />
            <details ref={mobileActionsRef} className="mobile-actions-menu">
              <summary aria-label="More page actions">
                <MoreHorizontal size={19} />
              </summary>
              <div role="menu">
                <label>
                  View
                  <OrganatoSelect
                    ariaLabel="Assignment view"
                    options={viewOptions}
                    value={activeView}
                    onChange={(value) => {
                      applySavedView(value);
                      closeMobileActions();
                    }}
                  />
                </label>
                <button
                  role="menuitem"
                  onClick={() => {
                    setShowFilters((value) => !value);
                    closeMobileActions();
                  }}
                >
                  <Filter size={16} /> Filter
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setShowSort((value) => !value);
                    setShowColumns(false);
                    closeMobileActions();
                  }}
                >
                  <SlidersHorizontal size={16} /> Sort options
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setShowColumns((value) => !value);
                    setShowSort(false);
                    closeMobileActions();
                  }}
                >
                  <Columns3 size={16} /> Columns
                </button>
                <button
                  aria-pressed={showCompleted}
                  onClick={toggleCompleted}
                  role="menuitem"
                >
                  {showCompleted ? <EyeOff size={16} /> : <Eye size={16} />}
                  {showCompleted ? "Hide completed" : "Show completed"}
                </button>
              </div>
            </details>
          </>
        }
      />
      {table.getFilteredSelectedRowModel().rows.length ? (
        <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
          <strong>
            {table.getFilteredSelectedRowModel().rows.length} of{" "}
            {filteredRowCount} selected
          </strong>
          <button
            onClick={() => {
              const selected = table.getFilteredSelectedRowModel().rows;
              const proceed =
                !settings.confirmBulkArchive ||
                window.confirm(
                  `Archive ${selected.length} selected ${selected.length === 1 ? "item" : "items"}? You can restore them from Settings → Data.`,
                );
              if (!proceed) return;
              selected.forEach((row) =>
                dispatch({ type: "archive", id: row.original.id }),
              );
              setRowSelection({});
            }}
          >
            Archive
          </button>
          <button onClick={() => setRowSelection({})}>Clear</button>
        </div>
      ) : null}
      {showSort ? (
        <div
          className="filter-bar sort-bar"
          role="group"
          aria-label="Sort options"
        >
          <OrganatoSelect
            ariaLabel="Sort field"
            options={sortFieldOptions}
            value={sorting[0]?.id ?? "due"}
            onChange={(value) =>
              setSorting([{ id: value, desc: sorting[0]?.desc ?? false }])
            }
          />
          <button
            type="button"
            aria-label={`Sort direction: ${sorting[0]?.desc ? "descending" : "ascending"} — activate to toggle`}
            aria-pressed={Boolean(sorting[0]?.desc)}
            onClick={() =>
              setSorting([
                { id: sorting[0]?.id ?? "due", desc: !sorting[0]?.desc },
              ])
            }
          >
            {sorting[0]?.desc ? "Descending ↓" : "Ascending ↑"}
          </button>
          <button
            type="button"
            onClick={() => setSorting([{ id: "due", desc: false }])}
          >
            Reset
          </button>
        </div>
      ) : null}
      {showFilters ? (
        <div className="filter-bar">
          <input
            aria-label="Filter this view"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter this view…"
          />
          <OrganatoSelect
            ariaLabel="Filter by priority"
            options={[
              { value: "", label: "Any priority" },
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
              { value: "urgent", label: "Urgent" },
            ]}
            value={priorityFilter}
            onChange={setPriorityFilter}
          />
          <button
            onClick={() => {
              setQuery("");
              setPriorityFilter("");
            }}
          >
            Clear
          </button>
          <input
            aria-label="Saved view name"
            value={viewName}
            onChange={(event) => setViewName(event.target.value)}
            placeholder="View name"
          />
          <button
            disabled={!viewName.trim()}
            onClick={() => {
              const sortable = new Set([
                "due",
                "priority",
                "name",
                "status",
                "subject",
                "created",
              ]);
              const view: SavedView = {
                id: crypto.randomUUID(),
                page,
                name: viewName.trim(),
                filters: {
                  ...(query ? { query } : {}),
                  ...(priorityFilter
                    ? {
                        priorities: [
                          priorityFilter as NonNullable<
                            OrganatoItem["priority"]
                          >,
                        ],
                      }
                    : {}),
                },
                sort: sorting.flatMap((entry) =>
                  sortable.has(entry.id)
                    ? [
                        {
                          field: entry.id as SavedView["sort"][number]["field"],
                          direction: entry.desc ? "desc" : "asc",
                        },
                      ]
                    : [],
                ),
                columns: table
                  .getVisibleLeafColumns()
                  .filter(
                    (column) => !["select", "actions"].includes(column.id),
                  )
                  .map((column) => column.id),
                columnWidths: table.getState().columnSizing,
                isDefault: false,
              };
              dispatch({ type: "saveView", view });
              setActiveView(view.id);
              setViewName("");
            }}
          >
            Save view
          </button>
        </div>
      ) : null}
      {showColumns ? (
        <div className="column-menu" role="group" aria-label="Visible columns">
          {table
            .getAllLeafColumns()
            .filter((column) => !["select", "actions"].includes(column.id))
            .map((column) => (
              <label key={column.id}>
                <input
                  type="checkbox"
                  checked={column.getIsVisible()}
                  onChange={column.getToggleVisibilityHandler()}
                />
                {column.id === "days" ? "Days remaining" : column.id}
              </label>
            ))}
        </div>
      ) : null}
      <div className="database-table-wrap">
        <table
          className={`database-table${settings.stickyNameColumn ? " sticky-name" : ""}`}
        >
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() }}
                    aria-sort={
                      header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : header.column.getIsSorted() === "desc"
                          ? "descending"
                          : "none"
                    }
                    className={`column-${header.id}`}
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="column-sort-button"
                        onClick={header.column.getToggleSortingHandler()}
                        aria-label={`Sort by ${header.column.id}`}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {header.column.getIsSorted() ? (
                          <span aria-hidden="true">
                            {header.column.getIsSorted() === "asc"
                              ? " ↑"
                              : " ↓"}
                          </span>
                        ) : null}
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    )}
                    <span
                      className={`column-resizer${header.column.getIsResizing() ? " active" : ""}`}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${header.column.id} column`}
                      aria-valuenow={Math.round(header.getSize())}
                      tabIndex={0}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (
                          event.key === "ArrowLeft" ||
                          event.key === "ArrowRight"
                        ) {
                          event.preventDefault();
                          const delta = event.key === "ArrowLeft" ? -12 : 12;
                          const next = Math.max(60, header.getSize() + delta);
                          table.setColumnSizing((old) => ({
                            ...old,
                            [header.column.id]: next,
                          }));
                        }
                        if (event.key === "Home") {
                          event.preventDefault();
                          table.setColumnSizing((old) => {
                            const next = { ...old };
                            delete next[header.column.id];
                            return next;
                          });
                        }
                      }}
                    />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                tabIndex={0}
                aria-label={`Open details for ${row.original.displayName}`}
                onKeyDown={(event) => {
                  // Let embedded controls handle their own keys.
                  const target = event.target as HTMLElement;
                  if (
                    target !== event.currentTarget &&
                    !["TR"].includes(target.tagName)
                  ) {
                    return;
                  }
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    dispatch({ type: "select", id: row.original.id });
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    (
                      event.currentTarget
                        .nextElementSibling as HTMLElement | null
                    )?.focus();
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    (
                      event.currentTarget
                        .previousElementSibling as HTMLElement | null
                    )?.focus();
                  }
                }}
                onClick={(event) => {
                  // Clicks on inline selects/menus must not open the inspector.
                  if (
                    (event.target as HTMLElement).closest(
                      "button, select, input, a",
                    )
                  ) {
                    return;
                  }
                  dispatch({ type: "select", id: row.original.id });
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className={`column-${cell.column.id}`}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!table.getRowModel().rows.length ? (
          <p className="empty-line">No {page} match this view.</p>
        ) : null}
      </div>
      {filteredRowCount > pagination.pageSize ? (
        <nav className="list-pagination" aria-label={`${itemNoun} pages`}>
          <span>
            {firstVisibleRow}–{lastVisibleRow} of {filteredRowCount}
          </span>
          <label>
            Rows
            <select
              aria-label="Rows per page"
              value={pagination.pageSize}
              onChange={(event) =>
                table.setPageSize(Number(event.target.value))
              }
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
          <button
            type="button"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            Next
          </button>
        </nav>
      ) : filteredRowCount ? (
        <p className="item-count">{filteredRowCount} items</p>
      ) : null}
      {deleteCandidate ? (
        <DeleteWorkDialog
          key={deleteCandidate.id}
          candidate={deleteCandidate}
          itemNoun={itemNoun}
          onCancel={closeDeleteDialog}
          onDelete={(confirmation) => deleteWork(deleteCandidate, confirmation)}
        />
      ) : null}
    </div>
  );
}
