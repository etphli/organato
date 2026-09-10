import { daysBetweenLocalDates } from "./dates";
import { itemDeadline, shouldRemind } from "./items";
import type { OrganatoItem, Priority } from "./types";

export type ReminderGroup =
  | "overdue"
  | "today"
  | "tomorrow"
  | "two_days"
  | "three_days"
  | "four_to_six_days"
  | "seven_days";

export interface GroupedReminder {
  key: ReminderGroup;
  items: OrganatoItem[];
}

const groupOrder: ReminderGroup[] = [
  "overdue",
  "today",
  "tomorrow",
  "two_days",
  "three_days",
  "four_to_six_days",
  "seven_days",
];

const priorityOrder: Record<NonNullable<Priority> | "blank", number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  blank: 4,
};

export function reminderGroupForDays(days: number): ReminderGroup | null {
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === 2) return "two_days";
  if (days === 3) return "three_days";
  if (days >= 4 && days <= 6) return "four_to_six_days";
  if (days === 7) return "seven_days";
  return null;
}

export function groupDigestItems(
  items: OrganatoItem[],
  now = new Date(),
  timezone = "Australia/Sydney",
): GroupedReminder[] {
  const grouped = new Map<ReminderGroup, OrganatoItem[]>();
  for (const item of items) {
    if (!shouldRemind(item, now, timezone)) continue;
    const deadline = itemDeadline(item, timezone);
    if (!deadline) continue;
    const key = reminderGroupForDays(
      daysBetweenLocalDates(now, deadline, timezone),
    );
    if (!key) continue;
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }
  return groupOrder.flatMap((key) => {
    const groupItems = grouped.get(key);
    if (!groupItems?.length) return [];
    groupItems.sort((a, b) => {
      const rankA = priorityOrder[a.priority ?? "blank"] ?? 4;
      const rankB = priorityOrder[b.priority ?? "blank"] ?? 4;
      if (rankA !== rankB) return rankA - rankB;
      return (
        (itemDeadline(a, timezone)?.getTime() ?? 0) -
        (itemDeadline(b, timezone)?.getTime() ?? 0)
      );
    });
    return [{ key, items: groupItems }];
  });
}

export function digestDeliveryKey(
  localDate: string,
  recipients: string[],
): string {
  return `daily:${localDate}:${[...recipients]
    .map((email) => email.toLowerCase())
    .sort()
    .join(",")}`;
}
