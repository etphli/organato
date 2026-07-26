import type {
  Classification,
  FieldOverride,
  OrganatoItem,
  Priority,
  RecurrenceRule,
  VisibleStatus,
} from "./types";
import { dateOnlyCutoffUtc } from "./dates";

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
  const copy = new Date(date);
  copy.setUTCMonth(copy.getUTCMonth() + amount);
  return copy;
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

export function shouldRemind(item: OrganatoItem, now = new Date()): boolean {
  if (!item.remindersEnabled || item.archivedAt) return false;
  const status = visibleStatus(item, now);
  return (
    status !== "completed" &&
    status !== "submitted" &&
    itemDeadline(item) !== null
  );
}
