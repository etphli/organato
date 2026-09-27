import { describe, expect, it, vi } from "vitest";
import { canvasSyncMessage, syncCanvasAndWait } from "../lib/canvasSync";
const summary = {
  commandId: "job",
  runId: "run",
  result: "success",
  fetched: 10,
  created: 7,
  updated: 2,
  archived: 0,
  skipped: 1,
};
describe("Canvas sync completion", () => {
  it("waits for the requested import, ignoring the previous success", async () => {
    let complete = false;
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === "POST")
        return { status: "queued", commandId: "job" };
      return {
        state: complete ? "connected" : "syncing",
        lastSync: { ...summary, commandId: complete ? "job" : "old" },
      };
    });
    const pause = vi.fn(async () => {
      complete = true;
    });
    const result = await syncCanvasAndWait(request, undefined, pause);
    expect(pause).toHaveBeenCalledOnce();
    expect(result.created).toBe(7);
    expect(canvasSyncMessage(result)).toContain(
      "10 read, 7 imported, 2 updated",
    );
  });
  it("does not report success when the Pi fails", async () => {
    const request = async (_path: string, init?: RequestInit) =>
      init?.method === "POST"
        ? { status: "queued", commandId: "job" }
        : { state: "error", error: "Reshet session expired" };
    await expect(syncCanvasAndWait(request)).rejects.toThrow(
      "Reshet session expired",
    );
  });
  it("reports empty and partial results honestly", async () => {
    expect(
      canvasSyncMessage({ ...summary, result: "success", fetched: 0 }),
    ).toContain("no assignments");
    expect(canvasSyncMessage({ ...summary, result: "partial" })).toContain(
      "incomplete",
    );
    const result = await syncCanvasAndWait(async () => ({
      status: "completed",
      ...summary,
    }));
    expect(result.fetched).toBe(10);
  });
});
