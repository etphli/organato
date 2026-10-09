import { z } from "zod";
import { createItemComparator } from "./items";
import { localDateKey } from "./dates";
import type { OrganatoItem } from "./types";

export const aiDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, "Choose a valid date.");
export const aiTaskSchema = z
  .object({
    itemKind: z.enum(["todo", "work"]),
    name: z.string().trim().min(1).max(500),
    subjectId: z.string().max(200).nullable(),
    date: aiDateSchema.nullable(),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    priority: z.enum(["low", "medium", "high", "urgent"]).nullable(),
    clarification: z.string().max(400).nullable(),
  })
  .strict()
  .refine((value) => !value.time || value.date, "A time needs a date.");
export const aiBreakdownSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(500),
            minutes: z.number().int().min(5).max(240),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
export const aiNextSchema = z
  .object({
    itemId: z.string().min(1).max(200),
    action: z.string().trim().min(1).max(500),
    reason: z.string().trim().min(1).max(500),
    minutes: z.number().int().min(5).max(120),
  })
  .strict();
export const aiRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("task"),
      destination: z.enum(["todo", "work", "auto"]).default("todo"),
      text: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("breakdown"),
      itemId: z.string().min(1).max(200),
      brief: z.string().max(6000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("next"),
      minutes: z.number().int().min(5).max(120),
    })
    .strict(),
]);
export type AiTask = z.infer<typeof aiTaskSchema>;
export type AiBreakdown = z.infer<typeof aiBreakdownSchema>;
export type AiNext = z.infer<typeof aiNextSchema>;
export type AiRequest = z.infer<typeof aiRequestSchema>;
export type AiDestination = Extract<AiRequest, { kind: "task" }>["destination"];

export function detectTaskKind(text: string): AiTask["itemKind"] {
  return /\b(assignment|assessment|essay|draft|project|report|checkpoint)\b/i.test(
    text,
  )
    ? "work"
    : "todo";
}

export function nextCandidates(
  items: OrganatoItem[],
  timezone: string,
  now = new Date(),
) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return items
    .filter(
      (item) =>
        !item.archivedAt &&
        !["completed", "submitted"].includes(item.workingStatus) &&
        !item.links.blockedBy.some((ref) => {
          const blocker = byId.get(ref.itemId);
          return (
            !blocker ||
            !["completed", "submitted"].includes(blocker.workingStatus)
          );
        }),
    )
    .toSorted(createItemComparator(now, timezone))
    .slice(0, 15);
}

export function demoTask(
  text: string,
  subjects: { id: string; displayName: string }[],
  timezone: string,
  now = new Date(),
): AiTask {
  const today = localDateKey(now, timezone);
  const date = new Date(`${today}T12:00:00Z`);
  const weekday =
    /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(
      text,
    );
  let dateKey: string | null = null;
  if (/\btomorrow\b/i.test(text)) date.setUTCDate(date.getUTCDate() + 1);
  if (/\b(today|tomorrow)\b/i.test(text))
    dateKey = date.toISOString().slice(0, 10);
  if (weekday) {
    const day = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ].indexOf((weekday[2] ?? "").toLowerCase());
    date.setUTCDate(
      date.getUTCDate() + ((day - date.getUTCDay() + 7) % 7 || 7),
    );
    dateKey = date.toISOString().slice(0, 10);
  }
  const explicit = /\b\d{4}-\d{2}-\d{2}\b/.exec(text)?.[0];
  if (explicit && aiDateSchema.safeParse(explicit).success) dateKey = explicit;
  const clock = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  let time: string | null = null;
  if (clock && dateKey && (clock[3] || Number(clock[1]) > 12)) {
    const rawHour = Number(clock[1]);
    const hour = clock[3]
      ? (rawHour % 12) + (clock[3].toLowerCase() === "pm" ? 12 : 0)
      : rawHour;
    const candidate = `${String(hour).padStart(2, "0")}:${clock[2] ?? "00"}`;
    if (
      rawHour <= (clock[3] ? 12 : 23) &&
      rawHour >= (clock[3] ? 1 : 0) &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(candidate)
    )
      time = candidate;
  }
  const subject = subjects.find((entry) =>
    text.toLowerCase().includes(entry.displayName.toLowerCase()),
  );
  const priority = /\b(low|medium|high|urgent)(?:\s+priority)?\b/i
    .exec(text)?.[1]
    ?.toLowerCase();
  const name = text
    .replace(
      /\b(?:due\s+)?(?:today|tomorrow|(?:next\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|\d{4}-\d{2}-\d{2})\b/gi,
      "",
    )
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, "")
    .replace(/\b(?:low|medium|high|urgent)(?:\s+priority)?\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[,\s]+$/g, "")
    .trim();
  return aiTaskSchema.parse({
    itemKind: "todo",
    name: name || text,
    date: dateKey,
    time,
    subjectId: subject?.id ?? null,
    priority: priority ?? null,
    clarification:
      clock && !time
        ? "Choose a date and specify AM or PM to confirm the time."
        : !dateKey
          ? "No supported date found. Choose a date below if needed."
          : null,
  });
}

export function demoBreakdown(title: string): AiBreakdown {
  const essay = /essay|draft|writing/i.test(title);
  return {
    steps: essay
      ? [
          { title: "Read the brief and identify the question", minutes: 10 },
          { title: "Collect evidence and make an outline", minutes: 25 },
          { title: "Write the first draft", minutes: 45 },
          {
            title: "Proofread and check the submission requirements",
            minutes: 20,
          },
        ]
      : [
          {
            title: `Review the requirements for ${title}`.slice(0, 500),
            minutes: 10,
          },
          { title: "Gather materials and plan the approach", minutes: 20 },
          { title: "Complete the main work", minutes: 40 },
          { title: "Check the result against the brief", minutes: 15 },
        ],
  };
}

export const aiSettingsSchema = z.object({
  model: z.string(),
  enabled: z.boolean(),
  hasKey: z.boolean(),
  sharedAvailable: z.boolean(),
  personal: z.boolean(),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;
