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
  Combine,
  ExternalLink,
  Filter,
  GitCompareArrows,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  daysRemainingLabel,
  itemDeadline,
  isInView,
  visibleStatus,
  type OrganatoItem,
  type SavedView,
} from "@organato/domain";
import { PageHeader } from "../components/PageHeader";
import {
  OrganatoActionMenu,
  OrganatoDatePicker,
  OrganatoSelect,
  quarterHourOptions,
} from "../components/OrganatoControls";
import { SubjectDot } from "../components/SubjectDot";
import { useOrganatoActions, useOrganatoData } from "../state/OrganatoProvider";
import { useDialogFocus } from "../components/useDialogFocus";
import { localDateTimeToIso } from "./calendar/model";

const now = new Date();
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

export default function WorkPage({
  page,
}: {
  page: "assignments" | "checkpoints";
}) {
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
  const [priorityFilter, setPriorityFilter] = useState("");
  const [viewName, setViewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [workName, setWorkName] = useState("");
  const [workDueDate, setWorkDueDate] = useState("");
  const [workDueTime, setWorkDueTime] = useState("");
  const [workSubject, setWorkSubject] = useState("");
  const [workPriority, setWorkPriority] = useState<
    NonNullable<OrganatoItem["priority"]> | ""
  >("");
  const [workClassification, setWorkClassification] = useState<
    "assignment" | "checkpoint" | "both"
  >(page === "assignments" ? "assignment" : "checkpoint");
  const pageViews = views.filter((view) => view.page === page);
  const [activeView, setActiveView] = useState("active");
  const [deleteCandidate, setDeleteCandidate] = useState<OrganatoItem | null>(
    null,
  );
  const deleteDialogRef = useRef<HTMLElement>(null);
  const deleteCloseRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(
    deleteCandidate !== null,
    deleteDialogRef,
    deleteCloseRef,
    deleteCandidate?.id ?? "closed",
  );
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const itemNoun = page === "assignments" ? "assignment" : "checkpoint";
  const viewOptions = useMemo(
    () => [
      { value: "active", label: "All active" },
      {
        value: "all",
        label: page === "assignments" ? "All assignments" : "All checkpoints",
      },
      ...pageViews.map((view) => ({ value: view.id, label: view.name })),
    ],
    [page, pageViews],
  );
  const data = useMemo(
    () =>
      items.filter((item) => {
        if (
          item.kind !== "work" ||
          item.archivedAt ||
          !isInView(item.classification, page)
        ) {
          return false;
        }
        if (priorityFilter && item.priority !== priorityFilter) return false;
        if (activeView === "active") {
          const status = visibleStatus(item, now);
          if (status === "completed") return false;
          if (status === "submitted" && !settings.showSubmittedActive)
            return false;
        }
        const selectedView = pageViews.find((view) => view.id === activeView);
        if (selectedView?.filters.due === "overdue") {
          return visibleStatus(item, now) === "overdue";
        }
        if (selectedView?.filters.due === "this_week") {
          const deadline = itemDeadline(item);
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
      page,
      pageViews,
      priorityFilter,
      settings.showSubmittedActive,
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
          const status = visibleStatus(row.original, now);
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
                onSelect: () => {
                  setDeleteCandidate(row.original);
                  setDeleteConfirmation("");
                },
              },
            ]}
          />
        ),
      }),
    ],
    [
      dispatch,
      settings.inlineEditing,
      settings.showSourceIcons,
      itemNoun,
      settings.timezone,
      subjectsById,
      setDeleteCandidate,
    ],
  );
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: query, rowSelection, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: setQuery,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    enableRowSelection: true,
    columnResizeMode: "onChange",
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
      setQuery("");
      setPriorityFilter("");
      setSorting([{ id: "due", desc: false }]);
      return;
    }
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
  return (
    <div className="page work-page">
      <PageHeader
        title={page === "assignments" ? "Assignments" : "Checkpoints"}
        meta={`${data.length} ${activeView === "all" ? page : "active"}`}
        actions={
          <>
            <OrganatoSelect
              ariaLabel={`${page === "assignments" ? "Assignment" : "Checkpoint"} view`}
              className="view-picker"
              options={viewOptions}
              value={activeView}
              onChange={applySavedView}
            />
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
                  <OrganatoSelect
                    ariaLabel={`${page === "assignments" ? "Assignment" : "Checkpoint"} view`}
                    options={viewOptions}
                    value={activeView}
                    onChange={applySavedView}
                  />
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
              dueAt:
                workDueDate && workDueTime
                  ? localDateTimeToIso(
                      workDueDate,
                      workDueTime,
                      settings.timezone,
                    )
                  : null,
              dueDateLocal: workDueDate && !workDueTime ? workDueDate : null,
              dueHasExplicitTime: Boolean(workDueDate && workDueTime),
              subjectId: workSubject || null,
              priority: workPriority || null,
            });
            setWorkName("");
            setWorkDueDate("");
            setWorkDueTime("");
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
          <div className="create-work-due">
            <OrganatoDatePicker
              ariaLabel="Due date"
              value={workDueDate}
              onChange={setWorkDueDate}
              placeholder="No date"
            />
            <OrganatoSelect
              ariaLabel="Due time"
              disabled={!workDueDate}
              options={quarterHourOptions}
              value={workDueTime}
              onChange={setWorkDueTime}
            />
          </div>
          <OrganatoSelect
            ariaLabel="Classification"
            options={[
              {
                value: page === "assignments" ? "assignment" : "checkpoint",
                label: page === "assignments" ? "Assignment" : "Checkpoint",
              },
              { value: "both", label: "Both" },
            ]}
            value={workClassification}
            onChange={(value) =>
              setWorkClassification(value as typeof workClassification)
            }
          />
          <OrganatoSelect
            ariaLabel="Subject"
            options={[
              { value: "", label: "No subject" },
              ...subjects
                .filter((subject) => subject.active)
                .map((subject) => ({
                  value: subject.id,
                  label: subject.displayName,
                })),
            ]}
            value={workSubject}
            onChange={setWorkSubject}
          />
          <OrganatoSelect
            ariaLabel="Priority"
            options={[
              { value: "", label: "Blank priority" },
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
              { value: "urgent", label: "Urgent" },
            ]}
            value={workPriority}
            onChange={(value) => setWorkPriority(value as typeof workPriority)}
          />
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
          <OrganatoSelect
            ariaLabel="Filter by priority"
            options={[
              { value: "", label: "Any priority" },
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
        <div
          className="delete-item-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setDeleteCandidate(null);
              setDeleteConfirmation("");
            }
          }}
        >
          <section
            ref={deleteDialogRef}
            className="delete-item-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-item-title"
          >
            <header>
              <h2 id="delete-item-title">
                Delete {deleteCandidate.kind === "work" ? itemNoun : "todo"}?
              </h2>
              <button
                ref={deleteCloseRef}
                type="button"
                className="icon-button"
                aria-label="Close delete dialog"
                onClick={() => {
                  setDeleteCandidate(null);
                  setDeleteConfirmation("");
                }}
              >
                ×
              </button>
            </header>
            <p>
              This permanently removes{" "}
              <strong>{deleteCandidate.displayName}</strong> from Organato. This
              cannot be undone.
            </p>
            <label>
              Type the {deleteCandidate.kind === "work" ? itemNoun : "todo"}{" "}
              name to confirm
              <input
                autoFocus
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
            </label>
            <footer>
              <button
                type="button"
                onClick={() => {
                  setDeleteCandidate(null);
                  setDeleteConfirmation("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={deleteConfirmation !== deleteCandidate.displayName}
                onClick={() => {
                  dispatch({
                    type: "deleteItem",
                    id: deleteCandidate.id,
                    confirmation: deleteConfirmation,
                  });
                  setDeleteCandidate(null);
                  setDeleteConfirmation("");
                }}
              >
                Delete {deleteCandidate.kind === "work" ? itemNoun : "todo"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
