import type {
  Classification,
  FieldOverride,
  OrganatoItem,
  Priority,
  RecurrenceRule,
  VisibleStatus,
} from "./types";
import { dateOnlyCutoffUtc } from "./dates";

export type DeadlineFields = Pick<
  OrganatoItem,
  "dueAt" | "dueDateLocal" | "dueHasExplicitTime"
>;

export class InvalidDeadlineError extends Error {
  constructor(message = "Deadline fields are inconsistent.") {
    super(message);
    this.name = "InvalidDeadlineError";
  }
}

function owns(
  value: Partial<DeadlineFields>,
  field: keyof DeadlineFields,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

export function isValidLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function normalizeDeadlineFields(
  fields: DeadlineFields,
): DeadlineFields {
  if (fields.dueAt && fields.dueDateLocal) {
    throw new InvalidDeadlineError(
      "A deadline cannot have both a timed instant and a date-only value.",
    );
  }
  if (fields.dueAt) {
    if (!fields.dueHasExplicitTime) {
      throw new InvalidDeadlineError(
        "A timed deadline must be marked as having an explicit time.",
      );
    }
    const instant = new Date(fields.dueAt);
    if (Number.isNaN(instant.getTime())) {
      throw new InvalidDeadlineError("The timed deadline is invalid.");
    }
    return {
      dueAt: instant.toISOString(),
      dueDateLocal: null,
      dueHasExplicitTime: true,
    };
  }
  if (fields.dueDateLocal) {
    if (fields.dueHasExplicitTime) {
      throw new InvalidDeadlineError(
        "A date-only deadline cannot have an explicit time.",
      );
    }
    if (!isValidLocalDate(fields.dueDateLocal)) {
      throw new InvalidDeadlineError("The date-only deadline is invalid.");
    }
    return {
      dueAt: null,
      dueDateLocal: fields.dueDateLocal,
      dueHasExplicitTime: false,
    };
  }
  if (fields.dueHasExplicitTime) {
    throw new InvalidDeadlineError(
      "An explicit-time deadline requires a timed instant.",
    );
  }
  return {
    dueAt: null,
    dueDateLocal: null,
    dueHasExplicitTime: false,
  };
}

export function mergeDeadlineFields(
  current: DeadlineFields,
  patch: Partial<DeadlineFields>,
): DeadlineFields {
  const hasDueAt = owns(patch, "dueAt");
  const hasDueDateLocal = owns(patch, "dueDateLocal");
  const hasExplicitTime = owns(patch, "dueHasExplicitTime");
  if (!hasDueAt && !hasDueDateLocal && !hasExplicitTime) {
    return normalizeDeadlineFields(current);
  }

  if (hasDueAt && patch.dueAt) {
    if (hasDueDateLocal && patch.dueDateLocal) {
      throw new InvalidDeadlineError(
        "Choose either a due time or a date-only deadline.",
      );
    }
    if (hasExplicitTime && patch.dueHasExplicitTime === false) {
      throw new InvalidDeadlineError(
        "A timed deadline must be marked as having an explicit time.",
      );
    }
    return normalizeDeadlineFields({
      dueAt: patch.dueAt,
      dueDateLocal: null,
      dueHasExplicitTime: true,
    });
  }

  if (hasDueDateLocal && patch.dueDateLocal) {
    if (hasExplicitTime && patch.dueHasExplicitTime === true) {
      throw new InvalidDeadlineError(
        "A date-only deadline cannot have an explicit time.",
      );
    }
    return normalizeDeadlineFields({
      dueAt: null,
      dueDateLocal: patch.dueDateLocal,
      dueHasExplicitTime: false,
    });
  }

  if (hasExplicitTime && patch.dueHasExplicitTime === true) {
    const dueAt = hasDueAt ? patch.dueAt : current.dueAt;
    return normalizeDeadlineFields({
      dueAt: dueAt ?? null,
      dueDateLocal: null,
      dueHasExplicitTime: true,
    });
  }

  if (hasExplicitTime && patch.dueHasExplicitTime === false) {
    const dueDateLocal = hasDueDateLocal
      ? patch.dueDateLocal
      : current.dueDateLocal;
    if (!dueDateLocal && !hasDueDateLocal && current.dueAt) {
      throw new InvalidDeadlineError(
        "Converting a timed deadline to date-only requires a local date.",
      );
    }
    return normalizeDeadlineFields({
      dueAt: null,
      dueDateLocal: dueDateLocal ?? null,
      dueHasExplicitTime: false,
    });
  }

  if (hasDueDateLocal && patch.dueDateLocal === null && !hasDueAt) {
    if (current.dueAt) return normalizeDeadlineFields(current);
    return normalizeDeadlineFields({
      dueAt: null,
      dueDateLocal: null,
      dueHasExplicitTime: false,
    });
  }

  if (hasDueAt && patch.dueAt === null) {
    const dueDateLocal = hasDueDateLocal
      ? patch.dueDateLocal
      : current.dueDateLocal;
    return normalizeDeadlineFields({
      dueAt: null,
      dueDateLocal: dueDateLocal ?? null,
      dueHasExplicitTime: false,
    });
  }

  return normalizeDeadlineFields(current);
}

export function itemDeadline(item: OrganatoItem): Date | null {
  if (item.dueHasExplicitTime && item.dueAt) return new Date(item.dueAt);
  if (item.dueDateLocal) return dateOnlyCutoffUtc(item.dueDateLocal);
  return item.dueAt ? new Date(item.dueAt) : null;
}

export function visibleStatus(
  item: OrganatoItem,
  now = new Date(),
): VisibleStatus {
  if (item.archivedAt) return "archived";
  if (item.workingStatus === "completed") return "completed";
  if (item.workingStatus === "submitted") return "submitted";
  const deadline = itemDeadline(item);
  if (deadline && deadline.getTime() < now.getTime()) return "overdue";
  return item.workingStatus;
}

export function isInView(
  classification: Classification,
  page: "assignments" | "checkpoints",
): boolean {
  if (page === "assignments") {
    return classification === "assignment" || classification === "both";
  }
  return classification === "checkpoint" || classification === "both";
}

export function effectiveField<T>(
  sourceValue: T,
  overrides: FieldOverride[],
  fieldName: FieldOverride["fieldName"],
): T {
  const override = overrides.find((entry) => entry.fieldName === fieldName);
  return (override?.value as T | undefined) ?? sourceValue;
}

const priorityRank: Record<NonNullable<Priority>, number> = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

export function compareItems(
  a: OrganatoItem,
  b: OrganatoItem,
  now = new Date(),
): number {
  const aStatus = visibleStatus(a, now);
  const bStatus = visibleStatus(b, now);
  if (aStatus === "overdue" && bStatus !== "overdue") return -1;
  if (bStatus === "overdue" && aStatus !== "overdue") return 1;
  const aDeadline = itemDeadline(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bDeadline = itemDeadline(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (aDeadline !== bDeadline) return aDeadline - bDeadline;
  const priorityDifference =
    (priorityRank[b.priority ?? "low"] ?? 0) -
    (priorityRank[a.priority ?? "low"] ?? 0);
  if (priorityDifference !== 0) return priorityDifference;
  return a.displayName.localeCompare(b.displayName);
}

function addDays(date: Date, amount: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + amount);
  return copy;
}

function addMonths(date: Date, amount: number): Date {
  const targetMonth = date.getUTCMonth() + amount;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, normalizedMonth + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      normalizedMonth,
      Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

export function nextRecurrence(date: Date, rule: RecurrenceRule): Date {
  if (rule.frequency === "daily") return addDays(date, rule.interval);
  if (rule.frequency === "weekly") return addDays(date, 7 * rule.interval);
  if (rule.frequency === "biweekly") return addDays(date, 14 * rule.interval);
  if (rule.frequency === "monthly") return addMonths(date, rule.interval);
  if (rule.frequency === "custom") return addDays(date, rule.interval);
  let next = addDays(date, 1);
  let remaining = rule.interval;
  while (remaining > 0) {
    const day = next.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
    if (remaining > 0) next = addDays(next, 1);
  }
  return next;
}

export function nextRecurrenceLocalDate(
  localDate: string,
  rule: RecurrenceRule,
): string {
  if (!isValidLocalDate(localDate)) {
    throw new InvalidDeadlineError("The recurrence date is invalid.");
  }
  return nextRecurrence(new Date(`${localDate}T00:00:00.000Z`), rule)
    .toISOString()
    .slice(0, 10);
}

export function nextRecurrenceDeadline(
  fields: DeadlineFields,
  rule: RecurrenceRule,
): DeadlineFields | null {
  const deadline = normalizeDeadlineFields(fields);
  if (deadline.dueAt) {
    return {
      dueAt: nextRecurrence(new Date(deadline.dueAt), rule).toISOString(),
      dueDateLocal: null,
      dueHasExplicitTime: true,
    };
  }
  if (deadline.dueDateLocal) {
    return {
      dueAt: null,
      dueDateLocal: nextRecurrenceLocalDate(deadline.dueDateLocal, rule),
      dueHasExplicitTime: false,
    };
  }
  return null;
}

export function shouldRemind(item: OrganatoItem, now = new Date()): boolean {
  if (!item.remindersEnabled || item.archivedAt) return false;
  const status = visibleStatus(item, now);
  return (
    status !== "completed" &&
    status !== "submitted" &&
    itemDeadline(item) !== null
  );
}
