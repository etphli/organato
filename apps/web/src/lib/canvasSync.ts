export interface CanvasSyncSummary {
  runId: string;
  result: "success" | "partial" | "skipped";
  fetched: number;
  created: number;
  updated: number;
  archived: number;
  skipped: number;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Canvas returned an invalid sync response.");
  return value as Record<string, unknown>;
}

export function parseCanvasSyncSummary(value: unknown): CanvasSyncSummary {
  const row = record(value);
  if (
    typeof row.runId !== "string" ||
    !["success", "partial", "skipped"].includes(String(row.result))
  )
    throw new Error("Canvas returned an invalid sync result.");
  const count = (key: string) => {
    const value = row[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
      throw new Error(`Canvas returned an invalid ${key} count.`);
    return value;
  };
  const result = row.result;
  if (result !== "success" && result !== "partial" && result !== "skipped")
    throw new Error("Canvas returned an invalid sync result.");
  return {
    runId: row.runId,
    result,
    fetched: count("fetched"),
    created: count("created"),
    updated: count("updated"),
    archived: count("archived"),
    skipped: count("skipped"),
  };
}

export function canvasSyncMessage(result: CanvasSyncSummary): string {
  if (result.result === "skipped")
    return "A Canvas sync is already running. Check Canvas settings for its result.";
  const counts = `${result.fetched} read, ${result.created} imported, ${result.updated} updated, ${result.archived} archived, ${result.skipped} unchanged or skipped.`;
  if (result.result === "partial")
    return `Canvas sync incomplete. ${counts} Some courses could not be read; existing work was retained.`;
  if (result.fetched === 0)
    return `Reshet returned no assignments. ${counts} Check the connected account and Pi connector.`;
  return `Canvas sync complete. ${counts}`;
}

type Request = (path: string, init?: RequestInit) => Promise<unknown>;
export async function syncCanvasAndWait(
  request: Request,
  path = "/api/integrations/canvas/sync",
  pause = () => new Promise<void>((resolve) => setTimeout(resolve, 3000)),
): Promise<CanvasSyncSummary> {
  const response = record(await request(path, { method: "POST", body: "{}" }));
  if (response.status === "completed") return parseCanvasSyncSummary(response);
  if (response.status !== "queued" || typeof response.commandId !== "string")
    throw new Error("Canvas did not confirm a sync job. Reload and try again.");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = record(await request("/api/integrations/canvas/connector"));
    if (status.lastSync) {
      const summary = record(status.lastSync);
      if (summary.commandId === response.commandId)
        return parseCanvasSyncSummary(summary);
    }
    if (
      ["error", "login_required", "unpaired", "offline"].includes(
        String(status.state),
      )
    )
      throw new Error(
        typeof status.error === "string"
          ? status.error
          : "Canvas could not finish syncing. Check the Pi connection in Canvas settings.",
      );
    await pause();
  }
  throw new Error(
    "Canvas sync has not finished yet. Check Canvas settings for the result; no completion was confirmed.",
  );
}
