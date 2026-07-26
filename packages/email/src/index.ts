import {
  groupDigestItems,
  itemDeadline,
  type GroupedReminder,
  type OrganatoItem,
  type Subject,
} from "@organato/domain";

const labels: Record<GroupedReminder["key"], string> = {
  overdue: "Overdue",
  today: "Due today",
  tomorrow: "Due tomorrow",
  two_days: "Due in 2 days",
  three_days: "Due in 3 days",
  four_to_six_days: "Due in 4–6 days",
  seven_days: "Due in 7 days",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function typeLabel(item: OrganatoItem): string {
  if (item.kind === "todo") return "Todo";
  if (item.classification === "both") return "Assignment + checkpoint";
  return item.classification[0]?.toUpperCase() + item.classification.slice(1);
}

export interface DigestInput {
  items: OrganatoItem[];
  subjects: Subject[];
  now: Date;
  appOrigin: string;
  lastCanvasSync: string;
  lastCalendarSync: string;
}

export interface RenderedDigest {
  subject: string;
  html: string;
  text: string;
  itemIds: string[];
}

export function renderDigest(input: DigestInput): RenderedDigest | null {
  const groups = groupDigestItems(input.items, input.now);
  if (!groups.length) return null;
  const subjects = new Map(
    input.subjects.map((subject) => [subject.id, subject]),
  );
  const all = groups.flatMap((group) => group.items);
  const todayCount =
    groups.find((group) => group.key === "today")?.items.length ?? 0;
  const overdueCount =
    groups.find((group) => group.key === "overdue")?.items.length ?? 0;
  const subject = overdueCount
    ? `Organato · ${overdueCount} overdue, ${all.length - overdueCount} coming up`
    : todayCount
      ? `Organato · ${todayCount} due today, ${all.length} this week`
      : `Organato · ${all.length} coming up this week`;

  const htmlGroups = groups
    .map((group) => {
      const emphasized = [
        "today",
        "tomorrow",
        "two_days",
        "three_days",
        "seven_days",
      ].includes(group.key);
      const rows = group.items
        .map((item) => {
          const subjectName = item.subjectId
            ? subjects.get(item.subjectId)?.displayName
            : undefined;
          const due = itemDeadline(item)?.toLocaleString("en-AU", {
            timeZone: "Australia/Sydney",
            dateStyle: "medium",
            ...(item.dueHasExplicitTime ? { timeStyle: "short" as const } : {}),
          });
          return `<tr>
            <td style="padding:14px 0;border-top:1px solid #2b2b2f">
              <a href="${escapeHtml(input.appOrigin)}/items/${encodeURIComponent(item.id)}" style="color:#f2f2f3;text-decoration:none;font-weight:600">${escapeHtml(item.displayName)}</a>
              <div style="margin-top:5px;color:#a3a3aa;font-size:13px">${escapeHtml(typeLabel(item))}${subjectName ? ` · ${escapeHtml(subjectName)}` : ""}${item.priority ? ` · ${escapeHtml(item.priority)}` : ""} · ${escapeHtml(due ?? "No due date")}</div>
              ${item.canvasHtmlUrl ? `<a href="${escapeHtml(item.canvasHtmlUrl)}" style="display:inline-block;margin-top:7px;color:#c4b5fd;font-size:13px">Open in Canvas</a>` : ""}
            </td>
          </tr>`;
        })
        .join("");
      return `<section style="margin:0 0 28px">
        <h2 style="margin:0 0 8px;color:${emphasized ? "#d8b4fe" : "#f2f2f3"};font-size:16px">${labels[group.key]}</h2>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>
      </section>`;
    })
    .join("");

  const html = `<!doctype html>
<html><body style="margin:0;background:#0b0b0c;color:#f2f2f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(subject)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0b0c">
    <tr><td align="center" style="padding:28px 16px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px">
        <tr><td style="padding:0 0 28px">
          <div style="font-size:22px;font-weight:700">Organato</div>
          <div style="margin-top:6px;color:#a3a3aa">Your next seven days</div>
        </td></tr>
        <tr><td>${htmlGroups}</td></tr>
        <tr><td style="padding-top:24px;border-top:1px solid #2b2b2f;color:#71717a;font-size:12px;line-height:1.6">
          Canvas last synced ${escapeHtml(input.lastCanvasSync)} · Calendar last reconciled ${escapeHtml(input.lastCalendarSync)}<br>
          One private digest from Organato. No tracking pixels or third-party images.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    "ORGANATO — YOUR NEXT SEVEN DAYS",
    "",
    ...groups.flatMap((group) => [
      labels[group.key].toUpperCase(),
      ...group.items.map((item) => {
        const subjectName = item.subjectId
          ? subjects.get(item.subjectId)?.displayName
          : undefined;
        return `- ${item.displayName} · ${typeLabel(item)}${subjectName ? ` · ${subjectName}` : ""}\n  ${input.appOrigin}/items/${item.id}${item.canvasHtmlUrl ? `\n  Canvas: ${item.canvasHtmlUrl}` : ""}`;
      }),
      "",
    ]),
    `Canvas last synced ${input.lastCanvasSync}`,
    `Calendar last reconciled ${input.lastCalendarSync}`,
  ].join("\n");

  return { subject, html, text, itemIds: all.map((item) => item.id) };
}

export { escapeHtml };
