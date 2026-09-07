const dayMs = 86_400_000;
const localDateFormatters = new Map<string, Intl.DateTimeFormat>();

function localDateFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = localDateFormatters.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  localDateFormatters.set(timezone, formatter);
  return formatter;
}

export function localDateKey(
  date: Date,
  timezone = "Australia/Sydney",
): string {
  const parts = localDateFormatter(timezone).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function localDateOrdinal(
  date: Date,
  timezone = "Australia/Sydney",
): number {
  const [year = 0, month = 1, day = 1] = localDateKey(date, timezone)
    .split("-")
    .map(Number);
  return Date.UTC(year, month - 1, day) / dayMs;
}

export function daysBetweenLocalDates(
  from: Date,
  to: Date,
  timezone = "Australia/Sydney",
): number {
  return localDateOrdinal(to, timezone) - localDateOrdinal(from, timezone);
}

export function daysRemainingLabel(
  due: Date | null,
  now = new Date(),
  timezone = "Australia/Sydney",
): string {
  if (!due) return "—";
  const days = daysBetweenLocalDates(now, due, timezone);
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  if (days > 1) return `${days} days`;
  if (days === -1) return "1 day overdue";
  return `${Math.abs(days)} days overdue`;
}

export function dateOnlyCutoffUtc(
  localDate: string,
  timezone = "Australia/Sydney",
): Date {
  // Determine the UTC offset at local midday, then construct local 23:59.
  const [year = 0, month = 1, day = 1] = localDate.split("-").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, 12));
  const formatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    timeZoneName: "longOffset",
    hour: "2-digit",
  });
  const offsetName =
    formatter.formatToParts(guess).find((part) => part.type === "timeZoneName")
      ?.value ?? "GMT+10:00";
  const match = offsetName.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
  const sign = match?.[1] === "-" ? -1 : 1;
  const offsetMinutes =
    sign * (Number(match?.[2] ?? 10) * 60 + Number(match?.[3] ?? 0));
  return new Date(
    Date.UTC(year, month - 1, day, 23, 59) - offsetMinutes * 60_000,
  );
}

export function isDigestHour(
  now: Date,
  timezone = "Australia/Sydney",
  hour = 6,
): boolean {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: "hour" | "minute") =>
    Number(parts.find((part) => part.type === type)?.value ?? -1);
  return value("hour") === hour && value("minute") < 15;
}
