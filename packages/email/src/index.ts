import {
  classificationLabel,
  groupDigestItems,
  itemDeadline,
  type CanvasCourseSignals,
  type GroupedReminder,
  type OrganatoItem,
  type Subject,
} from "@organato/domain";
import templateMetadata from "./template.json";

export const EMAIL_TEMPLATE_VERSION = templateMetadata.version;

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
  return classificationLabel(item.classification);
}

export interface DigestInput {
  items: OrganatoItem[];
  subjects: Subject[];
  now: Date;
  appOrigin: string;
  lastCanvasSync: string;
  lastCalendarSync: string;
  timezone?: string;
  truncated?: boolean;
  recentChanges?: Array<{
    itemId: string;
    itemName: string;
    action: string;
    summary: string;
    at: string;
  }>;
  courseSignals?: CanvasCourseSignals | undefined;
}

export interface RenderedDigest {
  subject: string;
  html: string;
  text: string;
  itemIds: string[];
}

export function renderDigest(input: DigestInput): RenderedDigest | null {
  const groups = groupDigestItems(
    input.items,
    input.now,
    input.timezone ?? "Australia/Sydney",
  );
  const hasSignals = Boolean(
    input.courseSignals &&
    (input.courseSignals.announcements.length ||
      input.courseSignals.grades.length ||
      input.courseSignals.modules.length),
  );
  if (!groups.length && !hasSignals) return null;
  const subjects = new Map(
    input.subjects.map((subject) => [subject.id, subject]),
  );
  const all = groups.flatMap((group) => group.items);
  const todayCount =
    groups.find((group) => group.key === "today")?.items.length ?? 0;
  const overdueCount =
    groups.find((group) => group.key === "overdue")?.items.length ?? 0;
  const subject = overdueCount
    ? `Organato: ${overdueCount} overdue, ${all.length - overdueCount} coming up`
    : todayCount
      ? `Organato: ${todayCount} due today, ${all.length} this week`
      : `Organato: ${all.length} coming up this week`;

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
          const due = itemDeadline(
            item,
            input.timezone ?? "Australia/Sydney",
          )?.toLocaleString("en-AU", {
            timeZone: input.timezone ?? "Australia/Sydney",
            dateStyle: "medium",
            ...(item.dueHasExplicitTime ? { timeStyle: "short" as const } : {}),
          });
          return `<tr>
            <td style="padding:0 0 10px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e7e5ef;border-radius:12px;background:#ffffff">
                <tr>
                  <td style="padding:16px 18px">
                    <a href="${escapeHtml(input.appOrigin)}/items/${encodeURIComponent(item.id)}" style="color:#17151d;text-decoration:none;font-size:15px;font-weight:700;line-height:1.35">${escapeHtml(item.displayName)}</a>
                    <div style="margin-top:7px;color:#6f6a79;font-size:13px;line-height:1.5">${escapeHtml(typeLabel(item))}${subjectName ? ` &nbsp;•&nbsp; ${escapeHtml(subjectName)}` : ""}${item.priority ? ` &nbsp;•&nbsp; ${escapeHtml(item.priority)}` : ""}</div>
                    <div style="margin-top:9px;color:#3e3948;font-size:13px;font-weight:600">${escapeHtml(due ?? "No due date")}</div>
                    ${item.canvasHtmlUrl ? `<a href="${escapeHtml(item.canvasHtmlUrl)}" style="display:inline-block;margin-top:10px;color:#7057c8;font-size:13px;font-weight:600;text-decoration:none">Open in Canvas&nbsp; →</a>` : ""}
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
        })
        .join("");
      return `<section style="margin:0 0 26px">
        <h2 style="margin:0 0 10px;color:${emphasized ? "#7057c8" : "#3e3948"};font-size:15px;line-height:1.4">${labels[group.key]} <span style="color:#9892a2;font-size:12px;font-weight:500">(${group.items.length})</span></h2>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>
      </section>`;
    })
    .join("");

  const changeLabel = (action: string): string =>
    action === "canvas_removed"
      ? "Removed from Canvas"
      : action === "canvas_imported"
        ? "New from Canvas"
        : "Updated in Canvas";
  const changes = (input.recentChanges ?? []).filter(
    (change) => change?.itemId && change?.itemName,
  );
  const changesSection = changes.length
    ? `<section style="margin:0 0 26px">
        <h2 style="margin:0 0 10px;color:#7057c8;font-size:15px;line-height:1.4">Changed since yesterday <span style="color:#9892a2;font-size:12px;font-weight:500">(${changes.length})</span></h2>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${changes
          .map(
            (change) =>
              `<tr><td style="padding:0 0 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e7e5ef;border-radius:12px;background:#ffffff"><tr><td style="padding:16px 18px"><a href="${escapeHtml(input.appOrigin)}/items/${encodeURIComponent(change.itemId)}" style="color:#17151d;text-decoration:none;font-size:15px;font-weight:700;line-height:1.35">${escapeHtml(change.itemName)}</a><div style="margin-top:7px;color:#6f6a79;font-size:13px;line-height:1.5">${escapeHtml(changeLabel(change.action))} &nbsp;•&nbsp; ${escapeHtml(change.summary)}</div></td></tr></table></td></tr>`,
          )
          .join("")}</table>
      </section>`
    : "";
  const changesText = changes.map(
    (change) =>
      `- ${change.itemName} · ${changeLabel(change.action)} · ${change.summary}\n  ${input.appOrigin}/items/${encodeURIComponent(change.itemId)}`,
  );

  const signals = input.courseSignals;
  const signalAnnouncements = (signals?.announcements ?? []).slice(0, 5);
  const signalGrades = (signals?.grades ?? []).filter(
    (grade) => grade.score !== null || grade.grade !== null,
  );
  const signalModules = (signals?.modules ?? [])
    .filter((module) => module.state !== "completed")
    .slice(0, 8);
  const signalsSection =
    signalAnnouncements.length || signalGrades.length || signalModules.length
      ? `<section style="margin:0 0 26px">
        <h2 style="margin:0 0 10px;color:#7057c8;font-size:15px;line-height:1.4">Course signals</h2>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${signalAnnouncements
          .map(
            (announcement) =>
              `<tr><td style="padding:0 0 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e7e5ef;border-radius:12px;background:#ffffff"><tr><td style="padding:16px 18px">${
                announcement.url
                  ? `<a href="${escapeHtml(announcement.url)}" style="color:#17151d;text-decoration:none;font-size:15px;font-weight:700;line-height:1.35">${escapeHtml(announcement.title)}</a>`
                  : `<span style="color:#17151d;font-size:15px;font-weight:700;line-height:1.35">${escapeHtml(announcement.title)}</span>`
              }<div style="margin-top:7px;color:#6f6a79;font-size:13px;line-height:1.5">${escapeHtml(announcement.courseName)} &nbsp;•&nbsp; ${escapeHtml(announcement.excerpt)}</div></td></tr></table></td></tr>`,
          )
          .join("")}${signalGrades
          .map(
            (grade) =>
              `<tr><td style="padding:0 0 10px;color:#3e3948;font-size:13px">📊 ${escapeHtml(grade.courseName)}: ${
                grade.score !== null ? `${grade.score}%` : ""
              }${grade.score !== null && grade.grade ? " · " : ""}${escapeHtml(grade.grade ?? "")}</td></tr>`,
          )
          .join("")}${signalModules
          .map(
            (module) =>
              `<tr><td style="padding:0 0 6px;color:#6f6a79;font-size:13px">📦 ${escapeHtml(module.courseName)} — ${escapeHtml(module.moduleName)}${module.state ? ` (${escapeHtml(module.state)})` : ""}</td></tr>`,
          )
          .join("")}</table>
      </section>`
      : "";
  const signalsText = [
    ...signalAnnouncements.map(
      (announcement) =>
        `- ${announcement.title} (${announcement.courseName}): ${announcement.excerpt}`,
    ),
    ...signalGrades.map(
      (grade) =>
        `- Grade ${grade.courseName}: ${grade.score !== null ? `${grade.score}%` : ""}${grade.grade ? ` ${grade.grade}` : ""}`,
    ),
  ];

  const html = `<!doctype html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body data-organato-template="${EMAIL_TEMPLATE_VERSION}" style="margin:0;background:#f4f2f8;color:#17151d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(subject)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f4f2f8" style="background:#f4f2f8">
    <tr><td align="center" style="padding:32px 14px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px">
        <tr><td style="padding:0 6px 18px;color:#17151d;font-size:20px;font-weight:800;letter-spacing:-0.02em">Organato</td></tr>
        <tr><td style="background:#17151d;border-radius:16px 16px 0 0;padding:28px 30px;color:#ffffff">
          <div style="color:#bfb5e8;font-size:12px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase">Weekly plan</div>
          <h1 style="margin:8px 0 6px;font-size:28px;line-height:1.2;letter-spacing:-0.03em">Your next seven days</h1>
          <p style="margin:0;color:#bbb7c2;font-size:14px;line-height:1.55">${all.length} item${all.length === 1 ? "" : "s"} need your attention${overdueCount ? `, including ${overdueCount} overdue` : ""}.</p>
        </td></tr>
        <tr><td style="background:#fbfaff;border:1px solid #e7e5ef;border-top:0;border-radius:0 0 16px 16px;padding:28px 30px 8px">${changesSection}${signalsSection}${htmlGroups}</td></tr>
        <tr><td align="center" style="padding:20px 12px 4px">
          <a href="${escapeHtml(input.appOrigin)}" style="display:inline-block;background:#7057c8;border-radius:9px;color:#ffffff;font-size:14px;font-weight:700;padding:11px 18px;text-decoration:none">Open Organato</a>
        </td></tr>
        <tr><td align="center" style="padding:14px 18px 0;color:#817b89;font-size:11px;line-height:1.65">
          Canvas synced ${escapeHtml(input.lastCanvasSync)} &nbsp;•&nbsp; Calendar reconciled ${escapeHtml(input.lastCalendarSync)}<br>
          ${input.truncated ? "Showing the first 1,000 items — open Organato for the full list.<br>" : ""}
          A private digest from Organato. No tracking pixels or third-party images.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    "ORGANATO — YOUR NEXT SEVEN DAYS",
    "",
    ...(changesText.length
      ? ["CHANGED SINCE YESTERDAY", ...changesText, ""]
      : []),
    ...(signalsText.length ? ["COURSE SIGNALS", ...signalsText, ""] : []),
    ...groups.flatMap((group) => [
      labels[group.key].toUpperCase(),
      ...group.items.map((item) => {
        const subjectName = item.subjectId
          ? subjects.get(item.subjectId)?.displayName
          : undefined;
        const due = itemDeadline(
          item,
          input.timezone ?? "Australia/Sydney",
        )?.toLocaleString("en-AU", {
          timeZone: input.timezone ?? "Australia/Sydney",
          dateStyle: "medium",
          ...(item.dueHasExplicitTime ? { timeStyle: "short" as const } : {}),
        });
        return `- ${item.displayName} · ${typeLabel(item)}${subjectName ? ` · ${subjectName}` : ""}${due ? ` · due ${due}` : ""}\n  ${input.appOrigin}/items/${encodeURIComponent(item.id)}${item.canvasHtmlUrl ? `\n  Canvas: ${item.canvasHtmlUrl}` : ""}`;
      }),
      "",
    ]),
    `Canvas last synced ${input.lastCanvasSync}`,
    `Calendar last reconciled ${input.lastCalendarSync}`,
  ].join("\n");

  return { subject, html, text, itemIds: all.map((item) => item.id) };
}

export interface WeeklyReviewInput {
  done: OrganatoItem[];
  slipped: OrganatoItem[];
  upcoming: OrganatoItem[];
  subjects: Subject[];
  now: Date;
  appOrigin: string;
  timezone?: string;
}

function reviewRow(
  item: OrganatoItem,
  subjects: Map<string, Subject>,
  timezone: string,
  appOrigin: string,
): string {
  const subjectName = item.subjectId
    ? subjects.get(item.subjectId)?.displayName
    : undefined;
  const due = itemDeadline(item, timezone)?.toLocaleString("en-AU", {
    timeZone: timezone,
    dateStyle: "medium",
    ...(item.dueHasExplicitTime ? { timeStyle: "short" as const } : {}),
  });
  return `<tr>
    <td style="padding:0 0 10px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e7e5ef;border-radius:12px;background:#ffffff">
        <tr>
          <td style="padding:16px 18px">
            <a href="${escapeHtml(appOrigin)}/items/${encodeURIComponent(item.id)}" style="color:#17151d;text-decoration:none;font-size:15px;font-weight:700;line-height:1.35">${escapeHtml(item.displayName)}</a>
            <div style="margin-top:7px;color:#6f6a79;font-size:13px;line-height:1.5">${escapeHtml(typeLabel(item))}${subjectName ? ` &nbsp;•&nbsp; ${escapeHtml(subjectName)}` : ""}${item.priority ? ` &nbsp;•&nbsp; ${escapeHtml(item.priority)}` : ""}</div>
            ${due ? `<div style="margin-top:9px;color:#3e3948;font-size:13px;font-weight:600">${escapeHtml(due)}</div>` : ""}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function reviewSection(
  title: string,
  color: string,
  items: OrganatoItem[],
  subjects: Map<string, Subject>,
  timezone: string,
  appOrigin: string,
): string {
  if (!items.length) return "";
  const rows = items
    .map((item) => reviewRow(item, subjects, timezone, appOrigin))
    .join("");
  return `<section style="margin:0 0 26px">
    <h2 style="margin:0 0 10px;color:${color};font-size:15px;line-height:1.4">${escapeHtml(title)} <span style="color:#9892a2;font-size:12px;font-weight:500">(${items.length})</span></h2>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>
  </section>`;
}

export function renderWeeklyReview(
  input: WeeklyReviewInput,
): RenderedDigest | null {
  const timezone = input.timezone ?? "Australia/Sydney";
  const subjects = new Map(
    input.subjects.map((subject) => [subject.id, subject]),
  );
  const total =
    input.done.length + input.slipped.length + input.upcoming.length;
  if (!total) return null;
  const subject = `Organato: week in review — ${input.done.length} done, ${input.slipped.length} slipped`;
  const htmlSections =
    reviewSection(
      "Completed this week",
      "#2f7d4f",
      input.done,
      subjects,
      timezone,
      input.appOrigin,
    ) +
    reviewSection(
      "Slipped",
      "#b34545",
      input.slipped,
      subjects,
      timezone,
      input.appOrigin,
    ) +
    reviewSection(
      "Coming next",
      "#7057c8",
      input.upcoming,
      subjects,
      timezone,
      input.appOrigin,
    );
  const textLine = (item: OrganatoItem) => {
    const subjectName = item.subjectId
      ? subjects.get(item.subjectId)?.displayName
      : undefined;
    const due = itemDeadline(item, timezone)?.toLocaleString("en-AU", {
      timeZone: timezone,
      dateStyle: "medium",
      ...(item.dueHasExplicitTime ? { timeStyle: "short" as const } : {}),
    });
    return `- ${item.displayName} · ${typeLabel(item)}${subjectName ? ` · ${subjectName}` : ""}${due ? ` · due ${due}` : ""}\n  ${input.appOrigin}/items/${encodeURIComponent(item.id)}`;
  };
  const text = [
    "ORGANATO — WEEK IN REVIEW",
    "",
    "COMPLETED THIS WEEK",
    ...input.done.map(textLine),
    "",
    "SLIPPED",
    ...input.slipped.map(textLine),
    "",
    "COMING NEXT",
    ...input.upcoming.map(textLine),
  ].join("\n");
  const html = `<!doctype html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body data-organato-template="${EMAIL_TEMPLATE_VERSION}" style="margin:0;background:#f4f2f8;color:#17151d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(subject)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f4f2f8" style="background:#f4f2f8">
    <tr><td align="center" style="padding:32px 14px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px">
        <tr><td style="padding:0 6px 18px;color:#17151d;font-size:20px;font-weight:800;letter-spacing:-0.02em">Organato</td></tr>
        <tr><td style="background:#17151d;border-radius:16px 16px 0 0;padding:28px 30px;color:#ffffff">
          <div style="color:#bfb5e8;font-size:12px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase">Weekly review</div>
          <h1 style="margin:8px 0 6px;font-size:28px;line-height:1.2;letter-spacing:-0.03em">Your week, honestly</h1>
          <p style="margin:0;color:#bbb7c2;font-size:14px;line-height:1.55">${input.done.length} completed · ${input.slipped.length} slipped · ${input.upcoming.length} coming next.</p>
        </td></tr>
        <tr><td style="background:#fbfaff;border:1px solid #e7e5ef;border-top:0;border-radius:0 0 16px 16px;padding:28px 30px 8px">${htmlSections}</td></tr>
        <tr><td align="center" style="padding:20px 12px 4px">
          <a href="${escapeHtml(input.appOrigin)}" style="display:inline-block;background:#7057c8;border-radius:9px;color:#ffffff;font-size:14px;font-weight:700;padding:11px 18px;text-decoration:none">Open Organato</a>
        </td></tr>
        <tr><td align="center" style="padding:14px 18px 0;color:#817b89;font-size:11px;line-height:1.65">
          A private review from Organato. No tracking pixels or third-party images.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return {
    subject,
    html,
    text,
    itemIds: [...input.done, ...input.slipped, ...input.upcoming].map(
      (item) => item.id,
    ),
  };
}

export { escapeHtml };
