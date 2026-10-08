import { describe, expect, it } from "vitest";
import type { OrganatoItem } from "@organato/domain";
import {
  EMAIL_TEMPLATE_VERSION,
  escapeHtml,
  renderDigest,
  renderWeeklyReview,
} from "../src";

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
      estimatedMinutes: null,
      archivedAt: null,
      archiveReason: null,
      sourceMissingSince: null,
      missingSyncCount: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      overrides: [],
      attachments: [],
      history: [],
      subtasks: [],
      links: { blockedBy: [], blocking: [] },
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
    expect(digest?.html).toContain(
      `data-organato-template="${EMAIL_TEMPLATE_VERSION}"`,
    );
    expect(digest?.html).toContain("Weekly plan");
    expect(digest?.html).toContain("Open Organato");
    const legacyDigest = renderDigest({
      items: [
        { ...item, classification: "checkpoint" },
        { ...item, id: "both-1", classification: "both" },
      ],
      subjects: [],
      now,
      appOrigin: "https://organato.example",
      lastCanvasSync: "just now",
      lastCalendarSync: "just now",
    });
    expect(legacyDigest?.itemIds).toEqual(["assignment-1", "both-1"]);
    expect(legacyDigest?.text).not.toMatch(
      /Checkpoint|Assignment \+ checkpoint/,
    );
    expect(legacyDigest?.text.match(/· Assignment/g)).toHaveLength(2);
  });

  it("renders the weekly review with done, slipped, and upcoming", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    const base: OrganatoItem = {
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
      estimatedMinutes: null,
      archivedAt: null,
      archiveReason: null,
      sourceMissingSince: null,
      missingSyncCount: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      overrides: [],
      attachments: [],
      history: [],
      subtasks: [],
      links: { blockedBy: [], blocking: [] },
    };
    const review = renderWeeklyReview({
      done: [{ ...base, id: "done-1", workingStatus: "completed" }],
      slipped: [{ ...base, id: "slip-1" }],
      upcoming: [{ ...base, id: "next-1" }],
      subjects: [],
      now,
      appOrigin: "https://organato.example",
      timezone: "Australia/Sydney",
    });

    expect(review?.subject).toContain("week in review");
    expect(review?.html).toContain("Completed this week");
    expect(review?.html).toContain("Slipped");
    expect(review?.text).toContain("COMPLETED THIS WEEK");
    expect(review?.itemIds).toEqual(["done-1", "slip-1", "next-1"]);
  });

  it("returns null for an empty weekly review", () => {
    expect(
      renderWeeklyReview({
        done: [],
        slipped: [],
        upcoming: [],
        subjects: [],
        now: new Date(),
        appOrigin: "https://organato.example",
      }),
    ).toBeNull();
  });

  it("renders course signals when provided", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");
    const digest = renderDigest({
      items: [],
      subjects: [],
      now,
      appOrigin: "https://organato.example",
      lastCanvasSync: "just now",
      lastCalendarSync: "just now",
      timezone: "Australia/Sydney",
      courseSignals: {
        announcements: [
          {
            id: "9",
            courseId: "7",
            courseName: "English",
            title: "Essay moved",
            excerpt: "Due Friday.",
            url: null,
            postedAt: null,
          },
        ],
        grades: [
          { courseId: "7", courseName: "English", score: 87.5, grade: "B+" },
        ],
        modules: [
          {
            courseId: "7",
            courseName: "English",
            moduleId: "3",
            moduleName: "Unit 1",
            state: "started",
          },
        ],
      },
    });

    expect(digest?.html).toContain("Course signals");
    expect(digest?.html).toContain("Essay moved");
    expect(digest?.html).toContain("87.5%");
    expect(digest?.text).toContain("COURSE SIGNALS");
  });
});
