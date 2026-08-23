import { describe, expect, it } from "vitest";
import type { OrganatoItem } from "@organato/domain";
import { escapeHtml, renderDigest } from "../src";

describe("email rendering", () => {
  it("escapes imported text", () => {
    expect(escapeHtml('<script>alert("x")</script>')).not.toContain("<script>");
  });

  it("renders a polished, correctly encoded digest subject and layout", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    const item: OrganatoItem = {
      id: "assignment-1",
      version: 1,
      kind: "work",
      classification: "assignment",
      sourceType: "manual",
      canvasAssignmentId: null,
      canvasCourseId: null,
      canvasHtmlUrl: null,
      sourceName: null,
      sourceDueAt: null,
      sourceUpdatedAt: null,
      sourcePayloadHash: null,
      displayName: "English essay",
      dueAt: "2026-08-25T06:00:00.000Z",
      dueDateLocal: null,
      dueHasExplicitTime: true,
      subjectId: null,
      priority: "high",
      workingStatus: "not_started",
      completedAt: null,
      submittedAt: null,
      notesMarkdown: "",
      recurrenceRule: null,
      recurrenceSeriesId: null,
      calendarEnabled: true,
      remindersEnabled: true,
      calendarSyncState: "pending",
      calendarNote: "",
      pinned: false,
      sortRank: 0,
      archivedAt: null,
      archiveReason: null,
      sourceMissingSince: null,
      missingSyncCount: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      overrides: [],
      attachments: [],
      history: [],
    };
    const digest = renderDigest({
      items: [item],
      subjects: [],
      now,
      appOrigin: "https://organato.example",
      lastCanvasSync: "just now",
      lastCalendarSync: "just now",
      timezone: "Australia/Sydney",
    });

    expect(digest?.subject).toBe("Organato: 1 coming up this week");
    expect(digest?.subject).not.toContain("Ã");
    expect(digest?.html).toContain('<meta charset="UTF-8">');
    expect(digest?.html).toContain("Weekly plan");
    expect(digest?.html).toContain("Open Organato");
  });
});
