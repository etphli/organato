import { useCallback, useMemo, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { useOrganato } from "../state/OrganatoProvider";
import { AgendaView } from "./calendar/AgendaView";
import {
  CalendarLegend,
  CalendarToolbar,
  CalendarViewSwitcher,
  MobileCalendarViewMenu,
} from "./calendar/CalendarControls";
import { MonthView } from "./calendar/MonthView";
import { CalendarQuickCreate } from "./calendar/QuickCreate";
import { WeekView } from "./calendar/WeekView";
import {
  buildCalendarEntries,
  defaultCalendarFilters,
  entriesByDate,
  filtersActiveCount,
  localDateTimeToIso,
  monthDates,
  moveAnchor,
  rangeTitle,
  rescheduleEntry,
  todayKey,
  weekDates,
  type CalendarEntry,
  type CalendarView,
} from "./calendar/model";
import { useCalendarPreferences } from "./calendar/useCalendarPreferences";
import "./calendar/calendar.css";

interface QuickCreateState {
  dateKey: string;
  minutes: number | null;
}

export default function CalendarPage() {
  const { items, subjects, subjectsById, settings, integrations, dispatch } =
    useOrganato();
  const [preferences, setPreferences] = useCalendarPreferences(
    settings.calendarDefaultView,
    settings.timezone,
  );
  const [quickCreate, setQuickCreate] = useState<QuickCreateState | null>(null);
  const todayDateKey = todayKey(settings.timezone);
  const entries = useMemo(
    () =>
      buildCalendarEntries(items, subjectsById, settings, preferences.filters),
    [items, preferences.filters, settings, subjectsById],
  );
  const groupedEntries = useMemo(() => entriesByDate(entries), [entries]);
  const visibleSubjects = useMemo(() => {
    const entrySubjectIds = new Set(
      entries
        .map((entry) => entry.item.subjectId)
        .filter((id): id is string => Boolean(id)),
    );
    const present = subjects.filter(
      (subject) => subject.active && entrySubjectIds.has(subject.id),
    );
    return present.length
      ? present
      : subjects.filter((subject) => subject.active).slice(0, 6);
  }, [entries, subjects]);
  const calendarIntegration = integrations.find(
    (integration) => integration.provider === "google_calendar",
  );
  const monthViewDates = useMemo(
    () => monthDates(preferences.anchorKey, settings.firstDayOfWeek),
    [preferences.anchorKey, settings.firstDayOfWeek],
  );
  const weekViewDates = useMemo(
    () => weekDates(preferences.anchorKey, settings.firstDayOfWeek),
    [preferences.anchorKey, settings.firstDayOfWeek],
  );
  const filterCount = filtersActiveCount(preferences.filters);

  const changeView = useCallback(
    (view: CalendarView) => {
      setPreferences((current) => ({ ...current, view }));
    },
    [setPreferences],
  );
  const selectDate = useCallback(
    (selectedDateKey: string) => {
      setPreferences((current) => ({ ...current, selectedDateKey }));
    },
    [setPreferences],
  );
  const openCreate = useCallback((dateKey: string, minutes: number | null) => {
    setQuickCreate({ dateKey, minutes });
  }, []);
  const openEntry = useCallback(
    (entry: CalendarEntry) => {
      dispatch({ type: "select", id: entry.item.id });
    },
    [dispatch],
  );
  const moveEntry = useCallback(
    (entry: CalendarEntry, dateKey: string, minutes = entry.startMinutes) => {
      dispatch({
        type: "patchItem",
        id: entry.item.id,
        patch: rescheduleEntry(entry, dateKey, settings.timezone, minutes),
      });
    },
    [dispatch, settings.timezone],
  );
  const clearFilters = useCallback(() => {
    setPreferences((current) => ({
      ...current,
      filters: defaultCalendarFilters,
    }));
  }, [setPreferences]);
  const movePeriod = useCallback(
    (amount: number) => {
      setPreferences((current) => {
        const anchorKey = moveAnchor(current.anchorKey, current.view, amount);
        return {
          ...current,
          anchorKey,
          selectedDateKey: anchorKey,
        };
      });
    },
    [setPreferences],
  );
  const returnToToday = useCallback(() => {
    setPreferences((current) => ({
      ...current,
      anchorKey: todayDateKey,
      selectedDateKey: todayDateKey,
    }));
  }, [setPreferences, todayDateKey]);

  return (
    <div className="page calendar-page oc-calendar-page">
      <PageHeader
        title="Calendar"
        meta={rangeTitle(
          preferences.anchorKey,
          preferences.view,
          settings.firstDayOfWeek,
        )}
        actions={
          <>
            <CalendarViewSwitcher
              view={preferences.view}
              onChange={changeView}
            />
            <MobileCalendarViewMenu
              view={preferences.view}
              onChange={changeView}
            />
          </>
        }
      />
      <CalendarToolbar
        preferences={preferences}
        setPreferences={setPreferences}
        subjects={subjects.filter((subject) => subject.active)}
        integration={calendarIntegration}
        onPrevious={() => movePeriod(-1)}
        onToday={returnToToday}
        onNext={() => movePeriod(1)}
      />
      <section className="oc-calendar-surface" aria-label="Calendar surface">
        {preferences.view === "month" ? (
          <MonthView
            anchorKey={preferences.anchorKey}
            dates={monthViewDates}
            entries={groupedEntries}
            selectedDateKey={preferences.selectedDateKey}
            todayDateKey={todayDateKey}
            weekStartsOn={settings.firstDayOfWeek}
            dragEnabled={settings.dragCalendarReschedule}
            filtersActive={filterCount > 0}
            onSelectDate={selectDate}
            onCreate={(dateKey) => openCreate(dateKey, null)}
            onOpenEntry={openEntry}
            onMoveEntry={(entry, dateKey) =>
              moveEntry(entry, dateKey, entry.startMinutes)
            }
            onClearFilters={clearFilters}
          />
        ) : null}
        {preferences.view === "week" ? (
          <WeekView
            dates={weekViewDates}
            entries={groupedEntries}
            selectedDateKey={preferences.selectedDateKey}
            todayDateKey={todayDateKey}
            timezone={settings.timezone}
            dragEnabled={settings.dragCalendarReschedule}
            filtersActive={filterCount > 0}
            onSelectDate={selectDate}
            onCreate={openCreate}
            onOpenEntry={openEntry}
            onMoveEntry={moveEntry}
            onClearFilters={clearFilters}
          />
        ) : null}
        {preferences.view === "agenda" ? (
          <AgendaView
            anchorKey={preferences.anchorKey}
            entries={entries}
            selectedDateKey={preferences.selectedDateKey}
            todayDateKey={todayDateKey}
            filtersActive={filterCount > 0}
            onSelectDate={selectDate}
            onCreate={(dateKey) => openCreate(dateKey, null)}
            onOpenEntry={openEntry}
            onClearFilters={clearFilters}
          />
        ) : null}
      </section>
      {preferences.view === "month" ? (
        <CalendarLegend
          subjects={visibleSubjects}
          filters={preferences.filters}
          onChange={(filters) =>
            setPreferences((current) => ({ ...current, filters }))
          }
        />
      ) : null}
      {quickCreate ? (
        <CalendarQuickCreate
          dateKey={quickCreate.dateKey}
          initialMinutes={quickCreate.minutes}
          onCancel={() => setQuickCreate(null)}
          onSave={({ name, dateKey, time }) => {
            dispatch(
              time
                ? {
                    type: "addTodo",
                    name,
                    dueAt: localDateTimeToIso(dateKey, time, settings.timezone),
                    dueDateLocal: null,
                    dueHasExplicitTime: true,
                  }
                : {
                    type: "addTodo",
                    name,
                    dueAt: null,
                    dueDateLocal: dateKey,
                    dueHasExplicitTime: false,
                  },
            );
            setQuickCreate(null);
            selectDate(dateKey);
          }}
        />
      ) : null}
    </div>
  );
}
