import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  SlidersHorizontal,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { IntegrationHealth, Priority, Subject } from "@organato/domain";
import {
  defaultCalendarFilters,
  filtersActiveCount,
  type CalendarFilters,
  type CalendarPreferences,
  type CalendarStatusFilter,
  type CalendarTypeFilter,
  type CalendarView,
} from "./model";
import { OrganatoSelect } from "../../components/OrganatoControls";

const viewOptions: Array<{ value: CalendarView; label: string }> = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "agenda", label: "Agenda" },
];

export function CalendarViewSwitcher({
  view,
  onChange,
}: {
  view: CalendarView;
  onChange(view: CalendarView): void;
}) {
  return (
    <div className="oc-view-switcher" role="group" aria-label="Calendar view">
      {viewOptions.map((option) => (
        <button
          type="button"
          className={view === option.value ? "is-active" : ""}
          key={option.value}
          onClick={() => onChange(option.value)}
          aria-pressed={view === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

function FilterOption({
  label,
  selected,
  colour,
  onClick,
}: {
  label: string;
  selected: boolean;
  colour?: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className={selected ? "is-selected" : ""}
      onClick={onClick}
      aria-pressed={selected}
    >
      {colour ? (
        <span
          className="oc-filter-dot"
          style={{ "--oc-filter-colour": colour } as CSSProperties}
          aria-hidden="true"
        />
      ) : null}
      <span>{label}</span>
      <span className="oc-filter-check" aria-hidden="true">
        {selected ? "✓" : ""}
      </span>
    </button>
  );
}

export function CalendarFilterMenu({
  filters,
  subjects,
  onChange,
}: {
  filters: CalendarFilters;
  subjects: Subject[];
  onChange(filters: CalendarFilters): void;
}) {
  const activeCount = filtersActiveCount(filters);
  const typeOptions: Array<[CalendarTypeFilter, string]> = [
    ["assignment", "Assignments"],
    ["todo", "Todos"],
    ["unclassified", "Unclassified"],
  ];
  const priorityOptions: Array<[NonNullable<Priority>, string]> = [
    ["urgent", "Urgent"],
    ["high", "High"],
    ["medium", "Medium"],
    ["low", "Low"],
  ];
  const statusOptions: Array<[CalendarStatusFilter, string]> = [
    ["active", "Active"],
    ["overdue", "Overdue"],
    ["submitted", "Submitted"],
    ["completed", "Completed"],
  ];
  return (
    <details className="oc-filter-menu">
      <summary aria-label="Filter calendar">
        <SlidersHorizontal size={14} aria-hidden="true" />
        <span>Filter</span>
        {activeCount ? <b>{activeCount}</b> : null}
      </summary>
      <div className="oc-filter-popover">
        <header>
          <strong>Filter calendar</strong>
          {activeCount ? (
            <button
              type="button"
              onClick={() => onChange(defaultCalendarFilters)}
            >
              Clear
            </button>
          ) : null}
        </header>
        <section>
          <h3>Type</h3>
          {typeOptions.map(([value, label]) => (
            <FilterOption
              key={value}
              label={label}
              selected={filters.types.includes(value)}
              onClick={() =>
                onChange({
                  ...filters,
                  types: toggleValue(filters.types, value),
                })
              }
            />
          ))}
        </section>
        <section>
          <h3>Subject</h3>
          {subjects.map((subject) => (
            <FilterOption
              key={subject.id}
              label={subject.displayName}
              colour={subject.colour}
              selected={filters.subjectIds.includes(subject.id)}
              onClick={() =>
                onChange({
                  ...filters,
                  subjectIds: toggleValue(filters.subjectIds, subject.id),
                })
              }
            />
          ))}
        </section>
        <section>
          <h3>Priority</h3>
          {priorityOptions.map(([value, label]) => (
            <FilterOption
              key={value}
              label={label}
              selected={filters.priorities.includes(value)}
              onClick={() =>
                onChange({
                  ...filters,
                  priorities: toggleValue(filters.priorities, value),
                })
              }
            />
          ))}
        </section>
        <section>
          <h3>Status</h3>
          {statusOptions.map(([value, label]) => (
            <FilterOption
              key={value}
              label={label}
              selected={filters.statuses.includes(value)}
              onClick={() =>
                onChange({
                  ...filters,
                  statuses: toggleValue(filters.statuses, value),
                })
              }
            />
          ))}
        </section>
      </div>
    </details>
  );
}

function integrationCopy(integration: IntegrationHealth | undefined): {
  label: string;
  tone: string;
  actionNeeded: boolean;
} {
  if (!integration || integration.state === "disconnected") {
    return {
      label: "Calendar only",
      tone: "disconnected",
      actionNeeded: true,
    };
  }
  if (integration.state === "healthy") {
    return {
      label: "Google Calendar connected",
      tone: "healthy",
      actionNeeded: false,
    };
  }
  if (integration.state === "delayed") {
    return {
      label: "Calendar sync delayed",
      tone: "delayed",
      actionNeeded: true,
    };
  }
  if (integration.state === "action_needed") {
    return {
      label: "Reconnect Google Calendar",
      tone: "error",
      actionNeeded: true,
    };
  }
  return {
    label: "Calendar needs attention",
    tone: "error",
    actionNeeded: true,
  };
}

function GoogleCalendarStatus({
  integration,
}: {
  integration: IntegrationHealth | undefined;
}) {
  const copy = integrationCopy(integration);
  const lastSuccess =
    integration?.lastSuccessAt &&
    !Number.isNaN(new Date(integration.lastSuccessAt).getTime())
      ? `Last reconciled ${formatDistanceToNow(
          new Date(integration.lastSuccessAt),
          { addSuffix: true },
        )}`
      : "No successful reconciliation yet";
  return (
    <div
      className={`oc-google-status oc-google-status--${copy.tone}`}
      title={lastSuccess}
    >
      <span className="oc-google-status__dot" aria-hidden="true" />
      <span>{copy.label}</span>
      {copy.actionNeeded ? (
        <Link to="/settings/calendar">Review</Link>
      ) : (
        <a
          href="https://calendar.google.com/calendar/u/0/r"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Organato calendar <ExternalLink size={11} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

export function CalendarToolbar({
  preferences,
  setPreferences,
  subjects,
  integration,
  onPrevious,
  onToday,
  onNext,
}: {
  preferences: CalendarPreferences;
  setPreferences: Dispatch<SetStateAction<CalendarPreferences>>;
  subjects: Subject[];
  integration: IntegrationHealth | undefined;
  onPrevious(): void;
  onToday(): void;
  onNext(): void;
}) {
  return (
    <div className="oc-toolbar">
      <div className="oc-period-controls" role="group" aria-label="Date range">
        <button type="button" onClick={onPrevious} aria-label="Previous period">
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button type="button" onClick={onToday}>
          Today
        </button>
        <button type="button" onClick={onNext} aria-label="Next period">
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="oc-toolbar__right">
        <CalendarFilterMenu
          filters={preferences.filters}
          subjects={subjects}
          onChange={(filters) =>
            setPreferences((current) => ({ ...current, filters }))
          }
        />
        <GoogleCalendarStatus integration={integration} />
      </div>
    </div>
  );
}

export function CalendarLegend({
  subjects,
  filters,
  onChange,
}: {
  subjects: Subject[];
  filters: CalendarFilters;
  onChange(filters: CalendarFilters): void;
}) {
  return (
    <footer className="oc-legend">
      <div className="oc-legend__subjects" aria-label="Subject colours">
        {subjects.map((subject) => (
          <span key={subject.id}>
            <i
              style={{ "--oc-legend-colour": subject.colour } as CSSProperties}
              aria-hidden="true"
            />
            {subject.displayName}
          </span>
        ))}
      </div>
      <label>
        <input
          type="checkbox"
          checked={filters.showTodos}
          onChange={(event) =>
            onChange({ ...filters, showTodos: event.target.checked })
          }
        />
        <span>Show todos</span>
      </label>
    </footer>
  );
}

export function MobileCalendarViewMenu({
  view,
  onChange,
}: {
  view: CalendarView;
  onChange(view: CalendarView): void;
}) {
  return (
    <label className="oc-mobile-view">
      <CalendarClock size={15} aria-hidden="true" />
      <span className="sr-only">Calendar view</span>
      <OrganatoSelect
        ariaLabel="Calendar view"
        options={viewOptions}
        value={view}
        onChange={(value) => onChange(value as CalendarView)}
      />
    </label>
  );
}
