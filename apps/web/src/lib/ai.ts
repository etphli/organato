import {
  aiTaskSchema,
  aiBreakdownSchema,
  aiNextSchema,
  demoTask,
  demoBreakdown,
  nextCandidates,
  type AiRequest,
} from "@organato/domain/ai";
import type { OrganatoItem, Subject } from "@organato/domain/core";
import { integrationRequest } from "./integrationApi";

export const aiDemoMode = import.meta.env.VITE_DEMO_MODE === "true";

async function suggest(
  request: AiRequest,
  signal: AbortSignal,
): Promise<unknown> {
  const result: unknown = await integrationRequest("/api/ai/suggest", {
    method: "POST",
    body: JSON.stringify(request),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  if (!result || typeof result !== "object" || !("suggestion" in result))
    throw new Error("AI returned an invalid suggestion.");
  return result.suggestion;
}

export async function suggestTask(
  text: string,
  subjects: Subject[],
  timezone: string,
  signal: AbortSignal,
) {
  if (aiDemoMode)
    return demoTask(
      text,
      subjects.filter((subject) => subject.active),
      timezone,
    );
  return aiTaskSchema.parse(await suggest({ kind: "task", text }, signal));
}

export async function suggestBreakdown(
  item: OrganatoItem,
  brief: string,
  signal: AbortSignal,
) {
  if (aiDemoMode) return demoBreakdown(item.displayName);
  return aiBreakdownSchema.parse(
    await suggest({ kind: "breakdown", itemId: item.id, brief }, signal),
  );
}

export async function suggestNext(
  items: OrganatoItem[],
  timezone: string,
  minutes: number,
  signal: AbortSignal,
) {
  const candidates = nextCandidates(items, timezone);
  if (!candidates.length)
    throw new Error("No unblocked unfinished work needs attention.");
  const item = candidates[0];
  if (aiDemoMode && item)
    return aiNextSchema.parse({
      itemId: item.id,
      action:
        item.subtasks.find((step) => !step.completed)?.title ??
        `Make a start on ${item.displayName}`.slice(0, 500),
      reason:
        "This is the earliest unfinished, unblocked item in your current task order.",
      minutes: Math.max(5, Math.min(minutes, item.estimatedMinutes ?? 25)),
    });
  const suggestion = aiNextSchema.parse(
    await suggest({ kind: "next", minutes }, signal),
  );
  if (
    !candidates.some((entry) => entry.id === suggestion.itemId) ||
    suggestion.minutes > minutes
  )
    throw new Error("Your work changed. Generate a fresh recommendation.");
  return suggestion;
}
