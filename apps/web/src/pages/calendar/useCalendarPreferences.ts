import { useEffect, useState } from "react";
import {
  defaultCalendarFilters,
  todayKey,
  type CalendarFilters,
  type CalendarPreferences,
  type CalendarView,
} from "./model";

const storageKey = "organato-calendar-preferences-v2";
const views = new Set<CalendarView>(["month", "week", "agenda"]);
const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readFilters(value: unknown): CalendarFilters {
  if (!value || typeof value !== "object") return defaultCalendarFilters;
  const candidate = value as Partial<CalendarFilters>;
  return {
    types: stringArray(candidate.types).filter(
      (entry): entry is CalendarFilters["types"][number] =>
        ["assignment", "checkpoint", "todo", "unclassified"].includes(entry),
    ),
    subjectIds: stringArray(candidate.subjectIds),
    priorities: stringArray(candidate.priorities).filter(
      (entry): entry is CalendarFilters["priorities"][number] =>
        ["low", "medium", "high", "urgent"].includes(entry),
    ),
    statuses: stringArray(candidate.statuses).filter(
      (entry): entry is CalendarFilters["statuses"][number] =>
        ["active", "overdue", "submitted", "completed"].includes(entry),
    ),
    showTodos:
      typeof candidate.showTodos === "boolean" ? candidate.showTodos : true,
  };
}

function defaultPreferences(
  defaultView: CalendarView,
  timezone: string,
): CalendarPreferences {
  const dateKey = todayKey(timezone);
  const isPhone =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 760px)").matches;
  return {
    view: isPhone ? "agenda" : defaultView,
    anchorKey: dateKey,
    selectedDateKey: dateKey,
    filters: defaultCalendarFilters,
  };
}

function readPreferences(
  defaultView: CalendarView,
  timezone: string,
): CalendarPreferences {
  const fallback = defaultPreferences(defaultView, timezone);
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<CalendarPreferences>;
    return {
      view: saved.view && views.has(saved.view) ? saved.view : fallback.view,
      anchorKey:
        saved.anchorKey && dateKeyPattern.test(saved.anchorKey)
          ? saved.anchorKey
          : fallback.anchorKey,
      selectedDateKey:
        saved.selectedDateKey && dateKeyPattern.test(saved.selectedDateKey)
          ? saved.selectedDateKey
          : fallback.selectedDateKey,
      filters: readFilters(saved.filters),
    };
  } catch {
    return fallback;
  }
}

export function useCalendarPreferences(
  defaultView: CalendarView,
  timezone: string,
) {
  const [preferences, setPreferences] = useState<CalendarPreferences>(() =>
    readPreferences(defaultView, timezone),
  );

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch {
      // Calendar state is still usable when device storage is unavailable.
    }
  }, [preferences]);

  return [preferences, setPreferences] as const;
}
