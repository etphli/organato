import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import {
  Columns3,
  Combine,
  Eye,
  EyeOff,
  ExternalLink,
  Filter,
  GitCompareArrows,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  daysRemainingLabel,
  itemDeadline,
  isInView,
  visibleStatus,
  type OrganatoItem,
  type SavedView,
} from "@organato/domain";
import { PageHeader } from "../components/PageHeader";
import { SubjectDot } from "../components/SubjectDot";
import { useOrganato } from "../state/OrganatoProvider";

const now = new Date();
const columnHelper = createColumnHelper<OrganatoItem>();
const assignmentsShowCompletedKey = "organato-assignments-show-completed-v1";

function loadShowCompletedPreference(): boolean {
  try {
    return localStorage.getItem(assignmentsShowCompletedKey) === "true";
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

export default function WorkPage({
  page,
}: {
  page: "assignments" | "checkpoints";
}) {
  const { items, subjects, subjectsById, views, settings, dispatch } =
    useOrganato();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "due", desc: false },
  ]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showCompleted, setShowCompleted] = useState(
    loadShowCompletedPreference,
  );
  const [priorityFilter, setPriorityFilter] = useState("");
  const [viewName, setViewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [workName, setWorkName] = useState("");
  const [workDue, setWorkDue] = useState("");
  const [workSubject, setWorkSubject] = useState("");
  const [workPriority, setWorkPriority] = useState<
    NonNullable<OrganatoItem["priority"]> | ""
  >("");
  const [workClassification, setWorkClassification] = useState<
    "assignment" | "checkpoint" | "both"
  >(page === "assignments" ? "assignment" : "checkpoint");
  const pageViews = views.filter((view) => view.page === page);
  const [activeView, setActiveView] = useState(
    pageViews.find((view) => view.isDefault)?.id ?? "",
  );
  const data = useMemo(
    () =>
      items.filter(
        (item) =>
          item.kind === "work" &&
          !item.archivedAt &&
          isInView(item.classification, page) &&
          (settings.showSubmittedActive ||
            item.workingStatus !== "submitted") &&
          (page !== "assignments" ||
            showCompleted ||
            item.workingStatus !== "completed") &&
          (!priorityFilter || item.priority === priorityFilter) &&
          (activeView !== "overdue" ||
            visibleStatus(item, now) === "overdue") &&
          (activeView !== "due-soon" ||
            !item.dueAt ||
            new Date(item.dueAt).getTime() <= now.getTime() + 7 * 86_400_000),
      ),
    [
      activeView,
      items,
      page,
      priorityFilter,
      settings.showSubmittedActive,
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
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            ref={(element) => {
              if (element)
                element.indeterminate = table.getIsSomeRowsSelected();
            }}
            onChange={table.getToggleAllRowsSelectedHandler()}
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
              <small title="Canvas source" aria-label="Canvas source">
                <ExternalLink size={12} />
              </small>
            ) : null}
            {settings.showSourceIcons && row.original.overrides.length ? (
              <small title="Manual override" aria-label="Manual override">
                <GitCompareArrows size={12} />
              </small>
            ) : null}
            {row.original.classification === "both" ? (
              <small title="Assignment and checkpoint" aria-label="Both">
                <Combine size={12} />
              </small>
            ) : null}
          </span>
        ),
      }),
      columnHelper.accessor(
        (item) => itemDeadline(item)?.toISOString() ?? null,
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
              visibleStatus(row.original, now) === "overdue"
                ? "danger-text"
                : ""
            }
          >
            {daysRemainingLabel(
              itemDeadline(row.original),
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
          <select
            className={`inline-select priority-${getValue() ?? "blank"}`}
            disabled={!settings.inlineEditing}
            value={getValue() ?? ""}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) =>
              dispatch({
                type: "patchItem",
                id: row.original.id,
                patch: {
                  priority: (event.target.value ||
                    null) as OrganatoItem["priority"],
                },
              })
            }
          >
            <option value="">—</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        ),
      }),
      columnHelper.accessor("workingStatus", {
        id: "status",
        size: 130,
        header: "Status",
        cell: ({ row }) => {
          const status = visibleStatus(row.original, now);
          return (
            <select
              className={`inline-select status-${status}`}
              disabled={!settings.inlineEditing}
              value={row.original.workingStatus}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                dispatch({
                  type: "patchItem",
                  id: row.original.id,
                  patch: {
                    workingStatus: event.target
                      .value as OrganatoItem["workingStatus"],
                  },
                })
              }
            >
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="submitted">Submitted</option>
              <option value="completed">Completed</option>
            </select>
          );
        },
      }),
      columnHelper.display({
        id: "actions",
        size: 32,
        cell: ({ row }) => (
          <button
            className="row-menu"
            onClick={(event) => {
              event.stopPropagation();
              dispatch({ type: "select", id: row.original.id });
            }}
            aria-label={`Actions for ${row.original.displayName}`}
          >
            <MoreHorizontal size={16} />
          </button>
        ),
      }),
    ],
    [
      dispatch,
      settings.inlineEditing,
      settings.showSourceIcons,
      settings.timezone,
      subjectsById,
    ],
  );
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: query, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setQuery,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const applySavedView = (id: string) => {
    const selected = pageViews.find((view) => view.id === id);
    setActiveView(id);
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
  const toggleCompleted = () => {
    const next = !showCompleted;
    setShowCompleted(next);
    setRowSelection({});
    saveShowCompletedPreference(next);
  };
  const completedVisibleCount =
    page === "assignments"
      ? data.filter((item) => item.workingStatus === "completed").length
      : 0;
  const activeVisibleCount = data.length - completedVisibleCount;
  return (
    <div className="page work-page">
      <PageHeader
        title={page === "assignments" ? "Assignments" : "Checkpoints"}
        meta={
          completedVisibleCount
            ? `${activeVisibleCount} active · ${completedVisibleCount} completed`
            : `${activeVisibleCount} active`
        }
        actions={
          <>
            <select
              className="view-picker"
              aria-label="Saved view"
              value={activeView}
              onChange={(event) => applySavedView(event.target.value)}
            >
              <option value="">All active</option>
              {pageViews.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
            </select>
            <button
              className="text-button icon-labelled work-secondary-action"
              onClick={() => setShowFilters((value) => !value)}
            >
              <Filter size={16} /> Filter
            </button>
            <button
              className="text-button icon-labelled work-secondary-action"
              onClick={() => setSorting([{ id: "priority", desc: true }])}
            >
              <SlidersHorizontal size={16} /> Sort
            </button>
            <button
              className="text-button icon-labelled work-secondary-action"
              onClick={() => setShowColumns((value) => !value)}
            >
              <Columns3 size={16} /> Columns
            </button>
            {page === "assignments" ? (
              <button
                aria-pressed={showCompleted}
                className="text-button icon-labelled work-secondary-action"
                onClick={toggleCompleted}
              >
                {showCompleted ? <EyeOff size={16} /> : <Eye size={16} />}
                {showCompleted ? "Hide completed" : "Show completed"}
              </button>
            ) : null}
            <button
              className="new-button"
              onClick={() => setCreating((value) => !value)}
            >
              <Plus size={16} /> New
            </button>
            <details className="mobile-actions-menu">
              <summary aria-label="More page actions">
                <MoreHorizontal size={19} />
              </summary>
              <div role="menu">
                <label>
                  View
                  <select
                    aria-label="Saved view"
                    value={activeView}
                    onChange={(event) => applySavedView(event.target.value)}
                  >
                    <option value="">All active</option>
                    {pageViews.map((view) => (
                      <option key={view.id} value={view.id}>
                        {view.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  role="menuitem"
                  onClick={() => setShowFilters((value) => !value)}
                >
                  <Filter size={16} /> Filter
                </button>
                <button
                  role="menuitem"
                  onClick={() => setSorting([{ id: "priority", desc: true }])}
                >
                  <SlidersHorizontal size={16} /> Sort by priority
                </button>
                <button
                  role="menuitem"
                  onClick={() => setShowColumns((value) => !value)}
                >
                  <Columns3 size={16} /> Columns
                </button>
                {page === "assignments" ? (
                  <button
                    aria-pressed={showCompleted}
                    onClick={toggleCompleted}
                    role="menuitem"
                  >
                    {showCompleted ? <EyeOff size={16} /> : <Eye size={16} />}
                    {showCompleted ? "Hide completed" : "Show completed"}
                  </button>
                ) : null}
              </div>
            </details>
          </>
        }
      />
      {creating ? (
        <form
          className="create-work-line"
          onSubmit={(event) => {
            event.preventDefault();
            if (!workName.trim()) return;
            dispatch({
              type: "addWork",
              name: workName.trim(),
              classification: workClassification,
              dueAt: workDue ? new Date(workDue).toISOString() : null,
              subjectId: workSubject || null,
              priority: workPriority || null,
            });
            setWorkName("");
            setWorkDue("");
            setWorkSubject("");
            setWorkPriority("");
            setCreating(false);
          }}
        >
          <input
            autoFocus
            aria-label="Work item name"
            value={workName}
            onChange={(event) => setWorkName(event.target.value)}
            placeholder="Work item name"
            required
          />
          <input
            aria-label="Due date and time"
            type="datetime-local"
            value={workDue}
            onChange={(event) => setWorkDue(event.target.value)}
          />
          <select
            aria-label="Classification"
            value={workClassification}
            onChange={(event) =>
              setWorkClassification(
                event.target.value as typeof workClassification,
              )
            }
          >
            <option
              value={page === "assignments" ? "assignment" : "checkpoint"}
            >
              {page === "assignments" ? "Assignment" : "Checkpoint"}
            </option>
            <option value="both">Both</option>
          </select>
          <select
            aria-label="Subject"
            value={workSubject}
            onChange={(event) => setWorkSubject(event.target.value)}
          >
            <option value="">No subject</option>
            {subjects
              .filter((subject) => subject.active)
              .map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.displayName}
                </option>
              ))}
          </select>
          <select
            aria-label="Priority"
            value={workPriority}
            onChange={(event) =>
              setWorkPriority(event.target.value as typeof workPriority)
            }
          >
            <option value="">Blank priority</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
          <button type="submit">Create</button>
          <button type="button" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      ) : null}
      {Object.keys(rowSelection).length ? (
        <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
          <strong>{Object.keys(rowSelection).length} selected</strong>
          <button
            onClick={() => {
              table.getSelectedRowModel().rows.forEach((row) =>
                dispatch({
                  type: "classify",
                  id: row.original.id,
                  classification: "assignment",
                }),
              );
              setRowSelection({});
            }}
          >
            Assignment
          </button>
          <button
            onClick={() => {
              table.getSelectedRowModel().rows.forEach((row) =>
                dispatch({
                  type: "classify",
                  id: row.original.id,
                  classification: "checkpoint",
                }),
              );
              setRowSelection({});
            }}
          >
            Checkpoint
          </button>
          <button onClick={() => setRowSelection({})}>Clear</button>
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
          <select
            aria-label="Filter by priority"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
          >
            <option value="">Any priority</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
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
                    onClick={header.column.getToggleSortingHandler()}
                    className={`column-${header.id}`}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                    {header.column.getIsSorted() ? (
                      <span>
                        {header.column.getIsSorted() === "asc" ? " ↑" : " ↓"}
                      </span>
                    ) : null}
                    <span
                      className={`column-resizer${header.column.getIsResizing() ? " active" : ""}`}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onClick={(event) => event.stopPropagation()}
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
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
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
                onClick={() =>
                  dispatch({ type: "select", id: row.original.id })
                }
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
      <p className="item-count">{table.getRowModel().rows.length} items</p>
    </div>
  );
}
